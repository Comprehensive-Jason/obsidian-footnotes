---
footnote-prefix: P-
---
# 08: the per-note footnote prefix

Automated coverage: 13 former checks now live in test/manual-footnote-prefix.test.ts and the smoke suite; run `npm test` and `npm run test:smoke` before this sheet.

Settings: `Per-note footnote prefix` ON. Undo between checks. The fixture is already in this note: the frontmatter carries `P-` and one prefixed footnote[^P-1] exists. The lint side of prefixes is sheet 09; an invalid property is sheet 10.

## The Set footnote prefix command

Run **Set footnote prefix** from the command palette:

- [ ] The modal opens prefilled with `P-`, the value is selected and the box has focus, so typing replaces it straight away
- [ ] Switch the note to Reading view and open the palette: **Set footnote prefix** is still offered there (a frontmatter edit is fine in Reading view)

(The phone keyboard-above-the-dialog check is sheet P's.)

[^P-1]: the first prefixed footnote
