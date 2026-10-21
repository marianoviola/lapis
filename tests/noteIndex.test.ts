import { describe, expect, it } from 'vitest';
import { NoteSource } from '../src/domain/note';
import { NoteIndex } from '../src/index/noteIndex';

const root = 'file:///vault';

function source(path: string, text = '', rootUri = root): NoteSource {
	return { uri: `${rootUri}/${path}`, rootUri, relativePath: path, text, dirty: false };
}

describe('shared note index', () => {
	it('indexes records and replaces only the changed note', () => {
		const index = new NoteIndex(async () => undefined);
		index.upsert(source('First.md'));
		index.upsert(source('Second.md'));
		const unchanged = index.get(`${root}/Second.md`);
		index.upsert({ ...source('First.md', '---\nstatus: doing\n---\n'), dirty: true, documentVersion: 4 });
		expect(index.size).toBe(2);
		expect(index.get(`${root}/First.md`)).toMatchObject({ properties: { status: 'doing' }, dirty: true, documentVersion: 4 });
		expect(index.get(`${root}/Second.md`)).toBe(unchanged);
	});
	it('ignores a delayed disk read after a newer editor change', async () => {
		let complete!: (value: NoteSource) => void;
		const index = new NoteIndex(() => new Promise(resolve => { complete = resolve; }));
		const pending = index.refresh(`${root}/Note.md`);
		index.upsert({ ...source('Note.md', '---\nstatus: doing\n---\n'), dirty: true });
		complete(source('Note.md', '---\nstatus: todo\n---\n'));
		await pending;
		expect(index.get(`${root}/Note.md`)?.properties.status).toBe('doing');
	});
	it('ignores stale reads when two refreshes finish out of order', async () => {
		const completions: ((value: NoteSource) => void)[] = [];
		const index = new NoteIndex(() => new Promise(resolve => { completions.push(resolve); }));
		const first = index.refresh(`${root}/Note.md`);
		const second = index.refresh(`${root}/Note.md`);
		completions[1](source('Note.md', '---\nstatus: done\n---\n'));
		await second;
		completions[0](source('Note.md', '---\nstatus: todo\n---\n'));
		await first;
		expect(index.get(`${root}/Note.md`)?.properties.status).toBe('done');
	});
	it('does not resurrect a deleted note from an in-flight read', async () => {
		let complete!: (value: NoteSource) => void;
		const index = new NoteIndex(() => new Promise(resolve => { complete = resolve; }));
		const pending = index.refresh(`${root}/Note.md`);
		index.remove(`${root}/Note.md`);
		complete(source('Note.md'));
		await pending;
		expect(index.size).toBe(0);
	});
	it('cancels pending reads when a containing directory is deleted', async () => {
		let complete!: (value: NoteSource) => void;
		const index = new NoteIndex(() => new Promise(resolve => { complete = resolve; }));
		const pending = index.refresh(`${root}/folder/Note.md`);
		index.removeTree(`${root}/folder`);
		complete(source('folder/Note.md'));
		await pending;
		expect(index.size).toBe(0);
	});
	it('resolves local, root-relative and unique basename links', () => {
		const index = new NoteIndex(async () => undefined);
		for (const path of ['projects/Source.md', 'projects/Local.md', 'Root.md', 'archive/Unique.md']) {
			index.upsert(source(path));
		}
		const from = `${root}/projects/Source.md`;
		for (const target of ['Local', './Local.md', '../Root', '/Root.md', 'Root', 'Unique']) {
			expect(index.resolve(target, from).kind).toBe('resolved');
		}
		expect(index.resolve('../../outside', from).kind).toBe('missing');
		expect(index.resolve('root', from).kind).toBe('missing');
		expect(index.resolve('', from)).toMatchObject({ kind: 'resolved', note: { id: from } });
	});
	it('does not silently pick ambiguous basenames or cross workspace roots', () => {
		const index = new NoteIndex(async () => undefined);
		for (const path of ['Source.md', 'one/Note.md', 'two/Note.md']) {
			index.upsert(source(path));
		}
		index.upsert(source('Other.md', '', 'file:///other'));
		expect(index.resolve('Note', `${root}/Source.md`).kind).toBe('ambiguous');
		expect(index.resolve('Other', `${root}/Source.md`).kind).toBe('missing');
	});
	it('preserves local precedence when unique basenames become duplicated', () => {
		const index = new NoteIndex(async () => undefined);
		const from = `${root}/projects/Source.md`;
		index.upsert(source('projects/Source.md'));
		index.upsert(source('archive/Target.md'));
		expect(index.resolve('Target', from)).toMatchObject({
			kind: 'resolved', note: { id: `${root}/archive/Target.md` },
		});
		index.upsert(source('projects/Target.md'));
		expect(index.resolve('Target', from)).toMatchObject({
			kind: 'resolved', note: { id: `${root}/projects/Target.md` },
		});
		index.remove(`${root}/projects/Target.md`);
		expect(index.resolve('Target', from)).toMatchObject({
			kind: 'resolved', note: { id: `${root}/archive/Target.md` },
		});
	});
	it('strips only one extension when resolving filenames with repeated .md suffixes', () => {
		const index = new NoteIndex(async () => undefined);
		const from = `${root}/projects/Source.md`;
		index.upsert(source('projects/Source.md'));
		index.upsert(source('archive/Double.md.md'));
		for (const target of ['Double.md.md', '/archive/Double.md.md', '../archive/Double.md.md']) {
			expect(index.resolve(target, from)).toMatchObject({
				kind: 'resolved', note: { id: `${root}/archive/Double.md.md` },
			});
		}
		expect(index.resolve('Double.md', from).kind).toBe('missing');
		index.upsert(source('archive/Double.md.md', '# Updated'));
		index.remove(`${root}/archive/Double.md.md`);
		expect(index.resolve('Double.md.md', from).kind).toBe('missing');
	});
	it('reports colliding extension-case identities instead of choosing the last file', () => {
		const index = new NoteIndex(async () => undefined);
		index.upsert(source('Source.md'));
		index.upsert(source('Note.md'));
		index.upsert(source('Note.MD'));
		expect(index.resolve('Note', `${root}/Source.md`).kind).toBe('ambiguous');
		index.remove(`${root}/Note.MD`);
		expect(index.resolve('Note', `${root}/Source.md`)).toMatchObject({ kind: 'resolved', note: { id: `${root}/Note.md` } });
	});
	it('does not cancel reads from other roots when removing a root', async () => {
		let complete!: (value: NoteSource) => void;
		const index = new NoteIndex(() => new Promise(resolve => { complete = resolve; }));
		const pending = index.refresh('file:///other/Other.md');
		index.removeRoot(root);
		complete(source('Other.md', '', 'file:///other'));
		await pending;
		expect(index.size).toBe(1);
	});
	it('invalidates cached backlinks on changes and new ambiguities', () => {
		const index = new NoteIndex(async () => undefined);
		index.upsert(source('Source.md', '[[Target]] ![[Target]]'));
		index.upsert(source('one/Target.md'));
		expect(index.getBacklinks(`${root}/one/Target.md`)).toHaveLength(1);
		index.upsert(source('two/Target.md'));
		expect(index.getBacklinks(`${root}/one/Target.md`)).toHaveLength(0);
		index.remove(`${root}/two/Target.md`);
		expect(index.getBacklinks(`${root}/one/Target.md`)).toHaveLength(1);
		index.upsert(source('Source.md', 'No links'));
		expect(index.getBacklinks(`${root}/one/Target.md`)).toHaveLength(0);
	});
	it('preserves the previous record on read errors and reports them', async () => {
		const errors: unknown[] = [];
		const index = new NoteIndex(async () => { throw new Error('Unavailable'); }, (_uri, error) => errors.push(error));
		index.upsert(source('Note.md'));
		await index.refresh(`${root}/Note.md`);
		expect(index.size).toBe(1);
		expect(errors).toHaveLength(1);
	});
	it('removes missing notes and emits disposable change events', async () => {
		const events: string[] = [];
		const index = new NoteIndex(async () => undefined);
		const subscription = index.onDidChange(uri => events.push(uri));
		index.upsert(source('Note.md'));
		await index.refresh(`${root}/Note.md`);
		expect(index.size).toBe(0);
		expect(events).toHaveLength(2);
		subscription.dispose();
		index.upsert(source('Note.md'));
		expect(events).toHaveLength(2);
	});
	it('removes one root without removing records from another', () => {
		const index = new NoteIndex(async () => undefined);
		index.upsert(source('Note.md'));
		index.upsert(source('Other.md', '', 'file:///other'));
		index.removeRoot(root);
		expect(index.getNotes().map(note => note.id)).toEqual(['file:///other/Other.md']);
	});
	it('waits for outstanding work and ignores completions after disposal', async () => {
		let complete!: (value: NoteSource) => void;
		const index = new NoteIndex(() => new Promise(resolve => { complete = resolve; }));
		const pending = index.refresh(`${root}/Note.md`);
		const idle = index.whenIdle();
		index.dispose();
		complete(source('Note.md'));
		await Promise.all([pending, idle]);
		expect(index.size).toBe(0);
	});
});