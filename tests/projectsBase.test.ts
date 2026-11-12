import { describe, expect, it } from 'vitest';
import { parseBase } from '../src/bases/base';
import { queryBaseView, resolveBaseProperty } from '../src/bases/evaluate';
import { renderBasePage } from '../src/bases/page';
import { projectBaseBoard, projectBaseTable } from '../src/bases/table';
import { parseNote } from '../src/index/parseNote';
import { evaluateBaseExpression, parseBaseExpression } from '../src/bases/expression';

const source = `
filters:
  and:
    - file.inFolder("Projects")
    - file.ext == "md"
    - file.name != "Projects"
formulas:
  state:
    if(status == "active", "🟢 Active",
      if(status == "backlog", "🟡 Backlog",
        if(status == "archived" || status == "archived-experiment", "⚪ Archived",
          if(status == "completed", "✅ Completed", status))))
properties:
  file.name:
    displayName: Project
  type:
    displayName: Type
  category:
    displayName: Category
  status:
    displayName: Status
  formula.state:
    displayName: State
  visibility:
    displayName: Visibility
  marketplace:
    displayName: Marketplace
  created:
    displayName: Created
  updated:
    displayName: Updated
  tags:
    displayName: Tags
  url:
    displayName: URL
  repository:
    displayName: Repository
  gate:
    displayName: Gate
  related:
    displayName: Related
views:
  - type: table
    name: All projects
    order: [formula.state, file.name, type, category, status, visibility, marketplace, updated]
    sort:
      - property: formula.state
        direction: ASC
      - property: file.name
        direction: ASC
  - type: table
    name: Active
    filters:
      and:
        - status == "active"
    order: [file.name, type, category, visibility, marketplace, updated]
  - type: table
    name: Public and marketplace
    filters:
      or:
        - visibility == "public"
        - marketplace != null
    order: [file.name, visibility, marketplace, url, repository]
  - type: table
    name: Backlog
    filters:
      and:
        - status == "backlog"
    order: [file.name, category, gate, related, created]
  - type: table
    name: Archived
    filters:
      or:
        - status == "archived"
        - status == "archived-experiment"
    order: [file.name, type, category, updated]
  - type: table
    name: By type
    order: [type, category, file.name, formula.state, visibility, marketplace]
    sort:
      - property: type
        direction: ASC
      - property: file.name
        direction: ASC
`;

function note(path: string, properties: string) {
	return parseNote({
		uri: `file:///vault/${path}`, rootUri: 'file:///vault', relativePath: path, dirty: false,
		text: `---\n${properties}\n---\n`,
	});
}

