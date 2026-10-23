# 15: delete footnote definition and all references

Settings: defaults. Undo between checks.

A footnote cited twice[^twice] and again here[^twice], a right-click fixture[^menu], a chained one[^chain] whose definition cites another footnote, and one inside a list item below.

- item with a footnote[^item]
- [^item]: defined inside the list item

## The command

Run **Delete footnote everywhere** from the command palette with the caret in each spot:

- [ ] Caret inside the first `[^twice]` above: BOTH references and the definition go; the toast reads well and its counts ("2 references and 1 definition") make sense at a glance
- [ ] One undo brings everything back at once (both references and the definition, not one press each), with the caret where it was
- [ ] Caret inside the `[^twice]:` label at the bottom: the same deletion happens from the definition's end
- [ ] Caret inside `[^chain]`: the chained definition goes, and the lint alert that follows names `[^inner]` as a definition nothing references now. Every delete on this sheet is followed by the lint alerts, so a nested-footnote alert also shows while `[^chain]` exists, since its definition cites `[^inner]`
- [ ] Caret inside `[^item]`: the reference and the definition text inside the list go together, and the bullet in front of the definition stays as an empty item, as Obsidian's own delete leaves it
- [ ] With the popup open on `[^menu]`, running the command first settles or closes the popup and deletes nothing on that press

## The right-click menu

- [ ] Right-click ON `[^menu]` above: the menu shows **Delete footnote everywhere** with the trash icon, in the same section as **Rename footnote**, and Obsidian's own **Delete footnote and reference** is still there beside it
- [ ] Choosing it deletes the definition and the reference, with the same toast as the command

## Compare with Obsidian's own item

- [ ] Right-click the first `[^twice]` and choose Obsidian's own **Delete footnote and reference**: only that one reference and the definition go, and the second `[^twice]` is left behind. Undo.

[^twice]: cited twice
[^menu]: the right-click fixture
[^chain]: this body cites[^inner] another footnote
[^inner]: only the chained body cites this one
