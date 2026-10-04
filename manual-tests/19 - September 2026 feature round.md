# 19: the September 2026 feature round, the checks no other sheet has (2026-09-22)

Claude: this sheet first gathered every human check of sheets 15 (delete), 16 (placement), 17 (conversions) and 18 (copy and paste) into one sitting before the beta. On 2026-10-04 it was trimmed to the checks no other sheet has (Jason's ask): the ones that only repeated sheets 15 to 18 are gone, and what is left is the list-item delete, two placement extras, the inline-footnote lint change, the naming styles, the second pane, the empty heading, two paste extras, and the icons and settings text. These are to move onto their theme sheets later, and then this sheet retires. Run `npm test` first; 3242 tests pass with 145 expected failures as of 2026-10-04. Every fixture is in this note or in the companion note **19b - Paste target**. Undo (Ctrl+Z) between checks unless a check says otherwise. Its phone checks are on sheet P (moved 2026-10-04).

Settings to start: defaults. **Placement relative to punctuation** = After punctuation, **Carry footnote definitions on copy, cut, and paste** on, **Preferred footnote naming style** = Keep as written, **Lint on footnote creation** off.

## 1. Delete footnote everywhere

Fixtures: a footnote used twice[^twice] and again[^twice], a right-click one[^menu], a chained one[^chain] whose definition cites another, and one inside a list item below.

- item with a footnote[^item]
- [^item]: defined inside the list item

- [ ] Caret inside `[^item]`, run **Delete footnote everywhere** from the palette: the reference and the definition text inside the list go together, and the bullet in front of the definition stays as an empty item, exactly as Obsidian's own delete leaves it (since 2026-10-03 a definition inside a list item or a quote counts like any other, so one that runs over more than one line goes whole too, bullet kept, instead of being refused). The lint alerts that follow every delete also name the nested footnote: `[^chain]`'s body cites `[^inner]`, and the plugin calls a reference inside a definition body a nested footnote (ADR 1)

## 2. Footnote reference placement

Fixtures: This is "some bravo". 这是一个句子，引用来源。 他说「引用来源。」

- [ ] Set **Before punctuation** and run **Lint footnotes** on this note. The two references in the lint fixture below move in front of their full stops, the quoted one stays outside its 」, the English one moves too (the known cost of one global setting), and one undo restores all of them

已有研究表明，该工艺可使能耗降低。[^gb] 他说「这是引文。」[^quote] An English sentence.[^en]

- [ ] Set **Don't move**. In Settings > Linting, **Fix footnote reference placement** is greyed out. Caret inside `bravo`, numbered hotkey: right after `bravo`, inside the closing quote (Don't move steps over nothing, your ruling of 2026-09-22); **Lint footnotes** moves nothing. Undo, set the placement back to **After punctuation**

## 3. Inline footnotes and the punctuation rule

Fixture: Content^[an inline note]. And "quoted^[another]". And a pair[^pair]^[third].

- [ ] Run **Lint footnotes**: the inline footnotes move past the full stop and past the closing quote and full stop, whole, bodies untouched (`Content.^[an inline note]`, `"quoted".^[another]`), and the reference-plus-inline pair crosses the full stop together. Reading view renders them. Undo

## 4. Converting between footnote styles

Fixtures: two inline footnotes with the same body^[the same note] and again^[the same note], a different one^[a different note], a single-line normal one[^single], and a long one[^long].

The command converts the whole note, so section 3's three inline footnotes (`^[an inline note]`, `^[another]`, `^[third]`) are converted with these three every time (corrected 2026-10-04: the sheet used to count only this section's three).

- [ ] Set **Preferred footnote naming style** to **Named** and run **Convert inline footnotes to normal footnotes**: this section's references read `[^same]`, `[^same]`, `[^different]`, and section 3's read `[^inline]`, `[^another]`, `[^third]`, with definitions to match. Undo
- [ ] Still under **Named**: this note has no numbered footnote of its own, so make some first. Set the style to **Keep as written**, run **Convert inline footnotes to normal footnotes** (the six become `[^1]` to `[^5]`), set **Named** again, and run **Lint footnotes**: those five take a word of their definition as their name (`[^inline]`, `[^another]`, `[^third]`, `[^same]`, `[^different]`), `[^twice]` and the other named ones stay as they are, a second lint changes nothing, and Reading view still renders every footnote. (The lint also moves references past punctuation and puts the definitions in reading order, as in sections 2 and 3.) Undo twice
- [ ] Set **Preferred footnote naming style** to **Numbered** and run **Lint footnotes**: the named footnotes become numbers by order of appearance. Undo
- [ ] Still under **Numbered**: split this note into two panes, scroll the second pane to the bottom with its caret on the last line, click back into the first pane, and run **Lint footnotes**: the first pane stays where its caret is, and the second pane keeps its caret on the last line and its scroll at the bottom (before 2026-09-24 it jumped to the top; the smoke suite checks this too, so this is the eye check). Undo, close the second pane, set the style back to Keep as written
- [ ] Empty heading: in a scratch note with **Enable section heading** on, one footnote under `# Footnotes`, and **Remove empty section heading** on (it is greyed out until the heading toggle is on), run **Convert normal footnotes to inline footnotes**: the heading and the blank lines above it go with the definition, one undo brings all of it back; the same with **Delete footnote everywhere** on that footnote, and with Ctrl+X on a selection holding the footnote's only reference. With the setting off (the default), all three leave the heading standing

## 5. Copying, cutting, and pasting

Open **19b - Paste target** in a second pane. Fixture paragraph: a paragraph with a shared footnote[^shared] and another use of it[^shared], one with its own[^own], and the chained one[^chain].

- [ ] A footnote that matches under another name: in 19b add a line `[^own]: a different body` at the bottom. Select the fixture paragraph above, Ctrl+C, click at the end of the line in 19b, Ctrl+V: `[^own]` arrives renamed to `[^own-2]` with its own definition, and the toast says 1 renamed. Ctrl+V once more: the toast says "3 reused, 1 matched an existing footnote (same definition, different name)", since `[^own-2]` already holds that body. Undo both pastes and remove the added line
- [ ] Cut `one with its own[^own]` and paste it into Notepad or a browser field: the definition line is there after the text; copy all of that from Notepad and paste it back into this note: it lands as a footnote again, not as a stray definition line. Undo

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
