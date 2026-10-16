import { describe, expect, it } from 'vitest';
import { NoteIndex } from '../src/index/noteIndex';
import { VaultRegistry } from '../src/vault/vaults';

function registry(...directories: string[]): VaultRegistry {
	const vaults = new VaultRegistry();
	vaults.replace(directories);
	return vaults;
}

describe('vault membership', () => {
	it('leaves files outside marked directories unassigned', () => {
		const vaults = registry('file:///notes');
		expect(vaults.resolve('file:///notes-other/Note.md')).toBeUndefined();
		expect(vaults.resolve('file:///Note.md')).toBeUndefined();
	});
	it('uses the topmost marker for the namespace and nearest-first inheritance chain', () => {
		const vaults = registry('file:///notes/projects/deep', 'file:///notes', 'file:///notes/projects');
		expect(vaults.resolve('file:///notes/projects/deep/Note.md')).toEqual({
			rootUri: 'file:///notes',
			chain: ['file:///notes/projects/deep', 'file:///notes/projects', 'file:///notes'],
			relativePath: 'projects/deep/Note.md',
		});
	});
	it('keeps independent vaults and remote authorities separate', () => {
		const vaults = registry('file:///one', 'file:///two', 'vscode-remote://host/one');
		expect(vaults.resolve('file:///two/Note.md')?.rootUri).toBe('file:///two');
		expect(vaults.resolve('vscode-remote://host/one/Note.md')?.rootUri).toBe('vscode-remote://host/one');
		expect(vaults.resolve('vscode-remote://other/one/Note.md')).toBeUndefined();
	});
	it('shares link resolution across nested vaults while isolating independent vaults', () => {
		const vaults = registry('file:///notes', 'file:///notes/sub', 'file:///other');
		const index = new NoteIndex(async () => undefined);
		for (const uri of ['file:///notes/sub/Source.md', 'file:///notes/Target.md', 'file:///other/Private.md']) {
			const membership = vaults.resolve(uri)!;
			index.upsert({ uri, rootUri: membership.rootUri, relativePath: membership.relativePath, text: '', dirty: false });
		}
		expect(index.resolve('Target', 'file:///notes/sub/Source.md').kind).toBe('resolved');
		expect(index.resolve('Private', 'file:///notes/sub/Source.md').kind).toBe('missing');
	});
	it('deduplicates trailing slashes and ignores discovery order', () => {
		const vaults = registry('file:///notes/sub/', 'file:///notes/', 'file:///notes');
		expect(vaults.getDirectories()).toEqual(['file:///notes', 'file:///notes/sub']);
		const before = vaults.resolve('file:///notes/sub/Note.md');
		vaults.replace(['file:///notes', 'file:///notes/sub']);
		expect(vaults.resolve('file:///notes/sub/Note.md')).toEqual(before);
	});
	it('reassigns descendants after a marker is removed', () => {
		const vaults = registry('file:///notes', 'file:///notes/sub');
		vaults.replace(['file:///notes/sub']);
		expect(vaults.resolve('file:///notes/sub/Note.md')?.relativePath).toBe('Note.md');
		expect(vaults.resolve('file:///notes/Other.md')).toBeUndefined();
		vaults.replace([]);
		expect(vaults.resolve('file:///notes/sub/Note.md')).toBeUndefined();
	});
	it('handles encoded names and filesystem roots', () => {
		const vaults = registry('file:///');
		expect(vaults.resolve('file:///My%20Notes/Caf%C3%A9.md')?.relativePath).toBe('My Notes/Café.md');
		expect(vaults.resolve('file:///Note.md')?.rootUri).toBe('file:///');
	});
	it('does not treat a file as its own containing vault', () => {
		const vaults = registry('file:///notes');
		expect(vaults.resolve('file:///notes')).toBeUndefined();
		expect(vaults.resolve('file:///notes/')).toBeUndefined();
	});
	it('returns immutable snapshots independent of later discovery', () => {
		const vaults = registry('file:///notes');
		const membership = vaults.resolve('file:///notes/Note.md')!;
		vaults.replace([]);
		expect(membership.rootUri).toBe('file:///notes');
		expect(Object.isFrozen(membership)).toBe(true);
		expect(Object.isFrozen(membership.chain)).toBe(true);
	});
	it('preserves the registry if discovery supplies invalid URIs', () => {
		const vaults = registry('file:///notes');
		expect(() => vaults.replace(['file:///other', 'invalid'])).toThrow();
		expect(vaults.getDirectories()).toEqual(['file:///notes']);
	});
});
