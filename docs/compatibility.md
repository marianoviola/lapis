# Portability and compatibility

Lapis is an independent Markdown workspace extension for VS Code. Its
documentation defines Lapis behavior directly; other applications are not
required to understand or use it.

## What remains portable

- Notes are ordinary Markdown files with YAML frontmatter, not records in an
  application-specific database.
- Frontmatter keeps typed strings, numbers, booleans, nulls, arrays and maps.
  Indexing and read-only views do not rewrite those values.
- Native Markdown links and relative paths can be read without Lapis.
  Wikilinks and Markdown extensions need a reader that supports their syntax;
  their rendering and resolution are not universally interchangeable.
- A vault is a folder with a `.lapis` marker. The marker enables Lapis discovery
  and link namespaces, but is not required to read the files in another editor.
- A `.base` file is a separate, human-readable YAML view definition. Deleting
  or not understanding a view definition does not delete its source notes.

Portable source text does not imply identical rendering, link resolution,
metadata interpretation or editing behavior across applications.

## The current compatibility boundary

| Surface | Lapis contract | Not promised |
| --- | --- | --- |
| Markdown notes | Files remain editable independently of Lapis. | Identical appearance or extension syntax in every Markdown reader. |
| YAML properties | The supported types and diagnostics are documented and tested. | Another application's property types, normalization or UI. |
| Wikilinks | Resolution follows Lapis vault namespaces and ambiguity rules. | Another application's heading, attachment or rename semantics. |
| `.base` views | Only the syntax in [Creating `.base` views](bases.md) is supported. Unknown keys and unsupported expressions produce diagnostics. | General Obsidian Bases compatibility, round-trip interchange or automatic conversion. |
| Presentation state | View controls are Lapis presentation choices, not changes to note data. | Shared UI state with another application. |
| Reminders | Alerts are stored in VS Code workspace state and delivered by Lapis. | Portable reminder metadata, synchronization or closed-editor delivery. |

The shared `.base` extension is not a compatibility declaration. Lapis currently
supports its own constrained filters, ascending `order`, table and Kanban views,
and grouping rules. Do not assume that a file created elsewhere will work in
Lapis, or that a Lapis definition will work elsewhere, without checking its
actual constructs. No cross-application compatibility matrix has been certified.

## How future compatibility is evaluated

Compatibility is selective, not a commitment to track another product's roadmap.
An integration or shared syntax is worth maintaining when it:

1. Serves a concrete workflow, such as opening existing notes or exporting a view.
2. Preserves source data and fits Lapis's explicit, undoable editing model.
3. Has a bounded, documentable contract with test fixtures and identified target
   versions, rather than an unqualified claim of compatibility.
4. Does not force a second index, silent reinterpretation of unsupported syntax,
   or dependence on another application's private state.
5. Has a maintenance cost justified by the workflow it enables.

If these conditions are not met, retaining readable data is preferable to
emulating another application's behavior. Where useful, an explicit import/export
adapter can be considered instead of changing the core model; no such adapter is
currently implemented.

Existing documented Lapis behavior remains the reference for development.
Any intentional incompatible change should be described in the changelog with
migration guidance, rather than silently treating the same source differently.
External compatibility claims should name the tested subset and versions;
they must not imply general or future parity.
