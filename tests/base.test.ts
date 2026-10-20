import { describe, expect, it } from 'vitest';
import { parseBase } from '../src/bases/base';

describe('.base YAML parsing', () => {
	it('parses global and view filters, table order and display names', () => {
		const result = parseBase([
			'filters:',
			'  and:',
			'    - status == "active"',
			'    - file.ext == "md"',
			'views:',
			'  - type: table',
			'    name: Active notes',
			'    filters:',
			'      not:',
			'        - archived == true',
			'    order: [file.name, status]',
			'properties:',
			'  status:',
			'    displayName: State',
		].join('\n'));

		expect(result.diagnostics).toEqual([]);
		expect(result.config).toMatchObject({
			filters: {
				kind: 'and',
				filters: [
					{ kind: 'comparison', property: { scope: 'note', name: 'status' }, operator: '==', value: 'active' },
					{ kind: 'comparison', property: { scope: 'file', name: 'ext' }, operator: '==', value: 'md' },
				],
			},
			views: [{
				type: 'table',
				name: 'Active notes',
				filters: {
					kind: 'not',
					filters: [{ kind: 'comparison', property: { scope: 'note', name: 'archived' }, operator: '==', value: true }],
				},
				order: [
					{ scope: 'file', name: 'name' },
					{ scope: 'note', name: 'status' },
				],
			}],
			properties: { status: { displayName: 'State' } },
		});
		expect(Object.getPrototypeOf(result.config?.properties)).toBeNull();
		expect(Object.isFrozen(result.config?.views[0].order)).toBe(true);
	});

	it('parses scalar comparisons with quoted strings, numbers, booleans and null', () => {
		const result = parseBase([
			'filters:',
			'  or:',
			'    - status != \'done\'',
			'    - score >= 1.5e2',
			'    - enabled == false',
			'    - deleted == null',
		].join('\n'));

		expect(result.diagnostics).toEqual([]);
		expect(result.config?.filters).toMatchObject({
			kind: 'or',
			filters: [
				{ value: 'done' },
				{ value: 150 },
				{ value: false },
				{ value: null },
			],
		});
	});

	it.each([
		['invalid YAML', 'views: ['],
		['a non-mapping root', '- item'],
		['duplicate keys', 'views: []\nviews: []'],
		['aliases', 'shared: &value [x]\nviews: *value'],
	])('reports %s with a diagnostic', (_label, source) => {
		const result = parseBase(source);
		expect(result.config).toBeUndefined();
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(1);
	});

	it('rejects unknown configuration and view keys instead of ignoring them', () => {
		const result = parseBase([
			'formulas:',
			'  total: 1',
			'views:',
			'  - type: table',
			'    groupBy: status',
		].join('\n'));

		expect(result.config).toBeUndefined();
		expect(result.diagnostics.map(issue => issue.message)).toEqual(expect.arrayContaining([
			'Unsupported .base key "formulas".',
			'Unsupported key "groupBy" in view 1.',
		]));
	});

	it('diagnoses unsupported view types, namespaces and filter expressions', () => {
		const result = parseBase([
			'filters: formula.total > 10',
			'views:',
			'  - type: timeline',
			'    name: Board',
		].join('\n'));

		expect(result.config).toBeUndefined();
		expect(result.diagnostics.map(issue => issue.message)).toEqual(expect.arrayContaining([
			'The "formula" namespace is not supported in filters yet.',
			'View 1 has unsupported type "timeline"; use "table" or "kanban".',
		]));
	});

	it('supports Kanban grouping, defaults to status and validates references', () => {
		const result = parseBase('views:\n  - type: kanban\n    groupBy: note.channel\n  - type: kanban');
		expect(result.diagnostics).toEqual([]);
		expect(result.config?.views.map(view => view.groupBy)).toEqual([
			{ scope: 'note', name: 'channel' }, { scope: 'note', name: 'status' },
		]);
		for (const groupBy of ['file.size', 'formula.total', '[]', 'null', '3']) {
			expect(parseBase(`views:\n  - type: kanban\n    groupBy: ${groupBy}`).config).toBeUndefined();
		}
	});

	it('rejects malformed filter trees and unsupported file properties', () => {
		const result = parseBase([
			'filters:',
			'  and:',
			'    - file.size > 10',
			'    - {or: [], not: []}',
		].join('\n'));

		expect(result.config).toBeUndefined();
		expect(result.diagnostics.map(issue => issue.message)).toEqual(expect.arrayContaining([
			'Unsupported file property "file.size".',
			'Filter "filters.and[1]" must contain exactly one of "and", "or", or "not".',
		]));
		expect(result.diagnostics.map(issue => issue.line)).toEqual(expect.arrayContaining([3, 4]));
	});

	it('rejects unsupported order namespaces and validates order shape', () => {
		const result = parseBase([
			'views:',
			'  - type: table',
			'    order: [formula.total, file.size]',
		].join('\n'));

		expect(result.config).toBeUndefined();
		expect(result.diagnostics.map(issue => issue.message)).toEqual(expect.arrayContaining([
			'The "formula" namespace is not supported in view order yet.',
			'Unsupported file property "file.size" in view order.',
		]));
	});
});
