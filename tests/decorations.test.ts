import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteIndex } from '../src/index/noteIndex';
import { registerWikilinkDecorations } from '../src/language/decorations';

const host = vi.hoisted(() => {
	type Document = {
		uri: { scheme: string; toString(): string };
		languageId: string;
		version: number;
		isClosed: boolean;
		positionAt(offset: number): number;
	};
	return {
		editors: [] as { document: Document; setDecorations: ReturnType<typeof vi.fn> }[],
		types: [] as { options: { color: { id: string }; textDecoration?: string }; dispose: ReturnType<typeof vi.fn> }[],
		visible: undefined as (() => void) | undefined,
		change: undefined as ((event: { document: Document; contentChanges: unknown[] }) => void) | undefined,
	};
});

vi.mock('vscode', () => ({
	ThemeColor: class { constructor(readonly id: string) {} },
	Range: class { constructor(readonly start: number, readonly end: number) {} },
	Disposable: class { constructor(readonly dispose: () => void) {} },
	DecorationRangeBehavior: { ClosedClosed: 1 },
	window: {
		get visibleTextEditors() { return host.editors; },
		createTextEditorDecorationType(options: typeof host.types[number]['options']) {
			const decoration = { options, dispose: vi.fn() };
			host.types.push(decoration);
			return decoration;
		},
		onDidChangeVisibleTextEditors(listener: () => void) {
			host.visible = listener;
			return { dispose: () => { host.visible = undefined; } };
		},
	},
	workspace: {
		onDidChangeTextDocument(listener: typeof host.change) {
			host.change = listener;
			return { dispose: () => { host.change = undefined; } };
		},
	},
}));

function fixture(text: string) {
	const notes = new NoteIndex(async () => undefined);
	const add = (path: string, content = '', rootUri = 'file:///vault', version = 1) => notes.upsert({
		uri: `${rootUri}/${path}`, rootUri, relativePath: path, text: content,
		dirty: true, documentVersion: version,
	});
	add('Source.md', text);
	const editor = {
		document: {
			uri: { scheme: 'file', toString: () => 'file:///vault/Source.md' },
			languageId: 'markdown', version: 1, isClosed: false, positionAt: (offset: number) => offset,
		},
		setDecorations: vi.fn(),
	};
	host.editors.push(editor);
	return { notes, add, editor };
}

function ranges(editor: typeof host.editors[number], kind: number) {
	return editor.setDecorations.mock.calls.filter(call => call[0] === host.types[kind]).at(-1)?.[1];
}

