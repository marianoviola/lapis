declare module 'markdown-it-mark' {
	import { PluginSimple } from 'markdown-it';
	const mark: PluginSimple;
	export = mark;
}

declare module 'markdown-it-footnote' {
	import { PluginSimple } from 'markdown-it';
	const footnote: PluginSimple;
	export = footnote;
}

declare module 'markdown-it/lib/rules_inline/text.mjs' {
	import MarkdownIt from 'markdown-it';
	const text: Parameters<MarkdownIt['inline']['ruler']['at']>[1];
	export default text;
}
