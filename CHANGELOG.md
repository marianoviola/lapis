# Changelog

## Unreleased

- Add a pure vault registry with nested membership and independent namespaces;
  filesystem discovery and index integration are pending.

- Fix escaped-pipe wikilink aliases, including heading links and embeds.
- Show Open Note immediately and stream indexed notes while scanning.
- Include unit tests in TypeScript and ESLint checks.

## 0.0.1 - 2026-10-02

### Added

- Lapislazuli extension scaffold with pnpm, esbuild, and Extension Host debugging.
- Read-only shared Markdown index with typed YAML properties, headings,
  wikilink extraction, root-scoped resolution, and cached backlinks.
- Incremental filesystem/editor updates with stale-read protection.
- Native Open Note Quick Pick and Rebuild Index commands.
- Frontmatter diagnostics and configurable excluded directories.
- Unit and isolated Extension Host integration tests.

Preview wikilinks, backlinks UI, note mutations, Bases views, and reminders
are planned vertical slices, not part of this milestone.