import { parseDocument } from 'yaml';

export type BaseScalar = string | number | boolean | null;

export interface BasePropertyReference {
	readonly scope: 'note' | 'file';
	readonly name: string;
}

export interface BaseComparison {
	readonly kind: 'comparison';
	readonly property: BasePropertyReference;
	readonly operator: '==' | '!=' | '<' | '<=' | '>' | '>=';
	readonly value: BaseScalar;
}

export type BaseFilter = BaseComparison
	| { readonly kind: 'and' | 'or'; readonly filters: readonly BaseFilter[] }
	| { readonly kind: 'not'; readonly filters: readonly BaseFilter[] };

export interface BaseView {
	readonly type: 'table' | 'kanban';
	readonly name?: string;
	readonly filters?: BaseFilter;
	readonly order?: readonly BasePropertyReference[];
	readonly groupBy?: BasePropertyReference;
}

export interface BasePropertyDefinition {
	readonly displayName?: string;
}

export interface BaseConfig {
	readonly filters?: BaseFilter;
	readonly views: readonly BaseView[];
	readonly properties: Readonly<Record<string, BasePropertyDefinition>>;
}

export interface BaseDiagnostic {
	readonly message: string;
	readonly line: number;
}

export interface BaseParseResult {
	readonly config?: BaseConfig;
	readonly diagnostics: readonly BaseDiagnostic[];
}

const fileProperties = new Set(['name', 'path', 'folder', 'ext', 'ctime', 'mtime']);
const allowedRootKeys = new Set(['filters', 'views', 'properties']);

export function parseBase(text: string): BaseParseResult {
	const document = parseDocument(text, {
		version: '1.2',
		stringKeys: true,
		uniqueKeys: true,
		resolveKnownTags: false,
	});
	const diagnostics = document.errors.map(error => ({
		message: error.message,
		line: error.linePos?.[0].line ?? 1,
	}));
	if (diagnostics.length) {
		return { diagnostics };
	}
	try {
		const contents = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
		const validator = new BaseValidator(text);
		const config = validator.validate(contents);
		if (validator.diagnostics.length) {
			return { diagnostics: validator.diagnostics };
		}
		return { config, diagnostics: [] };
	} catch (error) {
		if (!(error instanceof Error)) {
			throw error;
		}
		return {
			diagnostics: [Object.freeze({
				message: error instanceof Error ? error.message : String(error),
				line: 1,
			})],
		};
	}
}

class BaseValidator {
	readonly diagnostics: BaseDiagnostic[] = [];

	constructor(private readonly source: string) {}

	validate(value: unknown): BaseConfig {
		if (!(value instanceof Map)) {
			this.issue('A .base file must be a YAML mapping.', 1);
			return { views: [], properties: Object.freeze(Object.create(null)) };
		}
		for (const key of value.keys()) {
			if (typeof key !== 'string') {
				this.issue('Base configuration keys must be strings.', 1);
			} else if (!allowedRootKeys.has(key)) {
				this.issue(`Unsupported .base key "${key}".`, this.lineOf(key));
			}
		}
		const filters = value.has('filters') ? this.filter(value.get('filters'), 'filters') : undefined;
		const views = value.has('views') ? this.views(value.get('views')) : [];
		const properties = value.has('properties') ? this.properties(value.get('properties')) : Object.create(null) as Record<string, BasePropertyDefinition>;
		return Object.freeze({
			filters,
			views: Object.freeze(views),
			properties: Object.freeze(properties),
		});
	}

