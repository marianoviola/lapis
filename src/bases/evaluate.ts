import type { NoteRecord, PropertyValue } from '../domain/note';
import type { BaseComparison, BaseConfig, BaseFilter, BasePropertyReference, BaseScalar, BaseView } from './base';

const missing = Symbol('missing');
type Comparable = BaseScalar | typeof missing | readonly PropertyValue[] | PropertyValue;

export function evaluateBaseFilter(filter: BaseFilter, note: NoteRecord): boolean {
	switch (filter.kind) {
		case 'comparison':
			return evaluateComparison(filter, note);
		case 'and':
			return filter.filters.every(child => evaluateBaseFilter(child, note));
		case 'or':
			return filter.filters.some(child => evaluateBaseFilter(child, note));
		case 'not':
			return !filter.filters.every(child => evaluateBaseFilter(child, note));
	}
}

export function queryBaseView(
	config: BaseConfig,
	view: BaseView,
	notes: Iterable<NoteRecord>,
): readonly NoteRecord[] {
	const selected = [...notes].filter(note =>
		(!config.filters || evaluateBaseFilter(config.filters, note))
		&& (!view.filters || evaluateBaseFilter(view.filters, note)));
	if (!view.order?.length) {
		return Object.freeze(selected);
	}
	const ordered = selected.map((note, index) => ({ note, index }));
	ordered.sort((left, right) => {
		for (const property of view.order ?? []) {
			const comparison = compareForOrder(resolveProperty(left.note, property), resolveProperty(right.note, property));
			if (comparison !== 0) {
				return comparison;
			}
		}
		return left.index - right.index;
	});
	return Object.freeze(ordered.map(item => item.note));
}

function evaluateComparison(comparison: BaseComparison, note: NoteRecord): boolean {
	const actual = resolveProperty(note, comparison.property);
	if (actual === missing) {
		return false;
	}
	if (comparison.operator === '==' || comparison.operator === '!=') {
		if (!sameScalarType(actual, comparison.value)) {
			return false;
		}
		return comparison.operator === '==' ? actual === comparison.value : actual !== comparison.value;
	}
	if (typeof actual === 'number' && typeof comparison.value === 'number') {
		switch (comparison.operator) {
			case '<': return actual < comparison.value;
			case '<=': return actual <= comparison.value;
			case '>': return actual > comparison.value;
			case '>=': return actual >= comparison.value;
		}
	}
	if (typeof actual === 'string' && typeof comparison.value === 'string') {
		const order = actual.localeCompare(comparison.value);
		switch (comparison.operator) {
			case '<': return order < 0;
			case '<=': return order <= 0;
			case '>': return order > 0;
			case '>=': return order >= 0;
		}
	}
	return false;
}

function sameScalarType(actual: Comparable, expected: BaseScalar): actual is BaseScalar {
	return actual !== missing
		&& typeof actual === typeof expected
		&& (actual === null) === (expected === null)
		&& (typeof actual === 'string' || typeof actual === 'number' || typeof actual === 'boolean' || actual === null);
}

function resolveProperty(note: NoteRecord, property: BasePropertyReference): Comparable {
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

export function resolveBaseProperty(note: NoteRecord, property: BasePropertyReference): PropertyValue | undefined {
	const value = resolveProperty(note, property);
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
