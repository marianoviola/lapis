import { parseDocument } from 'yaml';
import { baseFileProperties, expressionReferences, parseBaseExpression, type BaseExpression } from './expression';

export type BaseScalar = string | number | boolean | null;

export interface BasePropertyReference {
	readonly scope: 'note' | 'file' | 'formula';
	readonly name: string;
}

export interface BaseComparison {
	readonly kind: 'comparison';
	readonly property: BasePropertyReference;
	readonly operator: '==' | '!=' | '<' | '<=' | '>' | '>=';
	readonly value: BaseScalar;
}

export type BaseFilter = BaseComparison
	| { readonly kind: 'inFolder'; readonly folder: string }
	| { readonly kind: 'and' | 'or'; readonly filters: readonly BaseFilter[] }
	| { readonly kind: 'not'; readonly filters: readonly BaseFilter[] };

export interface BaseView {
	readonly type: 'table' | 'kanban';
	readonly name?: string;
	readonly filters?: BaseFilter;
	readonly order?: readonly BasePropertyReference[];
	readonly sort?: readonly { readonly property: BasePropertyReference; readonly direction: 'ASC' | 'DESC' }[];
	readonly groupBy?: BasePropertyReference;
	readonly groupOrder?: readonly BaseScalar[];
}

export interface BasePropertyDefinition {
	readonly displayName?: string;
}

export interface BaseConfig {
	readonly filters?: BaseFilter;
	readonly views: readonly BaseView[];
	readonly properties: Readonly<Record<string, BasePropertyDefinition>>;
	readonly formulas?: Readonly<Record<string, BaseExpression>>;
}

export interface BaseDiagnostic {
	readonly message: string;
	readonly line: number;
}

export interface BaseParseResult {
	readonly config?: BaseConfig;
	readonly diagnostics: readonly BaseDiagnostic[];
}

