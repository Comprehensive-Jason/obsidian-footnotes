# 19: the September 2026 feature round in one sitting (2026-09-22)

Claude: one pass over everything built 2026-09-21 and 22, for Jason to run before the beta. It gathers the human checks of sheets 15 (delete), 16 (placement), 17 (conversions) and 18 (copy and paste), adds the inline-footnote lint change and the icons, and orders them so settings change as few times as possible. Run `npm test` first; 3239 tests pass with 145 expected failures as of 2026-10-04 (updated that day for the changes of 2026-10-03 and 04: section 4's conversion counts, the skipped footnotes, and the cut of a shared footnote). Every fixture is in this note or in the companion note **19b - Paste target**. Undo (Ctrl+Z) between checks unless a check says otherwise. Its phone checks are on sheet P (moved 2026-10-04).

Settings to start: defaults. **Placement relative to punctuation** = After punctuation, **Carry footnote definitions on copy, cut, and paste** on, **Preferred footnote naming style** = Keep as written, **Lint on footnote creation** off.

## 1. Delete footnote everywhere

Fixtures: a footnote used twice[^twice] and again[^twice], a right-click one[^menu], a chained one[^chain] whose definition cites another, and one inside a list item below.

- item with a footnote[^item]
- [^item]: defined inside the list item

- [ ] Caret inside the FIRST `[^twice]`, run **Delete footnote everywhere** from the palette: both references and the definition go, the toast reads well ("2 references and 1 definition")
- [ ] One undo brings both references and the definition back together, caret where it was
- [ ] Caret inside the `[^twice]:` label at the bottom: the same deletion from the definition's end
- [ ] Caret inside `[^chain]`: it goes, and a lint alert then names `[^inner]` as a definition nothing references (the deleted body was its only citation). Every delete in this section is followed by the lint alerts, which is why the nested-footnote alert also speaks while `[^chain]` exists: its body cites `[^inner]`, and the plugin calls a reference inside a definition body a nested footnote (ADR 1)
- [ ] Caret inside `[^item]`: the reference and the definition text inside the list go together, and the bullet in front of the definition stays as an empty item, exactly as Obsidian's own delete leaves it (since 2026-10-03 a definition inside a list item or a quote counts like any other, so one that runs over more than one line goes whole too, bullet kept, instead of being refused)
- [ ] Right-click ON `[^menu]`: the menu shows **Delete footnote everywhere** with your new icon, in the same section as **Rename footnote**, and the menu is no wider than before; choosing it deletes with the same toast
- [ ] Right-click the first `[^twice]` and choose Obsidian's OWN **Delete footnote and reference**: only that reference and the definition go, the second `[^twice]` is left pointing at nothing. This is the core bug the command exists to fix; undo

## 2. Footnote reference placement

Fixtures: This is "some bravo". 这是一个句子，引用来源。 他说「引用来源。」

- [ ] Settings page: **Placement relative to punctuation**, in the Footnote reference placement section, is a dropdown (After punctuation, Before punctuation, Don't move), shows After punctuation, and its description reads well; settings search for "placement" finds it
- [ ] After punctuation (default): caret inside `bravo`, numbered hotkey: the reference lands after the closing quote AND the full stop. Undo
- [ ] Set **Before punctuation**. Same press: after the closing quote, in front of the full stop. Undo
- [ ] Before, Chinese: caret in 来源 of the first Chinese sentence: the reference lands in front of the 。 and Reading view shows the superscript before the full stop. Undo
- [ ] Before, quoted Chinese: caret in 来源 of the quoted sentence: the reference lands after the 」, outside the quote. Undo
- [ ] Still Before: run **Lint footnotes** on this note. The two references in the lint fixture below move in front of their full stops, the quoted one stays outside its 」, the English one moves too (the known cost of one global setting), and one undo restores all of them

已有研究表明，该工艺可使能耗降低。[^gb] 他说「这是引文。」[^quote] An English sentence.[^en]

- [ ] Set **Don't move**. In Settings > Linting, **Fix footnote reference placement** is greyed out. Caret inside `bravo`, numbered hotkey: right after `bravo`, inside the closing quote (Don't move steps over nothing, your ruling of 2026-09-22); **Lint footnotes** moves nothing. Undo, set the placement back to **After punctuation**

## 3. Inline footnotes and the punctuation rule

Fixture: Content^[an inline note]. And "quoted^[another]". And a pair[^pair]^[third].

- [ ] Run **Lint footnotes**: the inline footnotes move past the full stop and past the closing quote and full stop, whole, bodies untouched (`Content.^[an inline note]`, `"quoted".^[another]`), and the reference-plus-inline pair crosses the full stop together. Reading view renders them. Undo

## 4. Converting between footnote styles

Fixtures: two inline footnotes with the same body^[the same note] and again^[the same note], a different one^[a different note], a single-line normal one[^single], and a long one[^long].

The command converts the whole note, so section 3's three inline footnotes (`^[an inline note]`, `^[another]`, `^[third]`) are converted with these three every time (corrected 2026-10-04: the sheet used to count only this section's three).

