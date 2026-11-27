import { describe, expect, it } from 'vitest';
import { parseBase } from '../src/bases/base';
import { renderInlineBase } from '../src/preview/base';
import { parseNote } from '../src/index/parseNote';

function notes() {
	return [
		parseNote({
			uri: 'file:///vault/Tasks.md', rootUri: 'file:///vault', relativePath: 'Tasks.md', dirty: false,
			text: '---\nstatus: open\nsummary: "<script>alert(1)</script>"\n---\n',
		}),
	];
}

describe('inline Base preview', () => {
	const result = () => parseBase([
		'views:',
		'  - type: table',
		'    name: Tasks',
		'  - type: kanban',
		'    name: By status',
		'    groupBy: status',
	].join('\n'));

	it('renders the first configured view by default as escaped, read-only HTML', () => {
		const html = renderInlineBase(result(), 'Work.base', notes(), note => `./${note.relativePath}`);

		expect(html).toContain('<section class="lapis-inline-base">');
		expect(html).toContain('<h4>Tasks</h4>');
		expect(html).toContain('<table>');
		expect(html).toContain('href="./Tasks.md" data-href="./Tasks.md"');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('By status');
	});

	it('renders a selected view by name and reports a missing view safely', () => {
		const selected = renderInlineBase(result(), 'Work.base', notes(), () => '#', 'by STATUS');
		expect(selected).toContain('<h4>By status</h4>');
		expect(selected).toContain('class="lapis-inline-base-board"');
		expect(selected).not.toContain('<table>');

		const missing = renderInlineBase(result(), 'Work.base', notes(), () => '#', '<unsafe>');
		expect(missing).toContain('View "&lt;unsafe&gt;" not found.');
		expect(missing).not.toContain('<unsafe>');
	});

	it('shows invalid Base diagnostics safely and handles empty view lists', () => {
		const invalid = renderInlineBase(parseBase('views: [<unsafe>]'), 'Bad.base', notes(), () => '#');
		expect(invalid).toContain('class="lapis-inline-base-diagnostics"');
		expect(invalid).not.toContain('<unsafe>');

		const empty = renderInlineBase(parseBase('views: []'), 'Empty.base', notes(), () => '#');
		expect(empty).toContain('No views are defined.');
	});
});
