import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { NoteIndex } from '../src/index/noteIndex';
import { completionContext, linkSuggestions } from '../src/language/completionItems';

function fixture() {
	const notes = new NoteIndex(async () => undefined);
	const add = (path: string, text = '', rootUri = 'file:///vault') => notes.upsert({
		uri: `${rootUri}/${path}`, rootUri, relativePath: path, text, dirty: false,
	});
	add('Source.md');
	add('Goals.md', '---\ntitle: My objectives\n---\n# First\n# Héllo *world*\n# First\n');
	add('one/Duplicate.md');
	add('two/Duplicate.md');
	add('Private.md', '', 'file:///private');
	return { notes, add, source: 'file:///vault/Source.md' };
}

function complete(text: string, cursor = text.length) {
	const context = completionContext(text, cursor);
	expect(context).toBeDefined();
	return context!;
}

describe('wikilink completion', () => {
	it('inserts the shortest uniquely resolving targets in the same vault', () => {
		const { notes, source, add } = fixture();
		add('one/Source.md');
		for (const from of [source, 'file:///vault/one/Source.md']) {
			const suggestions = linkSuggestions(notes, from, complete('[['));
			expect(suggestions.some(item => item.label === 'Private')).toBe(false);
			for (const item of suggestions) {
				const resolution = notes.resolve(item.insertText.slice(0, -2), from);
				expect(resolution.kind).toBe('resolved');
				if (resolution.kind === 'resolved') {
					expect(resolution.note.relativePath).toBe(item.description);
				}
			}
			expect(suggestions.find(item => item.description === 'Goals.md')?.insertText).toBe('Goals]]');
		}
		expect(linkSuggestions(notes, 'file:///vault/one/Source.md', complete('[['))
			.find(item => item.description === 'two/Duplicate.md')?.insertText).toBe('two/Duplicate]]');
		expect(linkSuggestions(notes, 'file:///vault/one/Source.md', complete('[['))
			.find(item => item.description === 'one/Duplicate.md')?.insertText).toBe('Duplicate]]');
	});

	it('searches titles and paths, not just filenames', () => {
		const { notes, source } = fixture();
		expect(linkSuggestions(notes, source, complete('[[objectives')).map(item => item.label)).toEqual(['My objectives']);
		expect(linkSuggestions(notes, source, complete('[[two/')).map(item => item.description)).toEqual(['two/Duplicate.md']);
		expect(linkSuggestions(notes, source, complete('[[absent'))).toEqual([]);
		expect(linkSuggestions(notes, 'file:///outside.md', complete('[['))).toEqual([]);
	});

	it('handles root-path shadowing, repeated extensions and unsupported target delimiters', () => {
		const { notes, add } = fixture();
		add('one/Source.md');
		add('one/two/Duplicate.md');
		add('Double.md.md');
		add('Unsafe#Heading.md');
		add('Unsafe|Alias.md');
		const source = 'file:///vault/one/Source.md';
		const suggestions = linkSuggestions(notes, source, complete('[['));
		expect(suggestions.find(item => item.description === 'two/Duplicate.md')?.insertText).toBe('/two/Duplicate]]');
		expect(suggestions.find(item => item.description === 'Double.md.md')?.insertText).toBe('Double.md.md]]');
		expect(suggestions.some(item => item.description.startsWith('Unsafe'))).toBe(false);
		for (const suggestion of suggestions) {
			const resolution = notes.resolve(suggestion.insertText.slice(0, -2), source);
			expect(resolution.kind).toBe('resolved');
			if (resolution.kind === 'resolved') {
				expect(resolution.note.relativePath).toBe(suggestion.description);
			}
		}
	});

	it('replaces an existing closing delimiter while preserving aliases and suffix text', () => {
		const { notes, source } = fixture();
		for (const alias of ['|Alias', '\\|Alias']) {
			const text = `Before [[old${alias}]] after`;
			const context = complete(text, text.indexOf('old') + 1);
			const suggestion = linkSuggestions(notes, source, { ...context, target: '' })
				.find(item => item.description === 'Goals.md')!;
			expect(text.slice(0, context.start) + suggestion.insertText + text.slice(context.end))
				.toBe(`Before [[Goals${alias}]] after`);
		}
		const text = '[[Go following prose';
		const context = complete(text, 4);
		expect(context.end).toBe(4);
		expect(text.slice(context.end)).toBe(' following prose');
	});

	it('lists deduplicated target headings and current-note headings after #', () => {
		const { notes, source, add } = fixture();
		add('Source.md', '# Local\n');
		expect(linkSuggestions(notes, source, complete('[[Goals#')).map(item => item.insertText))
			.toEqual(['First]]', 'Héllo world]]']);
		expect(linkSuggestions(notes, source, complete('[[#')).map(item => item.insertText)).toEqual(['Local]]']);
		expect(linkSuggestions(notes, source, complete('[[Duplicate#'))).toEqual([]);
		expect(linkSuggestions(notes, source, complete('[[Absent#'))).toEqual([]);
		const text = '[[Goals#old|Alias]] next';
		const context = complete(text, text.indexOf('old') + 1);
		expect(text.slice(0, context.start) + linkSuggestions(notes, source, context)[0].insertText + text.slice(context.end))
			.toBe('[[Goals#First|Alias]] next');
	});

	it('excludes Markdown code, escapes, metadata and alias positions', () => {
		for (const [text, offset] of [
			['`[[Go]]`', 5], ['```\n[[Go\n```', 8], ['~~~md\n[[Go\n~~~', 10],
			['    [[Go', 8], ['\\[[Go', 5],
			['---\ntitle: [[Go\n---\n', 15], ['---\ntitle: [[Go', 15],
			['[[Goals|alias]]', 10], ['[[Goals\\|alias]]', 11], ['[[Goals]]', 9],
		] as const) {
			expect(completionContext(text, offset), text).toBeUndefined();
		}
		expect(complete('> - ![[Go').start).toBe(7);
		expect(complete('[[Go]]\r\n[[Go', 12).start).toBe(10);
		expect(complete('lapislazuli-completion-context\n[[Go').start).toBe(33);
	});

	it('responds to target changes without a separate cached note catalog', () => {
		const { notes, source, add } = fixture();
		add('Goals.md', '# Unsaved heading');
		expect(linkSuggestions(notes, source, complete('[[Goals#'))[0].label).toBe('Unsaved heading');
		notes.remove('file:///vault/Goals.md');
		expect(linkSuggestions(notes, source, complete('[[objectives'))).toEqual([]);
	});

	it('generates completions under 50 ms for 10,000 indexed notes', () => {
		const { notes, source, add } = fixture();
		for (let index = 0; index < 10000; index++) {
			add(`folder/Note ${index}.md`);
		}
		const context = complete('[[');
		linkSuggestions(notes, source, context);
		const start = performance.now();
		const suggestions = linkSuggestions(notes, source, context);
		const elapsed = performance.now() - start;
		console.info(`10k-note completion: ${elapsed.toFixed(2)} ms`);
		expect(suggestions).toHaveLength(10004);
		expect(elapsed).toBeLessThan(50);
	});
});
