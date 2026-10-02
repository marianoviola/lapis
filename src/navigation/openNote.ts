import * as vscode from 'vscode';
import { WorkspaceIndex } from '../index/workspaceIndex';

interface NoteItem extends vscode.QuickPickItem {
	readonly uri: vscode.Uri;
}

export async function openNote(workspace: WorkspaceIndex): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		await vscode.window.showInformationMessage('Open a folder to browse notes with Lapis.');
		return;
	}
	await workspace.whenIdle();
	const picker = vscode.window.createQuickPick<NoteItem>();
	picker.title = 'Lapis: Open Note';
	picker.placeholder = 'Find a note by title or path';
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;
	picker.busy = true;
	const update = () => {
		const active = picker.activeItems[0]?.uri.toString();
		picker.items = workspace.notes.getNotes().map(note => {
			const uri = vscode.Uri.parse(note.id);
			const properties = ['type', 'status', 'project'].flatMap(key => {
				const value = note.properties[key];
				return typeof value === 'string' ? [`${key}: ${value}`] : [];
			});
			return {
				uri, label: note.title,
				description: vscode.workspace.asRelativePath(uri, true),
				detail: [note.dirty ? 'Unsaved changes' : '', note.issues.length ? 'Frontmatter needs attention' : '', ...properties].filter(Boolean).join(' | '),
				iconPath: new vscode.ThemeIcon(note.issues.length ? 'warning' : 'markdown'),
			};
		});
		const previous = picker.items.find(item => item.uri.toString() === active);
		picker.activeItems = previous ? [previous] : picker.items.slice(0, 1);
	};
	const subscriptions: vscode.Disposable[] = [];
	subscriptions.push(
		workspace.notes.onDidChange(update),
		picker.onDidAccept(() => {
			const item = picker.selectedItems[0];
			if (item) {
				picker.hide();
				void vscode.window.showTextDocument(item.uri, { preview: false }).then(undefined, error => {
					void vscode.window.showErrorMessage(`Lapis could not open this note: ${error instanceof Error ? error.message : String(error)}`);
				});
			}
		}),
	);
	subscriptions.push(picker.onDidHide(() => {
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		picker.dispose();
	}));
	update();
	picker.busy = false;
	if (!picker.items.length) {
		picker.placeholder = 'No Markdown notes found in the included workspace folders';
	}
	picker.show();
}