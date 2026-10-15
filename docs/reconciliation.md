# Lapislaz — Architecture & Product Reconciliation

Repository: `lapis` at the initial commit (single commit, ~1,150 lines of TypeScript including tests).
Date: 2026-10-15. Target engine: VS Code `^1.140.0` (`package.json:8`).

Tracking: GitHub milestones **1–9** (one per roadmap phase) and issues **#1–#23**. The open decisions
are tracked in **#24**.

**Evidence levels used below**

- **Observed**: read directly in this repository.
- **Verified upstream**: checked against the VS Code `1.140.0` tag on GitHub
  (`extensions/markdown-language-features/package.json`, `src/markdownEngine.ts`,
  `src/vs/workbench/api/browser/viewsExtensionPoint.ts`) or against npm registry metadata.
- **Assumption**: from prior knowledge of VS Code or Obsidian behaviour. Not verified, so each one
  is listed as an investigation item.

The tests were **not executed** during this review: dependencies were not installed. Every
behavioural claim about the code comes from reading it.

---

## A. Current State

The project is a clean, deliberately small "milestone 1". It has a read-only in-memory note
index and one navigation command. No document is ever written or reformatted.

### Composition and activation

| Aspect | Implementation |
| --- | --- |
| Activation | `onLanguage:markdown`, `workspaceContains:**/*.md` (`package.json:13`). The second event activates Lapis in almost every repository and triggers a full Markdown scan at startup. |
| Entry point | `activate()` in `src/extension.ts:16`. It creates a `LogOutputChannel`, a `WorkspaceIndex`, and two commands, and returns a public `LapisApi` (used by the integration tests). |
| Commands | `lapis.openNote` (`src/navigation/openNote.ts`) and `lapis.rebuildIndex` (`src/extension.ts:22`). |
| Configuration | One VS Code setting: `lapis.excludedFolders` (resource scope, `package.json:36`). **There is no `.lapis` support anywhere.** |
| UI contributions | Commands only. No views, view containers, menus, keybindings or Markdown preview contributions. |
| Capabilities | Untrusted workspaces supported. Virtual workspaces not supported. `extensionKind: workspace`. |
| Runtime deps | `markdown-it@14`, `yaml@2`. Bundled with esbuild into `dist/extension.js`. |

### Modules

| File | Responsibility | Notes |
| --- | --- | --- |
| `src/domain/note.ts` | Frozen record types: `NoteSource`, `NoteRecord`, `NoteLink`, `Heading`, `NoteIssue`. | `NoteLink` has **no source position**. `Heading` has a line number only. |
| `src/metadata/frontmatter.ts` | `readFrontmatter()` parses YAML 1.2 strictly: unique string keys, no YAML anchors or aliases, dates kept as strings, null-prototype frozen objects. | Robust. Built with Bases-style typed properties in mind. |
| `src/markdown/wikilinks.ts` | `wikilinks()` is a markdown-it inline rule that tokenizes `[[t]]`, `[[t\|label]]`, `[[t#h]]` and `![[t]]` into `lapis_wikilink` tokens. | The renderer outputs the **escaped raw text** (`:32`), not a link. The rule can be reused by the preview. |
| `src/index/parseNote.ts` | `parseNote()` runs markdown-it **`commonmark` preset** + wikilinks over the body and collects headings and links. | Code spans, fenced and indented code are excluded naturally. One full markdown-it parse per note. |
| `src/index/noteIndex.ts` | `NoteIndex` is pure (no `vscode` import). Records keyed by URI string, path and basename maps keyed by `[rootUri, path]`, per-URI generation tokens against stale async reads, `resolve()`, lazy `getBacklinks()`. | Well designed and well tested. Root equals the workspace folder. |
| `src/index/workspaceIndex.ts` | `WorkspaceIndex` is the VS Code adapter: `findFiles` discovery per workspace folder, eight concurrent reads, 100 ms debounce, open-buffer overlay, a `**/*` watcher per folder, native create/delete/rename events, frontmatter diagnostics. | `scope()` (`:150`) is the single point that decides membership and root. |
| `src/navigation/openNote.ts` | Quick Pick over the index (title, path, `type`/`status`/`project` properties). | Waits for the full index before it shows anything (`:13`). |

### Behaviour worth preserving (observed)

- Stale-read protection: `NoteIndex.refresh` compares generations (`noteIndex.ts:44-72`), covered by tests.
- Editor buffers take precedence over disk (`workspaceIndex.ts:181-182`). Nothing is auto-saved.
- Ambiguity is never guessed. `resolve()` returns `ambiguous` with its candidates (`noteIndex.ts:116-152`).
- Rename tracking updates identity only. Link text is never rewritten (`workspaceIndex.ts:36-47`, test `extension.test.ts:120`).
- No persistent database, no background process, no network, no telemetry.

