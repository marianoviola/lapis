import MarkdownIt from 'markdown-it';
import { Heading, NoteLink, NoteRecord, NoteSource } from '../domain/note';
import { readFrontmatter } from '../metadata/frontmatter';
import { wikilinks } from '../markdown/wikilinks';

const markdown = new MarkdownIt('commonmark').use(wikilinks);

export function parseNote(source: NoteSource): NoteRecord {
	const frontmatter = readFrontmatter(source.text);
	const tokens = markdown.parse(frontmatter.body, {});
	const headings: Heading[] = [];
	const links: NoteLink[] = [];
	for (let position = 0; position < tokens.length; position++) {
		const token = tokens[position];
		if (token.type === 'heading_open') {
			const inline = tokens[position + 1];
			const text = (inline.children ?? []).map(child => {
				if (child.type === 'lapislazuli_wikilink') {
					const link = child.meta as NoteLink;
					return link.label ?? link.target;
				}
				return ['text', 'code_inline', 'image'].includes(child.type) ? child.content : '';
			}).join('');
			headings.push(Object.freeze({ text, level: Number(token.tag.slice(1)), line: (token.map?.[0] ?? 0) + frontmatter.bodyLine }));
		}
		for (const child of token.children ?? []) {
			if (child.type === 'lapislazuli_wikilink') {
				links.push(Object.freeze({ ...child.meta as NoteLink }));
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