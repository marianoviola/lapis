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

	it.each(['insertRowAbove', 'insertRowBelow'] as const)('inserts a body row with %s and returns its cell', operation => {
		const result = apply(source, operation);
		const table = findTable(result.text, 0)!;
		expect(table.rows[result.row]).toEqual(['', '']);
		expect(table.rows).toHaveLength(5);
		expect(result.row).toBe(operation === 'insertRowAbove' ? 2 : 3);
	});

	it('inserts below the separator when requested on the header and supports header-only tables', () => {
		const result = apply('| A |\n| --- |', 'insertRowAbove', 0);
		expect(result.row).toBe(2);
		expect(findTable(result.text, 0)?.rows).toHaveLength(3);
	});

	it('deletes body rows but refuses to remove the header or separator', () => {
		const result = apply(source, 'deleteRow', 3);
		expect(findTable(result.text, 0)?.rows).toHaveLength(3);
		expect(result.row).toBe(2);
		expect(() => apply(source, 'deleteRow', 0)).toThrow('header');
		expect(() => apply(source, 'deleteRow', 1)).toThrow('separator');
		expect(apply('| A |\n| --- |\n| value |', 'deleteRow').row).toBe(0);
	});

	it.each(['insertColumnLeft', 'insertColumnRight'] as const)('inserts a column with %s', operation => {
		const result = apply(source, operation);
		const table = findTable(result.text, 0)!;
		const column = operation === 'insertColumnLeft' ? 0 : 1;
		expect(table.rows[2][column]).toBe('');
		expect(table.rows[0]).toHaveLength(3);
		expect(tableCell(table, result.row, result.column).column).toBe(column);
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
