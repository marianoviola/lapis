import MarkdownIt from 'markdown-it';
import stringWidth from 'string-width';
import { readFrontmatter } from '../metadata/frontmatter';

export type Alignment = 'default' | 'left' | 'center' | 'right';
export type TableOperation = 'format' | 'alignLeft' | 'alignCenter' | 'alignRight'
	| 'insertRowAbove' | 'insertRowBelow' | 'deleteRow'
	| 'insertColumnLeft' | 'insertColumnRight' | 'deleteColumn';

interface Cell {
	text: string;
	start: number;
	end: number;
}

export interface Table {
	startLine: number;
	endLine: number;
	lines: string[];
	rows: string[][];
	prefixes: string[];
	cells: Cell[][];
	alignments: Alignment[];
}

export interface TableEdit {
	text: string;
	row: number;
	column: number;
	tabStops?: { row: number; column: number }[];
}

const markdown = new MarkdownIt();

function splitRow(line: string, header = false): { prefix: string; cells: Cell[] } {
	const prefix = (header ? /^[ \t]*(?:>[ \t]*|(?:[-+*]|\d+[.)])[ \t]+)*/ : /^[ \t]*(?:>[ \t]*)*/).exec(line)![0];
	const content = line.slice(prefix.length);
	const pipes: number[] = [];
	for (let i = 0; i < content.length; i++) {
		if (content[i] === '\\') { i++; continue; }
		if (content[i] === '`') {
			const run = /^`+/.exec(content.slice(i))![0];
			let next = i + run.length;
			let closing = -1;
			while (next < content.length) {
				const match = /`+/.exec(content.slice(next));
				if (!match) { break; }
				next += match.index;
				if (match[0].length === run.length) { closing = next; break; }
				next += match[0].length;
			}
			if (closing >= 0) { i = closing + run.length - 1; continue; }
			i += run.length - 1;
		} else if (content[i] === '|') {
			pipes.push(i);
		}
	}
	const boundaries = [-1, ...pipes, content.length];
	const cells = boundaries.slice(1).map((end, index) => {
		const start = boundaries[index] + 1;
		return { text: content.slice(start, end).trim(), start: prefix.length + start, end: prefix.length + end };
	});
	if (pipes.length && !cells[0].text) { cells.shift(); }
	if (pipes.length && !cells[cells.length - 1].text) { cells.pop(); }
	return { prefix, cells };
}

export function findTable(text: string, line: number): Table | undefined {
	return findTables(text).find(table => line >= table.startLine && line < table.endLine);
}

export function findTables(text: string): Table[] {
	const { body, bodyLine } = readFrontmatter(text);
	const lines = text.split(/\r\n?|\n/);
	const tables: Table[] = [];
	for (const token of markdown.parse(body, {})) {
		if (token.type !== 'table_open' || !token.map) { continue; }
		const startLine = token.map[0] + bodyLine;
		const endLine = token.map[1] + bodyLine;
		const parsed = lines.slice(startLine, endLine).map((source, index) => splitRow(source, index === 0));
		const alignments: Alignment[] = parsed[1].cells.map(cell =>
			cell.text.startsWith(':') ? (cell.text.endsWith(':') ? 'center' : 'left')
				: cell.text.endsWith(':') ? 'right' : 'default');
		tables.push({
			startLine, endLine, alignments, lines: lines.slice(startLine, endLine),
			rows: parsed.map(row => row.cells.map(cell => cell.text)),
			prefixes: parsed.map(row => row.prefix),
			cells: parsed.map(row => row.cells),
		});
	}
	return tables;
}

export function tableCell(table: Table, line: number, character: number): { row: number; column: number } {
	const row = Math.max(0, Math.min(line - table.startLine, table.rows.length - 1));
	const cells = table.cells[row];
	const column = cells.findIndex(cell => character <= cell.end);
	return { row, column: column < 0 ? cells.length - 1 : column };
}