### Resolution algorithm (observed, `noteIndex.ts:116-152`)

1. An empty target with a `#heading` resolves to the current note.
2. `/x` resolves root-relative. `./x` and `../x` resolve relative to the source directory.
3. A bare target is tried relative to the source directory, then root-relative.
4. If the target contains `/`, resolution stops here. Otherwise it falls back to a **unique
   basename within the same root**.
5. Matching is **case-sensitive** (asserted by `tests/noteIndex.test.ts:70`).
6. Only `.md` files are known. There is no attachment resolution.

### Tests (observed)

- `tests/parseNote.test.ts` (8 tests) and `tests/noteIndex.test.ts` (14 tests) run in Vitest
  against the pure modules.
- `src/test/extension.test.ts` has 6 Extension Host tests: discovery, commands, Quick Pick,
  lifecycle, diagnostics, rename.
- The fixture vault in `.vscode-test.mjs` has **no `.lapis` file**, so these tests must change once
  vault gating ships.
- `tsconfig.json:20` includes `src/**` only, and `eslint src` lints `src` only. As a result,
  `tests/*.ts` is neither type-checked nor linted by `compile`.

### Performance characteristics (observed, unmeasured)

- Startup: `findFiles` per workspace folder, then reads and markdown-it parses of every `.md`
  file outside the excluded folder names. Eight reads run in parallel, and files over 2 MiB are
  skipped.
- Memory: records drop the source text and keep properties, headings and link targets only. That
  is reasonable.
- Changes: per-file debounced refresh. Each change invalidates the whole backlink cache, which is
  rebuilt lazily in O(total links) map lookups on the next `getBacklinks` call.
- No benchmark exists. With vault gating, cost becomes proportional to vault content rather than
  to the repository.

### Divergence from the new product vision

`docs/architecture.md:30-83` and `README.md:93-98` plan the following:

- Frontmatter mutations.
- **Bases/Table, Kanban and Timeline in a React custom text editor**.
- Reminders, embeds, TanStack Table and drag-and-drop.

The Lapislaz brief does not mention any of these. Its principles also contradict them: "avoid
custom webviews", "no new frameworks", "not another Obsidian". This is the largest reconciliation
item, and it is raised as decision H4.

---

## B. Capability Matrix

Legend:

- **I**: implemented
- **P**: partially implemented
- **M**: missing
- **X**: incompatible with the current architecture
- **?**: requires investigation
- **Native**: already provided by VS Code, so Lapislaz should add nothing

### Vaults and configuration

| Capability | Status | Evidence / note |
| --- | --- | --- |
| `.lapis` vault discovery | **M** | No code references `.lapis`. |
| Root vault and sub-vault hierarchy | **M** | — |
| Independent vaults with separate namespaces | **P** | Namespaces are separated by **workspace folder** (`noteIndex.ts:181` key = `[rootUri, path]`), not by vault. |
| Multi-root correctness | **P** | Works per folder. Nested workspace folders split one directory tree into several namespaces. |
| Config file parsing and inheritance | **M** | Only `lapis.excludedFolders` exists. |
| No Lapislaz frontmatter requirement | **I** | No `lapis: true` or similar. |

### Global Markdown enhancements

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Insert table command | **M** | — |
| Row and column insert/delete | **M** | — |
| Format and align table | **M** | — |
| Callout rendering | **M** | Not in the 1.140 built-in engine plugin list (`markdownEngine.ts:133-157`). |
| `==highlight==` | **M** | — |
| Footnotes | **M** | Not built in. |
| Standard tables in preview | **Native** | The built-in engine uses the markdown-it `default` preset (GFM tables). |
| Heading anchors in preview | **Native** | `#addNamedHeaders`, `markdownEngine.ts:307-313`. |
| Same-group source/preview switching | **Native (verified upstream)** | Since 1.120, `markdown.togglePreview` is bound to Cmd/Ctrl+Shift+V. `markdown.reopenAsPreview` and `markdown.reopenAsSource` are also available, through the `vscode.markdown.preview.editor` custom editor. **Lapislaz should add nothing here.** |