- [ ] Run **Convert inline footnotes to normal footnotes**: the six inline footnotes (section 3's three and this section's three) become numbered references `[^1]` to `[^5]`, five definitions are appended after the last definition block (the two identical bodies share one), the toast reads "Converted 6 inline footnotes into 5 normal footnotes (1 identical body merged)." (the nested-footnote alert about `[^chain]` follows it, as in section 1)
- [ ] One undo brings all six inline footnotes back and removes all five definitions
- [ ] Set **Preferred footnote naming style** to **Named** and run the command again: this section's references read `[^same]`, `[^same]`, `[^different]`, and section 3's read `[^inline]`, `[^another]`, `[^third]`, with definitions to match. Undo
- [ ] Still under **Named**: this note has no numbered footnote of its own, so make some first. Set the style to **Keep as written**, run **Convert inline footnotes to normal footnotes** (the six become `[^1]` to `[^5]`), set **Named** again, and run **Lint footnotes**: those five take a word of their definition as their name (`[^inline]`, `[^another]`, `[^third]`, `[^same]`, `[^different]`), `[^twice]` and the other named ones stay as they are, a second lint changes nothing, and Reading view still renders every footnote. (The lint also moves references past punctuation and puts the definitions in reading order, as in sections 2 and 3.) Undo twice
- [ ] Set **Preferred footnote naming style** to **Numbered** and run **Lint footnotes**: the named footnotes become numbers by order of appearance. Undo, set it back to Keep as written
- [ ] Still under **Numbered**: split this note into two panes, scroll the second pane to the bottom with its caret on the last line, click back into the first pane, and run **Lint footnotes**: the first pane stays where its caret is, and the second pane keeps its caret on the last line and its scroll at the bottom (before 2026-09-24 it jumped to the top). Undo, close the second pane, set the style back to Keep as written
- [ ] Turn **Lint on footnote creation** on and run the same command: it lints straight after (numbering follows the text) and the note reads right in Reading view. Undo, turn the setting off
- [ ] Run **Convert normal footnotes to inline footnotes**: `[^twice]` (if you restored it) becomes identical inline copies, `[^single]` becomes one, `[^long]`, `[^item]`, `[^chain]`, and `[^inner]` stay, and the toast names those four with their reasons and says how many definitions became copies: `Converted 9 footnotes into inline footnotes at 11 references (2 definitions used more than once became copies). Skipped "[^item]" (inside a list item), "[^chain]" (its body holds a footnote), "[^inner]" (referenced from inside another footnote), "[^long]" (more than one line).` (the toast is in code style here only so its names do not count as references in this note; `[^chain]` and `[^inner]` stay because an inline footnote cannot hold a reference, ADR 1; the sheet used to leave them out)
- [ ] One undo restores references and definitions together
- [ ] Empty heading: in a scratch note with **Enable section heading** on, one footnote under `# Footnotes`, and **Remove empty section heading** on (it is greyed out until the heading toggle is on), run **Convert normal footnotes to inline footnotes**: the heading and the blank lines above it go with the definition, one undo brings all of it back; the same with **Delete footnote everywhere** on that footnote, and with Ctrl+X on a selection holding the footnote's only reference. With the setting off (the default), all three leave the heading standing
- [ ] Round trip: run **Convert normal footnotes to inline footnotes**, then **Convert inline footnotes to normal footnotes**. The note does not come back byte for byte, since this section's inline fixtures become normal footnotes too, so check three footnotes instead: the one that was `[^twice]` is ONE definition with two numbered references again (the sharing is restored, the name is now a number), `[^single]` is one reference with one definition, and `[^long]`, `[^item]`, `[^chain]`, and `[^inner]` never moved. Undo twice

