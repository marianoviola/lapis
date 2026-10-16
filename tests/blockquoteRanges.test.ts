import { describe, expect, it } from 'vitest';
import { blockquoteRanges } from '../src/language/blockquoteRanges';

describe('blockquote source text colours', () => {
	const decorated = (text: string) => blockquoteRanges(text).map(range => text.slice(range.start, range.end));

	it('selects quote text, lazy continuations and nested quotes without markers', () => {
		expect(decorated('Ordinary\n\n> Quote\ncontinued\n>\n> > Nested\n')).toEqual(['Quote', 'continued', 'Nested']);
	});

	it('preserves inline code, links, wikilinks, images and fenced code colours', () => {
		const text = '> Plain **bold** and `code` [[Note|Label]] [link](url) ![image](url).\n>\n> ```ts\n> const green = true;\n> ```\n';
		const selected = decorated(text).join('');
		expect(selected).toContain('Plain ');
		expect(selected).toContain('bold');
		for (const excluded of ['code', 'Note', 'Label', 'link', 'url', 'image', 'const green', '>']) {
			expect(selected).not.toContain(excluded);
		}
	});

	it('ignores frontmatter, escaped quote markers and quotes inside code', () => {
		expect(decorated('---\ntitle: "> metadata"\n---\n\\> escaped\n\n```\n> code\n```\n')).toEqual([]);
	});

	it('preserves reference-link colours using document-level definitions', () => {
		expect(decorated('> Before [reference][id] after\n\n[id]: https://example.com\n')).toEqual(['Before ', ' after']);
	});

	it('maps CRLF, list prefixes, repeated text and inline code correctly', () => {
		expect(decorated('---\r\ntitle: test\r\n---\r\n- > `same` same\r\n  > > Nested\r\n')).toEqual([' same', 'Nested']);
	});
});
