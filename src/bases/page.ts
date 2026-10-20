import type { NoteRecord, PropertyValue } from '../domain/note';
import type { BaseParseResult, BasePropertyReference } from './base';
import { resolveBaseProperty } from './evaluate';
import { futureDateProperties, type NoteReminder } from './reminders';
import { formatValue, projectBaseTable } from './table';

export interface BasePreferences {
	readonly view: number;
	readonly mode: 'table' | 'kanban';
	readonly search: string;
	readonly groupBy: string;
	readonly hidden: readonly string[];
}

export interface BasePageInput {
	readonly title: string;
	readonly result: BaseParseResult;
	readonly notes: readonly NoteRecord[];
	readonly reminders: readonly NoteReminder[];
	readonly preferences?: BasePreferences;
}

export function renderBasePage(input: BasePageInput, nonce: string): string {
	const { config, diagnostics } = input.result;
	const notes = new Map(input.notes.map(note => [note.id, note]));
	const reminders = new Map(input.reminders.map(reminder => [reminder.noteUri, reminder]));
	const views = config?.views.map((view, index) => {
		const table = projectBaseTable(config, view, input.notes);
		const grouping = view.groupBy ?? { scope: 'note', name: 'status' };
		const groupKey = `${grouping.scope}.${grouping.name}`;
		const groups = [...table.columns];
		for (const key of [groupKey, 'file.folder']) {
			if (!groups.some(group => group.key === key)) {
				groups.push({ key, label: key.replace(/^note\./, '') });
			}
		}
		return {
			name: view.name ?? `View ${index + 1}`, type: view.type, groupBy: groupKey, columns: table.columns, groups,
			rows: table.rows.map(row => {
				const note = notes.get(row.noteUri)!;
				const reminder = reminders.get(row.noteUri);
				return {
					...row, path: note.relativePath, reminder: reminder?.due,
					tags: projectTags(note.properties.tags),
					lists: Object.fromEntries(Object.entries(note.properties).flatMap(([name, value]) =>
						name !== 'tags' && Array.isArray(value) ? [[`note.${name}`, value.map(formatListItem)]] : [])),
					canRemind: !!reminder || futureDateProperties(note.properties).length > 0,
					groupValues: Object.fromEntries(groups.map(group => {
						const dot = group.key.indexOf('.');
						const property: BasePropertyReference = { scope: group.key.startsWith('file.') ? 'file' : 'note', name: group.key.slice(dot + 1) };
						const value = resolveBaseProperty(note, property);
						const empty = value === undefined || value === null || value === '';
						return [group.key, { key: empty ? 'ungrouped' : `${typeof value}:${JSON.stringify(value)}`, label: empty ? 'No value' : formatValue(value) }];
					})),
				};
			}),
		};
	}) ?? [];
	const data = JSON.stringify({ views, preferences: input.preferences, reminders: input.reminders.length })
		.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
	const issues = diagnostics.length ? `<section role="alert" class="diagnostics"><h2>Base configuration needs attention</h2><ul>${diagnostics.map(diagnostic => `<li>Line ${diagnostic.line}: ${escapeHtml(diagnostic.message)}</li>`).join('')}</ul></section>` : '';
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title><style nonce="${nonce}">${styles}</style></head>
<body><main>
<header><div class="eyebrow">LAPIS / BASE</div><h1>${escapeHtml(input.title.replace(/\.base$/i, ''))}</h1><p class="subtitle">Your notes, in perspective.</p></header>
<nav id="views" aria-label="Configured views"></nav>
<section class="toolbar" aria-label="Base toolbar">
<div class="segmented" role="group" aria-label="Layout"><button id="table" aria-pressed="true">Table</button><button id="kanban" aria-pressed="false">Kanban</button></div>
<label id="group-label">Group by <select id="group" aria-label="Group Kanban by property"></select></label>
<div class="toolbar-spacer"></div>
<label class="search"><svg class="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="search" type="search" placeholder="Search notes..." aria-label="Search notes"></label>
<details id="properties"><summary>Properties</summary><div id="columns"></div></details>
<button id="reminders" title="Manage persistent note reminders">Reminders <span id="reminder-count"></span></button>
</section>
${issues}<div id="content"></div><p id="empty" class="empty" hidden>No matching notes. Try another view or search.</p>
<footer><span id="count" role="status"></span><span>Read-only view &middot; open a note to edit</span></footer>
</main><script nonce="${nonce}">const data = ${data};\n${script}</script></body></html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function projectTags(value: PropertyValue | undefined): readonly { label: string; valid: boolean }[] {
	const values = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
	return values.map(value => {
		if (typeof value !== 'string') {
			return { label: formatListItem(value), valid: false };
		}
		const label = value.trim().replace(/^#/, '');
		const valid = /^[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)*$/u.test(label)
			&& /[\p{L}_-]/u.test(label);
		return { label: valid ? label : value, valid };
	});
}

function formatListItem(value: PropertyValue): string {
	return value === null ? 'null' : typeof value === 'string' && !value ? '""' : formatValue(value);
}

const styles = `
:root{color-scheme:light dark}
*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background,#fff);color:var(--vscode-editor-foreground,#292b32);font-family:var(--vscode-font-family,system-ui);font-size:13px}
main{padding:30px 32px 20px;max-width:1800px;margin:auto}header{margin-bottom:24px}.eyebrow{font-size:10px;letter-spacing:1.5px;color:var(--vscode-descriptionForeground,#737982);margin-bottom:12px}
h1{font-size:28px;font-weight:650;letter-spacing:-.8px;margin:0}.subtitle{color:var(--vscode-descriptionForeground,#737982);margin:10px 0 0}
button,input,select,summary{font:inherit}button,summary,select{cursor:pointer}button{color:inherit;background:transparent;border:1px solid transparent;border-radius:5px;padding:6px 10px;white-space:nowrap}
button:hover,summary:hover{background:var(--vscode-toolbar-hoverBackground,#eef0f3)}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder,#0677d4);outline-offset:2px}
nav{display:flex;gap:16px;overflow-x:auto;border-bottom:1px solid var(--vscode-widget-border,#e2e4e8)}nav button{border-radius:0;padding:10px 3px;border-bottom:2px solid transparent;color:var(--vscode-descriptionForeground,#737982)}
nav button[aria-current=true]{border-bottom-color:var(--vscode-focusBorder,#0677d4);color:var(--vscode-editor-foreground,#292b32);font-weight:600}
.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 0}.toolbar-spacer{flex:1}.segmented{display:flex;background:var(--vscode-editorWidget-background,#f5f6f8);border:1px solid var(--vscode-widget-border,#dfe2e6);border-radius:6px;padding:2px}.segmented button{font-size:12px;padding:4px 10px}
.segmented button[aria-pressed=true]{background:var(--vscode-editor-background,#fff);box-shadow:0 1px 3px #0002;font-weight:600}
#group-label{display:flex;gap:7px;align-items:center;color:var(--vscode-descriptionForeground,#737982);font-size:12px}select{max-width:180px;color:var(--vscode-dropdown-foreground,#292b32);background:var(--vscode-dropdown-background,#fff);border:1px solid var(--vscode-dropdown-border,#dfe2e6);padding:5px;border-radius:5px}
.search{display:flex;align-items:center;gap:6px;border:1px solid var(--vscode-input-border,#dfe2e6);border-radius:5px;padding:0 8px;background:var(--vscode-input-background,#fff)}input[type=search]{width:155px;border:0;background:transparent;color:var(--vscode-input-foreground,#292b32);padding:6px 0;min-width:80px}
details{position:relative}summary{list-style:none;padding:6px 10px;border-radius:5px}summary::-webkit-details-marker{display:none}
#columns{position:absolute;right:0;top:34px;z-index:5;background:var(--vscode-editorWidget-background,#fff);border:1px solid var(--vscode-widget-border,#dfe2e6);box-shadow:0 8px 24px #0002;border-radius:7px;min-width:190px;max-height:300px;overflow:auto;padding:8px}
#columns label{display:flex;align-items:center;gap:8px;padding:6px;white-space:nowrap}input[type=checkbox]{accent-color:var(--vscode-focusBorder,#0677d4)}
.table-scroll{overflow:auto;border:1px solid var(--vscode-widget-border,#e2e4e8);border-radius:8px;max-height:70vh}table{border-collapse:separate;border-spacing:0;width:100%;text-align:left}
th,td{padding:10px 13px;white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid var(--vscode-widget-border,#e9ebee);border-right:1px solid var(--vscode-widget-border,#e9ebee)}
th:last-child,td:last-child{border-right:0}thead th{position:sticky;top:0;z-index:1;background:var(--vscode-editorWidget-background,#f7f8fa);font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground,#737982)}
tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--vscode-list-hoverBackground,#f7f8fa)}.name-cell{min-width:245px}.note-line{display:flex;align-items:center;gap:8px}
.note-link{padding:0;text-align:left;white-space:normal;font-weight:550;line-height:1.5}.file-icon{flex-shrink:0;width:16px;height:16px;color:var(--vscode-descriptionForeground,#737982)}svg{width:15px;height:15px;vertical-align:middle}
.search-icon{width:18px;height:18px;flex-shrink:0;color:var(--vscode-descriptionForeground,#737982)}
.list-cell{min-width:240px;width:280px;white-space:normal}.list-cell .tags,.list-cell .pills{min-width:214px}
.tags,.pills{display:flex;flex-wrap:wrap;gap:4px;white-space:normal;min-width:0}
.tag,.pill,.invalid-tag{display:inline-block;max-width:100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 8px;font-size:11px}
.tag{border-radius:10px;background:var(--vscode-textCodeBlock-background,#eef0f4);color:var(--vscode-textLink-foreground,#0677d4)}
.pill{border-radius:5px;background:var(--vscode-textCodeBlock-background,#eef0f4);border:1px solid var(--vscode-widget-border,#dfe2e6)}
.invalid-tag{border:1px dashed var(--vscode-editorWarning-foreground,#9a6700);border-radius:4px}
.bell{padding:4px;margin-left:auto;color:var(--vscode-descriptionForeground,#737982)}.bell.scheduled{color:var(--vscode-textLink-foreground,#0677d4)}.badge{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;background:var(--vscode-textCodeBlock-background,#eef0f4);border:1px solid var(--vscode-widget-border,#dfe2e6);padding:2px 7px;border-radius:5px;font-size:11px}
.board{display:flex;align-items:flex-start;gap:16px;overflow-x:auto;padding-bottom:14px}.lane{flex:0 0 285px;background:var(--vscode-editorWidget-background,#f5f6f8);border:1px solid var(--vscode-widget-border,#e2e4e8);border-radius:8px;padding:10px;min-height:170px}
.lane h2{font-size:12px;display:flex;gap:8px;align-items:center;margin:2px 2px 12px;font-weight:600}.lane h2:before{content:'';width:7px;height:7px;border-radius:50%;background:var(--vscode-focusBorder,#0677d4);opacity:.65}.lane-count{color:var(--vscode-descriptionForeground,#737982);font-weight:400}
.card{border:1px solid var(--vscode-widget-border,#dfe2e6);border-radius:6px;padding:13px;background:var(--vscode-editor-background,#fff);box-shadow:0 2px 4px #00000006;margin-top:9px}
.card:hover{border-color:var(--vscode-focusBorder,#0677d4)}.card-fields{display:grid;grid-template-columns:minmax(65px,1fr) minmax(0,2fr);gap:8px;margin-top:14px;font-size:11px}.field-label{color:var(--vscode-descriptionForeground,#737982);overflow:hidden;text-overflow:ellipsis}.field-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{display:flex;justify-content:space-between;gap:16px;color:var(--vscode-descriptionForeground,#737982);font-size:11px;margin-top:16px}.empty{padding:60px 16px;text-align:center;color:var(--vscode-descriptionForeground,#737982)}
.diagnostics{border-left:3px solid var(--vscode-editorError-foreground,#b42318);padding:12px 18px;background:var(--vscode-inputValidation-errorBackground,#fff2f0);margin-bottom:16px}.diagnostics h2{font-size:14px;margin:0 0 8px}
[hidden]{display:none!important}@media(max-width:650px){main{padding:20px 14px}.toolbar{gap:8px}.toolbar-spacer{display:none}.search{flex:1}.search input{width:100%}footer{flex-direction:column;gap:6px}h1{font-size:23px}}
`;

const script = `
(() => {
	const vscode = acquireVsCodeApi();
	const saved = vscode.getState() || data.preferences || {};
	const state = {view: 0, mode: '', search: '', groupBy: '', hidden: [], ...saved};
	state.view = Math.max(0, Math.min(Number.isInteger(state.view) ? state.view : 0, data.views.length - 1));
	const $ = id => document.getElementById(id);
	const send = (type, values = {}) => vscode.postMessage({type, ...values});
	const persist = () => { vscode.setState(state); send('preferences', {value: state}); };
	const element = (tag, text, className) => {
		const node = document.createElement(tag);
		if (text !== undefined) node.textContent = text;
		if (className) node.className = className;
		return node;
	};
	const paths = {
		file: '<path d="M9 2H4v16h12V9L9 2Z"/><path d="M9 2v7h7M6 12h7M6 15h5"/>',
		bell: '<path d="M5 13V8a5 5 0 0 1 10 0v5l2 2H3l2-2ZM8 18h4"/>'
	};
	const icon = name => {
		const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		node.setAttribute('viewBox','0 0 20 20'); node.setAttribute('fill','none');
		node.setAttribute('stroke','currentColor'); node.setAttribute('stroke-width','1.3');
		node.setAttribute('aria-hidden','true'); node.innerHTML = paths[name]; return node;
	};
	const badge = key => /(?:status|channel|category)$/.test(key);
	const valueNode = (value, key, row) => {
		if (key === 'note.tags') {
			if (!row.tags.length) return element('span', '\\u2014');
			const list = element('span', undefined, 'tags');
			list.append(...row.tags.map(tag => {
				const node = element('span', tag.valid ? '#' + tag.label : tag.label || '(empty tag)', tag.valid ? 'tag' : 'invalid-tag');
				node.title = tag.valid ? '#' + tag.label : 'Invalid tag: ' + (tag.label || '(empty value)') + '. Use letters, numbers, _, - or /, with at least one non-numeric character and no empty path segments.';
				if (!tag.valid) node.setAttribute('aria-label', node.title);
				return node;
			}));
			return list;
		}
		if (Object.hasOwn(row.lists, key)) {
			if (!row.lists[key].length) return element('span', '\\u2014');
			const list = element('span', undefined, 'pills');
			list.append(...row.lists[key].map(value => {
				const pill = element('span', value, 'pill');
				pill.title = value;
				return pill;
			}));
			return list;
		}
		return element('span', value || '\\u2014', badge(key) && value ? 'badge' : '');
	};
	const nameLine = row => {
		const line = element('div', undefined, 'note-line');
		const file = icon('file'); file.classList.add('file-icon'); line.append(file);
		const link = element('button', row.cells[0], 'note-link');
		link.type = 'button'; link.title = row.path; link.setAttribute('aria-label', 'Open ' + row.title);
		link.addEventListener('click', () => send('open-note', {uri:row.noteUri})); line.append(link);
		if (row.canRemind) {
			const bell = element('button', undefined, 'bell' + (row.reminder ? ' scheduled' : ''));
			bell.type = 'button';
			bell.title = row.reminder ? 'Reminder: ' + new Date(row.reminder).toLocaleString() + ' (change or cancel)' : 'Set reminder';
			bell.setAttribute('aria-label', bell.title + ': ' + row.title);
			bell.append(icon('bell')); bell.addEventListener('click', () => send('reminder',{uri:row.noteUri})); line.append(bell);
		}
		return line;
	};
	const content = $('content');
	const search = $('search');
	search.value = state.search;
	search.addEventListener('input', () => {state.search = search.value; persist(); render();});
	$('reminders').addEventListener('click', () => send('reminders'));
	$('reminder-count').textContent = data.reminders ? '(' + data.reminders + ')' : '';
	for (const mode of ['table','kanban']) $(''+mode).addEventListener('click', () => {state.mode = mode; persist(); render();});
	$('group').addEventListener('change', event => {state.groupBy = event.target.value; persist(); render();});
	data.views.forEach((view,index) => {
		const button = element('button',view.name); button.type = 'button';
		button.addEventListener('click', () => {
			state.view = index; state.mode = view.type; state.groupBy = view.groupBy; persist(); render();
		});
		$('views').append(button);
	});
	function render() {
		const view = data.views[state.view];
		content.replaceChildren();
		if (!view) {
			$('empty').textContent = 'No view is defined. Use Open Base Source in the VS Code editor toolbar to add a table or Kanban view.';
			$('empty').hidden = false; $('count').textContent = '0 notes';
			return;
		}
		if (!['table','kanban'].includes(state.mode)) state.mode = view.type;
		if (!view.groups.some(group => group.key === state.groupBy)) state.groupBy = view.groupBy;
		Array.from($('views').children).forEach((button,index) => button.setAttribute('aria-current', String(index === state.view)));
		for (const mode of ['table','kanban']) $(mode).setAttribute('aria-pressed',String(state.mode === mode));
		$('group-label').hidden = state.mode !== 'kanban';
		$('group').replaceChildren(...view.groups.map(group => {
			const option = element('option',group.label); option.value = group.key; return option;
		}));
		$('group').value = state.groupBy;
		$('columns').replaceChildren(...view.columns.slice(1).map(column => {
			const label = element('label'); const checkbox = element('input');
			checkbox.type = 'checkbox'; checkbox.checked = !state.hidden.includes(column.key);
			checkbox.addEventListener('change', () => {
				state.hidden = checkbox.checked ? state.hidden.filter(key => key !== column.key) : [...state.hidden,column.key];
				persist(); render();
			});
			label.append(checkbox, document.createTextNode(column.label)); return label;
		}));
		const query = state.search.trim().toLocaleLowerCase();
		const rows = view.rows.filter(row => [row.title,row.path,...row.cells].join(' ').toLocaleLowerCase().includes(query));
		$('empty').hidden = rows.length > 0;
		$('count').textContent = rows.length + ' of ' + view.rows.length + ' notes';
		const columns = view.columns.map((column,index) => ({...column,index})).filter(column => !state.hidden.includes(column.key));
		if (state.mode === 'table') {
			const scroll = element('div',undefined,'table-scroll');
			const table = element('table'); table.setAttribute('aria-label',view.name + ' notes');
			const head = element('thead'), headings = element('tr');
			columns.forEach(column => {const th = element('th', column.label); th.scope = 'col'; headings.append(th);});
			head.append(headings); table.append(head); const body = element('tbody');
			rows.forEach(row => {
				const tr = element('tr');
				columns.forEach(column => {
					const cell = element('td'); cell.title = row.cells[column.index];
					if (column.key === 'note.tags' || Object.hasOwn(row.lists, column.key)) cell.className = 'list-cell';
					if (column.index === 0) {cell.className = 'name-cell'; cell.append(nameLine(row));}
					else cell.append(valueNode(row.cells[column.index], column.key, row));
					tr.append(cell);
				});
				body.append(tr);
			});
			table.append(body); scroll.append(table); content.append(scroll);
		} else {
			const board = element('div',undefined,'board'), groups = new Map();
			rows.forEach(row => {
				const value = row.groupValues[state.groupBy];
				if (!groups.has(value.key)) groups.set(value.key, {label:value.label,rows:[]});
				groups.get(value.key).rows.push(row);
			});
			groups.forEach(group => {
				const lane = element('section',undefined,'lane'), heading = element('h2',group.label);
				heading.append(element('span',String(group.rows.length),'lane-count')); lane.append(heading);
				group.rows.forEach(row => {
					const card = element('article',undefined,'card'); card.append(nameLine(row));
					const fields = element('div',undefined,'card-fields');
					columns.filter(column => column.index > 0 && column.key !== state.groupBy && row.cells[column.index]).forEach(column => {
						const value = element('div',undefined,'field-value'); value.title = row.cells[column.index]; value.append(valueNode(row.cells[column.index],column.key,row));
						fields.append(element('span',column.label,'field-label'),value);
					});
					card.append(fields); lane.append(card);
				});
				board.append(lane);
			});
			content.append(board);
		}
	}
	render();
})();
`;
