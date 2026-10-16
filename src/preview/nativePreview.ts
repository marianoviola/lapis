import { posix } from 'node:path';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { NoteRecord } from '../domain/note';
import { WorkspaceIndex } from '../index/workspaceIndex';
import { previewFrontmatter, previewTaskLists } from '../markdown/preview';
import { previewWikilinks } from './wikilinks';

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
	const signature = (note: NoteRecord) => JSON.stringify([note.rootUri, note.relativePath, note.headings]);
	const signatures = new Map(workspace.notes.getNotes().map(note => [note.id, signature(note)]));
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
			previewFrontmatter(markdown);
			previewTaskLists(markdown);
			markdown.core.ruler.before('block', 'lapis_preview_buffers', () => workspace.synchronizeOpenDocuments());
			const contexts = new WeakMap<object, object>();
			markdown.core.ruler.before('inline', 'lapis_preview_context', state => {
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
						token.children = markdown.parseInline(token.content, context)[0].children;
					}
					return render(tokens, options, env);
				} finally {
					inlines.forEach((token, index) => { token.children = children[index]; });
				}
			};
			return previewWikilinks(markdown, workspace.notes, currentDocument, (from, note, fragment) => {
				const relative = posix.relative(posix.dirname(vscode.Uri.parse(from).path), vscode.Uri.parse(note.id).path);
				const path = relative.split('/').map(segment => encodeURIComponent(segment)).join('/');
				// A relative prefix prevents filenames containing ':' becoming URI schemes.
				return `./${path}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
			});
		},
		dispose() {
			disposed = true;
			clearTimeout(timer);
			listener.dispose();
		},
	};
}
