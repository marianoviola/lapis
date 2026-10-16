import * as vscode from 'vscode';
import { NoteLinkOccurrence } from '../domain/note';
import { NoteIndex } from '../index/noteIndex';
import { WorkspaceIndex } from '../index/workspaceIndex';

class WikilinkDocumentLink extends vscode.DocumentLink {
	constructor(range: vscode.Range, readonly fromUri: string, readonly occurrence: NoteLinkOccurrence) {
		super(range);
	}
}

function occurrences(document: vscode.TextDocument, notes: NoteIndex): readonly NoteLinkOccurrence[] {
	return notes.get(document.uri.toString())?.links ?? [];
}

function sourceRange(document: vscode.TextDocument, link: NoteLinkOccurrence): vscode.Range {
	return new vscode.Range(document.positionAt(link.range.start), document.positionAt(link.range.end));
}

function destination(link: NoteLinkOccurrence, from: string, notes: NoteIndex): vscode.Location | undefined {
	const resolution = notes.resolve(link.target, from);
	if (resolution.kind !== 'resolved') {
		return undefined;
	}
	const line = link.heading
		? resolution.note.headings.find(heading => heading.text === link.heading)?.line ?? 0 : 0;
	return new vscode.Location(vscode.Uri.parse(resolution.note.id), new vscode.Position(line, 0));
}

export function registerWikilinkNavigation(workspace: WorkspaceIndex): vscode.Disposable {
	const selector: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' };
	const prepare = async (token: vscode.CancellationToken) => {
		await workspace.ready;
		await workspace.whenIdle();
		workspace.synchronizeOpenDocuments();
		return !token.isCancellationRequested;
	};
	const links: vscode.DocumentLinkProvider<WikilinkDocumentLink> = {
		async provideDocumentLinks(document, token) {
			if (!await prepare(token)) {
				return [];
			}
			return occurrences(document, workspace.notes).flatMap(link => {
				const location = destination(link, document.uri.toString(), workspace.notes);
				if (!location) {
					return [];
				}
				const result = new WikilinkDocumentLink(sourceRange(document, link), document.uri.toString(), link);
				result.tooltip = `Open ${link.target || document.fileName}${link.heading ? `#${link.heading}` : ''}`;
				return [result];
			});
		},
		async resolveDocumentLink(link, token) {
			if (!await prepare(token)) {
				return undefined;
			}
			const location = destination(link.occurrence, link.fromUri, workspace.notes);
			if (!location) {
				return undefined;
			}
			link.target = location.uri.with({ fragment: `L${location.range.start.line + 1}` });
			return link;
		},
	};
	return vscode.Disposable.from(
		vscode.languages.registerDocumentLinkProvider(selector, links),
		vscode.languages.registerDefinitionProvider(selector, {
			async provideDefinition(document, position, token) {
				if (!await prepare(token)) {
					return undefined;
				}
				const offset = document.offsetAt(position);
				const link = occurrences(document, workspace.notes).find(candidate =>
					candidate.range.start <= offset && offset < candidate.range.end);
				return link ? destination(link, document.uri.toString(), workspace.notes) : undefined;
			},
		}),
		vscode.languages.registerHoverProvider(selector, {
			async provideHover(document, position, token) {
				if (!await prepare(token)) {
					return undefined;
				}
				const offset = document.offsetAt(position);
				const link = occurrences(document, workspace.notes).find(candidate =>
					candidate.range.start <= offset && offset < candidate.range.end);
				if (!link) {
					return undefined;
				}
				const resolution = workspace.notes.resolve(link.target, document.uri.toString());
				if (resolution.kind !== 'ambiguous') {
					return undefined;
				}
				const message = new vscode.MarkdownString().appendText('Ambiguous wikilink. Candidates:');
				for (const note of resolution.candidates) {
					message.appendText(`\n\n${note.relativePath}`);
				}
				return new vscode.Hover(message, sourceRange(document, link));
			},
		}),
	);
}
