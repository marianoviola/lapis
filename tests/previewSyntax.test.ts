import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import footnote from 'markdown-it-footnote';
import { previewSyntax } from '../src/markdown/previewSyntax';
import { previewFrontmatter, previewTaskLists } from '../src/markdown/preview';

describe('preview highlight and footnotes', () => {
	it('renders highlights with formatting and leaves escaped markers and code alone', () => {
		const markdown = new MarkdownIt().use(previewSyntax);
		const html = markdown.render('==**Important**== \\==plain== `==code==`\n\n```\n==fenced==\n```\n');
		expect(html).toContain('<mark><strong>Important</strong></mark>');
		expect(html.match(/<mark>/g)).toHaveLength(1);
		expect(html).toContain('==plain==');
		expect(html).toContain('<code>==code==</code>');
		expect(html).toContain('==fenced==');
	});

	it('renders repeated references, inline footnotes and formatted definitions with backlinks', () => {
		const markdown = new MarkdownIt().use(previewSyntax);
		const html = markdown.render('One[^a], again[^a], inline^[==Inline==].\n\n[^a]: **Definition**\n\n    Second paragraph.\n');
		expect(html).toContain('id="fnref1"');
		expect(html).toContain('id="fnref1:1"');
		expect(html).toContain('href="#fnref1:1"');
		expect(html).toContain('<strong>Definition</strong>');
		expect(html).toContain('Second paragraph.');
		expect(html).toContain('<mark>Inline</mark>');
		expect(html.match(/class="footnote-item"/g)).toHaveLength(2);
	});

	it('does not process undefined references or footnote syntax in code', () => {
		const markdown = new MarkdownIt().use(previewSyntax);
		const html = markdown.render('Missing[^missing] `[^code]`\n\n```\n[^code]: fenced\n```\n');
		expect(html).toContain('Missing[^missing]');
		expect(html).toContain('<code>[^code]</code>');
		expect(html).not.toContain('class="footnote-ref"');
		expect(html).not.toContain('class="footnotes"');
	});

	it('reuses installed plugins and preserves custom renderers on repeated registration', () => {
		const markdown = new MarkdownIt().use(mark).use(footnote);
		const reference = markdown.renderer.rules.footnote_ref!;
		markdown.renderer.rules.footnote_ref = (...args) => `<span>${reference(...args)}</span>`;
		const custom = markdown.renderer.rules.footnote_ref;
		const text = '==Highlighted==[^a]\n\n[^a]: Footnote';
		const expected = markdown.render(text);
		markdown.use(previewSyntax).use(previewSyntax);
		expect(markdown.renderer.rules.footnote_ref).toBe(custom);
		expect(markdown.render(text)).toBe(expected);
	});

	it('adds whichever syntax is absent and coexists with metadata hiding and task lists', () => {
		for (const existing of [mark, footnote]) {
			const markdown = new MarkdownIt().use(existing).use(previewSyntax)
				.use(previewFrontmatter).use(previewTaskLists);
			const html = markdown.render('---\ntitle: hidden\n---\n- [x] ==Task==[^a]\n\n[^a]: ==Note==');
			expect(html).not.toContain('hidden');
			expect(html).toContain('type="checkbox"');
			expect(html).toContain('<mark>Task</mark>');
			expect(html).toContain('<mark>Note</mark>');
			expect(html.match(/class="footnote-item"/g)).toHaveLength(1);
		}
	});
});
