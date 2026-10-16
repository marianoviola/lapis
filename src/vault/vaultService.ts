import * as vscode from 'vscode';
import { VaultRegistry } from './vaults';

export class VaultService implements vscode.Disposable {
	readonly registry = new VaultRegistry();
	readonly ready: Promise<void>;
	private readonly subscriptions: vscode.Disposable[] = [];
	private readonly watchers = new Map<string, { watcher: vscode.FileSystemWatcher; subscriptions: vscode.Disposable[] }>();
	private readonly listeners = new Set<() => void>();
	private refreshTimer?: ReturnType<typeof setTimeout>;
	private refreshOperation: Promise<void> = Promise.resolve();
	private generation = 0;
	private disposed = false;

	constructor(private readonly output: vscode.LogOutputChannel) {
		this.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this.syncWatchers();
			void this.refresh(true);
		}));
		this.syncWatchers();
		this.ready = this.refresh(true);
	}

	onDidChange(listener: () => void): vscode.Disposable {
		this.listeners.add(listener);
		return { dispose: () => { this.listeners.delete(listener); } };
	}

	async refresh(forceNotify = false): Promise<void> {
		const generation = ++this.generation;
		const operation = this.discover().then(directories => {
			if (this.disposed || generation !== this.generation) {
				return;
			}
			const previous = this.registry.getDirectories();
			this.registry.replace(directories);
			const current = this.registry.getDirectories();
			if (forceNotify || previous.length !== current.length || previous.some((directory, index) => directory !== current[index])) {
				for (const listener of this.listeners) {
					listener();
				}
			}
		}).catch(error => {
			this.output.error(`Vault discovery failed: ${error instanceof Error ? error.message : String(error)}`);
		});
		this.refreshOperation = operation;
		await operation;
	}

	async whenIdle(): Promise<void> {
		while (true) {
			if (this.refreshTimer) {
				clearTimeout(this.refreshTimer);
				this.refreshTimer = undefined;
				await this.refresh(true);
			}
			const operation = this.refreshOperation;
			await operation;
			if (!this.refreshTimer && operation === this.refreshOperation) {
				return;
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		for (const { watcher, subscriptions } of this.watchers.values()) {
			for (const subscription of subscriptions) {
				subscription.dispose();
			}
			watcher.dispose();
		}
		this.watchers.clear();
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.listeners.clear();
	}

	private async discover(): Promise<string[]> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const roots = new Set<string>();
		for (const folder of folders) {
			const markers = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/.lapis'));
			for (const marker of markers) {
				const root = this.parentUri(marker);
				if (root) {
					roots.add(root.toString());
				}
			}
			let directory: vscode.Uri | undefined = folder.uri;
			while (directory) {
				const marker = vscode.Uri.joinPath(directory, '.lapis');
				try {
					const stat = await vscode.workspace.fs.stat(marker);
					if (stat.type & vscode.FileType.File) {
						roots.add(directory.toString());
					}
				} catch (error) {
					if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
						throw error;
					}
				}
				directory = this.parentUri(directory);
			}
		}
		return [...roots];
	}

	private syncWatchers(): void {
		const desired = new Map<string, { base: vscode.Uri; pattern: string }>();
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			desired.set(`${folder.uri.toString()}|**/.lapis`, { base: folder.uri, pattern: '**/.lapis' });
			let directory = this.parentUri(folder.uri);
			while (directory) {
				desired.set(`${directory.toString()}|.lapis`, { base: directory, pattern: '.lapis' });
				directory = this.parentUri(directory);
			}
		}
		for (const [key, current] of this.watchers) {
			if (!desired.has(key)) {
				for (const subscription of current.subscriptions) {
					subscription.dispose();
				}
				current.watcher.dispose();
				this.watchers.delete(key);
			}
		}
		for (const [key, { base, pattern }] of desired) {
			if (this.watchers.has(key)) {
				continue;
			}
			try {
				const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
				const subscriptions = [
					watcher.onDidCreate(() => this.scheduleRefresh()),
					watcher.onDidChange(() => this.scheduleRefresh()),
					watcher.onDidDelete(() => this.scheduleRefresh()),
				];
				this.watchers.set(key, { watcher, subscriptions });
			} catch (error) {
				this.output.error(`Cannot watch vault marker under ${base.toString()}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	private scheduleRefresh(): void {
		if (this.disposed) {
			return;
		}
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh(true);
		}, 100);
	}

	private parentUri(uri: vscode.Uri): vscode.Uri | undefined {
		if (uri.path === '/' || !uri.path) {
			return undefined;
		}
		const path = uri.path.slice(0, uri.path.lastIndexOf('/')) || '/';
		return uri.with({ path, query: '', fragment: '' });
	}
}
