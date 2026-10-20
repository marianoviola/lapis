import * as vscode from 'vscode';
import type { NoteRecord } from '../domain/note';
import type { WorkspaceIndex } from '../index/workspaceIndex';
import { futureDateProperties, localDateTime, parseReminderDate, ReminderScheduler, type NoteReminder } from './reminders';

export class NoteReminderService implements vscode.Disposable {
	private readonly change = new vscode.EventEmitter<void>();
	readonly onDidChange = this.change.event;
	private readonly scheduler: ReminderScheduler;
	private readonly subscriptions: vscode.Disposable[];
	private disposed = false;

	constructor(
		context: Pick<vscode.ExtensionContext, 'workspaceState'>,
		private readonly workspace: Pick<WorkspaceIndex, 'getVaultRoot' | 'ready'>,
		private readonly output: Pick<vscode.LogOutputChannel, 'error'>,
	) {
		this.scheduler = new ReminderScheduler({
			read: () => context.workspaceState.get('lapis.noteReminders'),
			write: reminders => context.workspaceState.update('lapis.noteReminders', reminders),
		}, reminder => this.notify(reminder), () => this.change.fire(), error => this.report(error));
		this.subscriptions = [
			vscode.workspace.onDidRenameFiles(event => {
				for (const file of event.files) {
					void this.scheduler.relocate(file.oldUri.toString(), file.newUri.toString()).catch(error => this.report(error));
				}
			}),
			vscode.workspace.onDidDeleteFiles(event => {
				for (const uri of event.files) {
					void this.scheduler.relocate(uri.toString()).catch(error => this.report(error));
				}
			}),
			vscode.commands.registerCommand('lapis.manageReminders', () => this.manage()),
		];
	}

	getAll(): readonly NoteReminder[] {
		return this.scheduler.getAll();
	}

	async edit(note: NoteRecord): Promise<void> {
		try {
			const existing = this.getAll().find(reminder => reminder.noteUri === note.id);
			if (existing) {
				const action = await vscode.window.showQuickPick(['Change reminder', 'Cancel reminder'], {
					title: note.title, placeHolder: `Reminder: ${new Date(existing.due).toLocaleString()}`,
				});
				if (!action) {
					return;
				}
				if (action === 'Cancel reminder') {
					await this.scheduler.remove(note.id);
					return;
				}
			}
			const dates = futureDateProperties(note.properties);
			if (!dates.length) {
				await vscode.window.showInformationMessage('This note has no future ISO date property. Add a date such as due: 2026-12-20 to its frontmatter.');
				return;
			}
			const selected = await vscode.window.showQuickPick(dates.map(date => ({
				label: date.property, description: date.value, date,
			})), { title: `Remind me: ${note.title}`, placeHolder: 'Choose a future date property' });
			if (!selected) {
				return;
			}
			const input = await vscode.window.showInputBox({
				title: 'Reminder date and time',
				prompt: 'Local time, YYYY-MM-DDTHH:mm. Date-only properties default to 09:00. This does not change the note.',
				value: localDateTime(parseReminderDate(selected.date.value)!),
				validateInput: value => {
					const due = parseReminderDate(value);
					return due === undefined || due <= Date.now() ? 'Enter a valid future ISO date and time.' : undefined;
				},
			});
			if (input === undefined) {
				return;
			}
			const due = parseReminderDate(input);
			if (due === undefined) {
				throw new Error('Invalid reminder date.');
			}
			await this.scheduler.set({ noteUri: note.id, title: note.title, property: selected.date.property, due });
			await vscode.window.showInformationMessage(`Reminder set for ${new Date(due).toLocaleString()}: ${note.title}`);
		} catch (error) {
			this.report(error);
		}
	}

	async manage(): Promise<void> {
		const reminders = [...this.getAll()].sort((left, right) => left.due - right.due);
		if (!reminders.length) {
			await vscode.window.showInformationMessage('No Lapis reminders. Use the bell next to a note with a future date in a Base preview.');
			return;
		}
		const selected = await vscode.window.showQuickPick(reminders.map(reminder => ({
			label: reminder.title, description: new Date(reminder.due).toLocaleString(), detail: reminder.property, reminder,
		})), { title: 'Lapis reminders', placeHolder: 'Choose a reminder to open or cancel' });
		if (!selected) {
			return;
		}
		const action = await vscode.window.showQuickPick(['Open note', 'Cancel reminder'], { title: selected.label });
		try {
			if (action === 'Cancel reminder') {
				await this.scheduler.remove(selected.reminder.noteUri);
			} else if (action === 'Open note') {
				await vscode.window.showTextDocument(vscode.Uri.parse(selected.reminder.noteUri), { preview: false });
			}
		} catch (error) {
			this.report(error);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.scheduler.dispose();
		this.change.dispose();
		this.subscriptions.forEach(subscription => subscription.dispose());
	}

	private notify(reminder: NoteReminder): void {
		void (async () => {
			try {
				await this.workspace.ready;
				if (this.disposed) {
					return;
				}
				if (!this.workspace.getVaultRoot(vscode.Uri.parse(reminder.noteUri))) {
					throw new Error(`Reminder note is no longer in a Lapis vault: ${reminder.noteUri}`);
				}
				const action = await vscode.window.showInformationMessage(
					`Lapis reminder: ${reminder.title} (${reminder.property}, ${new Date(reminder.due).toLocaleString()})`, 'Open note');
				if (action === 'Open note') {
					await vscode.window.showTextDocument(vscode.Uri.parse(reminder.noteUri), { preview: false });
				}
			} catch (error) {
				this.report(error);
			}
		})();
	}

	private report(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.output.error(`Lapis reminder: ${message}`);
		void vscode.window.showErrorMessage(`Lapis reminder: ${message}`);
	}
}
