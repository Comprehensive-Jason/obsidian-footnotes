# 20: beta 7, one check behind every edit (2026-10-09)

Claude: written 2026-10-09 for 0.3.0-beta.7, whose headline is the result gate: every press, selection, paste, cut, and lint works out its change, reads the note as Obsidian would afterwards, and goes ahead only if nothing else would read differently (ADR 0003). Automated coverage: what each action below does to the text, and which notice it picks, is pinned by the unit tests (test/result-gate.test.ts, test/paste-back.test.ts, test/dead-footnote-notice.test.ts, and the hunt pins named in each check); the smoke suite cuts a first bullet, quote line, and callout line, pastes a bullet above a list, pastes a cut straight back after a cut from a definition's line, presses in front of a block id and checks the block stays linkable, and refuses a cited paste into the popup. Run `npm test` and `npm run test:smoke` before this sheet. What is left needs a person: how each new notice reads, what Reading view draws, and how cut, paste, and undo feel in the live editor. The companions are 20b (lint alerts), 20c (a note that opens with a rule), and 20d (a very long footnote); the phone checks for beta 7 are on sheet P.

Settings: defaults, with `Edit footnotes in a popup` OFF, so a press that goes through jumps to its new definition. Undo (Ctrl+Z) between checks. Every fixture is in this note, and none of its footnotes is numbered, so a press here always makes `[^1]`.

## A selection the plugin refuses

