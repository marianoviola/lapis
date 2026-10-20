import { describe, expect, it } from 'vitest';
import { parseBase } from '../src/bases/base';
import { renderBasePage } from '../src/bases/page';
import { parseNote } from '../src/index/parseNote';

describe('Base preview page', () => {
	it('provides a toolbar and safely serializes notes and configuration', () => {
		const note = parseNote({
			uri: 'file:///vault/post.md', rootUri: 'file:///vault', relativePath: 'post.md', dirty: false,
			text: '---\nstatus: draft\ndue: 2099-12-01\ntitle: "</script><img src=x onerror=alert(1)>"\n---\n',
		});
		const html = renderBasePage({
			title: '<script>.base',
			result: parseBase('views:\n  - type: table\n    name: Notes\n  - type: kanban\n    groupBy: status'),
			notes: [note], reminders: [],
		}, 'test-nonce');
		expect(html).toContain('script-src \'nonce-test-nonce\'');
		expect(html).not.toContain('id="source"');
		expect(html).toContain('class="search-icon"');
		expect(html).not.toContain('&#8981;');
		expect(html).toContain('id="kanban"');
		expect(html).toContain('id="search"');
		expect(html).toContain('id="reminders"');
		expect(html).toContain('"canRemind":true');
		expect(html).toContain('"note.status":{"key":"string:\\"draft\\"","label":"draft"}');
		expect(html).not.toContain('<img src=x');
		expect(html).not.toContain('<script>.base');
		expect(html.match(/<\/script>/g)).toHaveLength(1);
		expect(html).toContain('\\u003c/script\\u003e');
	});

	it('shows escaped diagnostics without duplicating the native source action on invalid YAML', () => {
		const html = renderBasePage({
			title: 'Notes.base', result: { diagnostics: [{ line: 2, message: '<bad> & unsafe' }] },
			notes: [], reminders: [],
		}, 'nonce');
		expect(html).toContain('role="alert"');
		expect(html).toContain('Line 2: &lt;bad&gt; &amp; unsafe');
		expect(html).not.toContain('id="source"');
	});

	it.each([
		['tags: [writing, "#product/design", "<script>alert(1)</script>"]', [
			{ label: 'writing', valid: true }, { label: 'product/design', valid: true }, { label: '<script>alert(1)</script>', valid: false },
		]],
		['tags: "#writing"', [{ label: 'writing', valid: true }]],
		['tags: " #writing "', [{ label: 'writing', valid: true }]],
		['tags: []', []],
		['tags: null', []],
		['tags: [false, {label: draft}]', [{ label: 'false', valid: false }, { label: '{"label":"draft"}', valid: false }]],
		['tags: [writing, 42, null]', [{ label: 'writing', valid: true }, { label: '42', valid: false }, { label: 'null', valid: false }]],
		['tags: [caffè, "日本語/記事", ai-native-publishing, independent-publishing, sphere, topic_2026]', [
			{ label: 'caffè', valid: true }, { label: '日本語/記事', valid: true },
			{ label: 'ai-native-publishing', valid: true }, { label: 'independent-publishing', valid: true },
			{ label: 'sphere', valid: true }, { label: 'topic_2026', valid: true },
		]],
		['tags: ["<img src=x onerror=alert(1)>", "two words", "##double", "123", "/topic", "topic/", "topic//child", ""]', [
			{ label: '<img src=x onerror=alert(1)>', valid: false }, { label: 'two words', valid: false },
			{ label: '##double', valid: false }, { label: '123', valid: false },
			{ label: '/topic', valid: false }, { label: 'topic/', valid: false },
			{ label: 'topic//child', valid: false }, { label: '', valid: false },
		]],
		['status: draft', []],
	])('validates tags without hiding invalid metadata in either layout: %s', (properties, tags) => {
		const note = parseNote({
			uri: 'file:///vault/post.md', rootUri: 'file:///vault', relativePath: 'post.md', dirty: false,
			text: `---\n${properties}\n---\n`,
		});
		const originalProperties = JSON.stringify(note.properties);
		const html = renderBasePage({
			title: 'Notes.base', result: parseBase('views:\n  - type: table\n  - type: kanban'),
			notes: [note], reminders: [],
		}, 'nonce');
		const serialized = html.match(/const data = (.*);\n/)![1];
		const data = JSON.parse(serialized);
		for (const view of data.views) {
			expect(view.rows[0].tags).toEqual(tags);
		}
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(JSON.stringify(note.properties)).toEqual(originalProperties);
	});

	it('projects every array item as a generic pill without changing scalar cells or raw metadata', () => {
		const note = parseNote({
			uri: 'file:///vault/post.md', rootUri: 'file:///vault', relativePath: 'post.md', dirty: false,
			text: '---\ntitle_options: ["A Substack With No Substack", "The Newsletter, Distributed", "<img src=x onerror=alert(1)>"]\nvalues: [0, false, null, "", [one, two], {label: draft}]\nempty: []\nstatus: draft\ntags: [writing]\n---\n',
		});
		const originalProperties = JSON.stringify(note.properties);
		const html = renderBasePage({
			title: 'Notes.base', result: parseBase('views:\n  - type: table\n  - type: kanban'),
			notes: [note], reminders: [],
		}, 'nonce');
		const data = JSON.parse(html.match(/const data = (.*);\n/)![1]);
		for (const view of data.views) {
			const row = view.rows[0];
			expect(row.lists).toEqual({
				'note.title_options': ['A Substack With No Substack', 'The Newsletter, Distributed', '<img src=x onerror=alert(1)>'],
				'note.values': ['0', 'false', 'null', '""', '["one","two"]', '{"label":"draft"}'],
				'note.empty': [],
			});
			const titleIndex = view.columns.findIndex((column: { key: string }) => column.key === 'note.title_options');
			expect(row.cells[titleIndex]).toEqual(JSON.stringify(note.properties.title_options));
		}
		expect(html).not.toContain('<img src=x');
		expect(JSON.stringify(note.properties)).toEqual(originalProperties);
	});
});
