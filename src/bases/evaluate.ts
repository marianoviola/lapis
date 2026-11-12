import type { NoteRecord, PropertyValue } from '../domain/note';
import type { BaseComparison, BaseConfig, BaseFilter, BasePropertyReference, BaseScalar, BaseView } from './base';
import { compareBaseValues, evaluateBaseExpression } from './expression';

const missing = Symbol('missing');
type Comparable = BaseScalar | typeof missing | readonly PropertyValue[] | PropertyValue;

export function evaluateBaseFilter(filter: BaseFilter, note: NoteRecord, config?: BaseConfig): boolean {
	switch (filter.kind) {
		case 'inFolder': {
			const folder = resolveProperty(note, { scope: 'file', name: 'folder' });
			return typeof folder === 'string'
				&& (!filter.folder || folder === filter.folder || folder.startsWith(`${filter.folder}/`));
		}
		case 'comparison':
			return evaluateComparison(filter, note, config);
		case 'and':
			return filter.filters.every(child => evaluateBaseFilter(child, note, config));
		case 'or':
			return filter.filters.some(child => evaluateBaseFilter(child, note, config));
		case 'not':
			return !filter.filters.every(child => evaluateBaseFilter(child, note, config));
	}
}

export function queryBaseView(
	config: BaseConfig,
	view: BaseView,
	notes: Iterable<NoteRecord>,
): readonly NoteRecord[] {
	const selected = [...notes].filter(note =>
		(!config.filters || evaluateBaseFilter(config.filters, note, config))
		&& (!view.filters || evaluateBaseFilter(view.filters, note, config)));
	const sort = view.sort ?? view.order?.map(property => ({ property, direction: 'ASC' as const }));
	if (!sort?.length) {
		return Object.freeze(selected);
	}
	const ordered = selected.map((note, index) => ({ note, index }));
	ordered.sort((left, right) => {
		for (const { property, direction } of sort) {
			const a = resolveProperty(left.note, property, config);
			const b = resolveProperty(right.note, property, config);
			const absent = a === missing || a === null || b === missing || b === null;
			const comparison = compareForOrder(a, b) * (direction === 'DESC' && !absent ? -1 : 1);
			if (comparison !== 0) {
				return comparison;
			}
		}
		return left.index - right.index;
	});
	return Object.freeze(ordered.map(item => item.note));
}

function evaluateComparison(comparison: BaseComparison, note: NoteRecord, config?: BaseConfig): boolean {
	const actual = resolveProperty(note, comparison.property, config);
	return compareBaseValues(actual === missing ? undefined : actual, comparison.operator, comparison.value);
}

function resolveProperty(note: NoteRecord, property: BasePropertyReference, config?: BaseConfig): Comparable {
	if (property.scope === 'formula') {
		const expression = config?.formulas?.[property.name];
		if (!expression) {
			throw new Error(`Unknown formula "${property.name}".`);
		}
		const value = evaluateBaseExpression(expression, reference => resolveBaseProperty(note, reference, config));
		return value === undefined ? missing : value;
	}
	if (property.scope === 'file') {
		switch (property.name) {
			case 'name': return note.filename.replace(/\.md$/i, '');
			case 'path': return note.relativePath;
			case 'folder': {
				const separator = note.relativePath.lastIndexOf('/');
				return separator < 0 ? '' : note.relativePath.slice(0, separator);
			}

			case 'ext': {
				const match = /\.([^.\/]+)$/.exec(note.filename);
				return match?.[1].toLocaleLowerCase() ?? '';
			}
			case 'ctime': return note.ctime ?? missing;
			case 'mtime': return note.mtime ?? missing;
			default: return missing;
		}
	}
	if (!Object.hasOwn(note.properties, property.name)) {
		return missing;
	}
	return note.properties[property.name];
}

export function resolveBaseProperty(note: NoteRecord, property: BasePropertyReference, config?: BaseConfig): PropertyValue | undefined {
	const value = resolveProperty(note, property, config);
	return value === missing ? undefined : value;
}

function compareForOrder(left: Comparable, right: Comparable): number {
	const leftAbsent = left === missing || left === null;
	const rightAbsent = right === missing || right === null;
	if (leftAbsent || rightAbsent) {
		return leftAbsent === rightAbsent ? 0 : leftAbsent ? 1 : -1;
	}
	const leftType = valueType(left);
	const rightType = valueType(right);
	if (leftType !== rightType) {
		return leftType.localeCompare(rightType);
	}
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	if (typeof left === 'string' && typeof right === 'string') {
		return left.localeCompare(right);
	}
	if (typeof left === 'boolean' && typeof right === 'boolean') {
		return Number(left) - Number(right);
	}
	return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function valueType(value: Comparable): string {
	if (Array.isArray(value)) {
		return 'array';
	}
	if (value !== null && typeof value === 'object') {
		return 'object';
	}
	return typeof value;
}
