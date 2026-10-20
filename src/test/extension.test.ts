import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
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

	function observeText(document: vscode.TextDocument, text: string, action: () => PromiseLike<unknown>): Promise<void> {
		return new Promise((resolve, reject) => {
			const cleanup = () => { clearTimeout(timeout); listener.dispose(); };
			const check = () => {
				if (document.getText() === text) { cleanup(); resolve(); }
			};
			const listener = vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document === document) { check(); }
			});
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error('Timed out waiting for the expected document text'));
			}, 10000);
			Promise.resolve().then(action).then(check, error => { cleanup(); reject(error); });
		});
	}

	test('discovers typed metadata, excludes dependency folders and resolves backlinks', () => {
		const welcome = vscode.Uri.joinPath(root, 'Welcome.md').toString();
		const related = vscode.Uri.joinPath(root, 'Projects', 'Related.md').toString();
		const shared = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1].uri, 'Shared.md').toString();
		assert.equal(api.getNotes().length, 4);
		assert.equal(api.getNote(welcome)?.title, 'Welcome to Lapis');
		assert.equal(api.getNote(welcome)?.properties.due, '2026-10-20');
		assert.equal(api.resolveLink('Welcome', related).kind, 'resolved');
		assert.deepEqual(api.getBacklinks(welcome).map(note => note.id).sort(), [related, shared].sort());
	});

	test('registers native commands and can rebuild the index', async () => {
		const commands = await vscode.commands.getCommands();
		assert.ok(commands.includes('lapis.openNote'));
		assert.ok(commands.includes('lapis.openBase'));
		assert.ok(commands.includes('lapis.openBaseSource'));
		assert.ok(commands.includes('lapis.manageReminders'));
		assert.ok(commands.includes('lapis.rebuildIndex'));
		assert.ok(!commands.includes('lapislazuli.openNote'));
		assert.ok(!commands.includes('lapislazuli.rebuildIndex'));
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'lapis');
		assert.equal(extension?.packageJSON.displayName, 'Lapis');
		assert.equal(extension?.packageJSON.icon, 'media/lapis-icon.png');
		const titleActions = extension?.packageJSON.contributes.menus['editor/title'];
		assert.ok(titleActions.some((action: { command: string; when: string }) =>
			action.command === 'lapis.openBaseSource' && action.when === 'activeCustomEditorId == lapis.baseTable'));
		assert.equal(await vscode.commands.executeCommand('lapis.rebuildIndex'), 4);
	});

	test('switches from Base source to a same-group read-only custom preview over the vault-scoped index', async () => {
		const base = vscode.Uri.joinPath(root, 'Notes.base');
		const welcome = vscode.Uri.joinPath(root, 'Welcome.md');
		created.add(base.toString());
		await vscode.workspace.fs.writeFile(base, Buffer.from([
			'views:',
			'  - type: table',
			'    name: Vault notes',
			'  - type: kanban',
			'    name: Board',
			'    groupBy: status',
			'properties:',
			'  status:',
			'    displayName: State',
		].join('\n')));
		const sourceDocument = await vscode.workspace.openTextDocument(base);
		assert.equal(sourceDocument.languageId, 'yaml');
		const sourceEditor = await vscode.window.showTextDocument(sourceDocument, { preview: false });
		const sourceColumn = sourceEditor.viewColumn;
		const sourceBytes = await vscode.workspace.fs.readFile(base);
		const edit = new vscode.WorkspaceEdit();
		const name = sourceDocument.getText().indexOf('Vault notes');
		edit.replace(base, new vscode.Range(sourceDocument.positionAt(name), sourceDocument.positionAt(name + 'Vault notes'.length)), 'Unsaved vault view');
		assert.ok(await vscode.workspace.applyEdit(edit));
		assert.ok(sourceDocument.isDirty);
		const before = await vscode.workspace.fs.readFile(welcome);
		const panel = await vscode.commands.executeCommand<vscode.WebviewPanel | undefined>('lapis.openBase', base);
		assert.ok(panel, 'Base table did not create a webview panel');
		assert.equal(panel.viewType, 'lapis.baseTable');
		assert.equal(panel.viewColumn, sourceColumn);
		const baseTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
			(tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom)
			&& tab.input.uri.toString() === base.toString());
		assert.equal(baseTabs.length, 1, 'Switching to preview should replace the source tab');
		assert.ok(baseTabs[0].input instanceof vscode.TabInputCustom);
		assert.doesNotMatch(panel.webview.html, /id="source"/);
		assert.match(panel.webview.html, /id="search"/);
		assert.match(panel.webview.html, /id="kanban"/);
		assert.match(panel.webview.html, /Unsaved vault view/);
		assert.match(panel.webview.html, /Welcome/);
		assert.match(panel.webview.html, /Related/);
		assert.match(panel.webview.html, /Shared/);
		assert.doesNotMatch(panel.webview.html, /Private/);
		assert.deepEqual(await vscode.workspace.fs.readFile(welcome), before);
		assert.deepEqual(await vscode.workspace.fs.readFile(base), sourceBytes, 'Preview must not save unsaved YAML');
		await vscode.commands.executeCommand('lapis.openBaseSource');
		assert.match(vscode.window.activeTextEditor?.document.getText() ?? '', /Unsaved vault view/);
		assert.equal(vscode.window.activeTextEditor?.viewColumn, sourceColumn);
		assert.deepEqual(await vscode.workspace.fs.readFile(base), sourceBytes, 'Opening source must not save unsaved YAML');
		assert.ok(await sourceDocument.save());
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

	test('formats only the active table outside vaults and undoes it in one step', async () => {
		const source = 'Before\n\n| Name | Qty |\n| --- | --- |\n| apple | 2 |\n\nAfter\n';
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: source });
		const editor = await vscode.window.showTextDocument(document);
		try {
			editor.selection = new vscode.Selection(4, 4, 4, 4);
			await vscode.commands.executeCommand('lapis.table.format');
			const formatted = document.getText();
			assert.notEqual(formatted, source);
			assert.ok(formatted.startsWith('Before\n\n'));
			assert.ok(formatted.endsWith('\n\nAfter\n'));
			assert.equal(editor.selection.active.line, 4);
			assert.equal(document.lineAt(4).text.slice(editor.selection.active.character, editor.selection.active.character + 5), 'apple');
			await vscode.commands.executeCommand('lapis.table.format');
			assert.equal(document.getText(), formatted);
			await observeText(document, source, () => vscode.commands.executeCommand('undo'));
			assert.equal(document.getText(), source);
			await observeText(document, formatted, () => vscode.commands.executeCommand('redo'));
			assert.equal(document.getText(), formatted);
		} finally {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('offers table Code Actions and preserves logical cells through structural edits', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown', content: '| Name | Qty |\n| --- | --- |\n| apple | 2 |\n',
		});
		const editor = await vscode.window.showTextDocument(document);
		try {
			editor.selection = new vscode.Selection(2, 4, 2, 4);
			const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
				'vscode.executeCodeActionProvider', document.uri, editor.selection);
			const insert = actions?.find((action): action is vscode.CodeAction =>
				action instanceof vscode.CodeAction && action.command?.command === 'lapis.table.insertColumnRight');
			assert.ok(insert?.command);
			await vscode.commands.executeCommand(insert.command.command, ...insert.command.arguments!);
			assert.equal(editor.selection.active.line, 0);
			const character = editor.selection.active.character;
			assert.equal(document.lineAt(0).text.slice(character, character + 1), ' ');
			await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
			assert.equal(editor.selection.active.line, 2);
			await vscode.commands.executeCommand('lapis.table.deleteColumn');
			assert.match(document.lineAt(2).text, /apple\s*\|\s*2/);
			await vscode.commands.executeCommand('lapis.table.insertRowBelow');
			assert.equal(editor.selection.active.line, 3);
			assert.equal(document.lineCount, 5);
			await vscode.commands.executeCommand('lapis.table.deleteRow');
			assert.equal(editor.selection.active.line, 2);
			assert.equal(document.lineCount, 4);
			const beforeAlignment = document.getText();
			await vscode.commands.executeCommand('lapis.table.alignCenter');
			assert.match(document.lineAt(1).text, /:---:/);
			await observeText(document, beforeAlignment, () => vscode.commands.executeCommand('undo'));
			assert.doesNotMatch(document.lineAt(1).text, /:---:/);
		} finally {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('does not offer table actions inside code fences or frontmatter', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown', content: '---\ntitle: sample\n---\n\n```\n| A | B |\n| --- | --- |\n| x | y |\n```\n',
		});
		await vscode.window.showTextDocument(document);
		try {
			for (const line of [1, 5, 7]) {
				const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
					'vscode.executeCodeActionProvider', document.uri, new vscode.Range(line, 0, line, 0));
				assert.ok(!actions?.some(action => action.title.startsWith('Lapis:')));
			}
		} finally {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('inserts compact rows with native snippet navigation without reformatting other lines', async () => {
		const source = 'Before\n\n| Long name | Qty |\n| :--- | ---: |\n| $value\\path | 2 |\n\nAfter\n';
		for (const operation of ['insertRowAbove', 'insertRowBelow']) {
			const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: source });
			const editor = await vscode.window.showTextDocument(document);
			try {
				editor.selection = new vscode.Selection(4, 18, 4, 18);
				await vscode.commands.executeCommand(`lapis.table.${operation}`);
				const row = operation === 'insertRowAbove' ? 4 : 5;
				const expected = source.split('\n');
				expected.splice(row, 0, '|  |  |');
				assert.equal(document.getText(), expected.join('\n'));
				assert.equal(editor.selection.active.line, row);
				assert.equal(editor.selection.active.character, 2);
				assert.ok(editor.selection.isEmpty);
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				assert.equal(editor.selection.active.character, 5);
				await vscode.commands.executeCommand('jumpToPrevSnippetPlaceholder');
				assert.equal(editor.selection.active.character, 2);
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				assert.equal(editor.selection.active.character, 7);
				assert.equal(document.getText(), expected.join('\n'));
				await observeText(document, source, () => vscode.commands.executeCommand('undo'));
				await observeText(document, expected.join('\n'), () => vscode.commands.executeCommand('redo'));
			} finally {
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			}
		}
	});

	test('fills compact row snippet cells without mirroring values into other cells', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '| A | B |\n| --- | --- |' });
		const editor = await vscode.window.showTextDocument(document);
		try {
			editor.selection = new vscode.Selection(0, 5, 0, 5);
			await vscode.commands.executeCommand('lapis.table.insertRowBelow');
			assert.equal(document.lineAt(2).text, '|  |  |');
			await vscode.commands.executeCommand('type', { text: 'first' });
			await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
			await vscode.commands.executeCommand('type', { text: 'second' });
			assert.equal(document.lineAt(2).text, '| first | second |');
			await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
			assert.equal(editor.selection.active.character, '| first | second |'.length);
		} finally {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('inserts compact columns with vertical snippet navigation and one-step undo', async () => {
		const source = 'Before\n\n| Long name | Qty |\n| :--- | ---: |\n| $value\\path | 2 |\n| pear | 10 |\n\nAfter\n';
		for (const operation of ['insertColumnLeft', 'insertColumnRight']) {
			const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: source });
			const editor = await vscode.window.showTextDocument(document);
			try {
				editor.selection = new vscode.Selection(4, 4, 4, 4);
				await vscode.commands.executeCommand(`lapis.table.${operation}`);
				const expected = operation === 'insertColumnLeft'
					? 'Before\n\n|  | Long name | Qty |\n| --- | :--- | ---: |\n|  | $value\\path | 2 |\n|  | pear | 10 |\n\nAfter\n'
					: 'Before\n\n| Long name |  | Qty |\n| :--- | --- | ---: |\n| $value\\path |  | 2 |\n| pear |  | 10 |\n\nAfter\n';
				assert.equal(document.getText(), expected);
				assert.equal(editor.selection.active.line, 2);
				assert.equal(editor.selection.active.character, operation === 'insertColumnLeft' ? 2 : 14);
				assert.ok(editor.selection.isEmpty);
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				assert.equal(editor.selection.active.line, 4);
				assert.equal(editor.selection.active.character, operation === 'insertColumnLeft' ? 2 : 16);
				await vscode.commands.executeCommand('jumpToPrevSnippetPlaceholder');
				assert.equal(editor.selection.active.line, 2);
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				assert.equal(editor.selection.active.line, 5);
				assert.equal(editor.selection.active.character, operation === 'insertColumnLeft' ? 2 : 9);
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				assert.equal(editor.selection.active.character, document.lineAt(5).text.length);
				await observeText(document, source, () => vscode.commands.executeCommand('undo'));
				await observeText(document, expected, () => vscode.commands.executeCommand('redo'));
			} finally {
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			}
		}
	});

	test('fills new column cells independently, skipping the separator', async () => {
		for (const content of ['| A |\n| --- |\n| x |', '| A |\n| --- |']) {
			const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
			const editor = await vscode.window.showTextDocument(document);
			try {
				await vscode.commands.executeCommand('lapis.table.insertColumnRight');
				await vscode.commands.executeCommand('type', { text: 'Header' });
				assert.equal(document.lineAt(0).text, '| A | Header |');
				await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				if (document.lineCount > 2) {
					assert.equal(editor.selection.active.line, 2);
					await vscode.commands.executeCommand('type', { text: 'Value' });
					assert.equal(document.lineAt(2).text, '| x | Value |');
					await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
				}
				assert.equal(document.lineAt(1).text, '| --- | --- |');
				assert.equal(editor.selection.active.character, document.lineAt(editor.selection.active.line).text.length);
			} finally {
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			}
		}
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

	test('hides metadata in the native Markdown preview without changing the document', async () => {
		const uri = vscode.Uri.joinPath(root, 'Welcome.md');
		const document = await vscode.workspace.openTextDocument(uri);
		const original = document.getText();
		const html = await vscode.commands.executeCommand<string>('markdown.api.render', document);
		assert.ok(html?.includes('Welcome'));
		assert.ok(!html?.includes('status:') && !html?.includes('due:') && !html?.includes('title:'));
		assert.ok(html?.includes('data-line="5"'), 'The native preview must retain source line mapping');
		assert.equal(document.getText(), original);
		assert.equal(document.isDirty, false);
	});

	test('renders native preview wikilinks with encoded paths, native heading IDs and unsaved targets', async () => {
		const sourceUri = vscode.Uri.joinPath(root, 'Preview source.md');
		const targetUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1].uri, 'Preview target %?.md');
		created.add(sourceUri.toString());
		created.add(targetUri.toString());
		const heading = 'Héllo, World! code';
		const sourceText = `[[Preview target %?.md#${heading}|Go]] [[Preview missing]] ![[Welcome]]\n`;
		await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceText));
		await vscode.workspace.fs.writeFile(targetUri, Buffer.from('# Original\n'));
		await vscode.commands.executeCommand('lapis.rebuildIndex');
		const source = await vscode.workspace.openTextDocument(sourceUri);
		const target = await vscode.workspace.openTextDocument(targetUri);
		try {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(targetUri, new vscode.Position(0, 0),
				'# Héllo, *World*! `code`\n# Repeat\n# Repeat\n# Repeat-1\n# A [[Welcome|label]] B\n\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			const html = await vscode.commands.executeCommand<string>('markdown.api.render', source);
			const targetHtml = await vscode.commands.executeCommand<string>('markdown.api.render', target);
			assert.ok(targetHtml?.includes('id="héllo-world-code"'));
			assert.deepEqual([...targetHtml!.matchAll(/<h\d\b[^>]*\bid="([^"]*)"/g)].map(match => match[1]),
				api.getNote(targetUri.toString())?.headings.map(heading => heading.slug));
			assert.ok(html?.includes('href="./../workspace-two/Preview%20target%20%25%3F.md#h%C3%A9llo-world-code"'), html);
			assert.ok(html?.includes('>Go</a>'));
			assert.ok(html?.includes('lapis-wikilink-missing'));
			assert.ok(html?.includes('![[Welcome]]'));
			assert.equal(source.isDirty, false);
			assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri)), '# Original\n');
			const unmarked = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![3].uri, 'Unmarked.md'));
			const outside = await vscode.commands.executeCommand<string>('markdown.api.render', {
				uri: unmarked.uri, version: unmarked.version,
				getText: () => '[[Welcome|raw]]',
			});
			assert.ok(outside?.includes('[[Welcome|raw]]'));
			assert.ok(!outside?.includes('lapis-wikilink'));
		} finally {
			await vscode.window.showTextDocument(target);
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('renders read-only GFM checkboxes with wikilinks without changing source or cached tokens', async () => {
		const uri = vscode.Uri.joinPath(root, 'Welcome.md');
		const text = '- [ ] [[Welcome|Open]]\n- [X] **Done**\n  - [x] Nested\n- Ordinary\n';
		const document = await vscode.workspace.openTextDocument(uri);
		const original = document.getText();
		const dirty = document.isDirty;
		const html = await vscode.commands.executeCommand<string>('markdown.api.render', {
			uri, version: document.version, getText: () => text,
		});
		assert.equal(html?.match(/type="checkbox"/g)?.length, 3);
		assert.equal(html?.match(/disabled=""/g)?.length, 3);
		assert.equal(html?.match(/checked=""/g)?.length, 2);
		assert.ok(html?.includes('>Open</a>'), html);
		assert.ok(html?.includes('<strong>Done</strong>'), html);
		assert.ok(!html?.includes('[ ]') && !html?.includes('[X]'));
		assert.equal(document.getText(), original);
		assert.equal(document.isDirty, dirty);

		const markdown = api.extendMarkdownIt(new MarkdownIt());
		const tokens = markdown.parse(text, {});
		const snapshot = JSON.stringify(tokens);
		for (let render = 0; render < 2; render++) {
			const result = markdown.renderer.render(tokens, markdown.options, { currentDocument: uri });
			assert.equal(result.match(/type="checkbox"/g)?.length, 3);
			assert.ok(result.includes('>Open</a>'));
			assert.equal(JSON.stringify(tokens), snapshot);
		}
	});

	test('renders highlight and footnotes inside and outside vaults without changing documents', async () => {
		for (const uri of [
			vscode.Uri.joinPath(root, 'Preview syntax.md'),
			vscode.Uri.joinPath(vscode.workspace.workspaceFolders![3].uri, 'Preview syntax.md'),
		]) {
			created.add(uri.toString());
			await vscode.workspace.fs.writeFile(uri, Buffer.from('==Highlighted==[^a]\n\n[^a]: **Footnote**\n'));
			const document = await vscode.workspace.openTextDocument(uri);
			const original = document.getText();
			const dirty = document.isDirty;
			const html = await vscode.commands.executeCommand<string>('markdown.api.render', document);
			assert.ok(html?.includes('<mark>Highlighted</mark>'), html);
			assert.ok(html?.includes('<strong>Footnote</strong>'), html);
			assert.ok(html?.includes('href="#fn1"'), html);
			assert.ok(html?.includes('href="#fnref1"'), html);
			assert.equal(document.getText(), original);
			assert.equal(document.isDirty, dirty);
		}
	});

	test('preserves footnote IDs, environment and cached tokens when reparsing wikilinks', () => {
		const markdown = api.extendMarkdownIt(new MarkdownIt());
		const text = '- [x] ==[[Welcome|Go]]==[^a] again[^a] inline^[Inline [[Welcome|Note]]].\n\n[^a]: Definition [[Welcome|Target]]\n';
		const env = {};
		const tokens = markdown.parse(text, env);
		const original = JSON.stringify({ tokens, env });
		for (let iteration = 0; iteration < 2; iteration++) {
			const html = markdown.renderer.render(tokens, markdown.options, {
				...env, currentDocument: vscode.Uri.joinPath(root, 'Welcome.md'),
			});
			assert.ok(html.includes('>Go</a></mark>'), html);
			assert.ok(html.includes('>Target</a>'), html);
			assert.ok(html.includes('>Note</a>'), html);
			assert.ok(html.includes('type="checkbox"'));
			assert.ok(html.includes('id="fnref1"'));
			assert.ok(html.includes('id="fnref1:1"'));
			assert.ok(html.includes('id="fnref2"'));
			assert.ok(!html.includes('id="fnref3"'));
			assert.equal(JSON.stringify({ tokens, env }), original);
		}
	});

	test('preserves cached native tokens, automatic links and formatting when rendering wikilinks', () => {
		const markdown = api.extendMarkdownIt(new MarkdownIt({ linkify: true, typographer: true }));
		const text = '[[Welcome|Go]] https://example.com "quote" [reference][id]\n\n[id]: https://example.com/ref';
		const tokens = markdown.parse(text, {});
		const original = JSON.stringify(tokens);
		const html = markdown.renderer.render(tokens, markdown.options, {
			currentDocument: vscode.Uri.joinPath(root, 'Welcome.md'),
		});
		assert.ok(html.includes('class="lapis-wikilink"'));
		assert.ok(html.includes('<a href="https://example.com">'));
		assert.ok(html.includes('<a href="https://example.com/ref">reference</a>'));
		assert.ok(html.includes('“quote”'));
		assert.equal(JSON.stringify(tokens), original);
		const outside = markdown.renderer.render(tokens, markdown.options, {
			currentDocument: vscode.Uri.joinPath(vscode.workspace.workspaceFolders![3].uri, 'Unmarked.md'),
		});
		assert.ok(outside.includes('[[Welcome|Go]]'));
		assert.ok(!outside.includes('lapis-wikilink'));
		assert.equal(JSON.stringify(tokens), original);
	});

	test('updates preview resolution for unchanged sources as targets appear, conflict and disappear', async () => {
		const sourceUri = vscode.Uri.joinPath(root, 'Preview lifecycle.md');
		const first = vscode.Uri.joinPath(root, 'Projects', 'Preview later.md');
		const second = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1].uri, 'Preview later.md');
		for (const uri of [sourceUri, first, second]) {
			created.add(uri.toString());
		}
		await vscode.workspace.fs.writeFile(sourceUri, Buffer.from('[[Preview later#Heading|Later]]'));
		await vscode.commands.executeCommand('lapis.rebuildIndex');
		const source = await vscode.workspace.openTextDocument(sourceUri);
		const render = () => vscode.commands.executeCommand<string>('markdown.api.render', source);
		assert.ok((await render())?.includes('wikilink-missing'));
		await observe(first, note => !!note,
			() => vscode.workspace.fs.writeFile(first, Buffer.from('# Heading')));
		assert.ok((await render())?.includes('href="./Projects/Preview%20later.md#heading"'));
		await observe(second, note => !!note,
			() => vscode.workspace.fs.writeFile(second, Buffer.from('# Heading')));
		assert.ok((await render())?.includes('wikilink-ambiguous'));
		await observe(first, note => !note, () => vscode.workspace.fs.delete(first));
		assert.ok((await render())?.includes('href="./../workspace-two/Preview%20later.md#heading"'));
		await observe(second, note => !note, () => vscode.workspace.fs.delete(second));
		assert.ok((await render())?.includes('wikilink-missing'));
		assert.equal(source.isDirty, false);
	});

	test('navigates wikilinks with fresh unsaved source/target buffers and heading fallbacks', async () => {
		const sourceUri = vscode.Uri.joinPath(root, 'Navigation source.md');
		const targetUri = vscode.Uri.joinPath(root, 'Navigation target %.md');
		created.add(sourceUri.toString());
		created.add(targetUri.toString());
		const sourceText = '# Local\n\n`[[Navigation target %#Changed]]` [[Navigation target %#Changed\\|Go]] ![[Navigation target %]] [[#Local]] [[Navigation target %#Absent]] [[Missing]]\n';
		await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceText));
		await vscode.workspace.fs.writeFile(targetUri, Buffer.from('# Original\n'));
		await vscode.commands.executeCommand('lapis.rebuildIndex');
		const source = await vscode.workspace.openTextDocument(sourceUri);
		const target = await vscode.workspace.openTextDocument(targetUri);
		try {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(sourceUri, new vscode.Position(0, 0), 'prefix\n\n');
			edit.insert(targetUri, new vscode.Position(0, 0), 'intro\n\n## Changed\n\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			const editor = await vscode.window.showTextDocument(source, vscode.ViewColumn.One);
			const offset = source.getText().indexOf('\\|Go');
			const position = source.positionAt(offset);
			const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.DefinitionLink)[]>(
				'vscode.executeDefinitionProvider', sourceUri, position);
			assert.equal(definitions?.length, 1);
			const definition = definitions![0];
			assert.ok('uri' in definition);
			assert.equal(definition.uri.toString(), targetUri.toString());
			assert.equal(definition.range.start.line, 2);

			const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', sourceUri, 100);
			const wikilinks = links!.filter(link => link.tooltip?.startsWith('Open '));
			assert.equal(wikilinks.length, 4);
			assert.deepEqual(wikilinks.map(link => source.getText(link.range)), [
				'[[Navigation target %#Changed\\|Go]]', '![[Navigation target %]]', '[[#Local]]', '[[Navigation target %#Absent]]',
			]);
			assert.equal(wikilinks[0].target?.fragment, 'L3');
			assert.equal(wikilinks[3].target?.fragment, 'L1');
			assert.equal(wikilinks[2].target?.with({ fragment: '' }).toString(), sourceUri.toString());
			assert.equal(wikilinks[2].target?.fragment, 'L3');
			const codeDefinitions = await vscode.commands.executeCommand<unknown[]>(
				'vscode.executeDefinitionProvider', sourceUri, source.positionAt(source.getText().indexOf('Navigation target %')));
			assert.equal(codeDefinitions?.length, 0);

			editor.selection = new vscode.Selection(position, position);
			await vscode.commands.executeCommand('editor.action.revealDefinition');
			assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), targetUri.toString());
			assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2);
			assert.equal(vscode.window.activeTextEditor?.viewColumn, vscode.ViewColumn.One);
			await vscode.window.showTextDocument(source, vscode.ViewColumn.One);
			await vscode.commands.executeCommand('vscode.open', wikilinks[0].target);
			assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), targetUri.toString());
			assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2);
			assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(sourceUri)), sourceText);
			assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri)), '# Original\n');
		} finally {
			for (const document of [source, target]) {
				await vscode.window.showTextDocument(document);
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			}
		}
	});

	test('does not navigate missing, ambiguous, excluded or out-of-vault wikilinks', async () => {
		const sourceUri = vscode.Uri.joinPath(root, 'Ambiguous source.md');
		const paths = ['one', 'two'].map(folder => vscode.Uri.joinPath(root, folder));
		created.add(sourceUri.toString());
		for (const path of paths) {
			created.add(path.toString());
			await vscode.workspace.fs.createDirectory(path);
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(path, 'Duplicate.md'), Buffer.from('# Duplicate\n'));
		}
		await vscode.workspace.fs.writeFile(sourceUri, Buffer.from('[[Duplicate]] [[Private]] [[Ignored]] [[Absent]]\n'));
		await vscode.commands.executeCommand('lapis.rebuildIndex');
		const document = await vscode.workspace.openTextDocument(sourceUri);
		const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', sourceUri);
		assert.equal(links?.filter(link => link.tooltip?.startsWith('Open ')).length, 0);
		const definitions = await vscode.commands.executeCommand<unknown[]>(
			'vscode.executeDefinitionProvider', sourceUri, new vscode.Position(0, 3));
		assert.equal(definitions?.length, 0);
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', sourceUri, new vscode.Position(0, 3));
		const text = hovers!.flatMap(hover => hover.contents.map(content => typeof content === 'string' ? content : content.value)).join('\n').replace(/\\/g, '');
		assert.ok(text.includes('one/Duplicate.md') && text.includes('two/Duplicate.md'));
		const outside = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![3].uri, 'Outside.md');
		const excluded = vscode.Uri.joinPath(root, 'node_modules', 'Excluded links.md');
		for (const uri of [outside, excluded]) {
			created.add(uri.toString());
			await vscode.workspace.fs.writeFile(uri, Buffer.from('[[Welcome]]\n'));
		}
		for (const uri of [
			vscode.Uri.joinPath(vscode.workspace.workspaceFolders![2].uri, 'Private.md'),
			outside, excluded,
		]) {
			await vscode.workspace.openTextDocument(uri);
			const result = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', uri);
			assert.equal(result?.filter(link => link.tooltip?.startsWith('Open ')).length, 0);
			const definitions = await vscode.commands.executeCommand<unknown[]>('vscode.executeDefinitionProvider', uri, new vscode.Position(0, 4));
			assert.equal(definitions?.length, 0);
		}
		assert.equal(document.isDirty, false);
	});

	test('completes vault notes and unsaved headings with native replacement ranges', async () => {
		const sourceUri = vscode.Uri.joinPath(root, 'Completion source.md');
		const targetUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1].uri, 'Completion target.md');
		const sourceText = '[[Comp\n[[Comp\\|Alias]]\n[[Completion target#Un]]\n`[[Comp]]`\n```\n[[Comp\n```\n';
		created.add(sourceUri.toString());
		created.add(targetUri.toString());
		await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceText));
		await vscode.workspace.fs.writeFile(targetUri, Buffer.from('---\ntitle: Completion title\n---\n# Original\n'));
		await vscode.commands.executeCommand('lapis.rebuildIndex');
		const source = await vscode.workspace.openTextDocument(sourceUri);
		const target = await vscode.workspace.openTextDocument(targetUri);
		const completions = async (line: number, character: number, trigger?: string) => {
			const result = await vscode.commands.executeCommand<vscode.CompletionList>(
				'vscode.executeCompletionItemProvider', sourceUri, new vscode.Position(line, character), trigger);
			return result!.items.filter(item => item.detail === 'workspace-two/Completion target.md');
		};
		const configuration = vscode.workspace.getConfiguration('lapis', sourceUri);
		const previous = configuration.inspect<boolean>('wikilinkCompletion')?.workspaceFolderValue;
		try {
			await vscode.window.showTextDocument(source);
			assert.equal(configuration.get('wikilinkCompletion'), false);
			assert.equal((await completions(0, 6, '[')).length, 0);
			await configuration.update('wikilinkCompletion', true, vscode.ConfigurationTarget.WorkspaceFolder);
			const notes = await completions(0, 6, '[');
			assert.equal(notes.length, 1);
			assert.equal(typeof notes[0].label === 'string' ? notes[0].label : notes[0].label.label, 'Completion title');
			assert.equal(notes[0].insertText, 'Completion target]]');
			assert.ok(notes[0].range instanceof vscode.Range);
			assert.equal(source.getText(notes[0].range), 'Comp');
			const aliases = await completions(1, 6);
			assert.equal(aliases[0].insertText, 'Completion target\\|Alias]]');
			const edit = new vscode.WorkspaceEdit();
			edit.replace(targetUri, new vscode.Range(3, 0, 3, 10), '# Unsaved heading');
			await vscode.workspace.applyEdit(edit);
			const headings = await completions(2, 22, '#');
			assert.equal(headings.length, 1);
			assert.equal(headings[0].insertText, 'Unsaved heading]]');
			assert.ok(headings[0].range instanceof vscode.Range);
			assert.equal(source.getText(headings[0].range), 'Un]]');
			assert.equal((await completions(3, 7)).length, 0);
			assert.equal((await completions(5, 6)).length, 0);
			const insertion = new vscode.WorkspaceEdit();
			insertion.replace(sourceUri, notes[0].range, notes[0].insertText);
			await vscode.workspace.applyEdit(insertion);
			assert.ok(source.getText().startsWith('[[Completion target]]\n'));
			assert.equal(api.resolveLink('Completion target', sourceUri.toString()).kind, 'resolved');
			assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(sourceUri)), sourceText);
			assert.ok(new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri)).includes('# Original'));
		} finally {
			await configuration.update('wikilinkCompletion', previous, vscode.ConfigurationTarget.WorkspaceFolder);
			for (const document of [source, target]) {
				await vscode.window.showTextDocument(document);
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			}
		}
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
		const extensionConfig = vscode.workspace.getConfiguration('lapis', root);
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
