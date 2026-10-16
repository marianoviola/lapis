import { posix } from 'node:path';
import MarkdownIt from 'markdown-it';
import { NoteRecord } from '../domain/note';
import { NoteIndex } from '../index/noteIndex';
import { wikilinks, WikilinkToken } from '../markdown/wikilinks';
import { readFrontmatter } from '../metadata/frontmatter';

const markdown = new MarkdownIt('commonmark').use(wikilinks);

export interface CompletionContext {
	readonly start: number;
	readonly end: number;
	readonly target: string;
	readonly heading: boolean;
	readonly suffix: string;
}

export interface LinkSuggestion {
	readonly label: string;
	readonly description: string;
	readonly insertText: string;
	readonly filterText: string;
}

export function completionContext(text: string, offset: number): CompletionContext | undefined {
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const opening = text.lastIndexOf('[[', offset - 1);
	if (opening < lineStart || offset < opening + 2) {
		return undefined;
	}
	const before = text.slice(opening + 2, offset);
	if (/[\]|]/.test(before)) {
		return undefined;
	}
	const lineEnd = text.indexOf('\n', offset);
	const rest = text.slice(opening + 2, lineEnd < 0 ? text.length : lineEnd).replace(/\r$/, '');
	const closing = rest.indexOf(']]');
	const content = closing < 0 ? rest : rest.slice(0, closing);
	// In an unfinished link, replace only the typed reference, not following prose.
	const end = closing < 0 ? offset : opening + 2 + closing + 2;
	let marker = 'lapislazuli-completion-context';
	while (text.includes(marker)) {
		marker += '-';
	}
	const candidate = text.slice(0, opening) + `[[${marker}]]` + text.slice(end);
	const tokens = markdown.parse(readFrontmatter(candidate).body, {});
	if (!tokens.some(token => token.children?.some(child =>
		child.type === 'lapis_wikilink' && (child.meta as WikilinkToken).target === marker))) {
		return undefined;
	}
	const hash = before.indexOf('#');
	const pipe = content.indexOf('|');
	const alias = closing >= 0 && pipe >= 0 ? content.slice(content[pipe - 1] === '\\' ? pipe - 1 : pipe) : '';
	return {
		start: hash < 0 ? opening + 2 : opening + 3 + hash,
		end, target: (hash < 0 ? before : before.slice(0, hash)).trim(),
		heading: hash >= 0, suffix: `${alias}]]`,
	};
}

function shortestTarget(note: NoteRecord, from: NoteRecord, notes: NoteIndex): string | undefined {
	const path = note.relativePath.replace(/\.md$/i, '');
	const relative = posix.relative(posix.dirname(from.relativePath), path);
	const candidates = [...new Set([
		note.filename.replace(/\.md$/i, ''), path,
		relative.startsWith('../') ? relative : `./${relative}`, `/${path}`,
		note.filename, note.relativePath,
		relative.startsWith('../') ? `${relative}.md` : `./${relative}.md`, `/${note.relativePath}`,
	])].sort((left, right) => left.length - right.length);
	return candidates.find(target => {
		if (!target || /[[\]#|\r\n]/.test(target) || target.trim() !== target) {
			return false;
		}
		const resolution = notes.resolve(target, from.id);
		return resolution.kind === 'resolved' && resolution.note.id === note.id;
	});
}

export function linkSuggestions(notes: NoteIndex, fromUri: string, context: CompletionContext): LinkSuggestion[] {
	const from = notes.get(fromUri);
	if (!from) {
		return [];
	}
	if (context.heading) {
		const resolution = notes.resolve(context.target, fromUri);
		if (resolution.kind !== 'resolved') {
			return [];
		}
		return [...new Set(resolution.note.headings.map(heading => heading.text))]
			.filter(heading => !!heading && heading.trim() === heading && !/[\]|\r\n]/.test(heading))
			.map(heading => ({
				label: heading, description: resolution.note.relativePath,
				insertText: heading + context.suffix, filterText: heading,
			}));
	}
	const query = context.target.toLocaleLowerCase();
	return notes.getNotes().filter(note => note.rootUri === from.rootUri).flatMap(note => {
		const target = shortestTarget(note, from, notes);
		return target && [note.title, note.relativePath, target].some(value => value.toLocaleLowerCase().includes(query)) ? [{
			label: note.title, description: note.relativePath,
			insertText: target + context.suffix,
			filterText: `${context.target} ${note.title} ${note.relativePath}`,
		}] : [];
	});
}