describe('wikilink editor decorations', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		host.editors.length = 0;
		host.types.length = 0;
	});
	afterEach(() => { vi.useRealTimers(); });

	it('colours complete syntax and aliases by resolver state using theme colours', () => {
		const text = '[[Target#Absent|Alias]] [[Missing]] [[Duplicate]] ![[image.png]] ![[Target]]';
		const { notes, add, editor } = fixture(text);
		add('Target.md');
		add('one/Duplicate.md');
		add('two/Duplicate.md');
		const registration = registerWikilinkDecorations({ notes });
		expect(host.types.map(type => type.options.color.id)).toEqual([
			'textLink.foreground', 'editorWarning.foreground', 'editorInfo.foreground',
		]);
		expect(host.types[1].options.textDecoration).toBe('underline dotted');
		expect(host.types[2].options.textDecoration).toBe('underline dashed');
		const links = notes.get(editor.document.uri.toString())!.links;
		expect(ranges(editor, 0)).toEqual([links[0].range, links[4].range]);
		expect(ranges(editor, 1)).toEqual([links[1].range]);
		expect(ranges(editor, 2)).toEqual([links[2].range]);
		registration.dispose();
		notes.dispose();
	});

	it('excludes code, frontmatter, escapes and other-vault destinations', () => {
		const { notes, add, editor } = fixture('---\ntitle: "[[Target]]"\n---\n`[[Target]]`\n\n```\n[[Target]]\n```\n\n\\[[Target]] [[Private]] [[Target\\|Alias]]');
		add('Target.md');
		add('Private.md', '', 'file:///private');
		const registration = registerWikilinkDecorations({ notes });
		expect(ranges(editor, 0)).toHaveLength(1);
		expect(ranges(editor, 1)).toHaveLength(1);
		expect(ranges(editor, 2)).toEqual([]);
		notes.remove(editor.document.uri.toString());
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 0)).toEqual([]);
		expect(ranges(editor, 1)).toEqual([]);
		registration.dispose();
		notes.dispose();
	});

	it('refreshes dependent editors on target creation, ambiguity, rename and deletion', () => {
		const { notes, add, editor } = fixture('[[Target]]');
		const registration = registerWikilinkDecorations({ notes });
		expect(ranges(editor, 1)).toHaveLength(1);
		add('one/Target.md');
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 0)).toHaveLength(1);
		add('two/Target.md');
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 2)).toHaveLength(1);
		notes.remove('file:///vault/one/Target.md');
		add('one/Renamed.md');
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 0)).toHaveLength(1);
		notes.remove('file:///vault/two/Target.md');
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 1)).toHaveLength(1);
		registration.dispose();
		notes.dispose();
	});

	it('clears stale ranges immediately and only decorates matching buffer versions', () => {
		const { notes, add, editor } = fixture('[[Target]]');
		add('Target.md');
		const registration = registerWikilinkDecorations({ notes });
		editor.document.version = 2;
		host.change!({ document: editor.document, contentChanges: [{}] });
		expect(ranges(editor, 0)).toEqual([]);
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 0)).toEqual([]);
		add('Source.md', 'Prefix [[Target|Label]]', 'file:///vault', 2);
		vi.advanceTimersByTime(100);
		expect(ranges(editor, 0)).toEqual([{ start: 7, end: 23 }]);
		registration.dispose();
		notes.dispose();
	});

	it('updates newly visible editors and disposes pending refreshes and listeners', () => {
		const { notes, add, editor } = fixture('[[Target]]');
		add('Target.md');
		const registration = registerWikilinkDecorations({ notes });
		editor.document.languageId = 'plaintext';
		host.visible!();
		expect(ranges(editor, 0)).toEqual([]);
		editor.document.languageId = 'markdown';
		host.visible!();
		expect(ranges(editor, 0)).toHaveLength(1);
		editor.document.uri.scheme = 'untitled';
		host.visible!();
		expect(ranges(editor, 0)).toEqual([]);
		editor.document.uri.scheme = 'file';
		host.visible!();
		expect(ranges(editor, 0)).toHaveLength(1);
		editor.document.isClosed = true;
		host.visible!();
		expect(ranges(editor, 0)).toEqual([]);
		editor.document.isClosed = false;
		host.visible!();
		notes.remove('file:///vault/Target.md');
		const calls = editor.setDecorations.mock.calls.length;
		registration.dispose();
		vi.advanceTimersByTime(500);
		expect(editor.setDecorations).toHaveBeenCalledTimes(calls);
		expect(host.types.every(type => type.dispose.mock.calls.length === 1)).toBe(true);
		expect(host.visible).toBeUndefined();
		expect(host.change).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
		notes.dispose();
	});

	it('coalesces index events and refreshes every visible editor without scanning hidden notes', () => {
		const { notes, add, editor } = fixture('[[Target]]');
		const second = { document: { ...editor.document }, setDecorations: vi.fn() };
		host.editors.push(second);
		const registration = registerWikilinkDecorations({ notes });
		editor.setDecorations.mockClear();
		second.setDecorations.mockClear();
		add('one/Target.md');
		add('two/Target.md');
		add('Unrelated.md');
		vi.advanceTimersByTime(99);
		expect(editor.setDecorations).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(editor.setDecorations).toHaveBeenCalledTimes(3);
		expect(second.setDecorations).toHaveBeenCalledTimes(3);
		expect(ranges(second, 2)).toHaveLength(1);
		registration.dispose();
		notes.dispose();
	});
});
