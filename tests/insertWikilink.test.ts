import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { NoteIndex } from '../src/index/noteIndex';
import { registerInsertWikilink } from '../src/language/insertWikilink';
import type { LinkSuggestion } from '../src/language/completionItems';

const host = vi.hoisted(() => ({
	text: '', version: 1, closed: false, selectionCount: 1,
	selection: undefined as vscode.Selection | undefined,
	command: undefined as (() => Promise<void>) | undefined,
	accept: undefined as (() => void) | undefined,
	hide: undefined as (() => void) | undefined,
	items: [] as readonly { suggestion: LinkSuggestion }[],
	edit: vi.fn(), alias: vi.fn(), heading: vi.fn(), error: vi.fn(), info: vi.fn(), dispose: vi.fn(),
}));

vi.mock('vscode', () => {
	const offsetAt = (position: vscode.Position) => host.text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character;
	const positionAt = (offset: number) => {
		const lines = host.text.slice(0, offset).split('\n');
		return { line: lines.length - 1, character: lines[lines.length - 1].length };
	};
	const editor = {
		document: {
			languageId: 'markdown',
			uri: { toString: () => 'file:///vault/Source.md' },
			get version() { return host.version; },
			get isClosed() { return host.closed; },
			getText: (range?: vscode.Range) => range ? host.text.slice(offsetAt(range.start), offsetAt(range.end)) : host.text,
			offsetAt, positionAt,
		},
		get selections() { return Array.from({ length: host.selectionCount }, () => ({})); },
		get selection() { return host.selection; },
		set selection(value: vscode.Selection | undefined) { host.selection = value; },
		edit: host.edit,
	};
	return {
		Position: class { constructor(readonly line: number, readonly character: number) {} },
		Range: class { constructor(readonly start: vscode.Position, readonly end: vscode.Position) {} },
		Selection: class {
			readonly active: vscode.Position;
			constructor(readonly start: vscode.Position, readonly end: vscode.Position) { this.active = end; }
			isEqual(other: vscode.Selection) { return this.start === other.start && this.end === other.end; }
		},
		Disposable: class { constructor(readonly dispose: () => void) {} },
		commands: {
			registerCommand: (_: string, callback: typeof host.command) => {
				host.command = callback;
				return { dispose: vi.fn() };
			},
		},
		window: {
			activeTextEditor: editor,
			showInputBox: host.alias, showQuickPick: host.heading,
			showErrorMessage: host.error, showInformationMessage: host.info,
			createQuickPick: () => ({
				get items() { return host.items; },
				set items(value: typeof host.items) { host.items = value; },
				activeItems: [],
				get selectedItems() { return host.items.filter(item => item.suggestion.description === 'Target.md'); },
				onDidAccept: (listener: typeof host.accept) => { host.accept = listener; return { dispose: vi.fn() }; },
				onDidHide: (listener: typeof host.hide) => { host.hide = listener; return { dispose: vi.fn() }; },
				show: vi.fn(), hide: () => host.hide!(), dispose: host.dispose,
			}),
		},
	};
});

function setup(text: string, start: number, end = start) {
	host.text = text;
	const position = (offset: number) => {
		const lines = text.slice(0, offset).split('\n');
		return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
	};
	host.selection = new vscode.Selection(position(start), position(end));
	const notes = new NoteIndex(async () => undefined);
	const add = (path: string, content = '', rootUri = 'file:///vault') => notes.upsert({
		uri: `${rootUri}/${path}`, rootUri, relativePath: path, text: content, dirty: false,
	});
	add('Source.md', text);
	add('Target.md', '# Section\n');
	add('Private.md', '', 'file:///private');
	const output = { error: vi.fn() };
	const registration = registerInsertWikilink({
		notes, ready: Promise.resolve(), whenIdle: async () => {}, synchronizeOpenDocuments: () => {},
	}, output);
	host.edit.mockImplementation(async (callback: (builder: { replace(range: vscode.Range, text: string): void }) => void) => {
		callback({ replace: (range, replacement) => {
			const offset = (position: vscode.Position) => host.text.split('\n').slice(0, position.line)
				.reduce((n, line) => n + line.length + 1, 0) + position.character;
			host.text = host.text.slice(0, offset(range.start)) + replacement + host.text.slice(offset(range.end));
			host.version++;
		} });
		return true;
	});
	return { notes, add, output, registration };
}

