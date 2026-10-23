# 16: footnote reference placement

Settings: defaults except where a check says otherwise. Undo between checks.

## The settings page

- [ ] Settings > Footnote Shortcut: **Placement relative to punctuation**, in the Footnote reference placement section, is a dropdown with three choices (After punctuation, Before punctuation, Don't move), it shows After punctuation on a fresh install, and its description reads well and fits without cutting off on a phone-width window
- [ ] Settings search for "placement" finds it

## Inserting under each placement

Put the caret inside the word "bravo" in each sentence below and press the numbered footnote hotkey, then undo.

- [ ] After punctuation: This is "some bravo". The reference lands after the closing quote AND the full stop
- [ ] Before punctuation: This is "some bravo". The reference lands after the closing quote and in front of the full stop
- [ ] Before punctuation, Chinese: 这是一个句子，引用来源。 with the caret in 来源: the reference lands in front of the 。 and Reading view shows the superscript before the full stop
- [ ] Before punctuation, quoted Chinese: 他说「引用来源。」 with the caret in 来源: the reference lands after the 」 (outside the quote)
- [ ] Don't move: in Settings > Linting, **Fix footnote reference placement** is greyed out. This is "some bravo". The reference lands right after `bravo`, inside the closing quote, and running **Lint footnotes** afterwards moves nothing. Set the placement back to After punctuation

## Inline footnotes and the punctuation rule

Fixture: Content^[an inline note]. And "quoted^[another]". And a pair[^pair]^[third].

- [ ] Under After punctuation, run **Lint footnotes**: the inline footnotes move past the full stop and past the closing quote and full stop, whole, bodies untouched (`Content.^[an inline note]`, `"quoted".^[another]`), and the reference-plus-inline pair crosses the full stop together. Reading view renders them. Undo

## The lint rule under Before punctuation

Set the placement to Before punctuation, then run **Lint footnotes** on this note.

- [ ] The two references below move in front of their full stops, the quoted one stays outside its 」, the English one moves too, and one undo brings all of them back. The inline footnotes in the section above follow the same rule: the quoted one moves outside its closing quote and stays in front of the full stop (`"quoted"^[another].`), and the other two already sit in front of theirs

已有研究表明，该工艺可使能耗降低。[^gb] 他说「这是引文。」[^quote] An English sentence.[^en]

[^pair]: for the pair check in the inline footnotes section
[^gb]: GB/T 7714-2015 puts the marker before the full stop in its worked examples
[^quote]: outside the closing bracket in every convention
[^en]: an English sentence in the same note moves too under a global setting; that is the known cost of not having a per-language table
