import * as vscode from 'vscode';
import { NoteRecord } from './domain/note';
import { Resolution } from './index/noteIndex';
import { WorkspaceIndex } from './index/workspaceIndex';
import { openNote } from './navigation/openNote';
import { VaultService } from './vault/vaultService';

export interface LapislazuliApi {
	onDidChange(listener: (uri: string) => void): vscode.Disposable;
	getNotes(): readonly NoteRecord[];
	getNote(uri: string): NoteRecord | undefined;
	resolveLink(target: string, fromUri: string): Resolution;
	getBacklinks(uri: string): readonly NoteRecord[];
	whenIdle(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): LapislazuliApi {
	const output = vscode.window.createOutputChannel('Lapislazuli', { log: true });
	const vaults = new VaultService(output);
	const workspace = new WorkspaceIndex(output, vaults);
	context.subscriptions.push(
		output, vaults, workspace,
		vscode.commands.registerCommand('lapislazuli.openNote', () => openNote(workspace)),
		vscode.commands.registerCommand('lapislazuli.rebuildIndex', async () => {
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Lapislazuli: Rebuilding note index' }, () => workspace.rebuild());
			return workspace.notes.size;
		}),
	);
	return {
		onDidChange: listener => workspace.notes.onDidChange(listener),
		getNotes: () => workspace.notes.getNotes(),
		getNote: uri => workspace.notes.get(uri),
		resolveLink: (target, fromUri) => workspace.notes.resolve(target, fromUri),
		getBacklinks: uri => workspace.notes.getBacklinks(uri),
		whenIdle: () => workspace.whenIdle(),
	};
}
