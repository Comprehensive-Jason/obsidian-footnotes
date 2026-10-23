# 07: rename footnote

Settings: defaults. Undo between checks.

A footnote[^alpha] to rename, and a right-click fixture here[^menu].

## The command

Run **Rename footnote** from the command palette with the caret in each spot:

- [ ] Caret inside `[^alpha]` above: the modal opens prefilled with `alpha`, the name selected and the box focused, so typing replaces it straight away
- [ ] Rename it to `gamma`: the toast reads well and its count of places makes sense at a glance
- [ ] One undo reverts the whole rename at once (reference and definition together, not one press each)
- [ ] With the popup open on `[^alpha]`, running the rename first settles or closes the popup (no popup left bound to the old name)

## The right-click menu

- [ ] Right-click ON `[^menu]` above: the menu shows **Rename footnote** with the pencil icon, where the native "Rename this heading" item sits on a heading line
- [ ] Choosing it opens the same modal as the command, prefilled with `menu`

[^alpha]: first definition
[^menu]: the definition to rename
