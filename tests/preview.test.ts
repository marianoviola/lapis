import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { previewFrontmatter, previewTaskLists } from '../src/markdown/preview';

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

	describe('native preview GFM task lists', () => {
		it('renders unchecked and lowercase/uppercase checked markers as disabled checkboxes', () => {
			const markdown = new MarkdownIt().use(previewTaskLists);
			const html = markdown.render('- [ ] Pending\n- [x] Done\n- [X] Also done\n- Ordinary');
			expect(html.match(/type="checkbox"/g)).toHaveLength(3);
			expect(html.match(/disabled=""/g)).toHaveLength(3);
			expect(html.match(/checked=""/g)).toHaveLength(2);
			expect(html.match(/class="lapis-task-list-item"/g)).toHaveLength(3);
			expect(html).toContain('> Pending</li>');
			expect(html).toContain('> Done</li>');
			expect(html).toContain('<li>Ordinary</li>');
			expect(html).not.toMatch(/\[[ xX]\]/);
		});

		it('supports nested, ordered, loose and empty tasks while retaining formatting and line maps', () => {
			const markdown = new MarkdownIt().use(previewTaskLists);
			const text = '1. [ ] **Parent**\n   - [X] Child\n\n2. [x] Done\n\n   Later paragraph\n\n3. [ ]\n';
			const html = markdown.render(text);
			expect(html.match(/type="checkbox"/g)).toHaveLength(4);
			expect(html).toContain('<strong>Parent</strong>');
			expect(html).toContain('Child');
			expect(html).toContain('<p>Later paragraph</p>');
			const tokens = markdown.parse(text, {});
			expect(tokens.find(token => token.type === 'list_item_open')?.map).toEqual([0, 3]);
			expect(tokens.find(token => token.type === 'inline')?.map).toEqual([0, 1]);
		});

		it('leaves code, escaped markers, non-list text and invalid markers unchanged', () => {
			const plain = new MarkdownIt();
			const markdown = new MarkdownIt().use(previewTaskLists);
			for (const text of [
				'[ ] Paragraph', '- \\[ ] Escaped', '- `[x]` Code', '- [x]without space',
				'- [y] Invalid', '- Prefix [ ] later', '- Item\n\n  [x] Second paragraph',
				'```\n- [x] Fenced\n```', '    - [x] Indented',
			]) {
				expect(markdown.render(text)).toBe(plain.render(text));
			}
		});

		it('keeps metadata hidden and preserves links, CRLF, tabs and XHTML output', () => {
			const markdown = new MarkdownIt({ xhtmlOut: true }).use(previewFrontmatter).use(previewTaskLists);
			const html = markdown.render('---\r\ntitle: hidden\r\n---\r\n- [x]\t[Link](https://example.com)\r\n');
			expect(html).not.toContain('hidden');
			expect(html).toContain('checked="" />');
			expect(html).toContain('<a href="https://example.com">Link</a>');
		});
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
