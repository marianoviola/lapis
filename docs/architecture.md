# Lapis Architecture

## Ownership

Markdown and YAML frontmatter are canonical. The extension owns only derived
in-memory records, presentation state and manually scheduled reminder state.
No feature may independently scan
the vault, and no webview may parse or write Markdown.

## Portability, not product parity

Lapis owns its documented semantics. Plain-text notes and view definitions
support data portability, but do not imply another application's parsing,
resolution or feature behavior. In particular, `.base` is the extension used
for the documented Lapis view schema, not a general Obsidian compatibility
contract.

External compatibility must be scoped to a useful workflow, supported by fixtures
and identified target versions, and preserve canonical source data. Unsupported
syntax must remain explicit, not silently broaden a query or mutate a note.
An optional boundary adapter is preferable to duplicating the index or coupling
the core model to external application state. No such adapter is implemented.
See [Portability and compatibility](compatibility.md) for the policy and current
boundaries.

## Modules

| Module | Current responsibility |
| --- | --- |
| `src/domain` | Portable record, property, heading, link, and issue types. |
| `src/metadata` | Read frontmatter without changing source text. |
| `src/markdown` | Shared wikilink tokenization and native preview frontmatter adapter. |
| `src/preview` | Resolver-backed wikilink rendering and native preview environment/refresh adapter. |
| `src/index` | Pure note parser/index plus a VS Code event/filesystem adapter. |
| `src/bases` | Pure `.base` parser, evaluator, table/board projections and HTML renderer; read-only custom text editor and persistent reminder scheduler/VS Code adapter. |
| `src/navigation` | Native Quick Pick over shared records. |
| `src/language` | Native document links, definitions, ambiguity hovers, dedicated wikilink insertion, optional completion and editor decorations. |
| `src/tables` | Pure table edits plus explicit commands, Code Actions and context-menu integration. |
| `src/extension.ts` | Composition, command registration, read-only API. |

The pure index has no VS Code dependency. URI strings are identity; root-scoped
path and basename maps provide resolution. Each refresh has a generation token.
A newer edit, removal, or disposal invalidates older asynchronous results.
Backlink maps are built lazily from indexed records and invalidated on updates;
this scans memory, not files. Targeted edge maintenance can replace this cache
if vault size demonstrates a need.

The workspace adapter registers events before discovery, reads at most eight
notes concurrently, and debounces per-note changes. Open buffers overlay disk
content, while source filesystem timestamps remain filesystem metadata. Native
rename tracking changes records but deliberately does not mutate link text.

Wikilink occurrences carry immutable absolute UTF-16 offset ranges (end
exclusive) for the full syntax, target, heading and label. The tokenizer records
inline offsets; the parser maps them through block prefixes and original line
endings, so identical text inside code spans cannot steal a link's range.
Language providers use the shared index and synchronize open document versions
before serving requests. Document link targets resolve lazily when first
followed, using the current target headings rather than a parsing-time URI.

Completion uses the shared tokenizer to validate a temporary completed reference
at the cursor, excluding code, escaped syntax and frontmatter without changing
the document. Suggestions use current indexed records, synchronize open buffers,
and validate candidate targets with the same resolver before choosing the
shortest uniquely resolving reference. Existing aliases and closing delimiters
are included in the replacement. Incomplete completion lists are regenerated as
the user types so title/path search is applied to the current query. No separate
file scan, note catalog, creation or save operation is introduced.
The resolver strips one optional `.md` extension from references, while index
keys are already canonical; repeated suffixes in filenames are preserved.

Commands are the primary content-authoring interface, including future callout
authoring. Wikilink insertion uses an independent Quick Pick rather than the
editor completion widget; completion is disabled by default and opt-in through
`lapis.wikilinkCompletion`. Note, optional heading and alias choices precede a
single buffer edit. The source version/selection and current destination are
checked after prompts, so cancellation or obsolete inputs do not modify notes.
Selected text supplies the alias default, and table aliases escape the pipe.

Table operations use markdown-it source maps for detection and a pure cell model
for escaped pipes, code spans, alignment and display-width padding. Commands
replace only the target table, preserve EOL/container prefixes, and restore a
logical cursor position. Code Actions carry source URI/version guards. One
exception to structural reformatting is row/column insertion: rows preserve all
existing lines, while columns preserve existing cell text and padding, completing
ragged rows as needed. Both insert compact cells with native snippet tab stops:
across a row from its first cell, or down a column from its header, skipping the
separator. Empty cells are not padded to the widest content. There is
no document formatter or automatic save, and table commands have no vault
dependency.

Editor decorations reuse indexed occurrence ranges and resolver states rather
than parsing Markdown again. Only visible, local Markdown editors whose buffer
version matches the indexed record are decorated. Edits clear stale ranges
immediately; index changes debounce a refresh of visible editors, including
dependents when targets change. Theme colours and dotted/dashed underlines
distinguish resolved, missing and ambiguous targets without adding diagnostics.
Non-Markdown embeds with unresolved targets are left undecorated pending H7.
Decoration types, listeners and the pending timer are disposed with the extension.

The exported `extendMarkdownIt` hook hides closed frontmatter in the native
preview by replacing its preamble with blank lines before block parsing. This
preserves source line maps, leaves documents untouched and does not suppress
index diagnostics. This presentation rule applies to native Markdown previews,
including documents outside indexed vaults.

Preview wikilinks resolve only for indexed source documents. Resolved links
emit encoded relative `href` and `data-href` attributes for native navigation;
missing and ambiguous targets emit distinct, theme-aware non-link spans.
Embeds remain raw text. Heading records include GitHub-style preview slugs,
including the native duplicate-heading suffix behavior, separately from their
exact-match heading text and editor line destinations.