### Wikilinks

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Syntax: target, `\|alias`, `#heading`, embed | **I** | `wikilinks.ts`. **Bug:** `[[a\|b]]` (Obsidian's escaped pipe for tables) yields target `a\` (`wikilinks.ts:13-14`), tracked in #1. |
| Exclusion of code and escaped syntax | **I** | Test `parseNote.test.ts:16`. |
| Resolution | **P** | Scoped to the workspace folder, case-sensitive, Markdown files only. Obsidian compatibility is **?** (see H5). |
| Ambiguity detection | **I** | `Resolution.kind === 'ambiguous'`. |
| Autocomplete | **M** | — |
| Navigation (Ctrl+click, F12) | **M** | — |
| Hover | **M** | — |
| Backlinks data | **P** | `getBacklinks()` returns source notes only, with no occurrences or excerpts. |
| Unresolved and ambiguous diagnostics | **M** | The `DiagnosticCollection` already exists for frontmatter (`workspaceIndex.ts:14`). |
| File rename and move propagation | **M** | Deliberately absent. Identity tracking is implemented. |
| Heading-rename propagation | **?** | May collide with the built-in Markdown heading `RenameProvider` (assumption). |
| Standard relative links across vaults | **Native** | The built-in language server handles them, including `markdown.validate.*` and `markdown.updateLinksOnFileMove.*`. |

### Indexing

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Incremental in-memory index | **I** | `NoteIndex` + `WorkspaceIndex`. |
| Unsaved editor changes | **I** | Overlay plus `dirty`/`documentVersion`. |
| Create, delete, rename, folder delete | **I** | Tests `noteIndex.test.ts:42-59`, `extension.test.ts:91-131`. |
| Exclusion rules | **P** | Its own setting. The explicit `exclude` passed to `findFiles` (`workspaceIndex.ts:85`) **disables `files.exclude`**, per the API contract. |
| Large repositories | **P** | Indexes all Markdown in the workspace, not only vault content. Activates on any `.md`. |
| Symlinks and duplicate paths | **?** | `findFiles` follows symlinks according to user settings, so one file under two URIs would become an ambiguous basename. |
| No persistent DB or full-text search | **I** | Respected. |

### Preview

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Wikilinks rendered as links | **P** | The tokenizer exists. `extendMarkdownIt` and `markdown.markdownItPlugins` are missing, and the renderer outputs plain text. |
| Read-only | **Native** | — |
| Built-in rich "Markdown Editor" (`vscode.markdown.editor`, new in 1.140) | **?** | It uses `@vscode/markdown-editor`, not the preview engine, so markdown-it plugins probably do not apply there (see H12). |

### Native UI

| Capability | Status | Evidence / note |
| --- | --- | --- |
| Activity Bar container | **M** | — |
| Vault Explorer | **M** | — |
| Table of Contents | **M** | The built-in Outline view already shows Markdown headings (see H10). |
| Backlinks view | **M** | — |
| Secondary sidebar default location | **M** | **Verified upstream:** `viewsContainers.secondarySidebar` is accepted and not gated in 1.140 (`viewsExtensionPoint.ts:74`, `:323`). The public docs still list only `activitybar`/`panel`. |
| Open Note Quick Pick | **I** | Extra capability: searches by frontmatter title, which Ctrl+P does not. |

### Planned in the repository's own documents

| Capability | Status | Evidence / note |
| --- | --- | --- |
| React custom editor (Bases, Kanban, Timeline), reminders | **X** | Planned only (`docs/architecture.md:42-50`). It contradicts the "no custom webviews / no frameworks" principles. |

---

## C. Architecture Gaps

### G1. The namespace is the workspace folder, not the vault (blocking)

- **Where:** `WorkspaceIndex.scope()` (`workspaceIndex.ts:150-159`) sets
  `rootUri = getWorkspaceFolder(uri)`. `NoteIndex` keys every lookup by that root.
- **Impact:** vault semantics, independent vaults, cross-folder vaults in multi-root workspaces,
  and "highest `.lapis` wins" all depend on this.
- **Alternative (small):** keep `NoteIndex` unchanged. Its root parameter is already opaque. Make
  `scope()` return the **root vault directory** and a vault-relative path. The change is confined
  to the adapter plus a new vault registry. Nested workspace folders then stop splitting
  namespaces, because vault identity is directory-based.

### G2. Link occurrences have no source positions (blocking for most editor features)

- **Where:** `NoteLink` (`domain/note.ts:7-12`) stores only target, heading, label and embed.
  markdown-it inline tokens carry no positions; only block tokens have `map` line ranges.
- **Impact:** blocks diagnostics, `DocumentLink`s, rename edits, backlink excerpts, and code
  actions.
- **Alternative:**
  - In `parseNote`, for each inline-bearing block, scan that block's source lines (from
    `token.map`) for the wikilinks markdown-it found, in order.
  - Record `{ line, start, end }` plus sub-ranges for target, heading and label.
  - The existing code-span exclusion stays authoritative.
  - **Rejected:** a separate regex-only scanner, because it would duplicate the code-exclusion
    logic that markdown-it already provides.

### G3. The resolver knows only Markdown notes

- **Impact:** `![[diagram.png]]` and `[[spec.pdf]]` are normal in Obsidian vaults. Unresolved-link
  diagnostics would flag them falsely.
