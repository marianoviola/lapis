import MarkdownIt from 'markdown-it';
import { NoteLink } from '../domain/note';

export function wikilinks(markdown: MarkdownIt): void {
	markdown.inline.ruler.before('link', 'lapislazuli_wikilink', (state, silent) => {
		if ('linkLevel' in state && typeof state.linkLevel === 'number' && state.linkLevel > 0) {
			return false;
		}
		const match = /^(!?)\[\[([^\]\r\n]+)\]\]/.exec(state.src.slice(state.pos, state.posMax));
		if (!match) {
			return false;
		}
		const separator = match[2].indexOf('|');
		// Markdown tables escape alias separators; remove only that escape.
		const referenceEnd = separator > 0 && match[2][separator - 1] === '\\' ? separator - 1 : separator;
		const reference = (separator < 0 ? match[2] : match[2].slice(0, referenceEnd)).trim();
		const fragment = reference.indexOf('#');
		const target = (fragment < 0 ? reference : reference.slice(0, fragment)).trim();
		const heading = fragment < 0 ? undefined : reference.slice(fragment + 1).trim();
		if (!target && !heading) {
			return false;
		}
		if (!silent) {
			const token = state.push('lapislazuli_wikilink', '', 0);
			token.content = match[0];
			token.meta = {
				target, heading, embed: match[1] === '!',
				label: separator < 0 ? undefined : match[2].slice(separator + 1),
			} satisfies NoteLink;
		}
		state.pos += match[0].length;
		return true;
	});
	markdown.renderer.rules.lapislazuli_wikilink = (tokens, position) => markdown.utils.escapeHtml(tokens[position].content);
}