import * as vscode from 'vscode';
import { WorkspaceIndex } from '../index/workspaceIndex';
import { linkSuggestions, LinkSuggestion, wikilinkInsertion } from './completionItems';
import { findTable } from '../tables/table';

interface LinkItem extends vscode.QuickPickItem {
	suggestion: LinkSuggestion;
}

export function registerInsertWikilink(
	workspace: Pick<WorkspaceIndex, 'ready' | 'synchronizeOpenDocuments' | 'notes' | 'whenIdle'>,
	output: Pick<vscode.LogOutputChannel, 'error'>,
): vscode.Disposable {
	let disposed = false;
	const pickers = new Set<vscode.QuickPick<LinkItem>>();
	const command = vscode.commands.registerCommand('lapis.insertWikilink', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'markdown' || editor.selections.length !== 1) {
			await vscode.window.showInformationMessage('Place a single cursor or selection in a Markdown document.');
			return;
		}
		const document = editor.document;
		const version = document.version;
		const selection = editor.selection;
		const insertion = wikilinkInsertion(document.getText(), document.offsetAt(selection.start), document.offsetAt(selection.end));
		if (!insertion) {
			await vscode.window.showInformationMessage('Wikilinks cannot be inserted in code or YAML frontmatter.');
			return;
		}
		try {
			await workspace.ready;
			workspace.synchronizeOpenDocuments();
		} catch (error) {
			output.error(`Cannot load wikilink destinations: ${String(error)}`);
			void vscode.window.showErrorMessage(`Lapis: Cannot load wikilink destinations. ${String(error)}`);
			return;
		}
		if (disposed) { return; }
		if (!workspace.notes.get(document.uri.toString())) {
			await vscode.window.showInformationMessage('Wikilink destinations are available only for notes indexed in a Lapis vault.');
			return;
		}
		const picker = vscode.window.createQuickPick<LinkItem>();
		pickers.add(picker);
		picker.title = insertion.context.heading ? 'Lapis: Insert Wikilink Heading' : 'Lapis: Insert Wikilink';
		picker.placeholder = 'Find a destination by title or path';
		picker.matchOnDescription = true;
		picker.value = insertion.context.heading ? '' : insertion.context.target;
		picker.busy = true;
		let hidden = false;
		let accepting = false;
		const suggestions = () => linkSuggestions(workspace.notes, document.uri.toString(), { ...insertion.context, target: insertion.context.heading ? insertion.context.target : '' });
		const update = () => {
			const active = picker.activeItems[0]?.suggestion.insertText;
			picker.items = suggestions().map(suggestion => ({
				label: suggestion.label, description: suggestion.description, suggestion,
			}));
			picker.activeItems = picker.items.filter(item => item.suggestion.insertText === active).slice(0, 1);
			if (!picker.activeItems.length) { picker.activeItems = picker.items.slice(0, 1); }
			picker.placeholder = picker.items.length ? 'Find a destination by title or path' : 'No link destinations available in this vault';
		};
		const subscriptions = [
			workspace.notes.onDidChange(update),
			picker.onDidAccept(() => {
				const selected = picker.selectedItems[0]?.suggestion;
				if (!selected || accepting) { return; }
				accepting = true;
				picker.hide();
				void (async () => {
					const value = suggestions().find(item => item.insertText === selected.insertText);
					if (!value) { throw new Error('The destination changed. Run Insert Wikilink again.'); }
					let reference = insertion.context.heading
						? insertion.context.target + '#' + value.insertText.slice(0, -insertion.context.suffix.length)
						: value.insertText.slice(0, -insertion.context.suffix.length);
					const original = workspace.notes.resolve(reference.split('#')[0], document.uri.toString());
					if (original.kind !== 'resolved') {
						throw new Error('The destination changed. Run Insert Wikilink again.');
					}
					if (!insertion.context.heading) {
						const target = value.insertText.slice(0, -insertion.context.suffix.length);
						const headings = linkSuggestions(workspace.notes, document.uri.toString(), { ...insertion.context, heading: true, target });
						if (headings.length) {
							const chosen = await vscode.window.showQuickPick([
								{ label: 'Link to note', description: value.description, value: value.insertText },
								...headings.map(heading => ({ label: heading.label, description: 'Heading', value: target + '#' + heading.insertText })),
							], { title: 'Lapis: Choose Wikilink Destination', placeHolder: 'Link to the whole note or to a heading' });
							if (!chosen) { return; }
							reference = chosen.value.slice(0, -insertion.context.suffix.length);
						}
					}
					const suffix = insertion.context.suffix;
					const existingAlias = suffix.startsWith('\\|') ? suffix.slice(2, -2) : suffix.startsWith('|') ? suffix.slice(1, -2) : '';
					const alias = await vscode.window.showInputBox({
						title: 'Lapis: Wikilink Alias',
						prompt: 'Optional display text. Leave empty to use the destination name.',
						value: existingAlias || document.getText(selection),
						validateInput: value => /[\[\]|\r\n]/.test(value) ? 'An alias cannot contain brackets, pipes or line breaks.' : undefined,
					});
					if (alias === undefined) { return; }
					if (disposed) { return; }
					workspace.synchronizeOpenDocuments();
					const resolution = workspace.notes.resolve(reference.split('#')[0], document.uri.toString());
					if (resolution.kind !== 'resolved' || resolution.note.id !== original.note.id || (reference.includes('#')
						&& !resolution.note.headings.some(heading => heading.text === reference.slice(reference.indexOf('#') + 1)))) {
						throw new Error('The destination changed. Run Insert Wikilink again.');
					}
					if (document.isClosed || document.version !== version || vscode.window.activeTextEditor !== editor
						|| editor.selections.length !== 1
						|| !editor.selection.isEqual(selection)) {
						throw new Error('The source document or selection changed. Run Insert Wikilink again.');
					}
					const range = new vscode.Range(document.positionAt(insertion.start), document.positionAt(insertion.end));
					const escaped = suffix.startsWith('\\|') || !!findTable(document.getText(), selection.active.line);
					const separator = escaped ? '\\|' : '|';
					const destination = insertion.context.heading ? reference.slice(reference.indexOf('#') + 1) : reference;
					const text = insertion.prefix + destination + (alias ? separator + alias : '') + ']]';
					const applied = await editor.edit(builder => builder.replace(range, text), { undoStopBefore: true, undoStopAfter: true });
					if (!applied) { throw new Error('VS Code could not insert the wikilink.'); }
					const cursor = document.positionAt(insertion.start + text.length);
					editor.selection = new vscode.Selection(cursor, cursor);
				})().catch(error => {
					output.error(`Cannot insert wikilink in ${document.uri.toString()}: ${String(error)}`);
					void vscode.window.showErrorMessage(`Lapis: ${String(error)}`);
				});
			}),
		];
		subscriptions.push(picker.onDidHide(() => {
			hidden = true;
			pickers.delete(picker);
			subscriptions.forEach(subscription => subscription.dispose());
			picker.dispose();
		}));
		update();
		picker.show();
		void workspace.whenIdle().then(() => {
			if (!hidden) { update(); picker.busy = false; }
		}, error => {
			if (!hidden) {
				picker.busy = false;
				output.error(`Cannot load wikilink destinations: ${String(error)}`);
				void vscode.window.showErrorMessage(`Lapis: Cannot load wikilink destinations. ${String(error)}`);
			}
		});
	});
	return new vscode.Disposable(() => {
		disposed = true;
		command.dispose();
		for (const picker of pickers) { picker.hide(); }
	});
}
