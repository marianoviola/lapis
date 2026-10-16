import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { previewFrontmatter } from '../src/markdown/preview';

describe('native preview frontmatter', () => {
	it.each(['\n', '\r\n'])('hides YAML metadata while retaining body markup and line maps with %j', newline => {
		const text = ['\uFEFF---', 'title: Private metadata', 'tags: [one, two]', '---', '# Body', '', '---', '', 'Visible'].join(newline);
		const markdown = new MarkdownIt().use(previewFrontmatter);
		const html = markdown.render(text);
		expect(html).not.toContain('Private metadata');
		expect(html).not.toContain('tags');
		expect(html).toContain('<h1>Body</h1>');
		expect(html).toContain('<hr>');
		expect(html).toContain('<p>Visible</p>');
		expect(markdown.parse(text, {}).find(token => token.type === 'heading_open')?.map).toEqual([4, 5]);
	});
	it.each(['', 'status: [', '- non-mapping', 'title: hidden'])('hides a closed preamble regardless of YAML validity: %j', yaml => {
		const markdown = new MarkdownIt().use(previewFrontmatter);
		expect(markdown.render(`---\n${yaml}\n---\nBody`)).toBe('<p>Body</p>\n');
	});
	it('does not hide ordinary Markdown, code blocks or an unterminated preamble', () => {
		const plain = new MarkdownIt();
		const markdown = new MarkdownIt().use(previewFrontmatter);
		for (const text of ['# Body\n---\ntitle: visible', '```yaml\n---\ntitle: visible\n---\n```', '---\ntitle: visible']) {
			expect(markdown.render(text)).toBe(plain.render(text));
		}
	});
	it('hides frontmatter ending at EOF without hiding later renders', () => {
		const markdown = new MarkdownIt().use(previewFrontmatter);
		expect(markdown.render('---\ntitle: hidden\n---')).toBe('');
		expect(markdown.render('# Body')).toBe('<h1>Body</h1>\n');
	});
});
