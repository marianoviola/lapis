/** Vault directories discovered by the host; this module never accesses files. */
export interface VaultMembership {
	/** Topmost marked directory owns the link namespace. */
	readonly rootUri: string;
	/** Marked ancestor directories, nearest first. */
	readonly chain: readonly string[];
	readonly relativePath: string;
}

function directoryUri(value: string): string {
	const uri = new URL(value);
	if (uri.search || uri.hash) {
		throw new Error('Vault directory URIs cannot have a query or fragment.');
	}
	uri.pathname = uri.pathname.replace(/\/+$/, '') || '/';
	return uri.toString();
}

function parentUri(value: string): string | undefined {
	const uri = new URL(value);
	if (uri.pathname === '/') {
		return undefined;
	}
	uri.pathname = uri.pathname.slice(0, uri.pathname.lastIndexOf('/')) || '/';
	return uri.toString();
}

export class VaultRegistry {
	private directories = new Set<string>();

	/** Replace discovery results atomically; input order has no semantic effect. */
	replace(directoryUris: Iterable<string>): void {
		this.directories = new Set([...directoryUris].map(directoryUri));
	}

	getDirectories(): readonly string[] {
		return [...this.directories].sort();
	}

	/** Resolve a file URI against known markers, independent of workspace folders. */
	resolve(fileUri: string): VaultMembership | undefined {
		const file = new URL(fileUri);
		if (file.search || file.hash || file.pathname.endsWith('/')) {
			return undefined;
		}
		const chain: string[] = [];
		let directory = parentUri(file.toString());
		while (directory) {
			if (this.directories.has(directory)) {
				chain.push(directory);
			}
			directory = parentUri(directory);
		}
		const rootUri = chain.at(-1);
		if (!rootUri) {
			return undefined;
		}
		const rootPath = new URL(rootUri).pathname.replace(/\/$/, '');
		return Object.freeze({
			rootUri,
			chain: Object.freeze(chain),
			relativePath: decodeURIComponent(file.pathname.slice(rootPath.length + 1)),
		});
	}
}
