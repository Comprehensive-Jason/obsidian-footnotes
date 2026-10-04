# 15: delete footnote definition and all references (2026-09-21)

Claude: automated coverage lives in test/delete-footnote.test.ts (the transform, its refusals, a property over random notes, and the command entry); run `npm test` before this sheet. What is left here needs the live app: how the toast reads, undo grouping, the right-click menu, and the popup. The phone check is on sheet P (moved 2026-10-04).

Settings: defaults. Undo between checks. Every fixture is already in this note: a footnote cited twice[^twice] and again here[^twice], a right-click fixture[^menu], a chained one[^chain] whose definition cites another footnote, and one inside a list item below.

- item with a footnote[^item]
- [^item]: defined inside the list item

## The command

Run **Delete footnote everywhere** from the command palette with the caret in each spot:

- [ ] Caret inside the first `[^twice]` above: BOTH references and the definition go; the toast reads well and its counts ("2 references and 1 definition") make sense at a glance
- [ ] One undo brings everything back at once (both references and the definition, not one press each), with the caret where it was
- [ ] Caret inside the `[^twice]:` label at the bottom: the same deletion happens from the definition's end
- [ ] Caret inside `[^chain]`: the chained definition goes, and the lint alert that follows names `[^inner]` as a definition nothing references now (the deleted body was its only citation). Every delete on this sheet is followed by the lint alerts, which is why the nested-footnote alert also speaks while `[^chain]` exists: its body cites `[^inner]`, and the plugin calls a reference inside a definition body a nested footnote (ADR 1)
- [ ] Caret inside `[^item]` (moved here from the feature-round sheet on 2026-10-04): the reference and the definition text inside the list go together, and the bullet in front of the definition stays as an empty item, exactly as Obsidian's own delete leaves it (since 2026-10-03 a definition inside a list item or a quote counts like any other, so one that runs over more than one line goes whole too, bullet kept, instead of being refused)
- [ ] With the popup open on `[^menu]`, running the command first settles/closes the popup and does not delete anything on that press (the same rule as rename)

## The right-click menu

- [ ] Right-click ON `[^menu]` above: the menu shows **Delete footnote everywhere** with the trash icon, in the same section as **Rename footnote**, and Obsidian's own **Delete footnote and reference** is still there beside it
- [ ] Choosing it deletes the definition and the reference, with the same toast as the command

## Compare with Obsidian's own item

- [ ] Right-click the first `[^twice]` and choose Obsidian's own **Delete footnote and reference**: only that one reference and the definition go, and the second `[^twice]` is left behind (the core behaviour this command exists to fix; Jason's report 2026-09-19). Undo.

[^twice]: cited twice
[^menu]: the right-click fixture
[^chain]: this body cites[^inner] another footnote
[^inner]: only the chained body cites this one