const fileProperties = baseFileProperties;
const allowedRootKeys = new Set(['filters', 'views', 'properties', 'formulas']);

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
	private formulas: Record<string, BaseExpression> = Object.create(null);

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
		this.readFormulas(value.get('formulas'));
		const filters = value.has('filters') ? this.filter(value.get('filters'), 'filters') : undefined;
		const views = value.has('views') ? this.views(value.get('views')) : [];
		const properties = value.has('properties') ? this.properties(value.get('properties')) : Object.create(null) as Record<string, BasePropertyDefinition>;
		return Object.freeze({
			filters,
			views: Object.freeze(views),
			properties: Object.freeze(properties),
			formulas: Object.freeze(this.formulas),
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
			const allowedKeys = new Set(['type', 'name', 'filters', 'order', 'sort', ...(item.get('type') === 'kanban' ? ['groupBy', 'groupOrder'] : [])]);
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
			const sort = item.has('sort') ? this.sort(item.get('sort'), index) : undefined;
			const groupBy = type === 'kanban'
				? this.reference(item.has('groupBy') ? item.get('groupBy') : 'status', 'groupBy')
				: undefined;
			const groupOrder = type === 'kanban' && item.has('groupOrder')
				? this.groupOrder(item.get('groupOrder'), index)
				: undefined;
			views.push(Object.freeze({
				type,
				name: typeof name === 'string' ? name : undefined,
				filters,
				order: order ? Object.freeze(order) : undefined,
				sort,
				groupBy,
				groupOrder: groupOrder ? Object.freeze(groupOrder) : undefined,
			}));
		}
		return views;
	}

	private groupOrder(value: unknown, index: number): BaseScalar[] | undefined {
		if (!Array.isArray(value) || value.some(item =>
			item !== null && typeof item !== 'string' && typeof item !== 'boolean'
			&& (typeof item !== 'number' || !Number.isFinite(item)))) {
			this.issue(`View ${index + 1} "groupOrder" must be a sequence of strings, numbers, booleans or null.`, this.lineOf('groupOrder'));
			return undefined;
		}
		const keys = new Set<string>();
		const values: BaseScalar[] = [];
		for (const item of value as BaseScalar[]) {
			const key = item === null || item === '' ? 'ungrouped' : `${typeof item}:${JSON.stringify(item)}`;
			if (keys.has(key)) {
				this.issue(`View ${index + 1} "groupOrder" cannot contain duplicate values.`, this.lineOf('groupOrder'));
				continue;
			}
			keys.add(key);
			values.push(item);
		}
		return values;
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
		const folder = /^\s*file\.inFolder\(\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*')\s*\)\s*$/.exec(source);
		if (folder) {
			try {
				const value: string = folder[1].startsWith('"') ? JSON.parse(folder[1]) : folder[1].slice(1, -1).replace(/''/g, "'");
				if (value.split('/').some(part => part === '.' || part === '..') || value.includes('\\')) {
					throw new SyntaxError('Folder paths must be vault-relative paths without "." or ".." segments.');
				}
				return Object.freeze({ kind: 'inFolder', folder: value.replace(/^\/+|\/+$/g, '') });
			} catch (error) {
				if (!(error instanceof SyntaxError)) { throw error; }
				this.issue(`Invalid folder filter: ${error.message}`, this.lineOf('filters'));
				return undefined;
			}
		}
		const match = /^\s*(?:(note|file|formula|this)\.)?([A-Za-z_][A-Za-z0-9_-]*)\s*(==|!=|<=|>=|<|>)\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/.exec(source);
		if (!match) {
			this.issue(`Unsupported filter expression "${source}". Use a property comparison with a quoted string, number, boolean, or null.`, this.lineOf(path.split('.').at(-1) ?? path));
			return undefined;
		}
		const [, scope, name, operator, rawValue] = match;
		if (scope === 'this') {
			this.issue(`The "${scope}" namespace is not supported in filters yet.`, this.lineOf(name));
			return undefined;
		}
		if (scope === 'formula' && !Object.hasOwn(this.formulas, name)) {
			this.issue(`Unknown formula "${name}".`, this.lineOf(name));
			return undefined;
		}
		if (scope === 'file' && !fileProperties.has(name)) {
			this.issue(`Unsupported file property "file.${name}".`, this.lineOf(name));
			return undefined;
		}
		const property: BasePropertyReference = Object.freeze({ scope: scope === 'file' || scope === 'formula' ? scope : 'note', name });
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

	private reference(value: unknown, context: 'order' | 'groupBy' | 'sort' | 'properties'): BasePropertyReference | undefined {
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
		if (scope === 'this') {
			this.issue(`The "${scope}" namespace is not supported in view ${context} yet.`, this.lineOf(value));
		} else if (scope === 'formula' && !Object.hasOwn(this.formulas, name)) {
			this.issue(`Unknown formula "${name}".`, this.lineOf(value));
		} else if (scope === 'file' && !fileProperties.has(name)) {
			this.issue(`Unsupported file property "file.${name}" in view ${context}.`, this.lineOf(value));
		} else {
			return Object.freeze({ scope: scope === 'file' || scope === 'formula' ? scope : 'note', name });
		}
		return undefined;
	}

	private sort(value: unknown, index: number): BaseView['sort'] {
		if (!Array.isArray(value)) {
			this.issue(`View ${index + 1} "sort" must be a sequence.`, this.lineOf('sort'));
			return undefined;
		}
		const result: NonNullable<BaseView['sort']>[number][] = [];
		for (const item of value) {
			if (!(item instanceof Map) || [...item.keys()].some(key => key !== 'property' && key !== 'direction')) {
				this.issue('Each sort entry must be a mapping with "property" and "direction".', this.lineOf('sort'));
				continue;
			}
			const property = this.reference(item.get('property'), 'sort');
			const direction = item.get('direction');
			if (direction !== 'ASC' && direction !== 'DESC') {
				this.issue('Sort direction must be "ASC" or "DESC".', this.lineOf('direction'));
			} else if (property) {
				result.push(Object.freeze({ property, direction }));
			}
		}
		return Object.freeze(result);
	}

	private readFormulas(value: unknown): void {
		if (value === undefined) { return; }
		if (!(value instanceof Map)) {
			this.issue('"formulas" must be a YAML mapping.', this.lineOf('formulas'));
			return;
		}
		for (const [name, source] of value) {
			if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || typeof source !== 'string') {
				this.issue('Each formula must have an identifier name and an expression string.', this.lineOf(String(name)));
				continue;
			}
			try {
				this.formulas[name] = parseBaseExpression(source);
			} catch (error) {
				if (!(error instanceof SyntaxError)) { throw error; }
				this.issue(`Invalid formula "${name}": ${error.message}`, this.lineOf(name));
			}
		}
		const visited = new Set<string>();
		const active = new Set<string>();
		const visit = (name: string): void => {
			if (active.has(name)) {
				this.issue(`Circular formula reference "${name}".`, this.lineOf(name));
				return;
			}
			if (visited.has(name)) { return; }
			visited.add(name);
			active.add(name);
			for (const reference of expressionReferences(this.formulas[name])) {
				if (reference.scope !== 'formula') { continue; }
				if (!Object.hasOwn(this.formulas, reference.name)) {
					this.issue(`Unknown formula "${reference.name}".`, this.lineOf(name));
				} else {
					visit(reference.name);
				}
			}
			active.delete(name);
		};
		for (const name of Object.keys(this.formulas)) { visit(name); }
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
			if (/^(note|file|formula|this)\./.test(key)) {
				this.reference(key, 'properties');
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
