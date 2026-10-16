import * as vscode from 'vscode';
import { WorkspaceIndex } from '../index/workspaceIndex';
import { completionContext, linkSuggestions } from './completionItems';

export function registerWikilinkCompletion(workspace: WorkspaceIndex): vscode.Disposable {
	return vscode.languages.registerCompletionItemProvider(
		{ language: 'markdown', scheme: 'file' },
		{
			async provideCompletionItems(document, position, token) {
				if (!vscode.workspace.getConfiguration('lapis', document.uri).get<boolean>('wikilinkCompletion', false)) {
					return [];
				}
				await workspace.ready;
				workspace.synchronizeOpenDocuments();
				if (token.isCancellationRequested || !workspace.notes.get(document.uri.toString())) {
					return [];
				}
				const context = completionContext(document.getText(), document.offsetAt(position));
				if (!context) {
					return [];
				}
				const range = new vscode.Range(document.positionAt(context.start), document.positionAt(context.end));
				const items = linkSuggestions(workspace.notes, document.uri.toString(), context).map(suggestion => {
					const item = new vscode.CompletionItem({
						label: suggestion.label, description: suggestion.description,
					}, context.heading ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.File);
					item.insertText = suggestion.insertText;
					item.filterText = suggestion.filterText;
					item.detail = suggestion.description;
					item.range = range;
					return item;
				});
				return new vscode.CompletionList(items, true);
			},
		}, '[', '#',
	);
}