- **Alternative:**
  - Either track non-Markdown file *paths* in the index (paths only, no reads; cheap), or resolve
    them lazily with `workspace.fs.stat`.
  - Until this is decided, diagnostics must treat targets with a non-`.md` extension as
    "not checked".

### G4. Activation and indexing are unconditional

- **Where:** `workspaceContains:**/*.md` (`package.json:13`) plus a full scan in the
  `WorkspaceIndex` constructor.
- **Impact:** this contradicts "lightweight, including on constrained machines" for repositories
  that have Markdown but no vault.
- **Alternative:**
  - Activate on `onLanguage:markdown` and `workspaceContains:**/.lapis`.
  - Contributing `markdown.markdownItPlugins` lets the built-in preview activate Lapislaz on
    demand.
  - Start the note scan only when the vault registry is non-empty.

### G5. Exclusion semantics are bespoke

- **Where:** passing an exclude string to `findFiles` disables the default `files.exclude`.
  `lapis.excludedFolders` is a second mechanism.
- **Alternative:** honour `files.exclude` by default. Keep a vault-level `index.exclude` only if it
  proves necessary (see H17).

### G6. Backlinks are note-level, and the cache is all-or-nothing

- **Impact:**
  - Excerpts need occurrences (see G2).
  - The cache rebuild per change burst is acceptable at current scale, but the Backlinks view must
    debounce its refresh.
- **Alternative:** have `getBacklinks()` return `{ source, link }[]`. Defer targeted edge
  maintenance until a benchmark shows a need. `docs/architecture.md:21-23` already plans this.

### G7. Rename planning needs a before/after simulation

- **Impact:** a rename can:
  - change a basename (links must be rewritten);
  - leave a basename unchanged (no edit is needed if it is still unique);
  - make *other* links ambiguous through a new collision;
  - break relative links *from* the moved notes.
- **Alternative:** because `NoteIndex` is pure, add a pure `planRename(moves)` that evaluates
  resolutions against the hypothetical post-move identity maps. The VS Code adapter then turns the
  plan into a `WorkspaceEdit` returned from `onWillRenameFiles` → `waitUntil`.

### G8. Heading renames versus the built-in rename provider (assumption)

- **Assumption:** VS Code's rename uses a single provider's edits and does not merge edits from
  several providers. The built-in Markdown language server already renames headings and their
  `#slug` links.
- **Impact:** a Lapislaz heading `RenameProvider` would either shadow the built-in one or never
  run.
- **Alternative:** see #14 and H9.

### G9. Index parser preset differs from the preview engine

- **Where:** the index uses `commonmark` (`parseNote.ts:6`). The preview uses `default`, plus
  plugins.
- **Impact:** small differences in which constructs exist, for example tables and, later,
  footnote definitions.
- **Alternative:** accept this and document it. The wikilink rule must handle `\|` identically in
  both.

### G10. The roadmap targets a different product (see H4)

- **Impact:** the typed-property normalization, `ctime`/`mtime`, and the hard-coded
  `type`/`status`/`project` Quick Pick fields exist for Bases/Timeline.
- **Alternative:** keep them, because they are cheap and tested, but stop extending them until H4
  is decided.

### G11. Identity naming

- **Where:** package `name: "lapis"`, `displayName: "Lapis"`, versus the product name "Lapislaz".
- **Impact:** changing `name` changes the extension's identity (see H14).

---

## D. Reuse Opportunities

### Built into VS Code 1.140 (do not rebuild)

| Need | Reuse | Status |
| --- | --- | --- |
| Source/preview toggle in the same group | `markdown.togglePreview` (Cmd/Ctrl+Shift+V), `markdown.reopenAsPreview`, `markdown.reopenAsSource`. Users can set `"workbench.editorAssociations": {"*.md": "vscode.markdown.preview.editor"}` to open the preview by default. | Verified upstream |
| TOC | Outline view and `vscode.executeDocumentSymbolProvider`. | Native |
| Standard Markdown links | Path completion, `markdown.validate.*`, `markdown.updateLinksOnFileMove.enabled` (default `"never"`; document setting it to `"prompt"`), `markdown.findAllFileReferences`. | Verified upstream (settings list) |
| Heading ids in preview | Built-in slugifier (`markdownEngine.ts:307`). It is not exported, so wikilink `#heading` hrefs must mirror the GitHub-style algorithm (`slugify.ts`, small) or link by line. | Verified upstream (presence) |
| Preview extension points | `markdown.markdownItPlugins` plus an `extendMarkdownIt(md)` export, `markdown.previewStyles`. `env.currentDocument` exists in 1.140's `RenderEnv` (`markdownEngine.ts:89`, `:206`) but is undocumented, so isolate it behind one adapter. | Verified upstream |
| Search | VS Code Search. Nothing needed. | Native |

### VS Code APIs, by responsibility

