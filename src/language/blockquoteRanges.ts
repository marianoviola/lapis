import MarkdownIt from 'markdown-it';
import textRule from 'markdown-it/lib/rules_inline/text.mjs';
import { SourceRange } from '../domain/note';
import { readFrontmatter } from '../metadata/frontmatter';
import { wikilinks } from '../markdown/wikilinks';

const markdown = new MarkdownIt('commonmark').use(wikilinks);
const inline = new MarkdownIt('commonmark').use(wikilinks);
inline.inline.ruler.at('text', (state, silent) => {
	const start = state.pos;
	const matched = textRule(state, silent);
	if (matched && !silent && 'linkLevel' in state && state.linkLevel === 0) {
		(state.env as { ranges: SourceRange[] }).ranges.push({ start, end: state.pos });
	}
	return matched;
});

export function blockquoteRanges(text: string): SourceRange[] {
	const { body } = readFrontmatter(text);
	const lines = body.split(/\r\n?|\n/);
	const offsets = [text.length - body.length];
	for (const match of body.matchAll(/\r\n?|\n/g)) {
		offsets.push(offsets[0] + match.index + match[0].length);
	}
	const ranges: SourceRange[] = [];
	let depth = 0;
	const context = {};
	for (const token of markdown.parse(body, context)) {
		if (token.type === 'blockquote_open') { depth++; }
		if (token.type === 'blockquote_close') { depth--; }
		if (!depth || token.type !== 'inline' || !token.map) { continue; }
		const env = { ...context, ranges: [] as SourceRange[] };
		inline.parseInline(token.content, env);
		let offset = 0;
		for (const [index, content] of token.content.split('\n').entries()) {
			const line = token.map[0] + index;
			const column = lines[line].replace(/\0/g, '\uFFFD').lastIndexOf(content);
			if (column < 0) {
				throw new Error(`Cannot map blockquote source at line ${line + 1}.`);
			}
			for (const range of env.ranges) {
				const start = Math.max(range.start, offset);
				const end = Math.min(range.end, offset + content.length);
				if (start < end) {
					ranges.push({ start: offsets[line] + column + start - offset, end: offsets[line] + column + end - offset });
				}
			}
			offset += content.length + 1;
		}
	}
	return ranges;
}
