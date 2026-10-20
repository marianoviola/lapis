import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { NoteRecord } from './domain/note';
import { Resolution } from './index/noteIndex';
import { WorkspaceIndex } from './index/workspaceIndex';
import { openNote } from './navigation/openNote';
import { VaultService } from './vault/vaultService';
import { registerWikilinkNavigation } from './language/links';
import { registerWikilinkCompletion } from './language/completion';
import { registerWikilinkDecorations } from './language/decorations';
import { registerBlockquoteDecorations } from './language/blockquoteDecorations';
import { nativePreview } from './preview/nativePreview';
import { registerTableCommands } from './tables/commands';
import { registerInsertWikilink } from './language/insertWikilink';
import { BaseViewProvider } from './bases/provider';
import { NoteReminderService } from './bases/reminderService';

export interface LapisApi {
	extendMarkdownIt(markdown: MarkdownIt): MarkdownIt;
	onDidChange(listener: (uri: string) => void): vscode.Disposable;
	getNotes(): readonly NoteRecord[];
	getNote(uri: string): NoteRecord | undefined;
	resolveLink(target: string, fromUri: string): Resolution;
	getBacklinks(uri: string): readonly NoteRecord[];
	whenIdle(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): LapisApi {
	const output = vscode.window.createOutputChannel('Lapis', { log: true });
	const vaults = new VaultService(output);
	const workspace = new WorkspaceIndex(output, vaults);
	const reminders = new NoteReminderService(context, workspace, output);
	const baseViews = new BaseViewProvider(workspace, output, reminders);
	const preview = nativePreview(workspace, output);
	context.subscriptions.push(
		output, vaults, workspace, reminders, baseViews, preview,
		registerWikilinkNavigation(workspace),
		registerWikilinkCompletion(workspace),
		registerWikilinkDecorations(workspace),
		registerBlockquoteDecorations(output),
		registerTableCommands(output),
		registerInsertWikilink(workspace, output),
		vscode.commands.registerCommand('lapis.openBase', (uri?: vscode.Uri) => baseViews.open(uri)),
		vscode.commands.registerCommand('lapis.openBaseSource', (uri?: vscode.Uri) => baseViews.openSource(uri)),
		vscode.commands.registerCommand('lapis.openNote', () => openNote(workspace)),
		vscode.commands.registerCommand('lapis.rebuildIndex', async () => {
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Lapis: Rebuilding note index' }, () => workspace.rebuild());
			return workspace.notes.size;
		}),
	);
	return {
		extendMarkdownIt: markdown => preview.extendMarkdownIt(markdown),
		onDidChange: listener => workspace.notes.onDidChange(listener),
		getNotes: () => workspace.notes.getNotes(),
		getNote: uri => workspace.notes.get(uri),
		resolveLink: (target, fromUri) => workspace.notes.resolve(target, fromUri),
		getBacklinks: uri => workspace.notes.getBacklinks(uri),
		whenIdle: () => workspace.whenIdle(),
	};
}
