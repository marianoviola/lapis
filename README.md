# Lapis

A personal VS Code extension for lightweight knowledge workspaces built from
ordinary Markdown files and YAML frontmatter. VS Code remains the editor,
filesystem browser, search environment, and Markdown preview.

Lapis defines its own workflows and documented view syntax. Notes remain plain
Markdown with YAML properties; using them does not require Obsidian or another
note application. Data portability is a design goal, not a promise of feature
or file-format parity with other tools. See [Portability and compatibility](docs/compatibility.md)
for the current boundaries and criteria for future integrations.

## Vaults

A vault is a directory containing a `.lapis` marker file. Lapis indexes
Markdown files only inside vaults; a marker may be in a workspace folder, a
descendant, or an ancestor of a workspace folder. The extension checks ancestor
directories as well as markers beneath each workspace folder.

Workspace folders inside the same vault share one link-resolution namespace.
The highest (outermost) discovered marker defines that vault root. Separate
vaults have isolated namespaces, including when they are open in the same
multi-root workspace. Creating or removing a marker updates the index.

## Milestone 1: Index And Note Navigation

Implemented:

- **Lapis: Open Note** opens a native Quick Pick searchable by title, path, and
	selected properties. Selecting a note opens the native Markdown editor.
- A shared in-memory index tracks Markdown files, typed frontmatter, headings,
	body wikilinks, file timestamps, and unsaved editor changes.
- File creation, modification, deletion, and native renames update the index.
	Pending reads cannot overwrite newer changes or resurrect deleted records.
- Invalid frontmatter appears in the Problems panel. Notes remain navigable.
- **Lapis: Rebuild Index** provides explicit recovery after missed
	filesystem events. The **Lapis** Output channel reports discovery and
	read failures.
- The data layer supports root-scoped link resolution and cached backlinks.
	Backlinks are not exposed as a sidebar yet.
- Wikilinks support **Cmd/Ctrl+click** and **F12** in the Markdown source editor,
	including heading destinations and unsaved buffers. Ambiguous links show a
	hover listing candidates instead of guessing a destination.
- **Lapis: Insert Wikilink** opens a dedicated note picker, then offers headings
	and an optional alias. Selected text is proposed as the alias; existing aliases
	are editable. Empty alias means no alias; Esc at any step makes no edit.
	Targets use the shortest uniquely resolving reference within the same vault,
	including unsaved headings. Aliases inside tables use `\|`. Code and metadata
	are excluded. Only the active buffer is edited, with one undo step; no note is
	created or saved.
- Editor completion is optional and **off by default**, so Lapis does not compete
	with VS Code or Copilot suggestions. Enable `lapis.wikilinkCompletion` to use
	`[[`, `#` and **Ctrl+Space** completion. It preserves existing aliases/closing
	brackets and uses the same index and resolver as the dedicated command.
- Wikilinks in the source editor use theme-aware colours: resolved targets use
	the link colour, missing notes use the warning colour with a dotted underline,
	and ambiguous targets use the info colour with a dashed underline. The entire
	wikilink, including its alias, is coloured; surrounding text is unchanged.
	Colours update when notes change, appear or disappear, including unsaved edits.
	Code, metadata and notes outside vaults are not decorated. Non-Markdown embeds
	are not marked as missing while attachment resolution remains undefined.
	A resolved note with a missing heading still uses the link colour, matching
	navigation's fallback to the top of the note.
- Blockquote prose in the source editor uses the active theme's normal text
	colour instead of the quote syntax colour. Quote markers, code, links and
	wikilinks retain their own colours; bold and italic formatting is unchanged.
	This also applies outside vaults and updates as you type, without editing
	the document or changing VS Code settings.
- The native Markdown preview hides a closed YAML frontmatter preamble, even
	when the YAML is invalid. Metadata stays editable in the source and available
	in the index; diagnostics are unchanged. An unclosed preamble remains visible.
- Inline code in the native preview uses 90% of the surrounding font size.
	Code blocks and source-editor font settings are unchanged.
- Ordinary blockquotes in the preview use a slim
	link-coloured bar, a subtle tinted background and compact spacing. Text keeps
	the surrounding colour; high-contrast themes omit the tint. Nested quotes,
	lists and code retain their Markdown structure. This does not add callout syntax.
	The accent follows the active VS Code theme's link colour, not a fixed blue;
	no separate Lapis accent setting is currently provided.
