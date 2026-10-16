import MarkdownIt from 'markdown-it';
import { readFrontmatter } from '../metadata/frontmatter';

export function previewFrontmatter(markdown: MarkdownIt): MarkdownIt {
	markdown.core.ruler.before('block', 'lapis_frontmatter', state => {
		const { body, bodyLine } = readFrontmatter(state.src);
		if (bodyLine > 0) {
			// Keep native preview line mapping without rendering the YAML preamble.
			state.src = '\n'.repeat(bodyLine) + body;
		}
	});
	return markdown;
}

export function previewTaskLists(markdown: MarkdownIt): MarkdownIt {
	markdown.core.ruler.after('inline', 'lapis_task_lists', state => {
		for (let index = state.tokens.length - 1; index >= 2; index--) {
			const inline = state.tokens[index];
			const item = state.tokens[index - 2];
			if (inline.type !== 'inline' || state.tokens[index - 1].type !== 'paragraph_open'
				|| item.type !== 'list_item_open') {
				continue;
			}
			const marker = /^\[([ xX])\](?:[ \t]+|(?=\n|$))/.exec(inline.content);
			const first = inline.children?.[0];
			if (!marker || first?.type !== 'text' || !first.content.startsWith(marker[0])) {
				continue;
			}
			item.attrJoin('class', 'lapis-task-list-item');
			inline.content = inline.content.slice(marker[0].length);
			first.content = first.content.slice(marker[0].length);
			// Keep the checkbox outside inline children, which native wikilink
			// rendering reparses temporarily with the current document context.
			const checkbox = new state.Token('lapis_task_checkbox', 'input', 0);
			checkbox.markup = marker[1];
			checkbox.level = inline.level;
			state.tokens.splice(index, 0, checkbox);
		}
	});
	markdown.renderer.rules.lapis_task_checkbox = (tokens, index, options) =>
		`<input class="lapis-task-checkbox" type="checkbox" disabled=""${
			tokens[index].markup === ' ' ? '' : ' checked=""'}${options.xhtmlOut ? ' /' : ''}> `;
	return markdown;
}
