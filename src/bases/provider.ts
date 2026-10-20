import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseBase } from './base';
import { renderBasePage, type BasePreferences } from './page';
import { WorkspaceIndex } from '../index/workspaceIndex';
import { NoteReminderService } from './reminderService';

interface BasePanelState {
	readonly panel: vscode.WebviewPanel;
	readonly rootUri: string;
	readonly document: vscode.TextDocument;
	timer?: ReturnType<typeof setTimeout>;
	readonly subscriptions: vscode.Disposable[];
}

export class BaseViewProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	private readonly panels = new Map<string, BasePanelState>();
	private readonly preferences = new Map<string, BasePreferences>();
	private readonly subscriptions: vscode.Disposable[];

	constructor(
		private readonly workspace: WorkspaceIndex,
		private readonly output: vscode.LogOutputChannel,
		private readonly reminders: NoteReminderService,
	) {
		this.subscriptions = [
			vscode.window.registerCustomEditorProvider('lapis.baseTable', this, {
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: false,
			}),
			vscode.workspace.onDidChangeTextDocument(event => {
				const state = this.panels.get(event.document.uri.toString());
				if (state && event.contentChanges.length) {
					this.render(state);
				}
			}),
			this.workspace.notes.onDidChange(() => this.refresh()),
			this.reminders.onDidChange(() => this.refresh()),
		];
	}

	async open(uri?: vscode.Uri): Promise<vscode.WebviewPanel | undefined> {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target || !/\.base$/i.test(target.path)) {
			await vscode.window.showInformationMessage('Open a .base file to preview it with Lapis.');
			return undefined;
		}
		try {
			await this.switchEditor(target, 'lapis.baseTable');
			return this.panels.get(target.toString())?.panel;
		} catch (error) {
			this.report('open this Base preview', error);
			return undefined;
		}
	}

	async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		await this.workspace.ready;
		const rootUri = this.workspace.getVaultRoot(document.uri);
		if (!rootUri) {
			this.report('open this Base preview', new Error('This .base file is outside a discovered Lapis vault.'));
			panel.dispose();
			return;
		}
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		const id = document.uri.toString();
		const state: BasePanelState = { panel, rootUri, document, subscriptions: [] };
		this.panels.set(id, state);
		state.subscriptions.push(
			panel.webview.onDidReceiveMessage(message => {
				void this.receive(state, message).catch(error => this.report('perform this Base action', error));
			}),
			panel.onDidDispose(() => {
				clearTimeout(state.timer);
				state.subscriptions.forEach(subscription => subscription.dispose());
				this.panels.delete(id);
			}),
		);
		this.render(state);
	}

	async openSource(uri?: vscode.Uri): Promise<void> {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const target = uri ?? (input instanceof vscode.TabInputCustom && input.viewType === 'lapis.baseTable' ? input.uri : undefined);
		if (!target || !/\.base$/i.test(target.path)) {
			await vscode.window.showInformationMessage('Open a Base preview to view its YAML source.');
			return;
		}
		try {
			await this.switchEditor(target, 'default');
		} catch (error) {
			this.report('open this Base source', error);
		}
	}

	dispose(): void {
		for (const state of this.panels.values()) {
			state.panel.dispose();
		}
		this.panels.clear();
		this.subscriptions.forEach(subscription => subscription.dispose());
	}

	private refresh(): void {
		for (const state of this.panels.values()) {
			clearTimeout(state.timer);
			state.timer = setTimeout(() => this.render(state), 75);
		}
	}

	private render(state: BasePanelState): void {
		const title = state.document.uri.path.split('/').at(-1) ?? '.base';
		state.panel.title = title;
		state.panel.webview.html = renderBasePage({
			title,
			result: parseBase(state.document.getText()),
			notes: this.workspace.notes.getNotes().filter(note => note.rootUri === state.rootUri),
			reminders: this.reminders.getAll(),
			preferences: this.preferences.get(state.document.uri.toString()),
		}, randomBytes(16).toString('base64'));
	}

	private async receive(state: BasePanelState, message: unknown): Promise<void> {
		if (!message || typeof message !== 'object' || !('type' in message)) {
			return;
		}
		if (message.type === 'preferences' && 'value' in message && validPreferences(message.value)) {
			this.preferences.set(state.document.uri.toString(), message.value);
		} else if (message.type === 'reminders') {
			await this.reminders.manage();
		} else if ((message.type === 'open-note' || message.type === 'reminder') && 'uri' in message && typeof message.uri === 'string') {
			const note = this.workspace.notes.get(message.uri);
			if (!note || note.rootUri !== state.rootUri) {
				throw new Error('This note is no longer available in the Base vault.');
			}
			if (message.type === 'reminder') {
				await this.reminders.edit(note);
			} else {
				await vscode.window.showTextDocument(vscode.Uri.parse(note.id), { preview: false });
			}
		}
	}

	private async switchEditor(uri: vscode.Uri, editor: string, column = vscode.window.tabGroups.activeTabGroup.viewColumn): Promise<void> {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const sameResource = (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)
			&& input.uri.toString() === uri.toString();
		if (sameResource) {
			await vscode.commands.executeCommand('reopenActiveEditorWith', editor);
		} else {
			await vscode.commands.executeCommand('vscode.openWith', uri, editor, { viewColumn: column, preview: false });
		}
	}

	private report(action: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.output.error(`Cannot ${action}: ${message}`);
		void vscode.window.showErrorMessage(`Lapis could not ${action}: ${message}`);
	}
}

function validPreferences(value: unknown): value is BasePreferences {
	return typeof value === 'object' && value !== null
		&& 'view' in value && Number.isInteger(value.view) && typeof value.view === 'number' && value.view >= 0
		&& 'mode' in value && (value.mode === 'table' || value.mode === 'kanban')
		&& 'search' in value && typeof value.search === 'string'
		&& 'groupBy' in value && typeof value.groupBy === 'string'
		&& 'hidden' in value && Array.isArray(value.hidden) && value.hidden.every(key => typeof key === 'string');
}
