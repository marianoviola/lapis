import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { NoteReminderService } from '../src/bases/reminderService';
import { parseNote } from '../src/index/parseNote';
import type { NoteReminder } from '../src/bases/reminders';

const mock = vi.hoisted(() => ({
	pick: vi.fn(), input: vi.fn(), info: vi.fn(), error: vi.fn(), open: vi.fn(),
	rename: vi.fn(), delete: vi.fn(), command: vi.fn(),
}));

vi.mock('vscode', () => ({
	EventEmitter: class {
		event = vi.fn(() => ({ dispose() {} }));
		fire = vi.fn();
		dispose = vi.fn();
	},
	Uri: { parse: (value: string) => ({ toString: () => value }) },
	window: { showQuickPick: mock.pick, showInputBox: mock.input, showInformationMessage: mock.info, showErrorMessage: mock.error, showTextDocument: mock.open },
	workspace: {
		onDidRenameFiles: (listener: unknown) => { mock.rename(listener); return { dispose() {} }; },
		onDidDeleteFiles: (listener: unknown) => { mock.delete(listener); return { dispose() {} }; },
	},
	commands: { registerCommand: mock.command.mockReturnValue({ dispose() {} }) },
}));

describe('VS Code note reminders', () => {
	const now = Date.parse('2026-01-01T00:00Z');
	const note = parseNote({
		uri: 'file:///vault/post.md', rootUri: 'file:///vault', relativePath: 'post.md', dirty: false,
		text: '---\ntitle: Post\ndue: 2027-12-01\n---\nPost body',
	});
	let service: NoteReminderService | undefined;

	function setup(saved?: readonly NoteReminder[], failStorage = false, ready = Promise.resolve()) {
		const update = vi.fn(async (_key: string, _value: unknown) => {
			if (failStorage) {
				throw new Error('Storage failed');
			}
		});
		const state: vscode.Memento = { keys: () => [], get: <T>() => saved as T, update };
		const output = { error: vi.fn() };
		const getVaultRoot = vi.fn(() => note.rootUri);
		service = new NoteReminderService({ workspaceState: state }, { getVaultRoot, ready }, output);
		return { service, update, output, getVaultRoot };
	}

	beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks(); });
	afterEach(() => { service?.dispose(); vi.useRealTimers(); });

	it('saves a manually chosen reminder without changing the note', async () => {
		const before = JSON.stringify(note);
		mock.pick.mockImplementationOnce(async (items: unknown[]) => items[0]);
		mock.input.mockResolvedValueOnce('2027-12-01T09:00');
		const { service, update } = setup();
		await service.edit(note);
		expect(update).toHaveBeenCalledWith('lapis.noteReminders', service.getAll());
		expect(service.getAll()[0]).toMatchObject({ noteUri: note.id, property: 'due' });
		expect(JSON.stringify(note)).toBe(before);
		expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('Reminder set'));
	});

	it('does not save when date selection is cancelled, or report success when storage fails', async () => {
		mock.pick.mockResolvedValueOnce(undefined);
		const { service, update, output } = setup(undefined, true);
		await service.edit(note);
		expect(update).not.toHaveBeenCalled();
		mock.pick.mockImplementationOnce(async (items: unknown[]) => items[0]);
		mock.input.mockResolvedValueOnce('2027-12-01T09:00');
		await service.edit(note);
		expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('Storage failed'));
		expect(output.error).toHaveBeenCalledOnce();
		expect(mock.info).not.toHaveBeenCalled();
		expect(service.getAll()).toEqual([]);
	});

	it('cancels an existing reminder through its bell', async () => {
		const { service, update } = setup([{ noteUri: note.id, title: note.title, property: 'due', due: now + 5000 }]);
		mock.pick.mockResolvedValueOnce('Cancel reminder');
		await service.edit(note);
		expect(update).toHaveBeenCalledWith('lapis.noteReminders', []);
		expect(service.getAll()).toEqual([]);
	});

	it('delivers restored overdue reminders through VS Code and opens the chosen note', async () => {
		mock.info.mockResolvedValueOnce('Open note');
		const { update } = setup([{ noteUri: note.id, title: note.title, property: 'due', due: now - 1000 }]);
		await vi.advanceTimersByTimeAsync(0);
		expect(update).toHaveBeenCalledWith('lapis.noteReminders', []);
		expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('Lapis reminder: Post'), 'Open note');
		expect(mock.open).toHaveBeenCalledWith(expect.objectContaining({ toString: expect.any(Function) }), { preview: false });
	});

	it('waits for vault discovery before delivering an overdue startup reminder', async () => {
		let finishDiscovery!: () => void;
		const ready = new Promise<void>(resolve => { finishDiscovery = resolve; });
		const { getVaultRoot } = setup([{ noteUri: note.id, title: note.title, property: 'due', due: now - 1000 }], false, ready);
		await vi.advanceTimersByTimeAsync(0);
		expect(getVaultRoot).not.toHaveBeenCalled();
		expect(mock.info).not.toHaveBeenCalled();
		finishDiscovery();
		await vi.advanceTimersByTimeAsync(0);
		expect(getVaultRoot).toHaveBeenCalledOnce();
		expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('Lapis reminder: Post'), 'Open note');
		expect(mock.error).not.toHaveBeenCalled();
	});
});