The native adapter is tested against VS Code 1.140.0. Its undocumented
`currentDocument` environment field is available at rendering, but absent during
native document tokenization. Affected inlines are reparsed with render context
and the full inline core pipeline; cached native children are restored afterward.
This preserves ordinary Markdown outside vaults and automatic links/formatting.
Open buffers synchronize before resolution. Resolution-relevant index changes
(membership, paths and headings) debounce `markdown.preview.refresh` by 100 ms;
disposal cancels pending refreshes and refresh failures are logged.

## Vaults

`VaultService` discovers `.lapis` markers beneath workspace folders and along
their ancestor paths, and watches marker lifecycle changes. `VaultRegistry`
resolves the topmost marked ancestor as the link namespace and returns the
marked ancestor chain nearest-first. `WorkspaceIndex` indexes Markdown only
inside discovered vaults, applies folder and VS Code file exclusions, and
rebuilds when vault membership changes. Workspace folders in one vault share a
namespace; independent vaults remain isolated.

## Planned Boundaries

- **Additional language providers:** references will share the
  resolver. A native TreeView exposes current-note backlinks.
- **Mutation service:** re-read the current document, validate the expected
  revision, plan source-token/YAML-aware edits, and use `WorkspaceEdit`. Preserve
  body text and refuse malformed metadata. Never auto-save already-dirty notes.
- **Bases:** parse YAML and evaluate a documented, allowlisted expression subset.
  The parser accepts table/Kanban views, recursive YAML `and`/`or`/`not` filters,
  scalar property comparisons, `order`, Kanban `groupBy`, and property display names. Filter
  comparisons are limited to note properties and `file.name`, `file.path`,
  `file.folder`, `file.ext`, `file.ctime`, and `file.mtime`; formula/`this`
  namespaces, other view types, and unknown keys produce diagnostics. Global
  and view filters combine with AND. Missing properties never match (including
  `!=`); explicit `null` matches only `== null`; incompatible types do not
  match, and relational comparisons are limited to numbers and strings.
  Ordering is ascending, stable for ties, puts missing/null values last, and
  sorts different value types by type then value. Queries consume `NoteRecord`s
  supplied by the shared index; unsupported expressions produce diagnostics,
  never wider silent results. The opt-in `lapis.baseTable` custom text editor
  scopes records to the containing vault and refreshes on index/definition or
  reminder changes. A pure HTML renderer serializes projections safely under a
  nonce CSP; note content is inserted with DOM text APIs. View tabs, layout,
  grouping, search and column controls retain session presentation state.
  Host messages authorize note actions against the vault-scoped shared index.
  Source/preview transitions share one text document in the same editor group;
  `.base` remains associated with YAML. Neither layout writes to notes.
- **Editable views (planned):** Table, Kanban, and Timeline will emit property
  mutations through a revision-checked mutation service. Versioned messages
  will carry request IDs, revisions, acknowledgments, and failures.
- **Dates/reminders:** strict ISO calendar/instant parsing without rewriting
  YAML. Date-only defaults to 09:00 local time; confirmation is local and the
  persisted due time is an absolute instant. One manual alert per note lives
  in workspaceState, with serialized writes before visible success or delivery.
  Activation restores future and overdue reminders independently of previews.
  Timers check at most one minute apart to handle long waits and resume/clock
  jumps; file-operation events relocate or cancel reminders. Errors are logged
  and shown. There is no background daemon or closed-VS-Code notification.

Saving a `.base` definition does not save notes edited through its view. Likewise,
custom-editor undo is not automatically a cross-document note undo mechanism.
Both workflows need explicit Extension Host tests before enabling editable views.

## Sequence And Acceptance Checks

1. **Index/navigation (implemented):** typed metadata, native Quick Pick, unsaved
   overlays, read races, deletion, exclusions, diagnostics, and rename tracking.
2. **Wikilinks:** native preview, editor definitions, completion after `[[`;
   test labels, fragments, encoding, code exclusions, and preview refresh.
3. **Backlinks/rename safety:** native sidebar and proven-reference edits;
   test ambiguity, folder moves, labels/headings, and external rename limitations.
4. **Frontmatter mutations:** scalar editing with minimal source changes;
   test body/comments/CRLF preservation, stale revisions, undo, and save failures.
5. **Bases/Table (implemented, read-only):** pure YAML parser, diagnostics,
   evaluator, and read-only table projection for the documented subset,
   integrated with the shared index; test vault isolation, sorting/filtering,
   column controls, diagnostics, and note opening. Scalar editing follows
   through the mutation service.
6. **Kanban (implemented, read-only):** typed grouping and unassigned columns,
   view/layout controls and keyboard-accessible note actions. Drag mutation and
   rejected-operation rollback follow the mutation service.
7. **Timeline:** point/range projection, grouping, Today marker, zoom and
   Day/Week/Month/Quarter presets; then movement/resizing with atomic property
   edits and calendar/DST tests. No separate persisted timeline model.
8. **Reminders (implemented, manual):** startup overdue notifications,
   bounded next-event timers, persistent reopen recovery, change/cancellation,
   file-operation tracking and fake-clock tests.
9. **Embeds:** native-engine rendering of indexed content with cycle/depth/size
   limits and dependency refresh. Recursive live transclusion is not an MVP gate.

Dependencies are added per slice. Current runtime libraries are `yaml` and
`markdown-it` 14.x, plus CommonJS-compatible `github-slugger` 1.x for native
heading anchors. React, TanStack Table, drag-and-drop, an expression parser,
and a proven timeline library are deferred until their respective slices.

No graph view, persistent index database, full formula language, background
daemon, or replacement Markdown editor is planned.