describe('Insert Wikilink command', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		host.version = 1;
		host.closed = false;
		host.selectionCount = 1;
		host.items = [];
		host.alias.mockResolvedValue('');
		host.heading.mockImplementation(async items => items[0]);
	});

	it('offers optional headings and an alias, editing once with undo boundaries', async () => {
		const { registration } = setup('selected label', 0, 14);
		host.heading.mockImplementation(async items => items[1]);
		host.alias.mockResolvedValue('My alias');
		await host.command!();
		expect(host.items.some(item => item.suggestion.description === 'Private.md')).toBe(false);
		host.accept!();
		await vi.waitFor(() => expect(host.edit).toHaveBeenCalledOnce());
		expect(host.text).toBe('[[Target#Section|My alias]]');
		expect(host.alias.mock.calls[0][0].value).toBe('selected label');
		expect(host.edit.mock.calls[0][1]).toEqual({ undoStopBefore: true, undoStopAfter: true });
		expect(host.dispose).toHaveBeenCalledOnce();
		registration.dispose();
	});

	it.each(['|Old', '\\|Old'])('preserves and allows changing an existing %s alias', async suffix => {
		const { registration } = setup(`[[Target${suffix}]]`, 4);
		host.alias.mockResolvedValue('New');
		await host.command!();
		host.accept!();
		await vi.waitFor(() => expect(host.edit).toHaveBeenCalledOnce());
		expect(host.alias.mock.calls[0][0].value).toBe('Old');
		expect(host.text).toBe(`[[Target${suffix.startsWith('\\') ? '\\|' : '|'}New]]`);
		registration.dispose();
	});

	it('escapes a new alias separator inside a Markdown table', async () => {
		const text = '| A |\n| --- |\n| selected |';
		const start = text.indexOf('selected');
		const { registration } = setup(text, start, start + 8);
		host.alias.mockResolvedValue('Label');
		await host.command!();
		host.accept!();
		await vi.waitFor(() => expect(host.edit).toHaveBeenCalledOnce());
		expect(host.text).toBe('| A |\n| --- |\n| [[Target\\|Label]] |');
		registration.dispose();
	});

	it('allows an empty alias and validates unsupported alias syntax', async () => {
		const { registration } = setup('', 0);
		await host.command!();
		host.accept!();
		await vi.waitFor(() => expect(host.edit).toHaveBeenCalledOnce());
		expect(host.text).toBe('[[Target]]');
		const validate = host.alias.mock.calls[0][0].validateInput;
		expect(validate('My label')).toBeUndefined();
		for (const value of ['x|y', '[x]', 'x\ny']) { expect(validate(value)).toBeTruthy(); }
		registration.dispose();
	});

	it.each(['note', 'heading', 'alias'])('cancels the %s picker without editing', async phase => {
		const { registration } = setup('', 0);
		if (phase === 'heading') { host.heading.mockResolvedValue(undefined); }
		if (phase === 'alias') { host.alias.mockResolvedValue(undefined); }
		await host.command!();
		if (phase === 'note') { host.hide!(); } else { host.accept!(); }
		await new Promise(resolve => setImmediate(resolve));
		expect(host.edit).not.toHaveBeenCalled();
		expect(host.error).not.toHaveBeenCalled();
		registration.dispose();
	});

	it.each(['source', 'destination', 'retarget', 'selection', 'heading', 'dispose'])('refuses obsolete edits after %s changes during the alias prompt', async change => {
		const { notes, add, output, registration } = setup('', 0);
		host.heading.mockImplementation(async items => items[1]);
		host.alias.mockImplementation(async () => {
			if (change === 'source') { host.version++; }
			if (change === 'destination') { notes.remove('file:///vault/Target.md'); }
			if (change === 'retarget') {
				notes.remove('file:///vault/Target.md');
				add('nested/Target.md', '# Section\n');
			}
			if (change === 'selection') { host.selectionCount = 2; }
			if (change === 'heading') { add('Target.md', '# Replaced\n'); }
			if (change === 'dispose') { registration.dispose(); }
			return 'Alias';
		});
		await host.command!();
		host.accept!();
		await new Promise(resolve => setImmediate(resolve));
		expect(host.edit).not.toHaveBeenCalled();
		if (change !== 'dispose') {
			expect(output.error).toHaveBeenCalledOnce();
			expect(host.error).toHaveBeenCalledOnce();
		}
		registration.dispose();
	});
});