	private views(value: unknown): BaseView[] {
		if (!Array.isArray(value)) {
			this.issue('"views" must be a YAML sequence.', this.lineOf('views'));
			return [];
		}
		const views: BaseView[] = [];
		for (const [index, item] of value.entries()) {
			if (!(item instanceof Map)) {
				this.issue(`View ${index + 1} must be a YAML mapping.`, this.lineOf('views'));
				continue;
			}
			const allowedKeys = new Set(['type', 'name', 'filters', 'order', ...(item.get('type') === 'kanban' ? ['groupBy'] : [])]);
			for (const key of item.keys()) {
				if (typeof key !== 'string' || !allowedKeys.has(key)) {
					this.issue(`Unsupported key "${String(key)}" in view ${index + 1}.`, this.lineOf(String(key)));
				}
			}
			const type = item.get('type');
			if (type !== 'table' && type !== 'kanban') {
				this.issue(`View ${index + 1} has unsupported type "${String(type)}"; use "table" or "kanban".`, this.lineOf('type'));
				continue;
			}
			const name = item.get('name');
			if (name !== undefined && typeof name !== 'string') {
				this.issue(`View ${index + 1} "name" must be a string.`, this.lineOf('name'));
			}
			const filters = item.has('filters') ? this.filter(item.get('filters'), `views[${index}].filters`) : undefined;
			const order = item.has('order') ? this.order(item.get('order'), index) : undefined;
			const groupBy = type === 'kanban'
				? this.reference(item.has('groupBy') ? item.get('groupBy') : 'status', 'groupBy')
				: undefined;
			views.push(Object.freeze({
				type,
				name: typeof name === 'string' ? name : undefined,
				filters,
				order: order ? Object.freeze(order) : undefined,
				groupBy,
			}));
		}
		return views;
	}

	private filter(value: unknown, path: string): BaseFilter | undefined {
		if (typeof value === 'string') {
			return this.comparison(value, path);
		}
		if (!(value instanceof Map)) {
			this.issue(`Filter "${path}" must be a comparison string or an and/or/not mapping.`, this.lineOf(path.split('.').at(-1) ?? path));
			return undefined;
		}
		if (value.size !== 1) {
			const firstKey = value.keys().next().value;
			this.issue(`Filter "${path}" must contain exactly one of "and", "or", or "not".`, this.lineOf(String(firstKey ?? path)));
			return undefined;
		}
		const [operator, children] = value.entries().next().value as [unknown, unknown];
		if (operator !== 'and' && operator !== 'or' && operator !== 'not') {
			this.issue(`Unsupported filter operator "${String(operator)}".`, this.lineOf(String(operator)));
			return undefined;
		}
		if (!Array.isArray(children) || children.length === 0) {
			this.issue(`Filter "${operator}" must contain a non-empty sequence.`, this.lineOf(String(operator)));
			return undefined;
		}
		const filters: BaseFilter[] = [];
		let valid = true;
		for (const [index, child] of children.entries()) {
			const parsed = this.filter(child, `${path}.${operator}[${index}]`);
			if (!parsed) {
				valid = false;
			} else {
				filters.push(parsed);
			}
		}
		if (!valid) {
			return undefined;
		}
		return Object.freeze({ kind: operator, filters: Object.freeze(filters) });
	}

	private comparison(source: string, path: string): BaseFilter | undefined {
		const match = /^\s*(?:(note|file|formula|this)\.)?([A-Za-z_][A-Za-z0-9_-]*)\s*(==|!=|<=|>=|<|>)\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/.exec(source);
		if (!match) {
			this.issue(`Unsupported filter expression "${source}". Use a property comparison with a quoted string, number, boolean, or null.`, this.lineOf(path.split('.').at(-1) ?? path));
			return undefined;
		}
		const [, scope, name, operator, rawValue] = match;
		if (scope === 'formula' || scope === 'this') {
			this.issue(`The "${scope}" namespace is not supported in filters yet.`, this.lineOf(name));
			return undefined;
		}
		if (scope === 'file' && !fileProperties.has(name)) {
			this.issue(`Unsupported file property "file.${name}".`, this.lineOf(name));
			return undefined;
		}
		const property: BasePropertyReference = Object.freeze({ scope: scope === 'file' ? 'file' : 'note', name });
		let value: BaseScalar;
		try {
			if (rawValue.startsWith('"')) {
				value = JSON.parse(rawValue) as string;
			} else if (rawValue.startsWith("'")) {
				value = rawValue.slice(1, -1).replace(/''/g, "'");
			} else if (rawValue === 'true') {
				value = true;
			} else if (rawValue === 'false') {
				value = false;
			} else if (rawValue === 'null') {
				value = null;
			} else {
				value = Number(rawValue);
			}
		} catch (error) {
			if (!(error instanceof SyntaxError)) {
				throw error;
			}
			this.issue(`Invalid literal in filter "${source}".`, this.lineOf(path.split('.').at(-1) ?? path));
			return undefined;
		}
		return Object.freeze({ kind: 'comparison', property, operator: operator as BaseComparison['operator'], value });
	}

