# 02: the popup editor

Automated coverage: 10 former checks now live in the smoke suite; run `npm test` and `npm run test:smoke` before this sheet.

Settings: `Edit footnotes in a popup` ON, defaults otherwise. Undo between checks. Every fixture is already in this note. The popup-OFF jumps are sheet 03.

## Basics

- [ ] Inserting a footnote into this sentence draws the popup AT the caret, not somewhere else on screen (that it opens, focuses, and leaves the caret in the text is already pinned by the smoke suite)
- [ ] With the popup open, click somewhere else in the note: the popup closes (the hotkey and Escape routes are pinned by the smoke suite)

## Persistence and edge cases

- [ ] Known accepted quirk (the stock hover editor has it too): after typing AND undoing inside the popup, an undo in the main editor may bring the text back once; a second undo settles it
- [ ] Vim users: the Esc that exits insert mode inside the popup does NOT also close the popup; a second Esc closes it

## Rapid entry (crash fixed 2026-08-13)

Starting from the end of this sentence, do three fast rounds of: press the numbered hotkey, type a few characters into the popup, press the hotkey again to close, and immediately press it again for the next footnote. (That the definitions keep their own text and that the save chain never crashes are both pinned by the smoke suite; what is left is how it feels.)

- [ ] Closing feels immediate; the next popup opens without a long stall

(The phone repeat is sheet P's.)
