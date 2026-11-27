import type { NoteRecord } from '../domain/note';
import type { BaseParseResult, BaseView } from '../bases/base';
import { projectBaseBoard, projectBaseTable } from '../bases/table';

export function renderInlineBase(
	result: BaseParseResult,
	title: string,
	notes: readonly NoteRecord[],
	href: (note: NoteRecord) => string,
	selectedView?: string,
): string {
	const escape = escapeHtml;
	if (result.diagnostics.length) {
		return `<aside class="lapis-inline-base-diagnostics" role="alert"><strong>${escape(title)}</strong><ul>${
			result.diagnostics.map(issue => `<li>Line ${issue.line}: ${escape(issue.message)}</li>`).join('')
		}</ul></aside>`;
	}
	const config = result.config;
	if (!config || !config.views.length) {
		return `<section class="lapis-inline-base"><h3>${escape(title)}</h3><p>No views are defined.</p></section>`;
	}
	const view = selectedView === undefined
		? { view: config.views[0], name: config.views[0].name ?? 'View 1' }
		: config.views.map((candidate, index) => ({
			view: candidate,
			name: candidate.name ?? `View ${index + 1}`,
		})).find(candidate => candidate.name.toLocaleLowerCase() === selectedView.trim().toLocaleLowerCase());
	if (!view) {
		return `<section class="lapis-inline-base"><h3>${escape(title)}</h3><p>View "${escape(selectedView ?? '')}" not found.</p></section>`;
	}
	const notesById = new Map(notes.map(note => [note.id, note]));
	const content = view.view.type === 'table'
		? renderTable(config, view.view, notes, notesById, view.name, href)
		: renderBoard(config, view.view, notes, notesById, view.name, href);
	return `<section class="lapis-inline-base"><h3>${escape(title)}</h3>${content}</section>`;
}

function renderTable(
	config: NonNullable<BaseParseResult['config']>,
	view: BaseView,
	notes: readonly NoteRecord[],
	notesById: ReadonlyMap<string, NoteRecord>,
	name: string,
	href: (note: NoteRecord) => string,
): string {
	const table = projectBaseTable(config, view, notes);
	const headings = table.columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join('');
	const rows = table.rows.map(row => {
		const note = notesById.get(row.noteUri);
		const cells = table.columns.map((column, index) => {
			const value = escapeHtml(row.cells[index] ?? '');
			if (column.key === 'file.name' && note) {
				const destination = escapeHtml(href(note));
				return `<td><a href="${destination}" data-href="${destination}">${value}</a></td>`;
			}
			return `<td>${value}</td>`;
		}).join('');
		return `<tr>${cells}</tr>`;
	}).join('');
	return `<section class="lapis-inline-base-view"><h4>${escapeHtml(name)}</h4><div class="lapis-inline-base-scroll"><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderBoard(
	config: NonNullable<BaseParseResult['config']>,
	view: BaseView,
	notes: readonly NoteRecord[],
	notesById: ReadonlyMap<string, NoteRecord>,
	name: string,
	href: (note: NoteRecord) => string,
): string {
	const groups = projectBaseBoard(config, view, notes);
	const table = projectBaseTable(config, view, notes);
	const columns = table.columns.filter(column => column.key !== 'file.name');
	const content = groups.map(group => {
		const cards = group.rows.map(row => {
			const note = notesById.get(row.noteUri);
			const title = escapeHtml(note?.filename.replace(/\.md$/i, '') ?? row.title);
			const heading = note
				? `<a href="${escapeHtml(href(note))}" data-href="${escapeHtml(href(note))}">${title}</a>`
				: title;
			const properties = columns.map(column => {
				const index = table.columns.findIndex(item => item.key === column.key);
				const value = escapeHtml(row.cells[index] ?? '');
				return `<div><span>${escapeHtml(column.label)}</span><span>${value}</span></div>`;
			}).join('');
			return `<article class="lapis-inline-base-card"><strong>${heading}</strong>${properties}</article>`;
		}).join('');
		return `<section class="lapis-inline-base-group"><h5>${escapeHtml(group.label)}</h5>${cards || '<p>No matching notes.</p>'}</section>`;
	}).join('');
	return `<section class="lapis-inline-base-view"><h4>${escapeHtml(name)}</h4><div class="lapis-inline-base-board">${content || '<p>No matching notes.</p>'}</div></section>`;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
