# 02: the popup editor

Settings: `Edit footnotes in a popup` ON, defaults otherwise. Undo between checks.

## Basics

- [ ] Insert a footnote into this sentence: the popup appears AT the caret, not somewhere else on screen
- [ ] With the popup open, click somewhere else in the note: the popup closes
- [ ] Open this note in a new window (right-click its tab, "Open in new window"). There, insert a footnote and click somewhere else in the note: the popup closes. Insert another and press Esc: it closes

## Persistence and edge cases

- [ ] Known accepted quirk (the stock hover editor has it too): after typing and undoing inside the popup, an undo in the main editor may bring the text back once; a second undo settles it
- [ ] Vim users: the Esc that exits insert mode inside the popup does NOT also close the popup; a second Esc closes it

## Rapid entry

From the end of this sentence, do three fast rounds: press the numbered hotkey, type a few characters into the popup, press the hotkey again to close, and press it again at once for the next footnote.

- [ ] Closing feels immediate; the next popup opens without a long stall
