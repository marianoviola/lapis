# Changelog

## Unreleased

### Added

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