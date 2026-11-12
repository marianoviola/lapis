# Creating `.base` views

In Lapis, a Base is a saved, declarative view over existing notes. It does not
store a second copy of the notes or require another note application.

A `.base` file is a YAML document that defines one or more read-only table or Kanban
views over Markdown notes in its Lapis vault. Create the file anywhere inside a
vault, give it the `.base` extension, and edit it with VS Code's YAML language
support. Run **Lapis: Open Base Preview** from the Command Palette, the file's
editor-title preview button, or its Explorer context menu. Preview replaces the
source tab in the same editor group. Use **Lapis: Open Base Source** (the code
icon in VS Code's editor-title toolbar, where the preview button appears in YAML) to
return to YAML; both editors share the document, including unsaved changes.
Alternatively, choose **Reopen Editor With > Lapis Base Preview**.

This guide is the reference for Lapis view syntax. The `.base` extension alone
does not guarantee interchange with Obsidian Bases or other applications.
Unsupported constructs produce diagnostics rather than being silently ignored.
See [Portability and compatibility](compatibility.md) for the compatibility policy.

The preview has configured-view tabs, a **Table / Kanban** toggle, text search,
property visibility controls, a Kanban grouping selector, and reminders.
Search matches note titles, paths and property values after the YAML filters.
Display choices survive live refreshes and source/preview switches in the
current window session; they do not rewrite the YAML. Selecting a different
configured-view tab restores that view's declared layout and grouping.
The `tags` property renders each valid string in a YAML list as its own `#tag`
chip in both table cells and Kanban cards. A single string is treated as one
tag, with an optional leading `#`. Tags accept Unicode letters, combining marks,
numbers, `_`, `-` and `/` for nesting; they cannot be purely numeric or contain
spaces, HTML, or empty path segments. Invalid values remain visible as plain
text with a warning border and an explanatory tooltip, never as `#tag` chips.
This display validation does not rewrite metadata or change YAML filtering or
grouping. Chips wrap between tags, not between letters; very long tags are
truncated with their full value available on hover.

Other array properties, such as `title_options`, render one neutral pill per
element in both layouts, without adding a `#` prefix or applying tag validation.
Numbers and booleans keep their text values; null and empty-string elements show
`null` and `""`. Nested lists and maps remain single pills with their JSON value,
so the original structure is not flattened. Empty arrays display a dash.
Long pills use ellipses with their complete value available on hover.
Search, sorting and grouping still use the original property values.

The current implementation supports filtering, explicit sorting, a constrained
formula language, and property display names. It does not yet support Timeline views, property
editing, or writing changes back to notes.

## Minimal example

```yaml
views:
  - type: table
```

This displays every indexed note in the `.base` file's vault. By default, the table
starts with a **Name** column, followed by properties found on the matching
notes. A view's `order` can place columns in a different sequence, including
placing calculated columns before **Name**.

## Configuration

The top-level YAML mapping accepts these keys:

| Key | Type | Purpose |
| --- | --- | --- |
| `filters` | Filter | Optional filter applied to every view. |
| `views` | Sequence of views | Views to display. Each requires `type: table` or `type: kanban`. |
| `properties` | Mapping | Optional property display-name definitions and column ordering. |
| `formulas` | Mapping | Named, read-only calculated expressions. |

Example:

```yaml
filters: 'status == "active"'

views:
  - type: table
    name: Active projects
    filters: 'priority >= 2'
    order: [priority, file.name]
  - type: table
    name: Recently touched
    order: [file.mtime]

properties:
  status:
    displayName: State
  priority:
    displayName: Priority
  due:
    displayName: Due date
```

Use `name` to label a view's tab. `order` puts the listed columns first.
Remaining columns from `properties` keep the order written;
properties present on matching notes but not configured are added afterward
alphabetically. Formula columns are also included. A configured property appears as a column even when no
matching note currently has a value for it. Each property definition currently
accepts only `displayName`. Column visibility can be toggled in the table UI;
that choice does not change the `.base` source. Property keys can use `note.`,
`file.`, or `formula.` prefixes; for example, `file.name: {displayName: Project}`
renames the existing name column rather than adding a second column.

## Formulas

Define formulas as expression strings, including YAML multiline strings:

```yaml
formulas:
  state:
    if(status == "active", "Active",
      if(status == "archived" || status == "archived-experiment", "Archived", status))
properties:
  formula.state:
    displayName: State
views:
  - type: table
    order: [formula.state, file.name, status]
    sort:
      - property: formula.state
        direction: ASC
      - property: file.name
        direction: ASC
```

The supported subset is scalar literals, property references, parentheses,
`if(condition, yes, no)`, comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`),
and boolean `&&` / `||`. Comparisons bind before `&&`, which binds before `||`.
`if` evaluates only the selected branch, and boolean operators short-circuit.
Conditions use truthiness: missing, null, false, zero and empty strings are false.
Comparisons require compatible scalar types; missing values never match.
References may use frontmatter names, `note.`, the allowlisted `file.` properties,
or another `formula.` name, including a formula declared later.
Unknown formulas, circular references, unsupported functions and malformed
expressions produce diagnostics. Formulas are limited to 512 tokens and 64
levels of expression nesting. No JavaScript or arbitrary code is executed.
Arithmetic, date functions, method calls and the `this` namespace are not supported.

Formula values are available in columns, comparison filters, sorting, search
and Kanban grouping, without modifying note metadata.

## Kanban

```yaml
views:
  - type: kanban
    name: Editorial board
    groupBy: status
    order: [due, file.name]
```

`groupBy` is supported on Kanban views and defaults to `status`. It accepts one
property reference, with optional `note.`, an allowlisted `file.` namespace,
or a defined `formula.` name.
The toolbar can also show any table view as a board without editing YAML.
The grouping selector offers matching-note properties, configured columns,
`file.name`, `file.folder` and the view's declared grouping property.
Missing, null and empty values share **No value**. Other groups preserve typed
values; arrays and maps are grouped by their complete JSON value, not split.
Columns follow first appearance in the ordered results. Search hides empty
columns. Cards open their notes; drag-and-drop and property mutations are not
enabled.

## Date reminders

For notes with a future ISO date property, use the bell beside the note name
in either layout. Choose a date property, then confirm the reminder date and
time. Calendar dates (`YYYY-MM-DD`) default to **09:00 local time**.
ISO timestamps with `T` and an optional `Z`/numeric offset are supported;
timestamps without an offset use local time. Impossible dates and nonexistent
local times during a daylight-saving transition are rejected. The confirmation
field uses local time; a reminder is stored as an absolute instant.

Reminders are manual, one per note, and independent of YAML filters: hiding a
note or changing its date after scheduling does not reschedule its alert.
A highlighted bell lets you change or cancel an alert. **Reminders** in the
toolbar, or **Lapis: Manage Note Reminders**, lists all reminders in this VS Code
workspace, including notes not shown in the current view.

Alerts are stored in VS Code workspace state, not in the vault or frontmatter.
They survive restarts in the same workspace. VS Code must be running to deliver
a notification; overdue alerts are delivered when that workspace next opens.
There is no operating-system background alarm or closed-editor delivery.
Notifications offer **Open note**, subject to VS Code's notification settings.
VS Code file/folder rename and delete operations relocate or cancel reminders.
External filesystem moves are not tracked. Storage/delivery failures are logged
and surfaced as errors; failed due-state writes retry after one minute.

## Filters

A filter can be a comparison expression, or a YAML mapping with one logical
operator (`and`, `or`, or `not`) and a non-empty sequence of child filters.
Filters at the top level and on a view are both applied, so a note must pass
both.

`file.inFolder("Projects")` is also supported as a filter, alone or in a logical
mapping. It selects notes directly in that vault-relative folder and its
descendants, not similarly named folders such as `Projects-old` or
`Elsewhere/Projects`. An empty folder selects the whole vault. Leading/trailing
slashes are accepted; `.` / `..` path segments and backslashes are rejected.

```yaml
filters:
  and:
    - 'status == "active"'
    - or:
        - 'priority >= 3'
        - 'pinned == true'
    - not:
        - 'archived == true'
```

Comparison expressions have the form `property operator literal`. Supported
operators are `==`, `!=`, `<`, `<=`, `>`, and `>=`. A property reference may
omit its namespace or use `note.` for frontmatter properties. String literals
can use single or double quotes; double-quoted strings support JSON escapes.
Numbers, `true`, `false`, and `null` are also supported:

```yaml
filters:
  and:
    - 'status != "done"'
    - 'priority >= 2'
    - 'published == false'
    - 'due != null'
```

`file.` references are limited to `name`, `path`, `folder`, `ext`, `ctime`,
and `mtime`. For example, `file.ext == "md"` compares against the Markdown
extension. `ctime` and `mtime` are numeric VS Code file timestamps.

Equality and inequality require matching scalar types; values are not coerced.
Relational comparisons (`<`, `<=`, `>`, `>=`) are supported only between two
numbers or two strings. A missing property never matches, including with
`!=`. An explicit `null` matches only `== null`; `!= null` does not match it.
Unsupported expressions produce a diagnostic instead of silently broadening
the results.

## Ordering and results

Set `order` to a YAML sequence of property references to arrange columns.
Set `sort` to a sequence of `{property, direction}` mappings to sort rows,
using `ASC` or `DESC`. Each sort key is applied in sequence; ties retain their
original index order. Missing and `null` values sort last in both directions.
`note.` is optional; the allowlisted `file.` properties and defined `formula.`
properties are supported:

```yaml
views:
  - type: table
    order: [status, file.folder, file.name]
    sort:
      - property: file.mtime
        direction: DESC
```

For existing Lapis definitions, omitting `sort` preserves legacy ascending
row sorting by `order`. An explicit `sort: []` keeps index order. `sort` never
changes the column sequence. Columns not listed in `order` remain available
and can be hidden using the preview's property controls.

The table is read-only. Selecting a row's name opens its Markdown note in the
native editor. The view includes only notes belonging to the vault that
contains the `.base` file, and refreshes when indexed notes or the `.base`
document change. Editing the YAML source changes the view definition; Lapis
does not write to the notes displayed in the table.

Unknown keys, malformed YAML, unsupported view types, and invalid filters are
reported as diagnostics in the preview, with Source still available.