export function editTable(table: Table, operation: TableOperation, row: number, column: number, eol: string): TableEdit {
	const rows = table.rows.map(cells => [...cells]);
	const prefixes = [...table.prefixes];
	const alignments = [...table.alignments];
	const count = Math.max(...rows.map(cells => cells.length));
	if (operation === 'insertRowAbove' || operation === 'insertRowBelow') {
		row = Math.min(rows.length, Math.max(2, row + (operation === 'insertRowBelow' ? 1 : 0)));
		const prefix = prefixes[1];
		const line = prefix + '|' + '  |'.repeat(count);
		const lines = [...table.lines];
		lines.splice(row, 0, line);
		const tabStops = Array.from({ length: count }, (_, index) => ({ row, column: prefix.length + 2 + index * 3 }));
		return { text: lines.join(eol), row, column: tabStops[0].column, tabStops };
	}
	if (operation === 'insertColumnLeft' || operation === 'insertColumnRight') {
		column += operation === 'insertColumnRight' ? 1 : 0;
		const tabStops: NonNullable<TableEdit['tabStops']> = [];
		const lines = table.lines.map((source, r) => {
			const separator = r === 1;
			const value = separator ? ' --- ' : '  ';
			const original = table.cells[r];
			const last = original[original.length - 1];
			// Complete ragged rows before inserting at the same logical column.
			const missing = count - original.length;
			const closing = missing > 0 && last.end === source.length ? '|' : '';
			const spacing = missing > 0 && source[last.end - 1] === '\\' ? ' ' : '';
			const line = source.slice(0, last.end) + spacing + ('|' + value).repeat(missing) + closing + source.slice(last.end);
			const parsed = splitRow(line, r === 0);
			const cells = parsed.cells;
			const atEnd = column === count;
			const offset = atEnd ? cells[cells.length - 1].end : cells[column].start;
			const opening = !atEnd && column === 0 && offset === parsed.prefix.length ? '|' : '';
			const boundary = atEnd && line[offset - 1] === '\\' ? ' |' : '|';
			const inserted = atEnd ? boundary + value + (offset === line.length ? '|' : '') : opening + value + '|';
			if (!separator) {
				tabStops.push({ row: r, column: offset + (atEnd ? boundary.length + 1 : opening.length + 1) });
			}
			return line.slice(0, offset) + inserted + line.slice(offset);
		});
		return { text: lines.join(eol), row: 0, column: tabStops[0].column, tabStops };
	}
	for (const cells of rows) { while (cells.length < count) { cells.push(''); } }
	while (alignments.length < count) { alignments.push('default'); }
	if (operation === 'deleteRow') {
		if (row <= 1) { throw new Error('The table header and separator cannot be deleted.'); }
		rows.splice(row, 1);
		prefixes.splice(row, 1);
		row = Math.max(0, Math.min(row, rows.length - 1));
		if (row === 1) { row = 0; }
	} else if (operation === 'deleteColumn') {
		if (count <= 1) { throw new Error('The last table column cannot be deleted.'); }
		for (const cells of rows) { cells.splice(column, 1); }
		alignments.splice(column, 1);
		column = Math.min(column, count - 2);
	} else if (operation !== 'format') {
		alignments[column] = operation === 'alignLeft' ? 'left' : operation === 'alignCenter' ? 'center' : 'right';
	}
	const widths = alignments.map((_, index) =>
		Math.max(alignments[index] === 'center' ? 5 : alignments[index] === 'default' ? 3 : 4,
			...rows.filter((__, r) => r !== 1).map(cells => stringWidth(cells[index]))));
	const lines = rows.map((cells, r) => {
		const values = cells.map((value, c) => {
			const width = widths[c];
			const alignment = alignments[c];
			if (r === 1) {
				const left = alignment === 'left' || alignment === 'center' ? ':' : '';
				const right = alignment === 'right' || alignment === 'center' ? ':' : '';
				return left + '-'.repeat(width - left.length - right.length) + right;
			}
			const padding = width - stringWidth(value);
			const before = alignment === 'right' ? padding : alignment === 'center' ? Math.floor(padding / 2) : 0;
			return ' '.repeat(before) + value + ' '.repeat(padding - before);
		});
		return prefixes[r] + '| ' + values.join(' | ') + ' |';
	});
	const target = splitRow(lines[row], row === 0).cells[column];
	const valueStart = target.start + (/^\s*/.exec(lines[row].slice(target.start, target.end))?.[0].length ?? 0);
	return { text: lines.join(eol), row, column: Math.min(valueStart, target.end) };
}
