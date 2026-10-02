# Lapis Architecture

## Ownership

Markdown and YAML frontmatter are canonical. The extension owns only derived
in-memory records and presentation state. No feature may independently scan
the vault, and no webview may parse or write Markdown.

| Module | Current responsibility |
| --- | --- |
| `src/domain` | Portable record, property, heading, link, and issue types. |
| `src/metadata` | Read frontmatter without changing source text. |
| `src/markdown` | Shared wikilink tokenization grammar. |
| `src/index` | Pure note parser/index plus a VS Code event/filesystem adapter. |
| `src/navigation` | Native Quick Pick over shared records. |
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

## Planned Boundaries

- **Preview adapter:** export `extendMarkdownIt`; recognize tokens during parsing,
  resolve from the index during rendering. Keep undocumented preview environment
  fields and refresh commands isolated behind a version-tested adapter.
- **Language providers:** definitions, completion, and later references share the
  resolver. A native TreeView exposes current-note backlinks.
- **Mutation service:** re-read the current document, validate the expected
  revision, plan source-token/YAML-aware edits, and use `WorkspaceEdit`. Preserve
  body text and refuse malformed metadata. Never auto-save already-dirty notes.
- **Bases:** parse YAML and evaluate a documented, allowlisted expression subset.
  Global/view filters combine with AND. Queries return normalized records;
  unsupported expressions produce diagnostics, never wider silent results.
- **Views:** one React custom text editor for `.base`, initially opt-in. Table,
  Kanban, and Timeline consume the same records and emit property mutations.
  Versioned messages carry request IDs, record revisions, acknowledgments, and
  failures. The host authorizes all file/property access.
- **Dates/tasks:** normalize configured date properties without rewriting YAML.
  Distinguish calendar dates from instants and define timezone/DST policies.
  Schedule the next relevant event, reconcile on activation/focus/change, and
  retain only notification deduplication state outside Markdown.

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
5. **Bases/Table (first structured MVP):** supported query subset, sorting,
   filtering, column resizing/order/visibility, note opening, and scalar editing.
6. **Kanban:** scalar grouping, unassigned columns, keyboard alternatives, drag
   mutation, and rejected-operation rollback.
7. **Timeline:** point/range projection, grouping, Today marker, zoom and
   Day/Week/Month/Quarter presets; then movement/resizing with atomic property
   edits and calendar/DST tests. No separate persisted timeline model.
8. **Reminders:** startup overdue summary, next-event timer, recomputation,
   reopen recovery, cancellation, and fake-clock tests.
9. **Embeds:** native-engine rendering of indexed content with cycle/depth/size
   limits and dependency refresh. Recursive live transclusion is not an MVP gate.

Dependencies are added per slice. Current runtime libraries are `yaml` and
`markdown-it` 14.x. React, TanStack Table, drag-and-drop, an expression parser,
and a proven timeline library are deferred until their respective slices.

No graph view, persistent index database, full formula language, background
daemon, or replacement Markdown editor is planned.