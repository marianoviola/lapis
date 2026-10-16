import MarkdownIt from 'markdown-it';
import { NoteRecord } from '../domain/note';
import { NoteIndex } from '../index/noteIndex';
import { wikilinks, WikilinkToken } from '../markdown/wikilinks';

export function headingFragment(note: NoteRecord, heading: string | undefined): string {
	return heading ? note.headings.find(candidate => candidate.text === heading)?.slug ?? '' : '';
}

export function previewWikilinks(markdown: MarkdownIt, notes: NoteIndex,
	source: (env: unknown) => string | undefined,
	href: (from: string, note: NoteRecord, fragment: string) => string): MarkdownIt {
	markdown.use(wikilinks, (env: unknown) => {
		const from = source(env);
		return !!from && !!notes.get(from);
	});
	markdown.renderer.rules.lapis_wikilink = (tokens, position, _options, env: unknown) => {
		const token = tokens[position];
		const link = token.meta as WikilinkToken;
		const from = source(env);
		const escape = markdown.utils.escapeHtml;
		if (!from || !notes.get(from) || link.embed) {
			return escape(token.content);
		}
		const resolution = notes.resolve(link.target, from);
		const label = escape(link.label ?? (link.target + (link.heading ? `#${link.heading}` : '')));
		if (resolution.kind !== 'resolved') {
			const title = resolution.kind === 'missing' ? 'Unresolved wikilink'
				: `Ambiguous wikilink: ${resolution.candidates.map(note => note.relativePath).join(', ')}`;
			return `<span class="lapis-wikilink-${resolution.kind}" title="${escape(title)}">${label}</span>`;
		}
		const destination = escape(href(from, resolution.note, headingFragment(resolution.note, link.heading)));
		return `<a class="lapis-wikilink" href="${destination}" data-href="${destination}">${label}</a>`;
	};
	return markdown;
}
