import * as vscode from 'vscode';
import { editTable, findTables, Table, tableCell, TableOperation } from './table';

const operations: readonly { operation: TableOperation; title: string }[] = [
	{ operation: 'format', title: 'Format Table' },
	{ operation: 'alignLeft', title: 'Align Column Left' },
	{ operation: 'alignCenter', title: 'Align Column Center' },
	{ operation: 'alignRight', title: 'Align Column Right' },
	{ operation: 'insertRowAbove', title: 'Insert Table Row Above' },
	{ operation: 'insertRowBelow', title: 'Insert Table Row Below' },
	{ operation: 'deleteRow', title: 'Delete Table Row' },
	{ operation: 'insertColumnLeft', title: 'Insert Table Column Left' },
	{ operation: 'insertColumnRight', title: 'Insert Table Column Right' },
	{ operation: 'deleteColumn', title: 'Delete Table Column' },
];

interface Target {
	uri: string;
	version: number;
	line: number;
	character: number;
}

export function registerTableCommands(output: Pick<vscode.LogOutputChannel, 'error'>): vscode.Disposable {
	const cache = new WeakMap<vscode.TextDocument, { version: number; tables: Table[] }>();
	function findTable(document: vscode.TextDocument, line: number): Table | undefined {
		let entry = cache.get(document);
		if (entry?.version !== document.version) {
			entry = { version: document.version, tables: findTables(document.getText()) };
			cache.set(document, entry);
		}
		return entry.tables.find(table => line >= table.startLine && line < table.endLine);
	}

	async function run(operation: TableOperation, target?: Target): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'markdown') {
			await vscode.window.showInformationMessage('Open a Markdown document to edit a table.');
			return;
		}
		const document = editor.document;
		if (target && (target.uri !== document.uri.toString() || target.version !== document.version)) {
			await vscode.window.showInformationMessage('The document changed. Request the table action again.');
			return;
		}
		if (editor.selections.length !== 1) {
			await vscode.window.showInformationMessage('Table commands require a single cursor or selection.');
			return;
		}
		const position = target ? new vscode.Position(target.line, target.character) : editor.selection.active;
		try {
			const table = findTable(document, position.line);
			if (!table) {
				await vscode.window.showInformationMessage('Place the cursor inside a Markdown table.');
				return;
			}
			const cell = tableCell(table, position.line, position.character);
			if ((operation === 'deleteRow' && cell.row <= 1)
				|| (operation === 'deleteColumn' && Math.max(...table.rows.map(row => row.length)) <= 1)) {
				await vscode.window.showInformationMessage(operation === 'deleteRow'
					? 'The table header and separator cannot be deleted.' : 'The last table column cannot be deleted.');
				return;
			}
			const edit = editTable(table, operation, cell.row, cell.column, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
			const range = new vscode.Range(table.startLine, 0, table.endLine - 1, document.lineAt(table.endLine - 1).text.length);
			if (document.getText(range) !== edit.text) {
				const applied = await editor.edit(builder => builder.replace(range, edit.text), { undoStopBefore: true, undoStopAfter: true });
				if (!applied) { throw new Error('VS Code could not apply the table edit.'); }
			}
			const cursor = new vscode.Position(table.startLine + edit.row, edit.column);
			editor.selection = new vscode.Selection(cursor, cursor);
			editor.revealRange(new vscode.Range(cursor, cursor));
		} catch (error) {
			output.error(`Cannot edit Markdown table in ${document.uri.toString()}: ${String(error)}`);
			await vscode.window.showErrorMessage(`Lapis: Cannot edit table. ${String(error)}`);
		}
	}

	const subscriptions = operations.map(({ operation }) =>
		vscode.commands.registerCommand(`lapis.table.${operation}`, (target?: Target) => run(operation, target)));
	subscriptions.push(vscode.languages.registerCodeActionsProvider('markdown', {
		provideCodeActions(document, range) {
			const table = findTable(document, range.start.line);
			if (!table || range.end.line >= table.endLine) { return []; }
			const cell = tableCell(table, range.start.line, range.start.character);
			return operations.filter(({ operation }) =>
				!(operation === 'deleteRow' && cell.row <= 1)
				&& !(operation === 'deleteColumn' && Math.max(...table.rows.map(row => row.length)) <= 1))
				.map(({ operation, title }) => {
					const action = new vscode.CodeAction(`Lapis: ${title}`, vscode.CodeActionKind.RefactorRewrite.append(`lapis.table.${operation}`));
					action.command = {
						command: `lapis.table.${operation}`, title,
						arguments: [{ uri: document.uri.toString(), version: document.version, line: range.start.line, character: range.start.character } satisfies Target],
					};
					return action;
				});
		},
	}, { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }));
	const updateContext = () => {
		const editor = vscode.window.activeTextEditor;
		const inTable = !!editor && editor.document.languageId === 'markdown'
			&& !!findTable(editor.document, editor.selection.active.line);
		void vscode.commands.executeCommand('setContext', 'lapis.inTable', inTable);
	};
	subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(updateContext),
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (event.textEditor === vscode.window.activeTextEditor) { updateContext(); }
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === vscode.window.activeTextEditor?.document) { updateContext(); }
		}),
	);
	updateContext();
	return vscode.Disposable.from(...subscriptions);
}
