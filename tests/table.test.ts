import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import { editTable, findTable, tableCell, TableOperation } from '../src/tables/table';

const source = '| Name | Qty |\n| :--- | ---: |\n| apple | 2 |\n| pear | 10 |';
function apply(text: string, operation: TableOperation = 'format', row = 2, column = 0) {
	const table = findTable(text, 0);
	expect(table).toBeDefined();
	return editTable(table!, operation, row, column, '\n');
}

describe('Markdown table editing', () => {
	it('formats idempotently and preserves column alignment', () => {
		const formatted = apply(source).text;
		expect(formatted).toBe('| Name  |  Qty |\n| :---- | ---: |\n| apple |    2 |\n| pear  |   10 |');
		expect(apply(formatted).text).toBe(formatted);
		const compactQuote = '>| A |\n>| --- |\n>| value |';
		expect(apply(compactQuote).text.split('\n').every(line => line.startsWith('>|'))).toBe(true);
	});

	it('detects only tables, not fences or YAML', () => {
		const text = `---\n${source}\n---\n\n\`\`\`md\n${source}\n\`\`\`\n\n${source}\n\nAfter`;
		expect(findTable(text, 1)).toBeUndefined();
		expect(findTable(text, 8)).toBeUndefined();
		expect(findTable(text, 15)?.startLine).toBe(14);
		expect(findTable(text, 19)).toBeUndefined();
	});

	it('preserves escaped pipes, matched and unmatched code spans and escaped wikilink aliases', () => {
		const text = '| A | B |\n| --- | --- |\n| `a|b` and ``a`|b`` | [[Note\\|Alias]] |\n| x\\|y | `unclosed |';
		const formatted = apply(text).text;
		for (const value of ['`a|b`', '``a`|b``', '[[Note\\|Alias]]', 'x\\|y', '`unclosed']) {
			expect(formatted).toContain(value);
		}
		expect(findTable(formatted, 2)?.rows[2]).toEqual(['`a|b` and ``a`|b``', '[[Note\\|Alias]]']);
		expect(apply(formatted).text).toBe(formatted);
	});

	it('uses display widths for CJK and emoji and does not cap long cells', () => {
		const long = 'x'.repeat(250);
		const formatted = apply(`| A | B |\n| --- | --- |\n| 漢字 | 😀 |\n| ${long} | e\u0301 |`).text;
		const widths = formatted.split('\n').map(line => stringWidth(line));
		expect(new Set(widths).size).toBe(1);
		expect(formatted).toContain(long);
		expect(apply(formatted).text).toBe(formatted);
	});

	it.each(['alignLeft', 'alignCenter', 'alignRight'] as const)('changes only the selected alignment with %s', operation => {
		const result = apply(source, operation, 2, 0);
		const table = findTable(result.text, 0)!;
		expect(table.alignments).toEqual([operation === 'alignLeft' ? 'left' : operation === 'alignCenter' ? 'center' : 'right', 'right']);
		expect(table.rows[2]).toEqual(['apple', '2']);
	});

	it.each(['insertRowAbove', 'insertRowBelow'] as const)('inserts a compact body row with %s and first-cell tab stops', operation => {
		const result = apply(source, operation, 2, 1);
		const table = findTable(result.text, 0)!;
		expect(result.text.split('\n')[result.row]).toBe('|  |  |');
		expect(result.text.split('\n').filter((_, index) => index !== result.row).join('\n')).toBe(source);
		expect(result.column).toBe(2);
		expect(result.tabStops).toEqual([{ row: result.row, column: 2 }, { row: result.row, column: 5 }]);
		expect(table.rows[result.row]).toEqual(['', '']);
		expect(table.rows).toHaveLength(5);
		expect(result.row).toBe(operation === 'insertRowAbove' ? 2 : 3);
	});

	it('inserts below the separator when requested on the header and supports header-only tables', () => {
		const result = apply('| A |\n| --- |', 'insertRowAbove', 0);
		expect(result.row).toBe(2);
		expect(findTable(result.text, 0)?.rows).toHaveLength(3);
		expect(result.text).toBe('| A |\n| --- |\n|  |');
		expect(result.tabStops).toEqual([{ row: 2, column: 2 }]);
	});

	it('inserts compact rows preserving CRLF, container prefixes and ragged extra columns', () => {
		const text = '- > | A | B |\r\n  > | --- | --- |\r\n  > | x | y | extra |';
		const table = findTable(text, 2)!;
		const result = editTable(table, 'insertRowAbove', 2, 2, '\r\n');
		expect(result.text).toBe('- > | A | B |\r\n  > | --- | --- |\r\n  > |  |  |  |\r\n  > | x | y | extra |');
		expect(result.tabStops).toEqual([6, 9, 12].map(column => ({ row: 2, column })));
	});

	it('deletes body rows but refuses to remove the header or separator', () => {
		const result = apply(source, 'deleteRow', 3);
		expect(findTable(result.text, 0)?.rows).toHaveLength(3);
		expect(result.row).toBe(2);
		expect(() => apply(source, 'deleteRow', 0)).toThrow('header');
		expect(() => apply(source, 'deleteRow', 1)).toThrow('separator');
		expect(apply('| A |\n| --- |\n| value |', 'deleteRow').row).toBe(0);
	});

	it.each(['insertColumnLeft', 'insertColumnRight'] as const)('inserts a compact column with %s starting in its header', operation => {
		const result = apply(source, operation);
		const table = findTable(result.text, 0)!;
		const column = operation === 'insertColumnLeft' ? 0 : 1;
		expect(table.rows[2][column]).toBe('');
		expect(table.rows[0]).toHaveLength(3);
		expect(result.row).toBe(0);
		expect(tableCell(table, result.row, result.column).column).toBe(column);
		expect(result.text).toBe(operation === 'insertColumnLeft'
			? '|  | Name | Qty |\n| --- | :--- | ---: |\n|  | apple | 2 |\n|  | pear | 10 |'
			: '| Name |  | Qty |\n| :--- | --- | ---: |\n| apple |  | 2 |\n| pear |  | 10 |');
		expect(result.tabStops?.map(stop => stop.row)).toEqual([0, 2, 3]);
		expect(table.alignments).toEqual(operation === 'insertColumnLeft'
			? ['default', 'left', 'right'] : ['left', 'default', 'right']);
	});

	it('appends compact columns without outer pipes, preserving source whitespace and escaped cells', () => {
		const text = 'Name | Qty\n:--- | ---:\n `$value\\path` | [[Note\\|Alias]]  ';
		const result = apply(text, 'insertColumnRight', 2, 1);
		expect(result.text).toBe('Name | Qty|  |\n:--- | ---:| --- |\n `$value\\path` | [[Note\\|Alias]]  |  |');
		expect(findTable(result.text, 0)?.rows[2]).toEqual(['`$value\\path`', '[[Note\\|Alias]]', '']);
		expect(result.tabStops).toEqual([{ row: 0, column: 12 }, { row: 2, column: text.split('\n')[2].length + 2 }]);
		const left = apply(text, 'insertColumnLeft');
		expect(left.text).toBe('|  |Name | Qty\n| --- |:--- | ---:\n |  |`$value\\path` | [[Note\\|Alias]]  ');
		expect(findTable(left.text, 0)?.rows[0]).toEqual(['', 'Name', 'Qty']);
	});

	it('inserts columns preserving CRLF, containers and ragged missing or extra cells', () => {
		const text = '- > | A | B |\r\n  > | :--- | ---: |\r\n  > | x |\r\n  > | y | z | extra |';
		const result = editTable(findTable(text, 0)!, 'insertColumnRight', 0, 1, '\r\n');
		expect(result.text).toBe('- > | A | B |  |  |\r\n  > | :--- | ---: | --- | --- |\r\n  > | x |  |  |  |\r\n  > | y | z |  | extra |');
		expect(findTable(result.text, 0)?.rows.map(row => row.length)).toEqual([4, 4, 4, 4]);
		expect(result.tabStops).toEqual([{ row: 0, column: 14 }, { row: 2, column: 13 }, { row: 3, column: 14 }]);
	});

	it('inserts a compact column in a header-only table', () => {
		const result = apply('| A |\n| --- |', 'insertColumnLeft', 0);
		expect(result.text).toBe('|  | A |\n| --- | --- |');
		expect(result.tabStops).toEqual([{ row: 0, column: 2 }]);
	});

	it('keeps a trailing backslash from escaping an appended column boundary', () => {
		const text = 'A | B\n--- | ---\nx | path\\';
		const result = apply(text, 'insertColumnRight', 2, 1);
		expect(findTable(result.text, 0)?.rows[2]).toEqual(['x', 'path\\', '']);
		expect(result.text.split('\n')[2]).toBe('x | path\\ |  |');
		const ragged = apply(text + '\ny | z | extra', 'insertColumnRight', 2, 1);
		expect(findTable(ragged.text, 0)?.rows[2]).toEqual(['x', 'path\\', '', '']);
	});

	it('deletes a column, retaining alignment, and refuses to remove the last column', () => {
		const result = apply(source, 'deleteColumn');
		expect(findTable(result.text, 0)?.alignments).toEqual(['right']);
		expect(findTable(result.text, 0)?.rows[2]).toEqual(['2']);
		expect(() => apply(result.text, 'deleteColumn')).toThrow('last');
	});

	it('preserves blockquote/list prefixes, CRLF and ragged cells', () => {
		const text = '- | A | B |\r\n  | --- | --- |\r\n  | - value |';
		const table = findTable(text, 2)!;
		const result = editTable(table, 'format', 2, 0, '\r\n');
		expect(result.text.split('\r\n')[0]).toMatch(/^- \|/);
		expect(result.text.split('\r\n')[2]).toContain('- value');
		expect(findTable(result.text, 2)?.rows[2]).toEqual(['- value', '']);
		const quote = '> | A |\n> | --- |\n> | value |';
		expect(apply(quote, 'insertRowBelow').text.split('\n').every(line => line.startsWith('> |'))).toBe(true);
		const nested = '- > | A |\n  > | --- |\n  > | value |';
		const formatted = apply(nested).text;
		expect(formatted).toMatch(/^- > \|/);
		expect(apply(formatted).text).toBe(formatted);
	});

	it('resolves the cursor column at padding, separators and the line end', () => {
		const table = findTable(source, 2)!;
		expect(tableCell(table, 2, 0)).toEqual({ row: 2, column: 0 });
		expect(tableCell(table, 2, 11)).toEqual({ row: 2, column: 1 });
		expect(tableCell(table, 2, 99)).toEqual({ row: 2, column: 1 });
	});
});