	private order(value: unknown, viewIndex: number): BasePropertyReference[] | undefined {
		if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
			this.issue(`View ${viewIndex + 1} "order" must be a sequence of property references.`, this.lineOf('order'));
			return undefined;
		}
		const properties: BasePropertyReference[] = [];
		for (const reference of value) {
			const property = this.reference(reference, 'order');
			if (property) {
				properties.push(property);
			}
		}
		return properties;
	}

	private reference(value: unknown, context: 'order' | 'groupBy'): BasePropertyReference | undefined {
		if (typeof value !== 'string') {
			this.issue(`View "${context}" must be a property reference string.`, this.lineOf(context));
			return undefined;
		}
		const match = /^(?:(note|file|formula|this)\.)?([A-Za-z_][A-Za-z0-9_-]*)$/.exec(value);
		if (!match) {
			this.issue(`Unsupported property reference "${value}" in view ${context}.`, this.lineOf(context));
			return undefined;
		}
		const [, scope, name] = match;
		if (scope === 'formula' || scope === 'this') {
			this.issue(`The "${scope}" namespace is not supported in view ${context} yet.`, this.lineOf(value));
		} else if (scope === 'file' && !fileProperties.has(name)) {
			this.issue(`Unsupported file property "file.${name}" in view ${context}.`, this.lineOf(value));
		} else {
			return Object.freeze({ scope: scope === 'file' ? 'file' : 'note', name });
		}
		return undefined;
	}

	private properties(value: unknown): Record<string, BasePropertyDefinition> {
		const properties: Record<string, BasePropertyDefinition> = Object.create(null);
		if (!(value instanceof Map)) {
			this.issue('"properties" must be a YAML mapping.', this.lineOf('properties'));
			return properties;
		}
		for (const [key, definition] of value) {
			if (typeof key !== 'string' || !(definition instanceof Map)) {
				this.issue('Each property definition must be a mapping.', this.lineOf(String(key)));
				continue;
			}
			for (const option of definition.keys()) {
				if (option !== 'displayName') {
					this.issue(`Unsupported property option "${String(option)}".`, this.lineOf(String(option)));
				}
			}
			const displayName = definition.get('displayName');
			if (displayName !== undefined && typeof displayName !== 'string') {
				this.issue(`Property "${key}" displayName must be a string.`, this.lineOf('displayName'));
			}
			properties[key] = Object.freeze({
				displayName: typeof displayName === 'string' ? displayName : undefined,
			});
		}
		return properties;
	}

	private issue(message: string, line: number): void {
		this.diagnostics.push(Object.freeze({ message, line }));
	}

	private lineOf(key: string): number {
		const lines = this.source.split(/\r\n?|\n/);
		const mappingIndex = lines.findIndex(line => new RegExp(`(?:^|[\\s{,])(?:["'])?${escapeRegExp(key)}(?:["'])?\\s*:`).test(line));
		if (mappingIndex >= 0) {
			return mappingIndex + 1;
		}
		const tokenIndex = lines.findIndex(line => new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(key)}(?:$|[^A-Za-z0-9_-])`).test(line));
		return tokenIndex < 0 ? 1 : tokenIndex + 1;
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
