import { posix } from 'node:path';
import { NoteRecord, NoteSource } from '../domain/note';
import { parseNote } from './parseNote';

export type Resolution = { readonly kind: 'resolved'; readonly note: NoteRecord }
	| { readonly kind: 'missing' }
	| { readonly kind: 'ambiguous'; readonly candidates: readonly NoteRecord[] };

export class NoteIndex {
	private readonly records = new Map<string, NoteRecord>();
	private readonly paths = new Map<string, Set<string>>();
	private readonly basenames = new Map<string, Set<string>>();
	private readonly generations = new Map<string, number>();
	private readonly listeners = new Set<(uri: string) => void>();
	private readonly pending = new Set<Promise<void>>();
	private backlinks?: Map<string, Set<string>>;
	private disposed = false;

	constructor(
		private readonly read: (uri: string) => Promise<NoteSource | undefined>,
		private readonly reportError: (uri: string, error: unknown) => void = () => {},
	) {}

	get(uri: string): NoteRecord | undefined {
		return this.records.get(uri);
	}

	get size(): number {
		return this.records.size;
	}

	getNotes(): readonly NoteRecord[] {
		return [...this.records.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)
			|| left.rootUri.localeCompare(right.rootUri));
	}

	onDidChange(listener: (uri: string) => void): { dispose(): void } {
		if (!this.disposed) {
			this.listeners.add(listener);
		}
		return { dispose: () => { this.listeners.delete(listener); } };
	}

	async refresh(uri: string): Promise<void> {
		if (this.disposed) {
			return;
		}
		const generation = this.nextGeneration(uri);
		const operation = (async () => {
			try {
				const source = await this.read(uri);
				if (this.disposed || this.generations.get(uri) !== generation) {
					return;
				}
				if (source) {
					this.replace(parseNote(source));
				} else {
					this.deleteRecord(uri);
				}
			} catch (error) {
				if (!this.disposed && this.generations.get(uri) === generation) {
					this.reportError(uri, error);
				}
			}
		})();
		this.pending.add(operation);
		try {
			await operation;
		} finally {
			this.pending.delete(operation);
		}
	}

	upsert(source: NoteSource): void {
		if (!this.disposed) {
			this.nextGeneration(source.uri);
			this.replace(parseNote(source));
		}
	}

	remove(uri: string): void {
		if (!this.disposed) {
			this.nextGeneration(uri);
			this.deleteRecord(uri);
		}
	}

	removeTree(uri: string): void {
		const prefix = uri.replace(/\/$/, '') + '/';
		for (const id of this.generations.keys()) {
			if (id === uri || id.startsWith(prefix)) {
				this.remove(id);
			}
		}
	}

	removeRoot(rootUri: string): void {
		for (const uri of this.generations.keys()) {
			if (this.records.get(uri)?.rootUri === rootUri || uri.startsWith(rootUri.replace(/\/$/, '') + '/')) {
				this.nextGeneration(uri);
			}
		}
		for (const note of this.records.values()) {
			if (note.rootUri === rootUri) {
				this.remove(note.id);
			}
		}
	}

	async whenIdle(): Promise<void> {
		while (this.pending.size) {
			await Promise.all([...this.pending]);
		}
	}

	resolve(target: string, fromUri: string): Resolution {
		const from = this.records.get(fromUri);
		if (!from) {
			return { kind: 'missing' };
		}
		const reference = target.trim().replace(/\.md$/i, '');
		if (!reference) {
			return { kind: 'resolved', note: from };
		}
		if (!reference.includes('/') && reference !== '.' && reference !== '..') {
			const matches = this.basenames.get(this.key(from.rootUri, reference));
			if (matches?.size === 1) {
				for (const uri of matches) {
					return { kind: 'resolved', note: this.records.get(uri)! };
				}
			}
		}
		const absolute = reference.startsWith('/');
		const relative = reference.startsWith('./') || reference.startsWith('../');
		const possiblePaths = absolute ? [reference.slice(1)]
			: relative ? [posix.join(posix.dirname(from.relativePath), reference)]
				: [posix.join(posix.dirname(from.relativePath), reference), reference];
		for (const candidate of possiblePaths) {
			const path = posix.normalize(candidate);
			if (path === '..' || path.startsWith('../') || posix.isAbsolute(path)) {
				continue;
			}
			const candidates = [...(this.paths.get(this.key(from.rootUri, path)) ?? [])].map(uri => this.records.get(uri)!);
			if (candidates.length === 1) {
				return { kind: 'resolved', note: candidates[0] };
			}
			if (candidates.length > 1) {
				return { kind: 'ambiguous', candidates };
			}
		}
		if (absolute || relative || reference.includes('/')) {
			return { kind: 'missing' };
		}
		const candidates = [...(this.basenames.get(this.key(from.rootUri, reference)) ?? [])]
			.map(uri => this.records.get(uri)!).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
		if (candidates.length === 1) {
			return { kind: 'resolved', note: candidates[0] };
		}
		return candidates.length > 1 ? { kind: 'ambiguous', candidates } : { kind: 'missing' };
	}

	getBacklinks(uri: string): readonly NoteRecord[] {
		if (!this.backlinks) {
			this.backlinks = new Map();
			for (const note of this.records.values()) {
				for (const link of note.links) {
					const resolution = this.resolve(link.target, note.id);
					if (resolution.kind === 'resolved' && resolution.note.id !== note.id) {
						const sources = this.backlinks.get(resolution.note.id) ?? new Set<string>();
						sources.add(note.id);
						this.backlinks.set(resolution.note.id, sources);
					}
				}
			}
		}
		return [...(this.backlinks.get(uri) ?? [])].map(source => this.records.get(source)!);
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
		this.records.clear();
		this.paths.clear();
		this.basenames.clear();
		this.generations.clear();
		this.backlinks = undefined;
	}

	private key(root: string, path: string): string {
		return JSON.stringify([root, path]);
	}

	private nextGeneration(uri: string): number {
		const generation = (this.generations.get(uri) ?? 0) + 1;
		this.generations.set(uri, generation);
		return generation;
	}

	private replace(note: NoteRecord): void {
		this.removeIdentity(note.id);
		this.records.set(note.id, note);
		const path = this.key(note.rootUri, note.relativePath.replace(/\.md$/i, ''));
		const matches = this.paths.get(path) ?? new Set<string>();
		matches.add(note.id);
		this.paths.set(path, matches);
		const basename = this.key(note.rootUri, note.filename.replace(/\.md$/i, ''));
		const ids = this.basenames.get(basename) ?? new Set<string>();
		ids.add(note.id);
		this.basenames.set(basename, ids);
		this.changed(note.id);
	}

	private removeIdentity(uri: string): void {
		const note = this.records.get(uri);
		if (note) {
			const path = this.key(note.rootUri, note.relativePath.replace(/\.md$/i, ''));
			const matches = this.paths.get(path);
			matches?.delete(uri);
			if (!matches?.size) {
				this.paths.delete(path);
			}
			const basename = this.key(note.rootUri, note.filename.replace(/\.md$/i, ''));
			const ids = this.basenames.get(basename);
			ids?.delete(uri);
			if (!ids?.size) {
				this.basenames.delete(basename);
			}
		}
	}

	private deleteRecord(uri: string): void {
		this.removeIdentity(uri);
		if (this.records.delete(uri)) {
			this.changed(uri);
		}
	}

	private changed(uri: string): void {
		this.backlinks = undefined;
		for (const listener of this.listeners) {
			listener(uri);
		}
	}
}