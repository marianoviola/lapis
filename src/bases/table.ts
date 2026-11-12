import type { NoteRecord, PropertyValue } from '../domain/note';
import type { BaseConfig, BasePropertyReference, BaseView } from './base';
import { queryBaseView, resolveBaseProperty } from './evaluate';
import { parseBaseReference } from './expression';

export interface BaseTableColumn {
	readonly key: string;
	readonly label: string;
}

export interface BaseTableRow {
	readonly noteUri: string;
	readonly title: string;
	readonly cells: readonly string[];
}

export interface BaseTableProjection {
	readonly columns: readonly BaseTableColumn[];
	readonly rows: readonly BaseTableRow[];
}

export function projectBaseTable(
	config: BaseConfig,
	view: BaseView,
	notes: Iterable<NoteRecord>,
): BaseTableProjection {
	const selected = queryBaseView(config, view, notes);
	const referenceForKey = (key: string): BasePropertyReference => {
		return /^(note|file|formula)\./.test(key) ? parseBaseReference(key) : { scope: 'note', name: key };
	};
	const keyForReference = (property: BasePropertyReference) => `${property.scope}.${property.name}`;
	const configuredProperties = Object.keys(config.properties).map(referenceForKey);
	const discoveredProperties = new Set(selected.flatMap(note => Object.keys(note.properties)));
	const properties = [
		...(view.order ?? []),
		{ scope: 'file' as const, name: 'name' },
		...configuredProperties,
		...Object.keys(config.formulas ?? {}).map(name => ({ scope: 'formula' as const, name })),
		...[...discoveredProperties].sort((left, right) => left.localeCompare(right)).map(name => ({ scope: 'note' as const, name })),
	];
	const unique = [...new Map(properties.map(property => [keyForReference(property), property])).values()];
	const columns: BaseTableColumn[] = unique.map(property => {
		const key = keyForReference(property);
		return {
			key,
			label: config.properties[key]?.displayName
				|| (property.scope === 'note' ? config.properties[property.name]?.displayName : undefined)
				|| (key === 'file.name' ? 'Name' : property.name),
		};
	});
	const rows = selected.map(note => ({
		noteUri: note.id,
		title: note.title,
		cells: unique.map(property => formatValue(resolveBaseProperty(note, property, config))),
	}));
	return Object.freeze({
		columns: Object.freeze(columns.map(column => Object.freeze(column))),
		rows: Object.freeze(rows.map(row => Object.freeze({ ...row, cells: Object.freeze(row.cells) }))),
	});
}

export interface BaseBoardGroup {
	readonly key: string;
	readonly label: string;
	readonly rows: readonly BaseTableRow[];
}

export function projectBaseBoard(
	config: BaseConfig,
	view: BaseView,
	notes: Iterable<NoteRecord>,
	groupBy: BasePropertyReference = view.groupBy ?? { scope: 'note', name: 'status' },
): readonly BaseBoardGroup[] {
	const selected = queryBaseView(config, view, notes);
	const table = projectBaseTable(config, view, selected);
	const groups = new Map<string, { key: string; label: string; rows: BaseTableRow[] }>();
	for (const [index, note] of selected.entries()) {
		const value = resolveBaseProperty(note, groupBy, config);
		const empty = value === undefined || value === null || value === '';
		const key = empty ? 'ungrouped' : `${typeof value}:${JSON.stringify(value)}`;
		let group = groups.get(key);
		if (!group) {
			group = { key, label: empty ? 'No value' : formatValue(value), rows: [] };
			groups.set(key, group);
		}
		group.rows.push(table.rows[index]);
	}
	return Object.freeze([...groups.values()].map(group => Object.freeze({ ...group, rows: Object.freeze(group.rows) })));
}

export function formatValue(value: PropertyValue | undefined): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return JSON.stringify(value) ?? '';
}
