import * as vscode from 'vscode';
import { WorkspaceIndex } from '../index/workspaceIndex';

export function registerWikilinkDecorations(workspace: Pick<WorkspaceIndex, 'notes'>): vscode.Disposable {
	const decorations = {
		resolved: vscode.window.createTextEditorDecorationType({
			color: new vscode.ThemeColor('textLink.foreground'),
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		}),
		missing: vscode.window.createTextEditorDecorationType({
			color: new vscode.ThemeColor('editorWarning.foreground'),
			textDecoration: 'underline dotted',
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		}),
		ambiguous: vscode.window.createTextEditorDecorationType({
			color: new vscode.ThemeColor('editorInfo.foreground'),
			textDecoration: 'underline dashed',
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		}),
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	const clear = (editor: vscode.TextEditor) => {
		for (const decoration of Object.values(decorations)) {
			editor.setDecorations(decoration, []);
		}
	};
	const refresh = () => {
		if (disposed) {
			return;
		}
		for (const editor of vscode.window.visibleTextEditors) {
			const document = editor.document;
			const note = workspace.notes.get(document.uri.toString());
			if (document.languageId !== 'markdown' || document.uri.scheme !== 'file' || document.isClosed
				|| !note || note.documentVersion !== document.version) {
				clear(editor);
				continue;
			}
			const ranges: Record<keyof typeof decorations, vscode.Range[]> = { resolved: [], missing: [], ambiguous: [] };
			for (const link of note.links) {
				const resolution = workspace.notes.resolve(link.target, note.id);
				// Attachment resolution is not defined yet; do not mark non-Markdown embeds as broken notes.
				if (link.embed && resolution.kind !== 'resolved' && /\.[^/.]+$/.test(link.target) && !/\.md$/i.test(link.target)) {
					continue;
				}
				ranges[resolution.kind].push(new vscode.Range(document.positionAt(link.range.start), document.positionAt(link.range.end)));
			}
			for (const kind of ['resolved', 'missing', 'ambiguous'] as const) {
				editor.setDecorations(decorations[kind], ranges[kind]);
			}
		}
	};
	const schedule = () => {
		if (!disposed && !timer) {
			timer = setTimeout(() => { timer = undefined; refresh(); }, 100);
		}
	};
	const subscriptions = [
		workspace.notes.onDidChange(schedule),
		vscode.window.onDidChangeVisibleTextEditors(refresh),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.contentChanges.length) {
				for (const editor of vscode.window.visibleTextEditors) {
					if (editor.document === event.document) {
						clear(editor);
					}
				}
				schedule();
			}
		}),
	];
	refresh();
	return new vscode.Disposable(() => {
		disposed = true;
		if (timer) {
			clearTimeout(timer);
		}
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		for (const decoration of Object.values(decorations)) {
			decoration.dispose();
		}
	});
}
