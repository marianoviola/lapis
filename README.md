# Lapis

A personal VS Code extension for lightweight knowledge workspaces built from
ordinary Markdown files and YAML frontmatter. VS Code remains the editor,
filesystem browser, search environment, and Markdown preview.

## Milestone 1: Index And Note Navigation

Implemented:

- **Lapis: Open Note** opens a native Quick Pick searchable by title, path, and
	selected properties. It opens immediately and updates while indexing continues.
	Selecting a note opens the native Markdown editor.
- A shared in-memory index tracks Markdown files, typed frontmatter, headings,
	body wikilinks, file timestamps, and unsaved editor changes.
- File creation, modification, deletion, and native renames update the index.
	Pending reads cannot overwrite newer changes or resurrect deleted records.
- Invalid frontmatter appears in the Problems panel. Notes remain navigable.
- **Lapis: Rebuild Index** provides explicit recovery after missed filesystem
	events. The **Lapis** Output channel reports discovery and read failures.
- The data layer supports root-scoped link resolution and cached backlinks.
	Neither is exposed as preview rendering or a backlinks sidebar yet.

Lapis does not write or reformat your notes in this milestone. There is no
database, hidden vault metadata, graph view, or proprietary note format.

## Try It

Requires Node.js 24 and VS Code 1.140.0 or newer. pnpm is the selected package
manager; these commands also work without a global pnpm installation:

```sh
npx --yes pnpm@10 install
npx --yes pnpm@10 run compile
```

Press **F5** in this project to launch **Run Lapis** in an Extension Development
Host. Open your Markdown folder in that window, then run **Lapis: Open Note**
from the Command Palette. F5's build task uses pnpm through npx.

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
- `lapis.excludedFolders` lists directory names excluded at any depth. Defaults:
	`.git`, `node_modules`, `dist`, `out`, and `.vscode-test`. These exclusions are
	independent of VS Code's Explorer and search exclusions. Recursive watcher
	events may also be suppressed by `files.watcherExclude`; rebuild to recover.

The index recognizes `[[Note]]`, `[[Note|Label]]`, `[[Note#Heading]]`, and
`![[Note]]` in Markdown body text, excluding fenced/indented code, inline code,
and escaped syntax. Escaped alias separators (`[[Note\|Label]]`) are supported
inside Markdown tables and ordinary body text. Heading line numbers are zero-based.

Resolution checks explicit relative paths, then local/root-relative candidates,
then a unique basename within the source workspace root. `/Note` is explicitly
root-relative. Names are case-sensitive, ambiguous matches are not guessed,
and an empty target with a heading refers to the current note. Current rename
handling updates index identity only; it does not rewrite inbound links.

## Checks

```sh
npx --yes pnpm@10 test
npx --yes pnpm@10 run compile
npx --yes pnpm@10 run test:integration
npx --yes pnpm@10 run package
```

Unit tests cover parsing, link resolution, backlinks, and index races.
Integration tests launch a separate Extension Host against a temporary vault;
the runner removes that vault on exit and uses an isolated VS Code profile.
By default it downloads VS Code 1.140.0. To use an existing installation:

```sh
VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' \
	npx --yes pnpm@10 run test:integration
```

`package` builds the production bundle; it does not publish an extension or
create a VSIX. No telemetry or network service is used by Lapis at runtime.

## Next Slices

See [the architecture and implementation sequence](docs/architecture.md).
Next is native Markdown preview wikilinks and editor completion/definitions,
followed by backlinks UI and practical rename safety, frontmatter mutations,
Bases/Table, Kanban, Timeline, reminders, and bounded note embedding.
