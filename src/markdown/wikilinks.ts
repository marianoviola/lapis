import MarkdownIt from 'markdown-it';
import { NoteLink } from '../domain/note';

export interface WikilinkToken extends NoteLink {
	readonly inlineOffset: number;
}

export function wikilinks(markdown: MarkdownIt, enabled?: (env: unknown) => boolean): void {
	markdown.inline.ruler.before('link', 'lapis_wikilink', (state, silent) => {
		if (enabled && !enabled(state.env)) {
			return false;
		}
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
			const token = state.push('lapis_wikilink', '', 0);
			token.content = match[0];
			token.meta = {
				target, heading, embed: match[1] === '!',
				label: separator < 0 ? undefined : match[2].slice(separator + 1),
				inlineOffset: state.pos,
			} satisfies WikilinkToken;
		}
		state.pos += match[0].length;
		return true;
	});
	markdown.renderer.rules.lapis_wikilink = (tokens, position) => markdown.utils.escapeHtml(tokens[position].content);
}