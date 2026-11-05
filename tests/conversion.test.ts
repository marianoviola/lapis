import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToDocx } from '../src/markdown/conversion';

describe('HTML and Markdown conversion', () => {
	it('converts common Word HTML formatting and structure to Markdown', () => {
		const markdown = htmlToMarkdown(`
			<p class="MsoHeading2">Meeting notes</p>
			<p><span style="font-weight: bold">Important</span> <i>detail</i>
				<a href="https://example.com">Reference</a></p>
			<ul><li>First item</li><li>Second item</li></ul>
			<table><tr><th>Name</th><th>Value</th></tr><tr><td>Topic</td><td>Notes</td></tr></table>
		`);

		expect(markdown).toContain('## Meeting notes');
		expect(markdown).toContain('**Important**');
		expect(markdown).toContain('*detail*');
		expect(markdown).toContain('[Reference](https://example.com)');
		expect(markdown).toMatch(/- +First item/);
		expect(markdown).toContain('| Name | Value |');
		expect(markdown).toContain('| Topic | Notes |');
	});

	it('converts Word list paragraphs and their nesting levels', () => {
		const markdown = htmlToMarkdown(`
			<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1;margin-left:36.0pt;text-indent:-18.0pt">
				<span style="mso-list:Ignore">1.<span>&nbsp;</span></span>First item
			</p>
			<p class="MsoListParagraph" style="mso-list:l0 level2 lfo1;margin-left:72.0pt;text-indent:-18.0pt">
				<span style="mso-list:Ignore">•<span>&nbsp;</span></span>Nested item
			</p>
		`);

		expect(markdown).toContain('1. First item');
		expect(markdown).toContain('  - Nested item');
	});

	it('creates a Word document from Markdown without dropping basic structure', async () => {
		const docx = await markdownToDocx(
			'# Notes\n\n**Important** and [a link](https://example.com)\n\n- First\n- Second\n\n![Remote image](https://example.com/image.png)',
		);

		expect(docx.byteLength).toBeGreaterThan(1000);
		expect([...docx.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
	});
});