| Responsibility | API |
| --- | --- |
| Ctrl+click on `[[x]]` | `DocumentLinkProvider`. The target can carry a `#L<line>` fragment for headings. |
| F12 / Peek | `DefinitionProvider` (cheap once ranges exist). |
| `[[` completion | `CompletionItemProvider` with trigger characters `[`, `#` and `\|`. Use `filterText` so titles and paths both match. |
| Hover preview | `HoverProvider` (optional, low cost). |
| Unresolved and ambiguous links | Existing `DiagnosticCollection`, plus `CodeActionProvider` (QuickFix: "Link to path…", "Create note"). |
| Backlinks | Expose them as a `ReferenceProvider` when the cursor is on the document's first heading or on a wikilink: Shift+F12 and the References view come free. Also feed a `TreeView`. |
| Rename and move propagation | `workspace.onWillRenameFiles` → `event.waitUntil(WorkspaceEdit)`. The edits become part of the same undoable operation. `WorkspaceEditEntryMetadata.needsConfirmation` can provide a native Refactor Preview in "prompt" mode, but whether that works inside will-rename participants is **?**. |
| Tables | Commands, a `CodeActionProvider` (`refactor.rewrite.*` kinds shown under the lightbulb and Ctrl+.), a `SnippetString` for insertion with tab stops, `setContext('lapis.inTable')` for menus and keybindings. **Avoid** registering a document formatter, because it competes with Prettier and Markdown All in One for "default formatter". |
| Views | `TreeDataProvider` with `resourceUri`, so file icons, git decorations and theme colours come free. Use `viewsContainers.activitybar` and `viewsContainers.secondarySidebar`. |
| Vault metadata display | `TreeItem.description`, `tooltip` and `iconPath: ThemeIcon(codicon)`. |

### Libraries (npm metadata checked 2026-10-15)

| Purpose | Candidate | Notes |
| --- | --- | --- |
| Footnotes | `markdown-it-footnote@4.0.0` | MIT, markdown-it org, no dependencies. |
| Highlight | `markdown-it-mark@4.0.0` | MIT, markdown-it org, no dependencies. |
| Callouts | `markdown-it-obsidian-callouts@0.3.5` | Apache-2.0, active (updated 2026-10-02). The alternative is about 60 lines of custom core rule over `blockquote_open`. Decide in a spike. |
| Table operations | `@susisu/mte-kernel@2.1.1` | MIT. Depends only on `meaw` (East Asian width). Last published in 2022, but the domain is stable. Provides insert/delete/move of rows and columns, format and align through an `ITextEditor` adapter, which matches the table requirements nearly one to one. |
| Table operations | `@tgrosinger/md-advanced-tables@3.11.0` | The fork used by Obsidian Advanced Tables. Adds `lodash`, `ebnf` and `decimal.js` (formulas), which is heavier than needed. |
| Table formatting only | `markdown-table@3.0.4` + `string-width@8.3.0` | Formatter only; parsing and operations would be custom. |
| Table detection | `markdown-it` (already present) | `default`-preset `table_open.map` gives exact line ranges and respects code fences. |

### Deletion and simplification candidates

- `vsc-extension-quickstart.md`: generator boilerplate.
- `.vscodeignore:9`: `.yarnrc` (pnpm project).
- `openNote.ts:24`: hard-coded `type`/`status`/`project` detail fields (a Bases leftover; see H4).
- `NoteRecord.ctime`/`mtime`: unused by any current or proposed vault feature (see H4).
- `docs/architecture.md`, "Planned Boundaries" and "Sequence": rewrite after H4.
- **Do not build:** the preview toggle, a TOC parser, standard-link rename updates, search, or a
  document formatter.

---

## E. Proposed Architecture

These are the smallest additions to the existing structure. One index, one vault registry, and
every provider reads from both. There is no new framework, webview, database or process.

```
src/
  domain/note.ts            + LinkRange on NoteLink; rootUri now means "root vault URI"
  vault/
    vaults.ts               NEW, pure: dirs-with-.lapis -> { root, chain } per path; config merge
    vaultService.ts         NEW, adapter: findFiles('**/.lapis'), watcher, read/parse, diagnostics
  index/
    parseNote.ts            + occurrence ranges (G2)
    noteIndex.ts            + backlink occurrences, + pure planRename() (G7)
    workspaceIndex.ts       scope() delegates membership/root to vaultService (G1)
  markdown/wikilinks.ts     \| fix; shared by index and preview
  language/                 NEW: links+definitions, completion, diagnostics+quick fixes, hover
  links/renameParticipant.ts NEW: onWillRenameFiles -> WorkspaceEdit
  preview/                  NEW: extendMarkdownIt (wikilinks, callouts, mark, footnote) + CSS
  tables/                   NEW: pure table model + commands + code actions (global)
  views/                    NEW: vault explorer, backlinks (TOC only if H10 says so)
  extension.ts              composition; returns LapisApi & { extendMarkdownIt }
```

