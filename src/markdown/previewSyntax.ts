import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import footnote from 'markdown-it-footnote';

export function previewSyntax(markdown: MarkdownIt): MarkdownIt {
	const highlighted = markdown.parseInline('==lapis==', {})
		.some(token => token.children?.some(child => child.type === 'mark_open'));
	if (!highlighted) {
		markdown.use(mark);
	}
	if (!markdown.renderer.rules.footnote_ref && !markdown.renderer.rules.footnote_block_open) {
		markdown.use(footnote);
	}
	return markdown;
}
