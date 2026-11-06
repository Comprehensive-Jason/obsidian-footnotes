# 12: lint triggers and the Linting settings page

Settings: defaults, then the trigger named in each section. Undo between checks.

The messy fixture, which any lint reindexes to `[^1]` and `[^2]`:

start messy[^20] references[^10] here

[^20]: twenty, used first
[^10]: ten, used second

## Lint on save

Settings: `Lint on save` ON, everything else default.

- [ ] Ctrl+S lints, and ONE undo restores the mess in a single step
- [ ] In a long note, write a definition mid-note with a blank line around it, caret at its end, and Ctrl+S: the view jumps to the bottom with the definition, the next keystroke goes into the definition, and the jump doesn't feel disorienting
- [ ] Fold a heading and a bulleted list in this note (any of them, including one the lint will edit inside), put the caret on an unchanged line, and Ctrl+S: the note is linted, every fold is still folded, and the caret is still where it was

## Lint on footnote creation

Settings: `Lint on footnote creation` ON, everything else default.

- [ ] Switching between notes never lints anything

## The Linting settings page

- [ ] Turn OFF all four rules AND Reindex AND the three Orphans-and-duplicates toggles, run **Lint footnotes**: "All lint rules are turned off in the plugin settings, so there is nothing to lint." (not the misleading "No linting needed."); Ctrl+S with lint-on-save says the same
- [ ] Turn every rule and toggle back to its default afterwards.

## The command palette and the settings text

- [ ] Command palette: **Delete footnote everywhere**, **Convert inline footnotes to normal footnotes**, and **Convert normal footnotes to inline footnotes** are listed, each with its icon (the two convert icons are placeholders; the delete icon is yours)
- [ ] Settings page: command and setting names in the descriptions are bold and footnote syntax is in code style (the naming dropdown and the prefix toggle show both); **Preferred footnote naming style**, **Placement relative to punctuation**, **Per-note footnote prefix**, and the carry toggle break their descriptions into bullet lists (one value or case per bullet, no full stop at the end of a bullet, a closing line after the list where there is one); settings search for "meaningful" still finds the naming dropdown
