# Changelog

## Unreleased

## 0.1.0 - 2026-10-20

### Added

- Saved `.base` views with validated YAML filters, property display names,
  stable ascending sorting, and vault-scoped queries over the shared index.
- Read-only table and Kanban previews with view tabs, search, property
  visibility, layout and grouping controls, and native Source/Preview actions
  that preserve unsaved YAML in the same editor group.
- Validated tag chips and one neutral chip per array element, with whole-chip
  wrapping, bounded long values and full-value tooltips. Invalid tag metadata
  remains visible without being interpreted as HTML or rewriting notes.
- Manual date reminders through VS Code notifications, persisted per workspace,
  with change/cancellation, startup overdue delivery and native file-operation
  tracking. No closed-editor background delivery.
- Lapis-first documentation and an explicit portability policy: selective,
  tested external compatibility, without a general Obsidian parity guarantee.
- Explicit Markdown table formatting, column alignment and row/column operations,
  available through commands, Code Actions and the editor context menu, inside
  and outside vaults. Preserve source content and edit only the target table
  with one undo step; use full display-width padding without a cap.
- **Lapis: Insert Wikilink** with a dedicated note picker, optional heading and
  editable alias, selected-text alias defaults and table-safe alias separators.
  Reuse the vault index and resolver; cancellation and obsolete source/target
  checks prevent unintended edits.
- Read-only GFM task-list checkboxes in the native Markdown preview, including
  nested and ordered lists and task labels containing wikilinks.
- Theme-aware `==highlights==`, referenced footnotes and inline footnotes in
  Markdown previews inside and outside vaults. Reuse parser support when
  already available and preserve cached reference IDs when rendering wikilinks.

### Changed

- Insert table rows compactly without reformatting existing rows, starting in
  the first cell with native Tab/Shift+Tab snippet navigation between cells.
- Insert table columns compactly, preserving existing cell content and padding,
  with native Tab/Shift+Tab navigation from the header down the new column,
  skipping the separator and completing missing cells in ragged tables.
- Treat commands as the primary content-authoring interface. Wikilink editor
  completion is now opt-in via `lapis.wikilinkCompletion` (default `false`);
  VS Code and Copilot suggestion settings remain untouched.
- Use the theme's normal text colour for source-editor blockquote prose,
  preserving quote markers, code, links and emphasis without changing settings.
- Restyle ordinary preview blockquotes with a link-coloured left bar, subtle
  background tint and tighter spacing, with high-contrast theme support.
- Rename the extension back to Lapis: package `lapis`, commands and settings
  under `lapis.*`, and matching editor, preview and debug labels.
- The `.lapis` vault marker is unchanged. Uninstall any older Lapislazuli VSIX
  before installing Lapis and move customized settings/keybindings to `lapis.*`.

## 0.0.1 - 2026-10-02

### Added

- Lapis extension scaffold with pnpm, esbuild, and Extension Host debugging.
- Read-only shared Markdown index with typed YAML properties, headings,
  wikilink extraction, root-scoped resolution, and cached backlinks.
- Incremental filesystem/editor updates with stale-read protection.
- Native Open Note Quick Pick and Rebuild Index commands.
- Frontmatter diagnostics and configurable excluded directories.
- Unit and isolated Extension Host integration tests.

Preview wikilinks, backlinks UI, note mutations, Bases views, and reminders
are planned vertical slices, not part of this milestone.