```
.lapis files ──► VaultService ──► WorkspaceIndex.scope() ──► NoteIndex (pure)
                     │                                          │
                     ▼                                          ▼
               Vault Explorer          language/*, links/*, preview/*, Backlinks view
Markdown files ─────────────────────────► (tables/* needs neither: global)
```

### Vault semantics (deterministic, no inheritance engine)

- **Discovery:**
  - `findFiles(RelativePattern(folder, '**/.lapis'))` per workspace folder, honouring the same
    excludes as the index.
  - Merge the results into one set of vault directory URIs, deduplicated by URI string.
  - A watcher on `**/.lapis` triggers recomputation and a rebuild. `.lapis` changes are rare, so a
    full rebuild is acceptable.
- **Membership:** for a note, walk its ancestor directories (O(depth) set lookups).
  - `chain`: the `.lapis` directories found, nearest first.
  - `root`: the topmost one, which owns the wikilink namespace and the `relativePath`.
  - No ancestor `.lapis` means the note is outside any vault (see H1).
- **Independence:** vaults without a common ancestor `.lapis` have different roots and therefore
  separate namespaces. `NoteIndex` already enforces this
  (`tests/noteIndex.test.ts:73`).
- **Multi-root:** independent of workspace folders. Two folders inside one vault share its
  namespace. Whether `.lapis` above an opened folder counts is open (see H2).
- **Configuration:**
  - Parse the file (an empty file means `{}`). Report syntax errors as diagnostics on `.lapis`.
  - Effective config is a shallow merge from root to leaf. Identity keys (`name`, `description`,
    `icon`) are not inherited (proposal, see H18).
  - Ship no keys until a feature consumes them. First consumers: `links.unresolved` (diagnostics),
    `links.autoUpdate` (rename), then `name`/`description`/`icon` (Explorer).
- **Placement rule:** global features (tables, preview syntax) are configured, if at all, through
  VS Code settings. Vault features are configured through `.lapis`. Per-vault toggles for global
  rendering (`preview.callouts`, `preview.highlight`, `tables.formatOnSave`) would contradict
  "works in every Markdown document" (see H13).

### Rename rules (the contract for `planRename`)

1. Consider only links that resolve **uniquely** to a moved note before the move. Missing and
   ambiguous links are never touched.
2. After the move, if the original text still resolves to the same note, emit no edit. Example:
   a basename link to a note that moved folders but kept its name.
3. Otherwise, rewrite only the *target* sub-range to the shortest form that resolves uniquely
   after the move: basename, then vault path. Keep `#heading`, `|label`, `!` and the `.md` suffix
   style exactly as written.
4. Recompute relative targets inside moved notes against their new location.
5. If the move makes unrelated links newly ambiguous (a basename collision), either qualify them
   or refuse with a message. Policy in H8. Never silently retarget.
6. External renames (git, terminal) arrive as delete plus create. Edits are not possible there.
   Instead, they surface as unresolved-link diagnostics with quick fixes. Document this
   limitation.

### Preview

- `extendMarkdownIt(md)` registers four plugins:
  - the shared wikilink rule, with a resolver-backed renderer that reads `env.currentDocument`
    behind one adapter;
  - `markdown-it-mark`;
  - `markdown-it-footnote`;
  - callouts.
- **Resolved wikilinks:**
  - render as `<a href="<relative>.md#<slug>">`, so the built-in preview link handler opens them;
  - unresolved and ambiguous links render as styled `<span>` elements;
  - outside a vault, the raw text is kept.
- **Styling:** callout and wikilink CSS goes in `markdown.previewStyles`, using `--vscode-*`
  variables for theme compatibility.
- **Refresh:** debounce `markdown.preview.refresh` when index changes alter resolution. The
  architecture document already anticipates this.

### Tables (global; no vault or index dependency)

- **Logic:** a pure model (`tables/table.ts`) for detection, parsing (escaped `\|`, code spans),
  formatting and operations, backed by `mte-kernel` if the spike passes, or about 200 lines of
  custom code otherwise.
- **UI:**
  - commands in the Command Palette;
  - context-aware Code Actions (lightbulb) when the cursor is inside a table;
  - optional keybindings guarded by `lapis.inTable`.
- **Scope:** edits are limited to the table's line range. Cells are never wrapped; column width is
  the maximum display width (East Asian wide characters count as 2). The policy for very long
  cells is H16.
- **Not used:** no CodeLens (noise on every table) and no formatter registration.

### Views

- One Activity Bar container `lapislaz` holds the **Vault Explorer**.
- One `secondarySidebar` container holds **Backlinks** and, if H10 calls for it, the **TOC**.
  Users can move any of them natively.
