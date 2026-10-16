import * as vscode from 'vscode';
import { blockquoteRanges } from './blockquoteRanges';

export function registerBlockquoteDecorations(output: Pick<vscode.LogOutputChannel, 'error'>): vscode.Disposable {
	const decoration = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor('editor.foreground'),
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});
	const refresh = () => {
		for (const editor of vscode.window.visibleTextEditors) {
			const document = editor.document;
			if (document.languageId !== 'markdown' || document.isClosed) {
				editor.setDecorations(decoration, []);
				continue;
			}
			try {
				editor.setDecorations(decoration, blockquoteRanges(document.getText()).map(range =>
					new vscode.Range(document.positionAt(range.start), document.positionAt(range.end))));
			} catch (error) {
				editor.setDecorations(decoration, []);
				output.error(`Cannot style Markdown blockquotes in ${document.uri.toString()}: ${String(error)}`);
			}
		}
	};
	const subscriptions = [
		vscode.window.onDidChangeVisibleTextEditors(refresh),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.contentChanges.length && vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) {
				refresh();
			}
		}),
	];
	refresh();
	return new vscode.Disposable(() => {
		subscriptions.forEach(subscription => subscription.dispose());
		decoration.dispose();
	});
}
