# 07: rename footnote (2026-08-12)

Automated coverage: 11 former checks now live in test/manual-rename-footnote.test.ts and the smoke suite; run `npm test` and `npm run test:smoke` before this sheet.

Settings: defaults. Undo between checks. Every fixture is already in this note: a footnote[^alpha] to rename, and a right-click fixture here[^menu].

## The command

Run **Rename footnote** from the command palette with the caret in each spot:

- [ ] Caret inside `[^alpha]` above: the modal opens prefilled with `alpha`, the name is selected and the box has focus, so typing replaces it straight away
- [ ] Rename it to `gamma`: the toast that follows reads well and its count of places makes sense at a glance
- [ ] One undo reverts the whole rename at once (reference and definition together, not one press each)
- [ ] With the popup open on `[^alpha]`, running the rename first settles/closes the popup (no stranded popup bound to the old name)

## The right-click menu (2026-08-13)

- [ ] Right-click ON `[^menu]` above: the menu shows **Rename footnote** with the pencil icon, and it sits where the native "Rename this heading" item does on a heading line
- [ ] Choosing it opens the same modal as the command, prefilled with `menu`

(There is no long-press twin on the phone: Obsidian owns that menu there and plugins cannot add to it. Sheet P covers the phone's route, the toolbar icon after a long press.)

[^alpha]: first definition
[^menu]: the definition to rename