- GFM task-list markers (`- [ ]`, `- [x]` and `- [X]`) render as read-only
	checkboxes, including nested and ordered lists. Change their state in the
	Markdown source; code examples and escaped markers remain ordinary text.
	Checked boxes use the theme's link colour as their background.
- Highlights (`==important text==`) and footnotes (`[^1]` with a
	`[^1]: Footnote text` definition) render in any native Markdown preview,
	including notes outside vaults. Inline footnotes (`^[Footnote text]`) are
	also supported. Highlights use theme colours; code and escaped syntax are
	left alone. Repeated references have distinct backlinks.
	Lapis reuses highlight and footnote support already registered on the
	Markdown parser, preserving existing footnote renderers. Extensions that
	register plugins afterward or use different conventions are not covered
	by this compatibility check.
- Preview wikilinks resolve through the same vault index, including heading
	anchors and unsaved target headings. Missing links have a dotted underline;
	ambiguous links have a dashed underline and list candidates in their tooltip.
	Colours follow the VS Code theme. Target changes refresh open previews.

Lapis never automatically rewrites or saves notes. Explicit authoring commands
edit the active buffer only. There is no database, hidden vault metadata, graph
view, or application-specific note container. Optional `.base` files are
plain-text view definitions using the [documented Lapis syntax](docs/bases.md).

## Content Authoring

Commands are the primary authoring interface for Lapis: tables and wikilinks now,
and callouts in a future slice. Completion is an optional aid, not the main
workflow. Changes are explicit, undoable and never automatically saved.

### `.base` Views

In Lapis, a Base is a saved view over note properties, not a separate database.
Create a YAML `.base` file inside a vault to define read-only table and Kanban
views over its Markdown notes. Run **Lapis: Open Base Preview** from the Command
Palette or use the file's editor-title preview button or Explorer context menu.
Switch between Source and Preview using VS Code's editor-title toolbar in the
same editor group. The preview includes
view tabs, search, layout/grouping toggles and property visibility controls.
Use a note's bell to schedule a persistent date reminder through VS Code
notifications, or **Lapis: Manage Note Reminders** to open or cancel alerts.
Reminders survive restarts in the same workspace; overdue alerts appear on the
next launch, not while VS Code is closed. See
[Creating `.base` views](docs/bases.md) for the supported YAML syntax, filters,
ordering, grouping, reminders, and examples.

### Markdown Tables

Place a single cursor inside an existing table and use the Command Palette,
**Ctrl+.**, or the **Lapis: Table** editor context submenu:

- **Format Table** and **Align Column Left/Center/Right**.
- **Insert Table Row Above/Below** and **Delete Table Row**.
- **Insert Table Column Left/Right** and **Delete Table Column**.

These commands work in any Markdown buffer, including untitled documents and
notes outside vaults. They change only the target table, preserve its container
prefixes and line endings, keep the cursor in a logical cell, and use one undo
step. Formatting is idempotent and pads to the widest cell without a width cap
or content truncation; CJK and emoji display widths are considered.

Row insertion leaves existing rows unchanged and adds a compact row such as
`|  |  |`, with the cursor in its first cell. Tab moves to the next cell and
Shift+Tab returns to the previous one using native snippet navigation; the last
Tab exits after the row. Use **Format Table** when ready to align the padding.

Column insertion also adds compact empty cells without changing existing cell
content or padding. The cursor starts in the new header cell; Tab proceeds down
the new column, skipping the separator, and Shift+Tab goes back. The last Tab
exits at the end of the last editable row. Missing cells in ragged tables are
completed so the new column has the same position throughout the table.

