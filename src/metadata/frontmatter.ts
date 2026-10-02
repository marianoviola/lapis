import { isMap, parseDocument } from 'yaml';
import { NoteIssue, Properties, PropertyValue } from '../domain/note';

export interface Frontmatter {
	readonly properties: Properties;
	readonly body: string;
	readonly bodyLine: number;
	readonly issues: readonly NoteIssue[];
}

function normalize(value: unknown, depth = 0): PropertyValue {
	if (depth > 32) {
		throw new Error('Frontmatter exceeds the supported nesting depth.');
	}
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(item => normalize(item, depth + 1)));
	}
	if (value instanceof Map) {
		const properties: Record<string, PropertyValue> = Object.create(null);
		for (const [key, item] of value) {
			if (typeof key !== 'string') {
				throw new Error('Frontmatter property names must be strings.');
			}
			properties[key] = normalize(item, depth + 1);
		}
		return Object.freeze(properties);
	}
	throw new Error('Frontmatter contains an unsupported value or YAML alias.');
}

export function readFrontmatter(text: string): Frontmatter {
	const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
	const empty = Object.freeze(Object.create(null)) as Properties;
	if (!opening) {
		return { properties: empty, body: text, bodyLine: 0, issues: [] };
	}
	const remainder = text.slice(opening[0].length);
	const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(remainder);
	if (!closing) {
		return {
			properties: empty, body: '', bodyLine: 0,
			issues: [{ message: 'Frontmatter is missing its closing delimiter.', line: 0 }],
		};
	}
	const yaml = remainder.slice(0, closing.index);
	const prefix = opening[0] + yaml + closing[0];
	const body = text.slice(prefix.length);
	const bodyLine = (prefix.match(/\n/g) ?? []).length;
	try {
		const document = parseDocument(yaml, {
			version: '1.2', stringKeys: true, uniqueKeys: true,
			resolveKnownTags: false, keepSourceTokens: true,
		});
		const issues: NoteIssue[] = [...document.errors, ...document.warnings].map(issue => ({
			message: issue.message,
			line: issue.linePos?.[0].line ?? 1,
		}));
		if (issues.length) {
			return { properties: empty, body, bodyLine, issues };
		}
		if (document.contents !== null && !isMap(document.contents)) {
			return {
				properties: empty, body, bodyLine,
				issues: [{ message: 'Frontmatter must be a YAML mapping of properties.', line: 1 }],
			};
		}
		const properties = document.contents === null ? empty
			: normalize(document.toJS({ mapAsMap: true, maxAliasCount: 0 })) as Properties;
		return { properties, body, bodyLine, issues: [] };
	} catch (error) {
		return {
			properties: empty, body, bodyLine,
			issues: [{ message: error instanceof Error ? error.message : String(error), line: 1 }],
		};
	}
}