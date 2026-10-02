import * as vscode from 'vscode';
import { NoteSource } from '../domain/note';
import { NoteIndex } from './noteIndex';

const defaultExcludedFolders = ['.git', 'node_modules', 'dist', 'out', '.vscode-test'];
const maxNoteBytes = 2 * 1024 * 1024;

export class WorkspaceIndex implements vscode.Disposable {
	readonly notes: NoteIndex;
	readonly ready: Promise<void>;
	private readonly subscriptions: vscode.Disposable[] = [];
	private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly diagnostics = vscode.languages.createDiagnosticCollection('lapis');
	private scan: Promise<void> = Promise.resolve();
	private scanGeneration = 0;
	private disposed = false;

	constructor(private readonly output: vscode.LogOutputChannel) {
		this.notes = new NoteIndex(uri => this.read(uri), (uri, error) => {
			this.output.error(`Cannot index ${uri}: ${error instanceof Error ? error.message : String(error)}`);
		});
		this.subscriptions.push(this.diagnostics, this.notes.onDidChange(uri => this.updateDiagnostics(uri)));
		this.syncWatchers();
		this.subscriptions.push(
			vscode.workspace.onDidCreateFiles(event => {
				for (const uri of event.files) {
					this.schedule(uri);
				}
			}),
			vscode.workspace.onDidDeleteFiles(event => {
				for (const uri of event.files) {
					this.removeResource(uri);
				}
			}),
			vscode.workspace.onDidRenameFiles(event => {
				for (const { oldUri, newUri } of event.files) {
					const oldId = oldUri.toString();
					const notes = this.notes.getNotes().filter(note => note.id === oldId || note.id.startsWith(oldId.replace(/\/$/, '') + '/'));
					this.removeResource(oldUri);
					this.schedule(newUri);
					for (const note of notes) {
						const path = newUri.path + vscode.Uri.parse(note.id).path.slice(oldUri.path.length);
						this.schedule(newUri.with({ path }));
					}
				}
			}),
			vscode.workspace.onDidOpenTextDocument(document => this.schedule(document.uri)),
			vscode.workspace.onDidChangeTextDocument(event => {
				if (event.contentChanges.length) {
					this.schedule(event.document.uri);
				}
			}),
			vscode.workspace.onDidSaveTextDocument(document => this.schedule(document.uri)),
			vscode.workspace.onDidCloseTextDocument(document => this.schedule(document.uri)),
			vscode.workspace.onDidChangeWorkspaceFolders(event => {
				for (const folder of event.removed) {
					this.notes.removeRoot(folder.uri.toString());
				}
				this.syncWatchers();
				void this.rebuild();
			}),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('lapis.excludedFolders')) {
					void this.rebuild();
				}
			}),
		);
		this.ready = this.rebuild();
	}

	async rebuild(): Promise<void> {
		const generation = ++this.scanGeneration;
		this.scan = this.discover(generation);
		await this.scan;
	}

	private async discover(generation: number): Promise<void> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const known = this.notes.getNotes();
		try {
			const batches = await Promise.all(folders.map(folder => {
				const excluded = this.excludedFolders(folder.uri);
				const exclude = excluded.length ? `**/{${excluded.join(',')}}/**` : null;
				return vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.[mM][dD]'), exclude);
			}));
			if (this.disposed || generation !== this.scanGeneration) {
				return;
			}
			const files = [...new Map(batches.flat().filter(uri => this.scope(uri)).map(uri => [uri.toString(), uri])).values()];
			const discovered = new Set(files.map(uri => uri.toString()));
			for (const note of known) {
				if (!discovered.has(note.id)) {
					this.notes.remove(note.id);
				}
			}
			let next = 0;
			await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
				while (!this.disposed && generation === this.scanGeneration && next < files.length) {
					const uri = files[next++];
					await this.notes.refresh(uri.toString());
				}
			}));
			if (!this.disposed && generation === this.scanGeneration) {
				this.output.info(`Indexed ${this.notes.size} Markdown notes.`);
			}
		} catch (error) {
			this.output.error(`Workspace discovery failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async whenIdle(): Promise<void> {
		let scan: Promise<void>;
		do {
			scan = this.scan;
			await scan;
			const uris = [...this.timers.keys()];
			for (const timer of this.timers.values()) {
				clearTimeout(timer);
			}
			this.timers.clear();
			await Promise.all(uris.map(uri => this.notes.refresh(uri)));
			await this.notes.whenIdle();
		} while (scan !== this.scan || this.timers.size);
	}

	dispose(): void {
		this.disposed = true;
		this.scanGeneration++;
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		for (const watcher of this.watchers.values()) {
			watcher.dispose();
		}
		this.watchers.clear();
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.notes.dispose();
	}

	private excludedFolders(uri: vscode.Uri): string[] {
		const value = vscode.workspace.getConfiguration('lapis', uri).get<unknown>('excludedFolders', defaultExcludedFolders);
		return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string'
			&& /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..') : defaultExcludedFolders;
	}

	private scope(uri: vscode.Uri): { folder: vscode.WorkspaceFolder; relativePath: string } | undefined {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder || !/\.md$/i.test(uri.path)) {
			return undefined;
		}
		const relativePath = uri.path.slice(folder.uri.path.replace(/\/$/, '').length + 1);
		const directories = relativePath.split('/').slice(0, -1);
		return directories.some(directory => this.excludedFolders(folder.uri).includes(directory))
			? undefined : { folder, relativePath };
	}

	private async read(id: string): Promise<NoteSource | undefined> {
		const uri = vscode.Uri.parse(id);
		const scope = this.scope(uri);
		if (!scope || this.disposed) {
			return undefined;
		}
		let stat: vscode.FileStat;
		try {
			stat = await vscode.workspace.fs.stat(uri);
		} catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
				return undefined;
			}
			throw error;
		}
		if (!(stat.type & vscode.FileType.File) || stat.size > maxNoteBytes) {
			this.output.warn(`Skipped ${id}: not a file or exceeds the 2 MiB note limit.`);
			return undefined;
		}
		const contents = await vscode.workspace.fs.readFile(uri);
		const document = vscode.workspace.textDocuments.find(candidate => !candidate.isClosed && candidate.uri.toString() === id);
		const text = document ? document.getText() : new TextDecoder('utf-8', { fatal: true }).decode(contents);
		const currentScope = this.scope(uri);
		if (Buffer.byteLength(text, 'utf8') > maxNoteBytes || !currentScope) {
			return undefined;
		}
		return {
			uri: id, rootUri: currentScope.folder.uri.toString(), relativePath: currentScope.relativePath, text,
			dirty: document?.isDirty ?? false, documentVersion: document?.version, ctime: stat.ctime, mtime: stat.mtime,
		};
	}

	private schedule(uri: vscode.Uri): void {
		if (this.disposed || !/\.md$/i.test(uri.path)) {
			return;
		}
		const id = uri.toString();
		clearTimeout(this.timers.get(id));
		this.timers.set(id, setTimeout(() => {
			this.timers.delete(id);
			void this.notes.refresh(id);
		}, 100));
	}

	private syncWatchers(): void {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const roots = new Set(folders.map(folder => folder.uri.toString()));
		for (const [root, watcher] of this.watchers) {
			if (!roots.has(root)) {
				watcher.dispose();
				this.watchers.delete(root);
			}
		}
		for (const folder of folders) {
			const root = folder.uri.toString();
			if (!this.watchers.has(root)) {
				const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
				watcher.onDidCreate(uri => this.schedule(uri));
				watcher.onDidChange(uri => this.schedule(uri));
				watcher.onDidDelete(uri => this.removeResource(uri));
				this.watchers.set(root, watcher);
			}
		}
	}

	private removeResource(uri: vscode.Uri): void {
		const id = uri.toString();
		const prefix = id.replace(/\/$/, '') + '/';
		for (const [candidate, timer] of this.timers) {
			if (candidate === id || candidate.startsWith(prefix)) {
				clearTimeout(timer);
				this.timers.delete(candidate);
			}
		}
		this.notes.removeTree(id);
	}

	private updateDiagnostics(id: string): void {
		const uri = vscode.Uri.parse(id);
		const note = this.notes.get(id);
		if (!note) {
			this.diagnostics.delete(uri);
			return;
		}
		this.diagnostics.set(uri, note.issues.map(issue => {
			const diagnostic = new vscode.Diagnostic(new vscode.Range(issue.line, 0, issue.line, 1), issue.message, vscode.DiagnosticSeverity.Warning);
			diagnostic.source = 'Lapis';
			return diagnostic;
		}));
	}
}