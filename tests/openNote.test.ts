import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceIndex } from '../src/index/workspaceIndex';
import { NoteIndex } from '../src/index/noteIndex';

const state = vi.hoisted(() => ({ hide: () => {}, picker: {
	title: '', placeholder: '', busy: false, matchOnDescription: false, matchOnDetail: false,
	items: [] as unknown[], activeItems: [] as { uri: { toString(): string } }[], selectedItems: [],
	show: vi.fn(), dispose: vi.fn(),
} }));
vi.mock('vscode', () => ({
	workspace: { workspaceFolders: [{}], asRelativePath: () => 'Note.md' },
	Uri: { parse: (id: string) => ({ toString: () => id }) },
	ThemeIcon: class {},
	window: { createQuickPick: () => ({
		...state.picker,
		get items() { return state.picker.items; },
		set items(value: unknown[]) { state.picker.items = value; },
		get busy() { return state.picker.busy; },
		set busy(value: boolean) { state.picker.busy = value; },
		onDidAccept: () => ({ dispose() {} }),
		onDidHide: (callback: () => void) => { state.hide = callback; return { dispose() {} }; },
	}), showErrorMessage: vi.fn() },
}));
import { openNote } from '../src/navigation/openNote';

describe('Open Note during indexing', () => {
	it('shows immediately, streams notes and finishes without blocking the command', async () => {
		let finish!: () => void;
		const pending = new Promise<void>(resolve => { finish = resolve; });
		const notes = new NoteIndex(async () => undefined);
		await openNote({ notes, whenIdle: () => pending } as unknown as WorkspaceIndex);
		expect(state.picker.show).toHaveBeenCalled();
		expect(state.picker.busy).toBe(true);
		notes.upsert({ uri: 'file:///vault/Note.md', rootUri: 'file:///vault', relativePath: 'Note.md', text: '', dirty: false });
		expect(state.picker.items).toHaveLength(1);
		finish();
		await pending;
		expect(state.picker.busy).toBe(false);
		state.hide();
	});
	it('unsubscribes and ignores indexing completion after dismissal', async () => {
		let finish!: () => void;
		const pending = new Promise<void>(resolve => { finish = resolve; });
		const notes = new NoteIndex(async () => undefined);
		await openNote({ notes, whenIdle: () => pending } as unknown as WorkspaceIndex);
		state.hide();
		const items = state.picker.items;
		notes.upsert({ uri: 'file:///vault/Note.md', rootUri: 'file:///vault', relativePath: 'Note.md', text: '', dirty: false });
		finish();
		await pending;
		expect(state.picker.items).toBe(items);
	});
});
