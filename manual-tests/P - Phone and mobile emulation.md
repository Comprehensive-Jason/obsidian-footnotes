# P: phone and mobile-emulation checks

Run this sheet after a beta release has synced to the phone (BRAT beta in the normal vault); the sandbox vault's dev build can't run these checks. Checks marked "or emulation" can also run in mobile emulation on the desktop (`app.emulateMobile(true)`, which reloads the window; run it again with `false` to leave), but the real phone is the ground truth.

Fixture reference[^menu] for the long-press check.

Convert fixture: an inline footnote^[an inline note] and a normal footnote[^convert].

Carry fixture: a phrase with its own footnote[^carry] and the rest of the line.

Table fixture:

| plain cell | other cell |
| --- | --- |
| more | text |

List fixture:

- First point
- Second point
- Third point

End of the list fixture.

- [ ] PHONE: the dialogs are bottom sheets like Obsidian's own **Rename heading**: run **Set footnote prefix**. The sheet rises from the bottom with rounded top corners and no close cross: the explanation, the field, the **Save** button, and a **Cancel** button stacked under it. Tap into the field: with the keyboard open, the whole sheet (field, inline error, both buttons) sits above the keyboard, nothing hidden behind it. Spot-check one of the Rename / Name-the-footnote dialogs the same way
- [ ] PHONE: long-press on `[^menu]` above: Obsidian's own menu opens with only its **Delete footnote and reference** item, and no **Rename footnote**. Dismiss it
- [ ] PHONE or emulation: rename after a long press: long-press `[^menu]` so the word is selected, dismiss the menu, then tap the **Rename footnote** toolbar icon: the dialog opens prefilled with `menu`
- [ ] PHONE: long-press on the `[^menu]:` label at the bottom of this note: no menu opens. With the label's word still selected, tap the **Rename footnote** toolbar icon: the dialog opens prefilled with `menu`. Cancel
- [ ] PHONE: Rename footnote from the toolbar with a refused name: type `two words` and tap the button; the error shows and the keyboard stays up (or comes straight back) with the field focused and its text selected, so the fix can be typed at once
- [ ] PHONE: Delete footnote everywhere: long-press `[^menu]` above so the word is selected, then tap the command's toolbar icon: the reference and its definition both go, and the toast reads well at phone width. Undo.
- [ ] PHONE: Convert footnote styles: tap the **Convert inline footnotes to normal footnotes** toolbar icon, then undo; then tap the **Convert normal footnotes to inline footnotes** icon, then undo. Both commands run from their icons, and each toast fits the screen. Each command converts the whole note, so the Convert fixture line above changes, and `[^menu]` takes part in the normal-to-inline one too
- [ ] PHONE: copy and paste carry the definition: select `a phrase with its own footnote[^carry]` in the Carry fixture line, Copy from the long-press menu, make a new scratch note and paste into it: the phrase lands with `[^carry]` defined at the bottom, and the toast fits the screen
- [ ] PHONE: the keyboard's clipboard history: copy the same phrase, copy some other word, then paste the phrase into the scratch note from Gboard's or Samsung Keyboard's clipboard history: it lands the same way, definition appended and the paste toast shown, not as plain text with the definition line after it. Delete the scratch note afterwards
- [ ] PHONE: a copy of whole lines from the keyboard's clipboard history: in this note, select the whole Carry fixture line, from its start to the start of the line under it, so the selection holds its line break, and Copy. Copy some other word, then in a new scratch note type two lines, put the caret at the start of the second, and paste the Carry line from the clipboard history: it lands as a line of its own above your second line, which stays on its own line, and `[^carry]` is defined at the bottom. Delete the scratch note afterwards
- [ ] PHONE: a cut pasted straight back from the clipboard history gives the note back: select `a phrase with its own footnote[^carry]`, Cut from the long-press menu (the `[^carry]` definition leaves too), and without moving the caret paste the newest entry of the keyboard's clipboard history: the line and the definition are back exactly as they were, still named `[^carry]`, with no paste toast
- [ ] PHONE: a cut carries the definition away: select `a phrase with its own footnote[^carry]` and Cut from the long-press menu: the phrase and the `[^carry]` definition leave together, and one undo brings both back
- [ ] PHONE: Obsidian's own Cut, Copy, and Paste buttons carry definitions too. Add them to the mobile toolbar if they are not there. Select `a phrase with its own footnote[^carry]`, tap the toolbar's Copy button, and paste with the toolbar's Paste button into a new scratch note: `[^carry]` arrives defined at the bottom. Back here, select the phrase again and tap the toolbar's Cut button: the phrase and the `[^carry]` definition leave together, and one undo brings both back. Delete the scratch note afterwards
- [ ] PHONE: a cut inside a table cell takes only the cell's text. Select `a phrase with its own footnote[^carry]` in the Carry fixture line so the note holds a selection, then tap into the table fixture, select `plain cell` inside its cell, and tap the toolbar's Cut button: only `plain cell` leaves the cell, and the Carry line and the `[^carry]` definition stay. Undo, and try the same with Cut from the long-press menu
- [ ] PHONE: a refused paste from the keyboard's clipboard history leaves the note as it was: select `a phrase with its own footnote[^carry]` in the Carry fixture line and Copy it, copy some other word, then put the caret at the very end of the `[^menu]:` definition at the bottom of this note and paste the phrase from Gboard's or Samsung Keyboard's clipboard history. Nothing is pasted, the definition reads as before, and the toast "Nothing was pasted: footnotes can't be nested inside other footnotes." fits the screen
- [ ] PHONE: a whole list item selected with the selection handles: long-press `Second point` in the List fixture, drag the handles out to the whole line (to the bullet if the handle reaches it, and to the line's end), and tap the numbered footnote toolbar icon. The bullet stays, now holding only `[^1]`, and `[^1]: Second point` is the new definition at the bottom (with the popup on, it opens showing `Second point`; close it). Undo
- [ ] PHONE: open the popup on `[^menu]` above (`Edit footnotes in a popup` ON): the label `[^menu]:` and the body text are the same size and sit on the same line, on your usual theme and on Minimal
- [ ] PHONE, Minimal theme: the Set footnote prefix sheet shows no box or outline around the field or the buttons, only the field's own border. Switch back to your theme afterwards
- [ ] PHONE or emulation: rapid popup entry, `Edit footnotes in a popup` ON, starting with the caret at the end of the `Fixture reference[^menu] for the long-press check.` line (not on the empty last line of the note, where a press is refused): three fast rounds of press, type a few characters, press to close, press again; every definition below ends up with exactly the text typed for it, closing feels immediate, and the console (if reachable) shows no `Cannot read properties of undefined (reading 'split')` errors
- [ ] PHONE or emulation: the plugin's commands sit on the mobile toolbar with their own icons and each one works from a tap; **Delete footnote everywhere** and the two convert commands can be added like the rest and their icons read at toolbar size (the popup stays open when a toolbar tap launches a command)
- [ ] PHONE: the plugin's settings page at phone width: the **Placement relative to punctuation** description reads well and does not cut off, and the bullet lists in the descriptions of **Preferred footnote naming style**, **Placement relative to punctuation**, **Per-note footnote prefix**, and the carry toggle keep a modest indent that still reads

[^menu]: the definition to rename
[^convert]: a normal note
[^carry]: only the carry fixture uses this one
