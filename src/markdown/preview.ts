import MarkdownIt from 'markdown-it';
import { readFrontmatter } from '../metadata/frontmatter';

export function previewFrontmatter(markdown: MarkdownIt): MarkdownIt {
	markdown.core.ruler.before('block', 'lapislazuli_frontmatter', state => {
		const { body, bodyLine } = readFrontmatter(state.src);
		if (bodyLine > 0) {
			// Keep native preview line mapping without rendering the YAML preamble.
			state.src = '\n'.repeat(bodyLine) + body;
		}
	});
	return markdown;
}
