import * as vscode from 'vscode';
import * as path from 'node:path';
import { markdownToDocx } from './conversion';

export function registerExportToWord(): vscode.Disposable {
	return vscode.commands.registerCommand('lapis.exportMarkdownToWord', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'markdown') {
			return;
		}

		const selections = editor.selections.filter(selection => !selection.isEmpty);
		const markdown = selections.length
			? selections.map(selection => editor.document.getText(selection)).join('\n\n')
			: editor.document.getText();
		const parsedPath = path.parse(editor.document.uri.path);
		const defaultUri = editor.document.uri.scheme === 'file'
			? editor.document.uri.with({ path: path.join(parsedPath.dir, `${parsedPath.name || 'Markdown'}.docx`) })
			: undefined;
		const uri = await vscode.window.showSaveDialog({
			defaultUri,
			filters: { 'Word Document': ['docx'] },
			saveLabel: 'Export',
		});
		if (!uri) {
			return;
		}

		const bytes = await markdownToDocx(markdown, parsedPath.name);
		await vscode.workspace.fs.writeFile(uri, bytes);
		void vscode.window.showInformationMessage(`Exported Word document: ${path.basename(uri.path)}`);
	});
}
