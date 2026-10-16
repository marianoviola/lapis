import MarkdownIt from 'markdown-it';
import { Heading, NoteLink, NoteLinkOccurrence, NoteRecord, NoteSource, SourceRange } from '../domain/note';
import { readFrontmatter } from '../metadata/frontmatter';
import { wikilinks, WikilinkToken } from '../markdown/wikilinks';

const markdown = new MarkdownIt('commonmark').use(wikilinks);

export function parseNote(source: NoteSource): NoteRecord {
	const frontmatter = readFrontmatter(source.text);
	const tokens = markdown.parse(frontmatter.body, {});
	const headings: Heading[] = [];
	const links: NoteLinkOccurrence[] = [];
	const lines = frontmatter.body.split(/\r\n?|\n/);
	const lineOffsets = [source.text.length - frontmatter.body.length];
	for (const match of frontmatter.body.matchAll(/\r\n?|\n/g)) {
		lineOffsets.push(lineOffsets[0] + match.index + match[0].length);
	}
	for (let position = 0; position < tokens.length; position++) {
		const token = tokens[position];
		if (token.type === 'heading_open') {
			const inline = tokens[position + 1];
			const text = (inline.children ?? []).map(child => {
				if (child.type === 'lapis_wikilink') {
					const link = child.meta as NoteLink;
					return link.label ?? link.target;
				}
				return ['text', 'code_inline', 'image'].includes(child.type) ? child.content : '';
			}).join('');
			headings.push(Object.freeze({ text, level: Number(token.tag.slice(1)), line: (token.map?.[0] ?? 0) + frontmatter.bodyLine }));
		}
		const inlineLines = token.content.split('\n');
		const inlineLineOffsets = [0];
		for (const line of inlineLines.slice(0, -1)) {
			inlineLineOffsets.push(inlineLineOffsets.at(-1)! + line.length + 1);
		}
		let inlineLineIndex = 0;
		let mappedLine = -1;
		let column = 0;
		for (const child of token.children ?? []) {
			if (child.type === 'lapis_wikilink') {
				const { inlineOffset, ...link } = child.meta as WikilinkToken;
				while (inlineLineIndex + 1 < inlineLineOffsets.length && inlineLineOffsets[inlineLineIndex + 1] <= inlineOffset) {
					inlineLineIndex++;
				}
				const line = (token.map?.[0] ?? 0) + inlineLineIndex;
				const inlineLine = inlineLines[inlineLineIndex];
				const trimmedLine = inlineLine.trimStart();
				// Blockquote/list prefixes are removed by markdown-it; inline offsets
				// distinguish real links from identical text inside code spans.
				if (mappedLine !== line) {
					column = lines[line].replace(/\0/g, '\uFFFD').indexOf(trimmedLine);
					mappedLine = line;
				}
				if (column < 0) {
					throw new Error(`Cannot map wikilink source in ${source.uri} at line ${line + frontmatter.bodyLine + 1}.`);
				}
				const start = lineOffsets[line] + column + inlineOffset - inlineLineOffsets[inlineLineIndex] - (inlineLine.length - trimmedLine.length);
				const raw = source.text.slice(start, start + child.content.length);
				if (raw.replace(/\0/g, '\uFFFD') !== child.content) {
					throw new Error(`Wikilink source does not match in ${source.uri} at offset ${start}.`);
				}
				links.push(occurrence(link, raw, start));
			}
		}
	}
	const filename = source.relativePath.split('/').at(-1) ?? source.relativePath;
	const basename = filename.replace(/\.md$/i, '');
	const title = typeof frontmatter.properties.title === 'string' && frontmatter.properties.title.trim()
		? frontmatter.properties.title : basename;
	return Object.freeze({
		id: source.uri, rootUri: source.rootUri, relativePath: source.relativePath, filename, title,
		properties: frontmatter.properties, headings: Object.freeze(headings), links: Object.freeze(links),
		issues: Object.freeze(frontmatter.issues), dirty: source.dirty,
		documentVersion: source.documentVersion, ctime: source.ctime, mtime: source.mtime,
	});
}

function occurrence(link: NoteLink, raw: string, start: number): NoteLinkOccurrence {
	const contentStart = raw.startsWith('!') ? 3 : 2;
	const contentEnd = raw.length - 2;
	const pipe = raw.indexOf('|', contentStart);
	const referenceEnd = pipe < 0 ? contentEnd : raw[pipe - 1] === '\\' ? pipe - 1 : pipe;
	const hash = raw.indexOf('#', contentStart);
	const hasHeading = hash >= 0 && hash < referenceEnd;
	const range = (from: number, to: number, trim = false): SourceRange => {
		const text = raw.slice(from, to);
		const leading = trim ? text.length - text.trimStart().length : 0;
		const length = trim ? text.trim().length : text.length;
		return Object.freeze({ start: start + from + leading, end: start + from + leading + length });
	};
	return Object.freeze({
		...link,
		range: range(0, raw.length),
		targetRange: range(contentStart, hasHeading ? hash : referenceEnd, true),
		headingRange: hasHeading ? range(hash + 1, referenceEnd, true) : undefined,
		labelRange: pipe < 0 ? undefined : range(pipe + 1, contentEnd),
	});
}