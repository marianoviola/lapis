import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { LapisApi } from '../extension';
import type { NoteRecord } from '../domain/note';

suite('Lapis Extension Host', () => {
	let api: LapisApi;
	let root: vscode.Uri;
	const created = new Set<string>();

	suiteSetup(async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'lapis');
		assert.ok(extension, 'Lapis must be loaded in the test Extension Host');
		api = await extension.activate() as LapisApi;
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
		assert.equal(api.getNotes().length, 2);
		assert.equal(api.getNote(welcome)?.title, 'Welcome to Lapis');
		assert.equal(api.getNote(welcome)?.properties.due, '2026-10-20');
		assert.equal(api.resolveLink('Welcome', related).kind, 'resolved');
		assert.deepEqual(api.getBacklinks(welcome).map(note => note.id), [related]);
	});

	test('registers native commands and can rebuild the index', async () => {
		const commands = await vscode.commands.getCommands();
		assert.ok(commands.includes('lapis.openNote'));
		assert.equal(await vscode.commands.executeCommand('lapis.rebuildIndex'), 2);
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
		await vscode.commands.executeCommand('lapis.openNote');
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

	test('publishes malformed YAML diagnostics and clears them after correction', async () => {
		const uri = vscode.Uri.joinPath(root, 'Invalid.md');
		created.add(uri.toString());
		await observe(uri, note => Boolean(note?.issues.length), () => vscode.workspace.fs.writeFile(uri, Buffer.from('---\nstatus: [\n---\nBody\n')));
		assert.ok(vscode.languages.getDiagnostics(uri).some(diagnostic => diagnostic.source === 'Lapis'));
		const document = await vscode.workspace.openTextDocument(uri);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), '---\nstatus: done\n---\nBody\n');
		await observe(uri, note => note?.properties.status === 'done', () => vscode.workspace.applyEdit(edit));
		assert.equal(vscode.languages.getDiagnostics(uri).filter(diagnostic => diagnostic.source === 'Lapis').length, 0);
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