describe('Projects Base configuration', () => {
	it('parses all six supplied views and projects calculated columns without duplicates', () => {
		const result = parseBase(source);
		expect(result.diagnostics).toEqual([]);
		const config = result.config!;
		expect(config.views).toHaveLength(6);
		const records = [
			note('Projects/B.md', 'status: active\ntype: plugin\nvisibility: public'),
			note('Projects/Sub/A.md', 'status: backlog\ntype: app'),
			note('Projects/C.md', 'status: archived-experiment\ntype: app'),
			note('Projects/D.md', 'status: completed\ntype: app'),
			note('Projects/E.md', 'status: custom\ntype: app'),
			note('Projects/Projects.md', 'status: active'),
			note('Projects-other/no.md', 'status: active'),
			note('Elsewhere/Projects/no.md', 'status: active'),
		];
		const before = JSON.stringify(records);
		const table = projectBaseTable(config, config.views[0], records);
		expect(table.rows).toHaveLength(5);
		expect(table.rows.map(row => row.cells[0])).toEqual(['🟢 Active', '🟡 Backlog', '⚪ Archived', '✅ Completed', 'custom'].sort((a, b) => a.localeCompare(b)));
		expect(table.columns.slice(0, 3)).toEqual([
			{ key: 'formula.state', label: 'State' },
			{ key: 'file.name', label: 'Project' },
			{ key: 'note.type', label: 'Type' },
		]);
		expect(new Set(table.columns.map(column => column.key)).size).toBe(table.columns.length);
		for (const [index, state] of ['🟢 Active', '🟡 Backlog', '⚪ Archived', '✅ Completed', 'custom'].entries()) {
			expect(resolveBaseProperty(records[index], { scope: 'formula', name: 'state' }, config)).toBe(state);
		}
		expect(queryBaseView(config, config.views[1], records).map(record => record.filename)).toEqual(['B.md']);
		expect(queryBaseView(config, config.views[2], records).map(record => record.filename)).toEqual(['B.md']);
		expect(queryBaseView(config, config.views[3], records).map(record => record.filename)).toEqual(['A.md']);
		expect(queryBaseView(config, config.views[4], records).map(record => record.filename)).toEqual(['C.md']);
		expect(queryBaseView(config, config.views[5], records).map(record => record.filename)).toEqual(['A.md', 'C.md', 'D.md', 'E.md', 'B.md']);
		const html = renderBasePage({ title: 'Projects.base', result, notes: records, reminders: [] }, 'nonce');
		const data = JSON.parse(html.match(/const data = (.*);\n/)![1]);
		expect(data.views[0].rows.find((row: { name: string }) => row.name === 'B').groupValues['formula.state'].label).toBe('🟢 Active');
		expect(html).toContain("column.key === 'file.name'");
		expect(html).toContain("element('button', row.name, 'note-link')");
		expect(projectBaseBoard(config, config.views[0], records, { scope: 'formula', name: 'state' })).toHaveLength(5);
		expect(JSON.stringify(records)).toBe(before);
	});

	it('keeps index order when sort is explicitly empty', () => {
		const config = parseBase('views:\n  - type: table\n    order: [file.name]\n    sort: []').config!;
		const records = [note('z.md', ''), note('a.md', '')];
		expect(queryBaseView(config, config.views[0], records)).toEqual(records);
	});

	it.each([
		['if(true, "selected", unavailable)', 'selected'],
		['if(false, unavailable, "selected")', 'selected'],
		['true || unavailable', true],
		['false && unavailable', false],
		['true || false && false', true],
		['(true || false) && false', false],
		['1 == "1"', false],
		['null == null', true],
		['"a" < "b"', true],
		['1 >= 2', false],
		['if(0, "yes", "no")', 'no'],
		['if("", "yes", "no")', 'no'],
		["'it''s quoted'", "it's quoted"],
		['"escaped\\nstring"', 'escaped\nstring'],
	])('evaluates formulas without executing unselected branches: %s', (expression, expected) => {
		expect(evaluateBaseExpression(parseBaseExpression(expression), () => {
			throw new Error('Unselected expression must not be evaluated.');
		})).toBe(expected);
	});

	it.each([
		'',
		'if(true, 1, 2) trailing',
		'if(true, 1, 2',
		'1 + 2',
		'this.status',
		'1e999',
		'"\\q"',
		'('.repeat(65) + 'true' + ')'.repeat(65),
		Array.from({ length: 257 }, () => 'true').join(' || '),
	])('rejects unsupported, malformed or excessive expressions: %s', expression => {
		expect(() => parseBaseExpression(expression)).toThrow(SyntaxError);
	});

	it('uses explicit descending sort instead of column order, keeping nulls last and ties stable', () => {
		const config = parseBase(`
views:
  - type: table
    order: [file.name, rank]
    sort:
      - property: rank
        direction: DESC
`).config!;
		const records = [
			note('a.md', 'rank: 1'),
			note('b.md', 'rank: null'),
			note('c.md', 'rank: 2'),
			note('d.md', 'rank: 2'),
			note('e.md', ''),
		];
		expect(queryBaseView(config, config.views[0], records).map(record => record.filename)).toEqual(['c.md', 'd.md', 'a.md', 'b.md', 'e.md']);
	});

	it('resolves forward formula references in filters, grouping and safely serialized cells', () => {
		const result = parseBase(`
formulas:
  label: 'if(formula.accepted && (rank >= 2), status, null)'
  accepted: 'status == "active" || status == "backlog"'
filters: formula.accepted == true
views:
  - type: kanban
    groupBy: formula.label
    order: [formula.label, file.name]
`);
		expect(result.diagnostics).toEqual([]);
		const config = result.config!;
		const records = [note('a.md', 'status: active\nrank: 3'), note('b.md', 'status: backlog\nrank: 1'), note('c.md', 'status: done')];
		expect(projectBaseBoard(config, config.views[0], records).map(group => group.label)).toEqual(['active', 'No value']);
		const unsafe = parseBase('formulas:\n  label: \'if(true, "</script><img src=x>", "")\'\nviews:\n  - type: table\n    order: [formula.label]');
		const html = renderBasePage({ title: 'safe.base', result: unsafe, notes: records, reminders: [] }, 'nonce');
		expect(html).not.toContain('<img src=x>');
		expect(html.match(/<\/script>/g)).toHaveLength(1);
	});

	it.each(['Projects', 'Projects/', '/Projects/'])('matches folders recursively on segment boundaries: %s', folder => {
		const config = parseBase(`filters: file.inFolder("${folder}")\nviews:\n  - type: table`).config!;
		const records = ['Projects/a.md', 'Projects/nested/b.md', 'Projects-old/c.md', 'Else/Projects/d.md', 'Projects.md'].map(path => note(path, ''));
		expect(queryBaseView(config, config.views[0], records).map(record => record.relativePath)).toEqual(['Projects/a.md', 'Projects/nested/b.md']);
	});
});
