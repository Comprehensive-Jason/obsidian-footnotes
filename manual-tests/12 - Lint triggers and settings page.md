# 12: lint triggers and the Linting settings page

Automated coverage: 15 former checks now live in test/manual-lint-triggers-and-settings.test.ts and the smoke suite; run `npm test` and `npm run test:smoke` before this sheet.

Settings: defaults, then the trigger named in each section. Undo between checks. Every fixture is already in this note.

The messy fixture: the references are out of order and reindex to `[^1]`/`[^2]` whenever a lint runs.

start messy[^20] references[^10] here

[^20]: twenty, used first
[^10]: ten, used second

## Lint on save

`Lint on save` ON, everything else default.

- [ ] Ctrl+S lints, and ONE undo restores the mess in a single step (the lint itself is smoke-covered; what needs your eyes is the undo grouping in the real editor)
- [ ] Fold a heading and a bulleted list in this note (any of them, including one the lint will edit inside), put the caret on an unchanged line, and Ctrl+S: the note is linted, every fold is still folded, and the caret is still where it was (2026-09-11: Obsidian drops a fold on any edit inside it, so the plugin puts the folds back after every lint, on save and on creation as well as the command; the smoke suite asserts this for the COMMAND only, so the save path and the list fold are yours)

## Lint on footnote creation

`Lint on footnote creation` ON, everything else default. This replaced the old `Lint on focused file change` trigger (2026-08-05): the lint happens in the note you are LOOKING AT, at the moment a new footnote definition is created.

- [ ] Switching between notes never lints anything anymore (the old trigger is gone)

## The Linting settings page

- [ ] Turn OFF all four rules AND Reindex AND the three Orphans-and-duplicates toggles, run **Lint footnotes**: "All lint rules are turned off in the plugin settings, so there is nothing to lint." (not the misleading "No linting needed."); Ctrl+S with lint-on-save says the same (2026-08-10)
- [ ] Turn every rule and toggle back to its default afterwards.

## The command palette and the settings text

Moved here from the feature-round sheet on 2026-10-04.

- [ ] Command palette: **Delete footnote everywhere**, **Convert inline footnotes to normal footnotes**, and **Convert normal footnotes to inline footnotes** are listed, each with its icon (the two convert icons are placeholders until yours land; the delete icon is yours)
- [ ] Settings page: command and setting names in the descriptions are bold and footnote syntax is in code style (the naming dropdown and the prefix toggle show both); **Preferred footnote naming style**, **Placement relative to punctuation**, **Per-note footnote prefix**, and the carry toggle break their descriptions into bullet lists (one value or case per bullet, no full stop at the end of a bullet, a closing line after the list where there is one); settings search for "meaningful" still finds the naming dropdown, which proves the search reads formatted descriptions
