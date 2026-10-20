import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/index/parseNote';
import { evaluateBaseFilter, queryBaseView } from '../src/bases/evaluate';
import { parseBase } from '../src/bases/base';
import type { NoteSource } from '../src/domain/note';

function note(name: string, yaml: string, ctime?: number, mtime?: number) {
	const source: NoteSource = {
		uri: `file:///vault/${name}`,
		rootUri: 'file:///vault',
		relativePath: name,
		text: `---\n${yaml}\n---\n${name}`,
		dirty: false,
		ctime,
		mtime,
	};
	return parseNote(source);
}

function config(source: string | readonly string[]) {
	const result = parseBase(typeof source === 'string' ? source : source.join('\n'));
	expect(result.diagnostics).toEqual([]);
	expect(result.config).toBeDefined();
	return result.config!;
}

describe('.base filter evaluation', () => {
	it('combines global and view filters with AND and returns matching notes', () => {
		const parsed = config([
			'filters: status == "active"',
			'views:',
			'  - type: table',
			'    filters: score >= 5',
		].join('\n'));
		const records = [
			note('both.md', 'status: active\nscore: 5'),
			note('global-only.md', 'status: active\nscore: 4'),
			note('view-only.md', 'status: draft\nscore: 7'),
			note('neither.md', 'status: draft\nscore: 2'),
		];

		expect(queryBaseView(parsed, parsed.views[0], records).map(record => record.filename)).toEqual(['both.md']);
	});

	it('evaluates nested and/or/not trees', () => {
		const parsed = config([
			'filters:',
			'  and:',
			'    - or:',
			'        - status == "active"',
			'        - status == "draft"',
			'    - not:',
			'        - archived == true',
			'views:',
			'  - type: table',
		].join('\n'));
		const accepted = note('accepted.md', 'status: active\narchived: false');
		const archived = note('archived.md', 'status: draft\narchived: true');
		const unrelated = note('other.md', 'status: paused\narchived: false');

		expect(evaluateBaseFilter(parsed.filters!, accepted)).toBe(true);
		expect(evaluateBaseFilter(parsed.filters!, archived)).toBe(false);
		expect(evaluateBaseFilter(parsed.filters!, unrelated)).toBe(false);
	});

	it('treats absent properties as non-matching, including for inequality', () => {
		const missing = note('missing.md', 'status: null');
		const configForFilters = config([
			'filters:',
			'  or:',
			'    - absent == null',
			'    - absent != "active"',
			'views:',
			'  - type: table',
		]);

		expect(evaluateBaseFilter(configForFilters.filters!, missing)).toBe(false);
	});

	it('distinguishes null from absent and does not coerce incompatible types', () => {
		const explicitNull = note('null.md', 'state: null\ncount: "5"');
		const integer = note('number.md', 'state: "null"\ncount: 5');
		const nullFilter = config('filters: state == null').filters!;
		const inequalityFilter = config('filters: state != null').filters!;
		const numberFilter = config('filters: count == 5').filters!;

		expect(evaluateBaseFilter(nullFilter, explicitNull)).toBe(true);
		expect(evaluateBaseFilter(inequalityFilter, explicitNull)).toBe(false);
		expect(evaluateBaseFilter(nullFilter, integer)).toBe(false);
		expect(evaluateBaseFilter(numberFilter, explicitNull)).toBe(false);
		expect(evaluateBaseFilter(numberFilter, integer)).toBe(true);
	});

	it('compares only compatible scalars and supports relational number/string operators', () => {
		const parsed = config([
			'filters:',
			'  and:',
			'    - score > 10',
			'    - title >= "M"',
			'    - enabled != false',
			'views:',
			'  - type: table',
		]);
		const record = note('note.md', 'score: 11\ntitle: Note\nenabled: true');
		const incompatible = note('bad.md', 'score: "11"\ntitle: Note\nenabled: true');

		expect(evaluateBaseFilter(parsed.filters!, record)).toBe(true);
		expect(evaluateBaseFilter(parsed.filters!, incompatible)).toBe(false);
	});

	it('resolves allowlisted file properties from note records', () => {
		const parsed = config([
			'filters:',
			'  and:',
			'    - file.name == "Daily"',
			'    - file.path == "journal/Daily.md"',
			'    - file.folder == "journal"',
			'    - file.ext == "md"',
			'    - file.ctime == 100',
			'    - file.mtime >= 200',
			'views:',
			'  - type: table',
		]);
		const record = note('journal/Daily.md', 'status: active', 100, 250);

		expect(evaluateBaseFilter(parsed.filters!, record)).toBe(true);
	});
});

describe('.base view ordering', () => {
	it('sorts by multiple properties and keeps missing/null values last', () => {
		const parsed = config([
			'views:',
			'  - type: table',
			'    order: [rank, title]',
		]);
		const records = [
			note('null.md', 'rank: null\ntitle: A'),
			note('missing.md', 'title: B'),
			note('last.md', 'rank: 2\ntitle: B'),
			note('first.md', 'rank: 1\ntitle: Z'),
			note('tie-a.md', 'rank: 2\ntitle: A'),
			note('tie-b.md', 'rank: 2\ntitle: A'),
		];

		expect(queryBaseView(parsed, parsed.views[0], records).map(record => record.filename)).toEqual([
			'first.md', 'tie-a.md', 'tie-b.md', 'last.md', 'null.md', 'missing.md',
		]);
	});

	it('sorts incompatible values by type and then value, preserving stable ties', () => {
		const parsed = config([
			'views:',
			'  - type: table',
			'    order: [value]',
		]);
		const records = [
			note('string.md', 'value: "2"'),
			note('bool-true.md', 'value: true'),
			note('number-2.md', 'value: 2'),
			note('bool-false.md', 'value: false'),
			note('number-1.md', 'value: 1'),
		];

		expect(queryBaseView(parsed, parsed.views[0], records).map(record => record.filename)).toEqual([
			'bool-false.md', 'bool-true.md', 'number-1.md', 'number-2.md', 'string.md',
		]);
	});

	it('sorts file properties and leaves equal rows in their original order', () => {
		const parsed = config([
			'views:',
			'  - type: table',
			'    order: [file.folder, file.name]',
		]);
		const records = [
			note('zeta.md', 'status: active'),
			note('alpha/beta.md', 'status: active'),
			note('alpha/alpha.md', 'status: active'),
			note('alpha/alpha.md', 'status: duplicate'),
		];

		expect(queryBaseView(parsed, parsed.views[0], records).map(record => record.relativePath)).toEqual([
			'zeta.md', 'alpha/alpha.md', 'alpha/alpha.md', 'alpha/beta.md',
		]);
	});
});
