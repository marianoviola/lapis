import { posix } from 'node:path';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { NoteRecord } from '../domain/note';
import { WorkspaceIndex } from '../index/workspaceIndex';
import { previewFrontmatter, previewTaskLists } from '../markdown/preview';
import { previewSyntax } from '../markdown/previewSyntax';
import { previewWikilinks } from './wikilinks';
import { parseBase } from '../bases/base';
import { renderInlineBase } from './base';

interface InlineBaseFile {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	readonly text: string;
}

type InlineBaseResolution = { readonly kind: 'resolved'; readonly file: InlineBaseFile }
	| { readonly kind: 'missing' }
	| { readonly kind: 'ambiguous'; readonly files: readonly InlineBaseFile[] };

const maxInlineBaseBytes = 2 * 1024 * 1024;

// currentDocument and markdown.preview.refresh are version-tested native adapters.
function currentDocument(env: unknown): string | undefined {
	if (typeof env !== 'object' || env === null || !('currentDocument' in env)) {
		return undefined;
	}
	return env.currentDocument instanceof vscode.Uri ? env.currentDocument.toString() : undefined;
}

export function nativePreview(workspace: WorkspaceIndex, output: vscode.LogOutputChannel):
	vscode.Disposable & { extendMarkdownIt(markdown: MarkdownIt): MarkdownIt } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let used = false;
	let disposed = false;
	const signature = (note: NoteRecord) => JSON.stringify([
		note.rootUri, note.relativePath, note.title, note.headings, note.properties, note.ctime, note.mtime,
	]);
	const signatures = new Map(workspace.notes.getNotes().map(note => [note.id, signature(note)]));
	const inlineBases = new Map<string, readonly InlineBaseFile[]>();
	const inlineBaseErrors = new Map<string, string>();
	const loadingRoots = new Set<string>();
	const refresh = () => {
		if (!used || disposed) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, error => {
				output.error(`Cannot refresh Markdown preview: ${String(error)}`);
			});
		}, 100);
	};
	const loadInlineBases = (rootUri: string) => {
		if (loadingRoots.has(rootUri)) {
			return;
		}
		loadingRoots.add(rootUri);
		inlineBaseErrors.delete(rootUri);
		void (async () => {
			try {
				const root = vscode.Uri.parse(rootUri);
				const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.base'));
				const loaded = await Promise.all(files.map(async uri => {
					try {
						const document = vscode.workspace.textDocuments.find(candidate =>
							!candidate.isClosed && candidate.uri.toString() === uri.toString());
						const bytes = document ? Buffer.from(document.getText(), 'utf8') : await vscode.workspace.fs.readFile(uri);
						if (bytes.byteLength > maxInlineBaseBytes) {
							throw new Error('Base file exceeds the 2 MiB inline preview limit.');
						}
						const relativePath = uri.path.slice(root.path.replace(/\/$/, '').length + 1);
						return {
							uri,
							relativePath,
							text: document ? document.getText() : new TextDecoder('utf-8', { fatal: true }).decode(bytes),
						} satisfies InlineBaseFile;
					} catch (error) {
						output.error(`Cannot load inline Base ${uri.toString()}: ${error instanceof Error ? error.message : String(error)}`);
						return undefined;
					}
				}));
				inlineBases.set(rootUri, loaded.filter((file): file is InlineBaseFile => !!file));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				inlineBaseErrors.set(rootUri, message);
				output.error(`Cannot discover inline Bases in ${rootUri}: ${message}`);
			} finally {
				loadingRoots.delete(rootUri);
				refresh();
			}
		})();
	};
	const baseWatcher = vscode.workspace.createFileSystemWatcher('**/*.base');
	const reloadRootFor = (uri: vscode.Uri) => {
		const rootUri = workspace.getVaultRoot(uri);
		if (rootUri && inlineBases.has(rootUri)) {
			loadInlineBases(rootUri);
		}
	};
	const baseSubscriptions = [
		baseWatcher.onDidCreate(reloadRootFor),
		baseWatcher.onDidChange(reloadRootFor),
		baseWatcher.onDidDelete(reloadRootFor),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (/\.base$/i.test(event.document.uri.path)) {
				reloadRootFor(event.document.uri);
			}
		}),
		vscode.workspace.onDidOpenTextDocument(document => {
			if (/\.base$/i.test(document.uri.path)) {
				reloadRootFor(document.uri);
			}
		}),
		vscode.workspace.onDidRenameFiles(event => {
			for (const { oldUri, newUri } of event.files) {
				reloadRootFor(oldUri);
				reloadRootFor(newUri);
			}
		}),
	];
	const listener = workspace.notes.onDidChange(uri => {
		const note = workspace.notes.get(uri);
		const next = note ? signature(note) : undefined;
		if (next === signatures.get(uri)) {
			return;
		}
		if (next === undefined) {
			signatures.delete(uri);
		} else {
			signatures.set(uri, next);
		}
		refresh();
	});
	return {
		extendMarkdownIt(markdown) {
			used = true;
			previewSyntax(markdown);
			previewFrontmatter(markdown);
			previewTaskLists(markdown);
			markdown.core.ruler.before('block', 'lapis_preview_buffers', () => workspace.synchronizeOpenDocuments());
			const contexts = new WeakMap<object, object>();
			markdown.core.ruler.push('lapis_preview_context', state => {
				const env: unknown = state.env;
				if (typeof env === 'object' && env !== null) {
					for (const token of state.tokens) {
						if (token.type === 'inline' && token.content.includes('[[')) {
							contexts.set(token, env);
						}
					}
				}
			});
			const render = markdown.renderer.render.bind(markdown.renderer);
			markdown.renderer.render = (tokens, options, env: unknown) => {
				const from = currentDocument(env);
				if (!from || !workspace.notes.get(from)) {
					return render(tokens, options, env);
				}
				// Native document tokenization omits currentDocument. Reparse affected
				// inlines with render context, then restore the native token cache.
				workspace.synchronizeOpenDocuments();
				const inlines = tokens.filter(token => token.type === 'inline' && token.content.includes('[['));
				const children = inlines.map(token => token.children);
				try {
					for (const token of inlines) {
						const context = Object.assign({}, contexts.get(token), env);
						// Footnote parsing increments counters in env. Reparse a copy,
						// retaining the original reference IDs and backlink numbering.
						if ('footnotes' in context) {
							context.footnotes = structuredClone(context.footnotes);
						}
						const references = token.children?.filter(child => child.type === 'footnote_ref') ?? [];
						let reference = 0;
						token.children = markdown.parseInline(token.content, context)[0].children?.map(child =>
							child.type === 'footnote_ref' && references[reference]
								? references[reference++] : child) ?? null;
					}
					return render(tokens, options, env);
				} finally {
					inlines.forEach((token, index) => { token.children = children[index]; });
				}
			};
			const relativeHref = (from: string, target: vscode.Uri) => {
				const relative = posix.relative(posix.dirname(vscode.Uri.parse(from).path), target.path);
				const path = relative.split('/').map(segment => encodeURIComponent(segment)).join('/');
				return `./${path}`;
			};
			return previewWikilinks(markdown, workspace.notes, currentDocument, (from, note, fragment) => {
				const destination = relativeHref(from, vscode.Uri.parse(note.id));
				// A relative prefix prevents filenames containing ':' becoming URI schemes.
				return `${destination}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
			}, (target, from, embed, label, view) => {
				const note = workspace.notes.get(from);
				if (!note) {
					return undefined;
				}
				const bases = inlineBases.get(note.rootUri);
				if (!bases) {
					loadInlineBases(note.rootUri);
					const error = inlineBaseErrors.get(note.rootUri);
					return error
						? `<span class="lapis-inline-base-error" title="${markdown.utils.escapeHtml(error)}">Base preview unavailable</span>`
						: undefined;
				}
				const resolution = resolveInlineBase(target, note, bases);
				if (resolution.kind === 'missing') {
					const visible = markdown.utils.escapeHtml(label ?? target);
					return `<span class="lapis-wikilink-missing" title="Unresolved Base">${visible}</span>`;
				}
				if (resolution.kind === 'ambiguous') {
					const files = resolution.files.map(file => file.relativePath).join(', ');
					const visible = markdown.utils.escapeHtml(label ?? target);
					return `<span class="lapis-wikilink-ambiguous" title="${markdown.utils.escapeHtml(`Ambiguous Base: ${files}`)}">${visible}</span>`;
				}
				const file = resolution.file;
				if (!embed) {
					const destination = markdown.utils.escapeHtml(relativeHref(from, file.uri));
					return `<a class="lapis-wikilink" href="${destination}" data-href="${destination}">${markdown.utils.escapeHtml(label ?? file.relativePath.replace(/\.base$/i, ''))}</a>`;
				}
				const notes = workspace.notes.getNotes().filter(candidate => candidate.rootUri === note.rootUri);
				const title = label ?? file.relativePath.replace(/\.base$/i, '');
				return renderInlineBase(parseBase(file.text), title, notes,
					targetNote => relativeHref(from, vscode.Uri.parse(targetNote.id)), view);
			});
		},
		dispose() {
			disposed = true;
			clearTimeout(timer);
			listener.dispose();
			baseWatcher.dispose();
			baseSubscriptions.forEach(subscription => subscription.dispose());
		},
	};
}

function resolveInlineBase(target: string, from: NoteRecord, files: readonly InlineBaseFile[]): InlineBaseResolution {
	const reference = target.trim().replace(/\.base$/i, '');
	if (!reference) {
		return { kind: 'missing' };
	}
	if (!reference.includes('/') && reference !== '.' && reference !== '..') {
		const candidates = files.filter(file => posix.basename(file.relativePath).replace(/\.base$/i, '') === reference);
		if (candidates.length === 1) {
			return { kind: 'resolved', file: candidates[0] };
		}
		if (candidates.length > 1) {
			return { kind: 'ambiguous', files: candidates };
		}
	}
	const absolute = reference.startsWith('/');
	const relative = reference.startsWith('./') || reference.startsWith('../');
	const possiblePaths = absolute ? [reference.slice(1)]
		: relative ? [posix.join(posix.dirname(from.relativePath), reference)]
			: [posix.join(posix.dirname(from.relativePath), reference), reference];
	for (const candidate of possiblePaths) {
		const path = posix.normalize(candidate);
		if (path === '..' || path.startsWith('../') || posix.isAbsolute(path)) {
			continue;
		}
		const matches = files.filter(file => file.relativePath.replace(/\.base$/i, '') === path);
		if (matches.length === 1) {
			return { kind: 'resolved', file: matches[0] };
		}
		if (matches.length > 1) {
			return { kind: 'ambiguous', files: matches };
		}
	}
	return { kind: 'missing' };
}