Switch this note to Source mode for this section (the plain-text editor, from the note's menu or the status bar), so the `>` and `-` markers show and can be selected. That each selection is refused with the note unchanged is pinned by units; what is left is whether each notice reads well and tells you what to do instead.

> The sky is blue today.

- [ ] Select from the very start of the quote line above through the word `sky`, so the selection takes the `> ` with it, and press the numbered key: nothing changes, and the notice reads "No footnote was created: the selection takes part of the line's formatting. Select the whole line, or only its text." (Jason's pick, 2026-10-08; spec-selection-from-margin-takes-marker)

List fixture:

- First point
- Second point
- Third point

End of the list fixture.

- [ ] Select the first two bullets of the List fixture whole, from the start of `- First point` to the end of `- Second point`, and press the numbered key: nothing changes, and the notice reads "No footnote was created: select one item's text, or the whole list." (Jason's ruling Q31, 2026-10-08)

Quote fixture:

> One.
> Two.
> Three.

End of the quote fixture.

- [ ] Select the first two lines of the Quote fixture whole, from the start of `> One.` to the end of `> Two.`, and press the numbered key: nothing changes, and the notice reads "No footnote was created: select one line's text, or the whole quote." (Jason's ruling Q33, 2026-10-09)

Escape fixture: the file sits in C:\notes today.

- [ ] Select the word `notes` in the Escape fixture and press the inline key: nothing changes, and the notice reads "No footnote was created: Obsidian wouldn't read it as a footnote here." (the backslash in front would escape the `^` of the new inline footnote; ruling 7 of the cycle 6 rulings, 2026-10-08; test/dead-footnote-notice.test.ts)

Switch back to Live Preview.

## A paste or a cut the plugin refuses

Carry source: a phrase with its own footnote[^src] and the rest of the line.

A host sentence whose footnote is the paste target[^host].

Code fixture: run `make notes` to build.

- [ ] Select `a phrase with its own footnote[^src]` in the Carry source line and press Ctrl+C. Click at the very end of the `[^host]:` definition at the bottom of this note and press Ctrl+V: nothing is pasted, and the notice reads "Nothing was pasted: the pasted footnotes would land inside another footnote." (Jason's rulings Q7 and Q20, 2026-10-07)
- [ ] With the same clipboard, click between `make` and `notes` inside the Code fixture's code span and press Ctrl+V: nothing is pasted, and the notice reads "Nothing was pasted: footnotes can't go inside code, math, or other protected text." (Jason's ruling Q15, 2026-10-07; spec-raw-paste-into-inline-code-escapes-span)

Cut fixture:

- Oysters filter[^filter] water

The next paragraph goes on
over two lines.
- and a list starts right under it

End of the cut fixture.

- [ ] Drag from just after `- Oysters` in the Cut fixture to just after `The next`, and press Ctrl+X: nothing is cut or copied, and the notice reads "Nothing was cut: it would change how Obsidian reads the text around it." (The editor's own cut would join the list under the paragraph to the bullet's list. Jason's ruling Q34, 2026-10-09, lets the same cut through when no list sits under the paragraph.)

## Reading view after a press or a selection

Each press below writes an empty definition at the bottom; Reading view still lists its footnote, so there is no need to type into it (probed on Obsidian 1.14.4, 2026-10-09).

Brackets fixture: as noted [see p. 5] here.

Email fixture: Write to me@example.com.

Block id fixture:

- An item ^i1
- Another item

See [[#^i1]] for the item.

- [ ] Brackets: put the caret right after the `5` in the Brackets fixture and press the numbered key: the line reads `as noted [see p. 5[^1]] here.` In Reading view the superscript sits inside the brackets, right after the 5, and footnote 1 is listed at the bottom (Jason's ruling Q2, 2026-10-07; before beta 7 the press was refused with the link notice)
- [ ] Email: put the caret at the very end of the Email fixture (after the full stop) and press the numbered key: the line reads `Write to me@example.com[^1].` (Jason's ruling Q30, 2026-10-08). In Reading view the address is still a link, the link stops at the end of `com` without taking the full stop, and the superscript and then the full stop follow it
- [ ] Block id: triple-click `- An item ^i1` in the Block id fixture (the whole line) and press the numbered key: the line becomes `- [^1] ^i1`, and the definition reads `[^1]: An item` (Jason's ruling Q32, 2026-10-09). In Reading view the bullet shows the superscript with the `^i1` hidden, and clicking the `^i1` link in the line under the list jumps to that bullet, not into the footnote (Obsidian 1.14.4 registered the block on the bullet's line, 2026-10-09)

## Cut, paste, and undo in the live editor

Paste-back fixture, its definition sitting above the paragraph that cites it:

[^back]: a definition that sits above the paragraph citing it

A paragraph that cites it[^back].

End of the paste-back fixture.

- [ ] A cut pasted straight back (ADR 0003, rule 2): select `A paragraph that cites it[^back].` from the start of its line to the end, and press Ctrl+X: the paragraph's text and the `[^back]:` definition above it both leave, with blank lines where they were, and the toast reads "Cut with 1 footnote definition that nothing else used; paste to carry it along." Without moving the caret, press Ctrl+V: the note is back exactly as it was, the definition in its old place above the paragraph and still named `[^back]`, with no paste toast. Then one Ctrl+Z takes the paragraph and the definition away again, together

Outline fixture:

- Oysters filter water[^outline].
  - up to 50 gallons a day
- Tides rise.

End of the outline fixture.

- [ ] Cutting a first bullet that has a sub-bullet (hunt cycle 8, V7; refused with "Nothing was cut" until 2026-10-09): in Source mode, put the caret at the very start of `- Oysters filter water[^outline].`, press Shift+Down so the whole line is selected, and press Ctrl+X. The line leaves, the `[^outline]:` definition at the bottom leaves with it, the cut toast shows, and `  - up to 50 gallons a day` and `- Tides rise.` stay. One Ctrl+Z brings the line and the definition back together

Duplicate fixture:

Water cites a source[^dup].

End of the duplicate fixture.

- [ ] Duplicating a paragraph by pasting it at its own start (hunt cycle 8, V9; refused until 2026-10-09): put the caret at the very start of `Water cites a source[^dup].`, press Shift+Down twice (the line and the blank line under it), press Ctrl+C, press Left once (the caret goes back to the start of the line), and press Ctrl+V. The paragraph is there twice, a blank line between, both citing `[^dup]`, which keeps its one definition, and the toast reads "Pasted with 1 footnote definition: 1 reused." One Ctrl+Z takes the copy away

## Convert inline to normal skips one footnote

Convert fixture: a plain inline footnote^[a plain note] and one whose text cites another^[see [^cvt] there].

- [ ] Run **Convert inline footnotes to normal footnotes**: the plain inline footnote becomes `[^1]` with its definition at the bottom, the other stays inline, and the toast reads "Converted 1 inline footnote into 1 normal footnote. Skipped 1 whose body holds a footnote." (Jason's decision 4 of the stage 3 report, 2026-10-08; spec-convert-inline-body-holds-reference. Before, the whole conversion was refused for that one footnote.) One Ctrl+Z puts the plain one back

[^src]: the carry source's own definition
[^host]: the host footnote's text, where a paste is refused
[^filter]: the cut fixture's footnote
[^outline]: Smith 2020, the outline's footnote
[^dup]: the duplicate fixture's footnote
