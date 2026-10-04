# 18: copying, cutting, and pasting footnotes (2026-09-22)

Claude: automated coverage lives in test/carry-footnotes.test.ts (which definitions a selection needs, how they merge and rename in the destination, the clipboard text with definitions in it, what a cut orphans) and test/carry-footnotes-hooks.test.ts (the copy, cut, and paste hooks over a fake clipboard); run `npm test` before this sheet. What is left needs the live app: the real clipboard, Obsidian's own paste, undo grouping, a second note, the phone, and the toasts at a glance.

Settings: defaults (**Carry footnote definitions on copy, cut, and paste** on). Undo between checks. Fixtures: this note holds a paragraph with a shared footnote[^shared] and another use of it[^shared], one with its own footnote[^own], and a chained one[^chain]. Make a second note called "Paste target" holding one line, `Existing[^1] text.`, and its definition `[^1]: an existing one`.

## Copy and paste into another note

- [ ] Select the whole first fixture paragraph above (both `[^shared]`, `[^own]`, `[^chain]`), Ctrl+C, switch to "Paste target", Ctrl+V at the end of its line: the text lands, four definitions are appended after `[^1]: an existing one` (`shared`, `own`, `chain`, and `inner`, which only `chain`'s body cites), the toast reads "Pasted with 4 footnote definitions: 4 added." and Reading view renders every footnote
- [ ] One undo in "Paste target" removes the text and the four definitions together
- [ ] Paste the same clipboard a second time: the four definitions are reused, not added again (toast: 4 reused), and the references point at them
- [ ] In "Paste target", add a definition `[^own]: a different body`, then paste again: `[^own]` comes in renamed (`[^own-2]`) with its own definition, and the toast says 1 renamed
- [ ] Copy `Existing[^1]` from "Paste target" and paste it into this note, where `[^1]` does not exist: it lands as `[^1]` with its definition. Then paste it again after adding a different `[^1]` here: it comes in as the next free number

## Cut

- [ ] Select `one with its own footnote[^own]` (just that phrase) and Ctrl+X: the phrase leaves, the `[^own]` definition leaves with it in the SAME undo step, and the toast says one definition was cut. Ctrl+V somewhere else in this note brings both back
- [ ] Select one of the two `[^shared]` uses and Ctrl+X: the definition stays (the other use still needs it) and no toast shows; the clipboard text carries a copy of the definition (the plugin takes over any cut whose selection needs a definition, so the copy travels; corrected 2026-10-04, the sheet used to say Obsidian's own cut runs), and pasting elsewhere in this note reuses the existing definition (toast: "1 reused")
- [ ] A cut outside the note's text is left alone (2026-10-03): select `one with its own footnote[^own]` in the note, then press Ctrl+F, type a word into the search box, select it there, and Ctrl+X; do the same in the note's inline title. Each time only the field's own text is cut: the note's text and the `[^own]` definition stay, and no toast shows (the plugin used to cut the note's old selection instead; what the units cannot see is where Obsidian really draws these fields)

## The clipboard text and other apps

- [ ] Paste the copied paragraph into another app (Notepad, a browser field): the text, a blank line, then the definition lines, which travel in the clipboard text on purpose. Paste it into "Paste target" as well: the definitions land at the bottom, not in the middle of the text
- [ ] Copy with Footnotes compatibility (optional, if that plugin is installed in a scratch vault): text it copied pastes here with its definitions landed and merged

## The phone

- [ ] On the phone, select text with a footnote, Copy from the long-press menu, paste into another note: the definition follows, and the toast fits the screen
- [ ] On the phone, Cut a phrase with a footnote only it uses: the definition leaves with it in one undo

[^shared]: used twice above
[^own]: used once
[^chain]: this body cites[^inner] another
[^inner]: only the chained body cites this