Escaped pipes and pipes inside code spans are preserved. Native GFM previews
still require escaped pipes inside code spans to render those cells correctly.
Code fences and frontmatter are excluded. The header/separator and last column
cannot be deleted. Lapis registers no document formatter and performs no
format-on-save. Creating a new table is a separate, not-yet-implemented command
(#15).

## Try It

Requires Node.js 24 and VS Code 1.140.0 or newer. pnpm is the selected package
manager; these commands also work without a global pnpm installation:

```sh
npx --yes pnpm@10 install
npx --yes pnpm@10 run compile
```

Press **F5** in this project to launch **Run Lapis** in an Extension
Development Host. Open a folder containing or inside a `.lapis` vault in that
window, then run **Lapis: Open Note** from the Command Palette. F5's build
task uses pnpm through npx.

The index is read-only and can operate in Restricted Mode. Desktop/local
workspaces are the currently verified target. Virtual workspaces are not
supported; remote behavior has not been certified.

## Index Rules

- Files must have a `.md` extension, including mixed-case extensions.
- Files are UTF-8; notes larger than 2 MiB are skipped and logged.
- YAML 1.2 preserves ordinary date values as strings, rather than implicitly
	converting them into JavaScript dates. Derived date semantics come later.
- Frontmatter must be a mapping with unique string keys. Unsupported tags,
	aliases, and non-finite numeric values produce diagnostics.
- `title` in frontmatter supplies the navigation title; otherwise the filename
	without `.md` is used. File identity is its URI, not its display title.
- Editor buffers take precedence over disk content. Event updates are debounced
	by 100 ms. Nothing is automatically saved.
- `lapis.excludedFolders` lists directory names excluded at any depth.
	Defaults: `.git`, `node_modules`, `dist`, `out`, and `.vscode-test`. Entries
	in this setting and enabled `files.exclude` patterns are both respected.
	Recursive watcher events may also be suppressed by `files.watcherExclude`;
	rebuild to recover.

The index recognizes `[[Note]]`, `[[Note|Label]]`, `[[Note#Heading]]`, and
`![[Note]]` in Markdown body text, excluding fenced/indented code, inline code,
and escaped syntax. Escaped alias separators (`[[Note\|Label]]`) are supported
inside Markdown tables and ordinary body text. Heading line numbers are
zero-based.

Heading references match the heading text exactly; a missing heading opens the
top of the target note. Editor link ranges include aliases and embed syntax.
Preview links use native Markdown navigation and respect
`markdown.preview.openMarkdownLinks`. Outside indexed vaults, wikilinks remain
ordinary Markdown text. Embeds remain raw text in the preview and do not yet
render target contents.

Resolution checks explicit relative paths, then local/root-relative candidates,
then a unique basename within the source vault. `/Note` is explicitly
vault-root-relative. Names are case-sensitive, ambiguous matches are not
guessed, and an empty target with a heading refers to the current note. Current
rename handling updates index identity only; it does not rewrite inbound links.

## Checks

```sh
npx --yes pnpm@10 test
npx --yes pnpm@10 run compile
npx --yes pnpm@10 run test:integration
npx --yes pnpm@10 run package
```

Unit tests cover parsing, link resolution, backlinks, and index races.
Editor-decoration tests cover resolver states, source-version guards, visible
editors, target lifecycle updates, code exclusions and disposal.
Integration tests launch a separate Extension Host against a temporary vault;
they cover marker discovery and lifecycle, multi-root namespace sharing and
isolation, index exclusions, native wikilink navigation, preview metadata
hiding, heading IDs, encoded preview URLs, target lifecycle changes and native
completion ranges/unsaved headings. Completion unit tests include a 10,000-note
fixture with a measured generation threshold of 50 ms.
Actual webview clicks and theme appearance also need a manual F5 check.
The runner removes its fixture on exit and
uses an isolated VS Code profile.
By default it downloads VS Code 1.140.0. To use an existing installation:

```sh
VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' \
	npx --yes pnpm@10 run test:integration
```

`package` builds the production bundle; it does not publish an extension or
create a VSIX. No telemetry or network service is used by Lapis at
runtime.

## Next Slices

See [the architecture and implementation sequence](docs/architecture.md).
Next are backlinks UI and practical rename safety, frontmatter mutations,
editable Bases/Kanban, Timeline, and bounded note embedding.

## Install In An Existing VS Code Window

If you previously installed the Lapislazuli VSIX, uninstall that extension
before installing Lapis to avoid running both copies. The extension identifier
has changed: commands now use `lapis.*`, and the folder exclusion setting is
`lapis.excludedFolders`. Move any customized value from
`lapislazuli.excludedFolders` to the new setting and update custom keybindings
that reference the old commands. No automatic settings migration is performed.
Vault markers remain `.lapis`; notes and vault directories need no changes.

Create a local VSIX (the prepublish step builds and checks the extension):

```sh
npx --yes @vscode/vsce package --no-dependencies --skip-license
```

Dependencies are bundled in `dist/extension.js`. `--skip-license` permits
local packaging while the project has no license file; it does not grant a
license. In VS Code, use Extensions → … → Install from VSIX and select
`lapis-0.1.0.vsix`. Reload the window if prompted. Rebuild and reinstall
the VSIX after source changes.
