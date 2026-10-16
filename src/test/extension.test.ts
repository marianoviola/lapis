import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { LapislazuliApi } from '../extension';
import type { NoteRecord } from '../domain/note';

suite('Lapislazuli Extension Host', () => {
	let api: LapislazuliApi;
	let root: vscode.Uri;
	const created = new Set<string>();

	suiteSetup(async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'lapislazuli');
		assert.ok(extension, 'Lapislazuli must be loaded in the test Extension Host');
		api = await extension.activate() as LapislazuliApi;
		root = vscode.workspace.workspaceFolders![0].uri;
		await api.whenIdle();
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const id of created) {
			try {
				await vscode.workspace.fs.delete(vscode.Uri.parse(id), { recursive: true });
			} catch (error) {
				if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
					throw error;
				}
			}
		}
		created.clear();
	});

	function observe(uri: vscode.Uri, predicate: (record: NoteRecord | undefined) => boolean, action: () => PromiseLike<unknown>): Promise<void> {
		return new Promise((resolve, reject) => {
			const cleanup = () => { clearTimeout(timeout); listener.dispose(); };
			const check = () => {
				if (predicate(api.getNote(uri.toString()))) {
					cleanup();
					resolve();
				}
			};
			const listener = api.onDidChange(id => {
				if (id === uri.toString()) {
					check();
				}
			});
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error(`Timed out waiting for ${uri.toString()}`));
			}, 10000);
			Promise.resolve().then(action).then(check, error => { cleanup(); reject(error); });
		});
	}

	test('discovers typed metadata, excludes dependency folders and resolves backlinks', () => {
		const welcome = vscode.Uri.joinPath(root, 'Welcome.md').toString();
		const related = vscode.Uri.joinPath(root, 'Projects', 'Related.md').toString();
		const shared = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1].uri, 'Shared.md').toString();
		assert.equal(api.getNotes().length, 4);
		assert.equal(api.getNote(welcome)?.title, 'Welcome to Lapislazuli');
		assert.equal(api.getNote(welcome)?.properties.due, '2026-10-20');
		assert.equal(api.resolveLink('Welcome', related).kind, 'resolved');
		assert.deepEqual(api.getBacklinks(welcome).map(note => note.id).sort(), [related, shared].sort());
	});

	test('registers native commands and can rebuild the index', async () => {
		const commands = await vscode.commands.getCommands();
		assert.ok(commands.includes('lapislazuli.openNote'));
		assert.equal(await vscode.commands.executeCommand('lapislazuli.rebuildIndex'), 4);
	});

	test('opens a selected Quick Pick note in the native Markdown editor', async () => {
		const opened = new Promise<void>((resolve, reject) => {
			const listener = vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor && api.getNote(editor.document.uri.toString())) {
					clearTimeout(timeout);
					listener.dispose();
					assert.equal(editor.document.languageId, 'markdown');
					resolve();
				}
			});
			const timeout = setTimeout(() => {
				listener.dispose();
				reject(new Error('Quick Pick did not open a native Markdown editor'));
			}, 10000);
		});
		await vscode.commands.executeCommand('lapislazuli.openNote');
		await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		await opened;
	});

	test('tracks external creation, unsaved editor changes, save and deletion', async () => {
		const uri = vscode.Uri.joinPath(root, 'Lifecycle.md');
		created.add(uri.toString());
		await observe(uri, note => note?.properties.status === 'todo', () => vscode.workspace.fs.writeFile(uri, Buffer.from('---\nstatus: todo\n---\nBody\n')));
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		const edit = new vscode.WorkspaceEdit();
		const start = document.getText().indexOf('todo');
		edit.replace(uri, new vscode.Range(document.positionAt(start), document.positionAt(start + 4)), 'doing');
		await observe(uri, note => note?.dirty === true && note.properties.status === 'doing', () => vscode.workspace.applyEdit(edit));
		assert.ok(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).includes('todo'));
		await observe(uri, note => note?.dirty === false && note.properties.status === 'doing', async () => { assert.ok(await document.save()); });
		assert.ok(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).includes('doing'));
		await observe(uri, note => note === undefined, () => vscode.workspace.fs.delete(uri));
	});

	test('shares a vault namespace across workspace folders and isolates independent vaults', async () => {
		const folders = vscode.workspace.workspaceFolders!;
		const sharedNote = vscode.Uri.joinPath(folders[1].uri, 'Shared.md');
		assert.equal(api.resolveLink('Welcome', sharedNote.toString()).kind, 'resolved');

		const independentFolder = folders[2].uri;
		const independentNote = vscode.Uri.joinPath(independentFolder, 'Private.md');
		assert.equal(api.resolveLink('Welcome', independentNote.toString()).kind, 'missing');
		assert.equal(api.getNote(independentNote.toString())?.rootUri, independentFolder.toString());
	});

	test('does not index a workspace until a .lapis marker is created, then removes its notes when deleted', async () => {
		const folder = vscode.workspace.workspaceFolders![3].uri;
		const note = vscode.Uri.joinPath(folder, 'Unmarked.md');
		const marker = vscode.Uri.joinPath(folder, '.lapis');
		assert.equal(api.getNote(note.toString()), undefined);

		await observe(note, record => Boolean(record), () => vscode.workspace.fs.writeFile(marker, Buffer.from('')));
		await observe(note, record => record === undefined, () => vscode.workspace.fs.delete(marker));
	});

	test('applies both extension and VS Code file exclusions', async () => {
		const custom = vscode.Uri.joinPath(root, 'ExcludedBySetting', 'Note.md');
		const byPattern = vscode.Uri.joinPath(root, 'ExcludedByPattern', 'Note.md');
		created.add(custom.toString());
		created.add(byPattern.toString());
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, 'ExcludedBySetting'));
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, 'ExcludedByPattern'));
		await vscode.workspace.fs.writeFile(custom, Buffer.from('# Private\n'));
		await vscode.workspace.fs.writeFile(byPattern, Buffer.from('# Hidden\n'));
		const extensionConfig = vscode.workspace.getConfiguration('lapislazuli', root);
		const filesConfig = vscode.workspace.getConfiguration('files', root);
		try {
			await extensionConfig.update('excludedFolders', ['ExcludedBySetting'], vscode.ConfigurationTarget.WorkspaceFolder);
			await filesConfig.update('exclude', { '**/ExcludedByPattern/**': true }, vscode.ConfigurationTarget.WorkspaceFolder);
			await api.whenIdle();
			assert.equal(api.getNote(custom.toString()), undefined);
			assert.equal(api.getNote(byPattern.toString()), undefined);
		} finally {
			await extensionConfig.update('excludedFolders', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
			await filesConfig.update('exclude', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
			await api.whenIdle();
		}
	});

	test('publishes malformed YAML diagnostics and clears them after correction', async () => {
		const uri = vscode.Uri.joinPath(root, 'Invalid.md');
		created.add(uri.toString());
		await observe(uri, note => Boolean(note?.issues.length), () => vscode.workspace.fs.writeFile(uri, Buffer.from('---\nstatus: [\n---\nBody\n')));
		assert.ok(vscode.languages.getDiagnostics(uri).some(diagnostic => diagnostic.source === 'Lapislazuli'));
		const document = await vscode.workspace.openTextDocument(uri);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), '---\nstatus: done\n---\nBody\n');
		await observe(uri, note => note?.properties.status === 'done', () => vscode.workspace.applyEdit(edit));
		assert.equal(vscode.languages.getDiagnostics(uri).filter(diagnostic => diagnostic.source === 'Lapislazuli').length, 0);
		await document.save();
	});

	test('tracks a native file rename without rewriting its content', async () => {
		const original = vscode.Uri.joinPath(root, 'Before.md');
		const renamed = vscode.Uri.joinPath(root, 'After.md');
		created.add(original.toString());
		created.add(renamed.toString());
		await observe(original, note => Boolean(note), () => vscode.workspace.fs.writeFile(original, Buffer.from('Plain Markdown\n')));
		const edit = new vscode.WorkspaceEdit();
		edit.renameFile(original, renamed);
		await observe(renamed, note => note?.filename === 'After.md', () => vscode.workspace.applyEdit(edit));
		assert.equal(api.getNote(original.toString()), undefined);
		assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(renamed)), 'Plain Markdown\n');
	});
});
