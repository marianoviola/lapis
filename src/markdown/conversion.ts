import HtmlToDocx = require('html-to-docx');
import MarkdownIt from 'markdown-it';
import TurndownService = require('turndown');
import { gfm } from 'turndown-plugin-gfm';

export function htmlToMarkdown(html: string): string {
	const turndown = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		emDelimiter: '*',
		bulletListMarker: '-',
	});

	turndown.use(gfm);
	turndown.remove(node => ['HEAD', 'STYLE', 'SCRIPT', 'META', 'LINK', 'XML', 'O:P'].includes(node.nodeName));
	turndown.addRule('wordHeading', {
		filter: node => {
			if (node.nodeName !== 'P') {
				return false;
			}
			const className = node.getAttribute('class') ?? '';
			const style = node.getAttribute('style') ?? '';
			return /MsoTitle|MsoHeading[1-6]/i.test(className)
				|| /mso-outline-level\s*:\s*[1-6]/i.test(style);
		},
		replacement: (content, node) => {
			const className = node.getAttribute('class') ?? '';
			const style = node.getAttribute('style') ?? '';
			const level = Number(className.match(/MsoHeading([1-6])/i)?.[1]
				?? style.match(/mso-outline-level\s*:\s*([1-6])/i)?.[1]
				?? 1);
			return `\n\n${'#'.repeat(level)} ${content.trim()}\n\n`;
		},
	});
	turndown.addRule('wordListParagraph', {
		filter: node => node.nodeName === 'P'
			&& /MsoListParagraph/i.test(node.getAttribute('class') ?? ''),
		replacement: (content, node) => {
			const marker = node.textContent?.trim().match(/^([•·▪◦○●‣⁃\-]|\d+[.)]|[a-z][.)])(?:\s|\u00a0)*/i)?.[1];
			const style = node.getAttribute('style') ?? '';
			const listLevel = Number(style.match(/mso-list\s*:[^;]*?\blevel(\d+)/i)?.[1]);
			const marginLeft = Number(style.match(/margin-left\s*:\s*([\d.]+)\s*pt/i)?.[1] ?? 36);
			const indent = Number.isFinite(listLevel) && listLevel > 0
				? listLevel - 1
				: Math.max(0, Math.round((marginLeft - 36) / 18));
			const ordered = marker ? /^\d/.test(marker) : false;
			const listMarker = marker && ordered ? marker : '-';
			const markerPattern = /^\s*(?:[•·▪◦○●‣⁃\uF0B7\-]|\d+[.)]|[a-z][.)])(?:\s|\u00a0)*/i;
			const item = content.replace(markerPattern, '').trim();
			return `\n${'  '.repeat(indent)}${listMarker} ${item}\n`;
		},
	});
	turndown.addRule('wordInlineFormatting', {
		filter: node => node.nodeName === 'SPAN'
			&& /(?:font-weight\s*:\s*(?:bold|[6-9]00)|font-style\s*:\s*italic|text-decoration(?:-line)?\s*:\s*(?:underline|line-through))/i
				.test(node.getAttribute('style') ?? ''),
		replacement: (content, node) => {
			const style = node.getAttribute('style') ?? '';
			let result = content;
			if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)) {
				result = `**${result}**`;
			}
			if (/font-style\s*:\s*italic/i.test(style)) {
				result = `*${result}*`;
			}
			if (/text-decoration(?:-line)?\s*:\s*line-through/i.test(style)) {
				result = `~~${result}~~`;
			}
			if (/text-decoration(?:-line)?\s*:\s*underline/i.test(style)) {
				result = `<u>${result}</u>`;
			}
			return result;
		},
	});

	return turndown.turndown(html).trim();
}

export async function markdownToDocx(markdown: string, title?: string): Promise<Uint8Array> {
	const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
	parser.renderer.rules.image = (tokens, index, options, env, renderer) => {
		const token = tokens[index];
		const source = token.attrGet('src') ?? '';
		if (!/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(source)) {
			return renderer.renderInlineAsText(token.children ?? [], options, env);
		}
		const altIndex = token.attrIndex('alt');
		if (altIndex >= 0) {
			token.attrs![altIndex][1] = renderer.renderInlineAsText(token.children ?? [], options, env);
		}
		return renderer.renderToken(tokens, index, options);
	};
	const html = parser.render(markdown);
	const result = await HtmlToDocx(
		`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
		null,
		{ title, creator: 'Lapis', font: 'Calibri', fontSize: 22 },
	);
	if (Buffer.isBuffer(result)) {
		return new Uint8Array(result);
	}
	if (result instanceof ArrayBuffer) {
		return new Uint8Array(result);
	}
	return new Uint8Array(await result.arrayBuffer());
}