- **Vault Explorer:**
  - roots are the root vaults, with sub-vaults marked;
  - children come from lazy `workspace.fs.readDirectory`, and items use `resourceUri` so theme
    file icons and git decorations apply;
  - commands: open, "Reveal in Explorer".
- **Backlinks:**
  - follows the active editor, and also the URI of the active `vscode.markdown.preview.editor`
    tab via `tabGroups` (`TabInputCustom.uri`), so it keeps working while the preview is shown;
  - groups occurrences by source note and shows a one-line excerpt;
  - lists unresolved and ambiguous references to the note in a separate collapsed group (H8
    affects wording).

---

## F. Implementation Roadmap

Each phase can ship on its own and leaves the extension coherent. Each phase is a GitHub
milestone.

**Order adjustments versus the brief:**

- **Link ranges (G2)** become an explicit enabler at the start of Phase 3, because diagnostics,
  navigation, backlinks excerpts and rename all need them.
- **Tables** have no code dependency on vaults or the index, and the brief calls them high
  priority. They can be developed in parallel or pulled forward right after Phase 1.
- The preview toggle has been **removed**: VS Code 1.140 already provides it.

| Milestone | Scope | Issues |
| --- | --- | --- |
| 1. Stabilization | `\|` fix, Quick Pick responsiveness, type-check and lint the tests, remove boilerplate, reconcile the docs after H4. | #1–#3 |
| 2. Vaults | Pure registry, discovery, index scoped to vaults, gated activation, `.lapis` parsing and diagnostics. | #4–#6 |
| 3. Wikilinks | Occurrence ranges, then links/definitions, completion, diagnostics with quick fixes (attachments handled). | #7–#10 |
| 4. Backlinks | Occurrence API plus `ReferenceProvider`, then the Backlinks view (in the secondary sidebar). | #11–#12 |
| 5. Rename & move | `planRename` plus the will-rename participant; heading-reference spike. | #13–#14 |
| 6. Tables | Insert, model and format, operations through commands and Code Actions. | #15–#17 |
| 7. Preview | Wikilinks, mark and footnotes, callouts. | #18–#20 |
| 8. Navigation views | Container plus Vault Explorer; TOC decision. | #21–#22 |
| 9. Visual customization | Vault `name`/`description`/`icon`, optionally `appearance.accent`. | #23 |

---

## G. GitHub Issues

Created as #1–#23. Each issue holds the full problem statement, approach, acceptance criteria,
dependencies, files and complexity. Complexity: **S** is about a day or less, **M** a few days,
**L** a week or more.

| # | Title | Milestone | Depends on | Size |
| --- | --- | --- | --- | --- |
| #1 | Fix escaped-pipe wikilinks (`[[note\|alias]]`) | 1 | — | S |
| #2 | Stabilization: Quick Pick responsiveness, test type-checking, scaffold cleanup | 1 | — | S |
| #3 | Reconcile architecture documentation with the Lapislaz vision | 1 | H4 | S |
| #4 | Vault registry: deterministic `.lapis` hierarchy resolution | 2 | — | S |
| #5 | Scope the index to vaults and gate activation | 2 | #4, H1, H2 | M |
| #6 | Parse `.lapis` configuration (empty allowed) with diagnostics | 2 | #4, H3, H18 | S–M |
| #7 | Record source ranges for wikilink occurrences | 3 | #1 | M |
| #8 | Wikilink navigation: document links and definitions | 3 | #5, #7 | M |
| #9 | Wikilink completion | 3 | #5 | M |
| #10 | Unresolved and ambiguous wikilink diagnostics with quick fixes | 3 | #5, #7, H7 | M |
| #11 | Backlink occurrences and ReferenceProvider | 4 | #7 | M |
| #12 | Backlinks view | 4 | #11 | M |
| #13 | Propagate wikilinks on file and folder rename or move | 5 | #5, #7, H8 | L |
| #14 | Spike: heading-reference updates on heading rename | 5 | #11, H9 | M |
| #15 | Insert Table command | 6 | — | S |
| #16 | Table model, Format Table and Align Column | 6 | H16 | M |
| #17 | Table row and column operations via commands and Code Actions | 6 | #16 | M |
| #18 | Preview: render wikilinks | 7 | #1, #5 | M |
| #19 | Preview: highlight and footnotes | 7 | #18, H15 | S |
| #20 | Preview: Obsidian callouts | 7 | #18 | M |
| #21 | Activity Bar container and Vault Explorer | 8 | #5, H11 | M |
| #22 | Decide and implement the Table of Contents | 8 | #12, H10 | S |
| #23 | Vault metadata: name, description, icon | 9 | #6, #21 | S |

---

## H. Open Decisions

These cannot be settled from the code or the brief, and they are tracked as a checklist in #24.
Where there is a recommendation, it is marked as one.

