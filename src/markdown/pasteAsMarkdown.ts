import * as vscode from 'vscode';
import { htmlToMarkdown } from './conversion';

export function registerPasteAsMarkdown(): vscode.Disposable {
	return vscode.languages.registerDocumentPasteEditProvider(
		{ language: 'markdown' },
		{
			provideDocumentPasteEdits: async (_document, _ranges, dataTransfer) => {
				const html = dataTransfer.get('text/html');
				if (!html) {
					return [];
				}
				const markdown = htmlToMarkdown(await html.asString());
				if (!markdown) {
					return [];
				}
				const kind = vscode.DocumentDropOrPasteEditKind.Text.append('markdown');
				return [new vscode.DocumentPasteEdit(markdown, 'Paste as Markdown', kind)];
			},
		},
		{
			providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text.append('markdown')],
			pasteMimeTypes: ['text/html'],
		},
	);
}
