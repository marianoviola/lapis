import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { wikilinks } from '../src/markdown/wikilinks';
import { parseNote } from '../src/index/parseNote';
import { readFrontmatter } from '../src/metadata/frontmatter';

function note(text: string) {
	return parseNote({ uri: 'file:///vault/Note.md', rootUri: 'file:///vault', relativePath: 'Note.md', text, dirty: false });
}

describe('note parsing', () => {
	it('keeps YAML properties typed and dates as strings', () => {
		const record = note('---\ntitle: My note\ndue: 2026-10-20\nactive: true\ncount: 3\ntags: [one, two]\nextra:\n  value: null\n---\n# Heading\nBody');
		expect(record.title).toBe('My note');
		expect(record.properties).toMatchObject({ due: '2026-10-20', active: true, count: 3, tags: ['one', 'two'], extra: { value: null } });
		expect(record.headings).toEqual([{ text: 'Heading', level: 1, line: 9 }]);
	});
	it('recognizes links, aliases, headings and embeds outside code', () => {
		const record = note('[[Note]] [[Other|Label]] [[Other#Heading]] ![[Other.md]] [[#Local]]\n`[[Inline]]` \\[[Escaped]]\n\n```md\n[[Fenced]]\n```\n\n    [[Indented]]');
		expect(record.links).toHaveLength(5);
		expect(record.links[1]).toMatchObject({ target: 'Other', label: 'Label' });
		expect(record.links[2]).toMatchObject({ target: 'Other', heading: 'Heading' });
		expect(record.links[3]).toMatchObject({ target: 'Other.md', embed: true });
		expect(record.links[4]).toMatchObject({ target: '', heading: 'Local' });
	});
	it('recognizes escaped alias separators without changing raw rendering', () => {
		const record = note(String.raw`[[Other\|Label]] [[Other#Heading\|Label]] ![[Other\|Embed]]`);
		expect(record.links).toEqual([
			{ target: 'Other', heading: undefined, label: 'Label', embed: false },
			{ target: 'Other', heading: 'Heading', label: 'Label', embed: false },
			{ target: 'Other', heading: undefined, label: 'Embed', embed: true },
		]);
	});
	it('handles escaped aliases inside native Markdown tables', () => {
		const markdown = new MarkdownIt().use(wikilinks);
		const table = String.raw`| Link |
| --- |
| [[Other#Heading\|Alias]] |`;
		const tokens = markdown.parse(table, {});
		const link = tokens.flatMap(token => token.children ?? []).find(token => token.type === 'lapislazuli_wikilink');
		expect(link?.meta).toMatchObject({ target: 'Other', heading: 'Heading', label: 'Alias' });
		expect(markdown.render(table)).toContain('[[Other#Heading|Alias]]');
		expect(markdown.render(String.raw`[[Other\|Alias]]`)).toContain(String.raw`[[Other\|Alias]]`);
	});
	it('preserves the body and line offsets with a BOM and CRLF', () => {
		const text = '\uFEFF---\r\nstatus: doing\r\n---\r\n# Heading\r\nBody\r\n';
		expect(readFrontmatter(text).body).toBe('# Heading\r\nBody\r\n');
		expect(note(text).headings[0].line).toBe(3);
	});
	it('reports malformed metadata without discarding valid Markdown', () => {
		const record = note('---\nstatus: [\n---\n# Still available');
		expect(record.issues.length).toBeGreaterThan(0);
		expect(Object.keys(record.properties)).toEqual([]);
		expect(record.headings[0].text).toBe('Still available');
	});
	it('rejects duplicate keys, non-mappings, aliases and non-finite numbers', () => {
		for (const yaml of ['status: todo\nstatus: done', '- todo', 'original: &value [one]\ncopy: *value', 'value: .inf']) {
			expect(note(`---\n${yaml}\n---\nBody`).issues.length).toBeGreaterThan(0);
		}
	});
	it('does not mistake a body separator for frontmatter', () => {
		const record = note('# Title\n---\nstatus: doing');
		expect(record.title).toBe('Note');
		expect(Object.keys(record.properties)).toEqual([]);
	});
	it('reports an unterminated preamble', () => {
		expect(note('---\nstatus: todo').issues[0].message).toContain('closing delimiter');
	});
	it('protects special property names and freezes nested values', () => {
		const record = note('---\n__proto__: portable\ntags: [one]\n---\n');
		expect(record.properties.__proto__).toBe('portable');
		expect(Object.getPrototypeOf(record.properties)).toBeNull();
		expect(Object.isFrozen(record.properties.tags)).toBe(true);
	});
});