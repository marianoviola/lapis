import { describe, expect, it } from 'vitest';
import { parseBase } from '../src/bases/base';
import { projectBaseBoard, projectBaseTable } from '../src/bases/table';
import { parseNote } from '../src/index/parseNote';
import type { NoteSource } from '../src/domain/note';

function note(path: string, properties: string) {
	const source: NoteSource = {
		uri: `file:///vault/${path}`,
		rootUri: 'file:///vault',
		relativePath: path,
		text: `---\n${properties}\n---\n${path}`,
		dirty: false,
	};
	return parseNote(source);
}

describe('.base table projection', () => {
	it('projects filtered and sorted index records with display names and hideable columns', () => {
		const parsed = parseBase([
			'filters: status == "active"',
			'views:',
			'  - type: table',
			'    order: [rank]',
			'properties:',
			'  status:',
			'    displayName: State',
			'  missing:',
			'    displayName: Planned field',
		].join('\n'));
		expect(parsed.config).toBeDefined();
		const records = [
			note('later.md', 'status: active\nrank: 2\nowner: "Ada"'),
			note('excluded.md', 'status: draft\nrank: 0'),
			note('first.md', 'status: active\nrank: 1'),
		];

		const projection = projectBaseTable(parsed.config!, parsed.config!.views[0], records);

		expect(projection.columns).toEqual([
			{ key: 'file.name', label: 'Name' },
			{ key: 'note.status', label: 'State' },
			{ key: 'note.missing', label: 'Planned field' },
			{ key: 'note.owner', label: 'owner' },
			{ key: 'note.rank', label: 'rank' },
		]);
		expect(projection.rows).toEqual([
			{ noteUri: 'file:///vault/first.md', title: 'first', cells: ['first', 'active', '', '', '1'] },
			{ noteUri: 'file:///vault/later.md', title: 'later', cells: ['later', 'active', '', 'Ada', '2'] },
		]);
		expect(Object.isFrozen(projection.rows)).toBe(true);
		expect(Object.isFrozen(projection.rows[0].cells)).toBe(true);
	});

	it('renders empty and structured values without changing indexed properties', () => {
		const parsed = parseBase('views:\n  - type: table');
		const record = note('values.md', 'empty: null\nlist: [one, two]\nobject:\n  nested: true');
		const before = JSON.stringify(record.properties);

		const projection = projectBaseTable(parsed.config!, parsed.config!.views[0], [record]);

		expect(projection.rows[0].cells).toEqual(['values', '', '["one","two"]', '{"nested":true}']);
		expect(JSON.stringify(record.properties)).toBe(before);
	});

	it('groups Kanban rows without losing filters, ordering or missing values', () => {
		const parsed = parseBase('filters: type == "post"\nviews:\n  - type: kanban\n    groupBy: status\n    order: [rank]');
		const records = [
			note('second.md', 'type: post\nstatus: draft\nrank: 2'),
			note('excluded.md', 'type: reference\nstatus: done'),
			note('first.md', 'type: post\nstatus: draft\nrank: 1'),
			note('missing.md', 'type: post'),
			note('null.md', 'type: post\nstatus: null'),
			note('done.md', 'type: post\nstatus: done'),
		];
		const groups = projectBaseBoard(parsed.config!, parsed.config!.views[0], records);
		expect(groups.map(group => [group.label, group.rows.map(row => row.title)])).toEqual([
			['draft', ['first', 'second']], ['No value', ['missing', 'null']], ['done', ['done']],
		]);
		expect(Object.isFrozen(groups[0].rows)).toBe(true);
	});

	it('distinguishes typed values with identical display labels and allows file grouping', () => {
		const config = parseBase('views:\n  - type: kanban').config!;
		const records = [note('one.md', 'status: true'), note('two.md', 'status: "true"')];
		expect(projectBaseBoard(config, config.views[0], records)).toHaveLength(2);
		expect(projectBaseBoard(config, config.views[0], records, { scope: 'file', name: 'folder' })).toHaveLength(1);
	});
});
