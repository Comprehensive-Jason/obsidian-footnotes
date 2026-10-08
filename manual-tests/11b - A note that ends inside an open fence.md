# 11b: a note that ends inside an open code fence (2026-10-08)

Claude: a companion to sheet 11, added 2026-10-08. This whole note is the fixture: it ends inside a code fence that is never closed, so nothing can come after the fixture, and the steps and checks are all above it. Undo between checks.

Settings: defaults, plus **Footnote section heading** ON with the heading text `## Sheet 11b footnotes` (put your own heading back afterwards). **Move footnotes to the bottom** stays ON, as by default.

Until 2026-10-08 the lint left a note like this one untouched, because the note ends inside an open fence. Jason ruled that the result gate decides (list A, 2026-10-08): under a heading above the open fence, the definitions stay footnotes, so the lint gathers them there (Obsidian 1.14.4 read them so on 2026-10-08). The move itself is pinned by units (`spec-move-to-bottom-anchored-note-ending-protected`, `spec-open-fence-above-heading`), and so is the same note ending in an open `%%` comment; this sheet is only about how the result renders.

Steps: run **Lint footnotes** from the command palette.

- [ ] Both definitions move under the `## Sheet 11b footnotes` heading, above the open fence, and the fence and the line after it stay where they are
- [ ] Reading view: alpha's and bravo's footnotes render with their text, and everything from the fence to the end of the note shows as one code block

The fixture:

alpha[^a] and bravo[^b] here.

[^a]: alpha's definition
[^b]: bravo's definition

Prose between the definitions and the heading.

## Sheet 11b footnotes

```
code in a fence that never closes