## 5. Copying, cutting, and pasting

Open **19b - Paste target** in a second pane. Fixture paragraph: a paragraph with a shared footnote[^shared] and another use of it[^shared], one with its own[^own], and the chained one[^chain].

- [ ] Select the fixture paragraph, Ctrl+C, click at the end of the line in 19b, Ctrl+V: the text lands, definitions for `shared`, `own`, `chain` and `inner` are appended after `[^1]: an existing one`, the toast reads "Pasted with 4 footnote definitions: 4 added." (a zero count is never said), Reading view renders every footnote
- [ ] One undo in 19b removes the text and all four definitions together
- [ ] Ctrl+V twice (the undo above took the first paste back, so the first of these two says "4 added" again): the second toast says "4 reused" and the references point at the existing definitions. Paste once more after the `[^own-2]` rename of the next check: the toast says "3 reused, 1 matched an existing footnote (same definition, different name)"
- [ ] In 19b add a line `[^own]: a different body` at the bottom, Ctrl+V again: `[^own]` arrives renamed to `[^own-2]` with its own definition, toast says 1 renamed
- [ ] Copy `Existing[^1] text.` from 19b, paste it here at the end of a paragraph: it lands as `[^1]` with its definition (this note has no `[^1]`). Undo
- [ ] Cut: select exactly `one with its own[^own]` and Ctrl+X: the phrase and the `[^own]` definition leave in the SAME undo step, the toast says one definition was cut; Ctrl+V elsewhere in this note brings both back. Undo twice
- [ ] Cut one of the two `[^shared]` uses: the definition stays (the other use still needs it) and no toast shows; the clipboard text carries a copy of the definition, and pasting it elsewhere in this note reuses the existing definition (toast: "1 reused")
- [ ] Paste the copied paragraph into Notepad or a browser field: the text, then a blank line, then the four definition lines (they travel in the clipboard text on purpose, so a cut pasted outside Obsidian loses nothing)
- [ ] Cut a phrase whose footnote only it uses, paste it into Notepad: the definition line is there; paste it back into this note: it lands as a footnote again, not as a stray definition line

## 6. Icons and the palette

- [ ] Command palette: **Delete footnote everywhere**, **Convert inline footnotes to normal footnotes** and **Convert normal footnotes to inline footnotes** are listed, each with its icon (the two convert icons are placeholders until yours land; the delete icon is yours). On a beta build the palette also lists **Benchmark footnote parsers on this note**, with no icon: it is beta-only, for the phone speed test on sheet P, and is to go before the 0.3.0 stable release
- [ ] Settings page: command and setting names in the descriptions are bold and footnote syntax is in code style (the naming dropdown and the prefix toggle show both); **Preferred footnote naming style**, **Placement relative to punctuation**, **Per-note footnote prefix**, and the carry toggle break their descriptions into bullet lists (one value or case per bullet, no full stop at the end of a bullet, a closing line after the list where there is one); settings search for "meaningful" still finds the naming dropdown, which proves the search reads formatted descriptions

[^twice]: cited twice, one line
[^pair]: for the pair check in section 3
[^menu]: the right-click fixture
[^chain]: this body cites[^inner] another
[^inner]: only the chained body cites this
[^gb]: GB/T 7714-2015 puts the marker before the full stop in its worked examples
[^quote]: outside the closing bracket in every convention
[^en]: an English sentence in the same note moves too under a global setting
[^single]: one line
[^long]: first line
    second line, so this one has no inline form
[^shared]: used twice in the paste fixture
[^own]: used once in the paste fixture
