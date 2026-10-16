import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
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
		await vscode.commands.executeCommand('lapislazuli.rebuildIndex');
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
			assert.ok(html?.includes('lapislazuli-wikilink-missing'));
			assert.ok(html?.includes('![[Welcome]]'));
			assert.equal(source.isDirty, false);
			assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri)), '# Original\n');
			const unmarked = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![3].uri, 'Unmarked.md'));
			const outside = await vscode.commands.executeCommand<string>('markdown.api.render', {
				uri: unmarked.uri, version: unmarked.version,
				getText: () => '[[Welcome|raw]]',
			});
			assert.ok(outside?.includes('[[Welcome|raw]]'));
			assert.ok(!outside?.includes('lapislazuli-wikilink'));
		} finally {
			await vscode.window.showTextDocument(target);
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
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
		assert.ok(html.includes('class="lapislazuli-wikilink"'));
		assert.ok(html.includes('<a href="https://example.com">'));
		assert.ok(html.includes('<a href="https://example.com/ref">reference</a>'));
		assert.ok(html.includes('“quote”'));
		assert.equal(JSON.stringify(tokens), original);
		const outside = markdown.renderer.render(tokens, markdown.options, {
			currentDocument: vscode.Uri.joinPath(vscode.workspace.workspaceFolders![3].uri, 'Unmarked.md'),
		});
		assert.ok(outside.includes('[[Welcome|Go]]'));
		assert.ok(!outside.includes('lapislazuli-wikilink'));
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
		await vscode.commands.executeCommand('lapislazuli.rebuildIndex');
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
		await vscode.commands.executeCommand('lapislazuli.rebuildIndex');
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
		await vscode.commands.executeCommand('lapislazuli.rebuildIndex');
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
