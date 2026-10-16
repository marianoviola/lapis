import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { NoteIndex } from '../src/index/noteIndex';
import { headingFragment, previewWikilinks } from '../src/preview/wikilinks';

function fixture() {
	const notes = new NoteIndex(async () => undefined);
	const add = (path: string, text = '', rootUri = 'file:///vault') => notes.upsert({
		uri: `${rootUri}/${path}`, rootUri, relativePath: path, text, dirty: false,
	});
	add('Source.md');
	add('Target.md', '# Héllo, *World*! `code`\n# Repeat\n# Repeat\n# Repeat-1\n# A [[Target|label]] B\n');
	add('one/Duplicate.md');
	add('two/Duplicate.md');
	add('Private.md', '', 'file:///private');
	const markdown = previewWikilinks(new MarkdownIt(), notes,
		env => typeof env === 'string' ? env : undefined,
		(_from, note, fragment) => `./${note.relativePath}${fragment ? `#${fragment}` : ''}`);
	return { notes, add, markdown, render: (text: string) => markdown.render(text, 'file:///vault/Source.md') };
}

describe('preview wikilinks', () => {
	it('renders aliases and exact heading anchors, falling back to the document top', () => {
		const { render, notes } = fixture();
		expect(render('[[Target#Héllo, World! code\\|Go]]')).toContain(
			'href="./Target.md#héllo-world-code" data-href="./Target.md#héllo-world-code">Go</a>');
		expect(render('[[Target#Absent]]')).toContain('href="./Target.md"');
		expect(render('[[#Local]]')).toContain('href="./Source.md"');
		const target = notes.get('file:///vault/Target.md')!;
		expect(target.headings.map(heading => heading.slug)).toEqual([
			'héllo-world-code', 'repeat', 'repeat-1', 'repeat-1', 'a--b',
		]);
		expect(headingFragment(target, 'Repeat')).toBe('repeat');
	});

	it('distinguishes missing and ambiguous links without making them navigable', () => {
		const { render } = fixture();
		expect(render('[[Missing]]')).toContain('class="lapislazuli-wikilink-missing"');
		const ambiguous = render('[[Duplicate]]');
		expect(ambiguous).toContain('class="lapislazuli-wikilink-ambiguous"');
		expect(ambiguous).toContain('one/Duplicate.md, two/Duplicate.md');
		expect(ambiguous).not.toContain('<a ');
		expect(render('[[Private]]')).toContain('lapislazuli-wikilink-missing');
	});

	it('escapes labels and candidate tooltips without interpreting Markdown or HTML', () => {
		const { add, render } = fixture();
		add('one/Bad"<.md');
		add('two/Bad"<.md');
		expect(render('[[Target|<img src=x onerror=alert(1)> & "Go"]]'))
			.toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Go&quot;</a>');
		expect(render('[[Bad"<]]')).toContain('one/Bad&quot;&lt;.md');
		expect(render('[[javascript:alert(1)]]')).not.toContain('<a ');
	});

	it('preserves raw text outside indexed vaults and without native document context', () => {
		const { markdown } = fixture();
		for (const env of [undefined, {}, 'file:///unmarked/Source.md']) {
			expect(markdown.render('[[Target|Alias]] ![[Target]]', env))
				.toBe('<p>[[Target|Alias]] ![[Target]]</p>\n');
		}
	});

	it('keeps code, escaped links, existing Markdown links and embeds inert', () => {
		const { render } = fixture();
		const html = render('`[[Target]]` \\[[Target]] ![[Target]] [normal](https://example.com)\n\n```\n[[Target]]\n```');
		expect(html).not.toContain('class="lapislazuli-wikilink"');
		expect(html).toContain('<code>[[Target]]</code>');
		expect(html).toContain('![[Target]]');
		expect(html).toContain('href="https://example.com"');
	});

	it('resolves against current index state across target creation, ambiguity and deletion', () => {
		const { add, notes, render } = fixture();
		expect(render('[[Later]]')).toContain('wikilink-missing');
		add('one/Later.md');
		expect(render('[[Later]]')).toContain('href="./one/Later.md"');
		add('two/Later.md');
		expect(render('[[Later]]')).toContain('wikilink-ambiguous');
		notes.remove('file:///vault/one/Later.md');
		expect(render('[[Later]]')).toContain('href="./two/Later.md"');
		notes.remove('file:///vault/two/Later.md');
		expect(render('[[Later]]')).toContain('wikilink-missing');
	});
});
