import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBlockquoteDecorations } from '../src/language/blockquoteDecorations';

const host = vi.hoisted(() => ({
	editor: {
		document: {
			languageId: 'markdown', isClosed: false,
			uri: { toString: () => 'untitled:quote.md' },
			getText: (): string => '> Quote', positionAt: (offset: number) => offset,
		},
		setDecorations: vi.fn(),
	},
	visible: undefined as (() => void) | undefined,
	change: undefined as ((event: { document: object; contentChanges: unknown[] }) => void) | undefined,
	dispose: vi.fn(),
	visibleDispose: vi.fn(),
	changeDispose: vi.fn(),
	options: undefined as { color: { id: string } } | undefined,
}));

vi.mock('vscode', () => ({
	ThemeColor: class { constructor(readonly id: string) {} },
	Range: class { constructor(readonly start: number, readonly end: number) {} },
	Disposable: class { constructor(readonly dispose: () => void) {} },
	DecorationRangeBehavior: { ClosedClosed: 1 },
	window: {
		get visibleTextEditors() { return [host.editor]; },
		createTextEditorDecorationType(options: typeof host.options) {
			host.options = options;
			return { dispose: host.dispose };
		},
		onDidChangeVisibleTextEditors(listener: () => void) {
			host.visible = listener;
			return { dispose: host.visibleDispose };
		},
	},
	workspace: {
		onDidChangeTextDocument(listener: typeof host.change) {
			host.change = listener;
			return { dispose: host.changeDispose };
		},
	},
}));

describe('blockquote editor decorations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		host.editor.document.languageId = 'markdown';
		host.editor.document.getText = () => '> Quote';
	});

	it('uses a dynamic theme colour, refreshes unsaved prose and disposes listeners', () => {
		const registration = registerBlockquoteDecorations({ error: vi.fn() });
		expect(host.options?.color.id).toBe('editor.foreground');
		expect(host.editor.setDecorations.mock.lastCall?.[1]).toEqual([{ start: 2, end: 7 }]);
		host.editor.document.getText = () => 'Not a quote';
		host.change!({ document: host.editor.document, contentChanges: [{}] });
		expect(host.editor.setDecorations.mock.lastCall?.[1]).toEqual([]);
		host.editor.document.languageId = 'plaintext';
		host.visible!();
		expect(host.editor.setDecorations.mock.lastCall?.[1]).toEqual([]);
		registration.dispose();
		expect(host.dispose).toHaveBeenCalledOnce();
		expect(host.visibleDispose).toHaveBeenCalledOnce();
		expect(host.changeDispose).toHaveBeenCalledOnce();
	});
});