1. **Markdown outside any `.lapis`:**
   - The brief says wikilinks work "within a vault". Today every workspace folder is implicitly a
     vault.
   - Should notes outside vaults stay unindexed (no wikilink features, no Quick Pick entries)?
   - This decides activation and scan cost.
   - *Recommendation:* yes, unindexed. Global features are unaffected.
2. **A `.lapis` above the opened folder:**
   - If a user opens `docs/` while `.lapis` sits at the repository root, should Lapislaz walk up
     parents with `fs.stat`, or only consider `.lapis` files inside workspace folders?
   - This affects which directory is the "root vault".
3. **`.lapis` format:**
   - YAML: consistent with frontmatter, `yaml` is already a dependency, and an empty file is
     natively valid.
   - JSONC: built-in schema validation and completion through `jsonValidation`, with no
     dependency on the Red Hat YAML extension.
4. **Fate of the existing roadmap:**
   - Are Bases, Kanban, Timeline, reminders, frontmatter mutations and the React `.base` custom
     editor (`docs/architecture.md`) dropped, deferred, or kept as a separate extension?
   - This determines whether typed properties, `ctime`/`mtime` and the mutation-service design
     stay.
5. **Obsidian resolution compatibility:**
   - Assumption: Obsidian matches link targets case-insensitively and supports path-suffix
     matching (`[[folder/note]]` for `a/folder/note.md`) and frontmatter `aliases:` as link
     targets.
   - The current resolver is case-sensitive, has no suffix matching and no `aliases`.
   - Which of these must Lapislaz match? Verify against Obsidian before deciding.
6. **`.obsidian/` as an implicit vault marker:** should an existing Obsidian vault work without
   adding `.lapis`? The brief does not say. Not assumed.
7. **Attachments and embeds:**
   - Should `[[file.pdf]]` and `![[image.png]]` resolve, so that they do not produce false
     diagnostics?
   - Should image embeds render as images in the preview?
   - Note transclusion is out of scope unless requested.
8. **Rename policy:**
   - Modes: always, prompt or never, and the default.
   - What happens on a new basename collision: qualify affected links, or refuse.
   - Whether the setting lives in `.lapis` (`links.autoUpdate`) or in VS Code settings, which
     would mirror `markdown.updateLinksOnFileMove.enabled`.
9. **Heading-reference updates:** is a dedicated command acceptable if the built-in rename
   provider cannot be extended (#14)?
10. **TOC:** rely on the native Outline (moved to the secondary sidebar), or ship a thin Lapislaz
    view? Principle 6 favours Outline. The preview-tracking gap favours a thin view.
11. **Vault Explorer contents:** all files or Markdown only? Without a clear difference from the
    native Explorer (vault metadata, multi-vault grouping), it risks duplicating it.
12. **Built-in rich Markdown Editor (`vscode.markdown.editor`, 1.140):** should Lapislaz features
    (wikilinks, callouts, completion) target it too? Its extensibility is unexplored and probably
    not markdown-it based.
13. **Configuration of global features:** confirm that global features use VS Code settings (or
    none), and that `.lapis` holds vault-scoped keys only. This affects `preview.*` and
    `tables.formatOnSave` from the candidate list.
14. **Naming:**
    - Should the extension `name`, `displayName`, command prefix (`lapis.*` versus
      `lapislaz.*`) and setting namespace change to Lapislaz? `.lapis` stays as specified.
    - Is there a publisher id?
15. **Coexistence:** expected behaviour when Markdown All in One (tables, TOC) or a footnotes
    preview extension is installed. Detect and defer, or ignore?
16. **Long table cells:** pad every row to the widest cell (exact alignment, large diffs), or cap
    padding past a threshold (smaller diffs, imperfect alignment)?
17. **Exclusions:**
    - Keep `lapis.excludedFolders`, honour `files.exclude`, add `.lapis` `index.exclude`, or some
      combination?
    - Folding these together would remove a mechanism.
18. **Sub-vault inheritance:** which keys inherit? Proposal: behavioural keys inherit; `name`,
    `description`, `icon` and `home` do not.

### Investigation items (technical; no product decision needed)

- Whether VS Code merges or arbitrates several `RenameProvider`s (affects #14).
- Whether `needsConfirmation` metadata triggers Refactor Preview for edits returned from a
  will-rename participant (affects #13 prompt mode).
- Symlinked and duplicate paths, and case-only differences on case-insensitive file systems
  (affects identity in `NoteIndex`).
- Index cost on a 10k-note fixture: initial scan time, memory, and backlink rebuild time. This
  establishes a baseline before any optimization.
- `findFiles2` / `useExcludeSettings` availability in 1.140, to honour `files.exclude` and
  `search.exclude` cleanly (affects G5).
