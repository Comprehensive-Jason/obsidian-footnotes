# 17: converting between footnote styles (2026-09-21)

Claude: automated coverage lives in test/convert-footnotes.test.ts (both transforms, the merge, every skip reason, the toasts, the command entries); run `npm test` before this sheet. What is left needs the live app: undo grouping, the toasts at a glance, Reading view, and the transclusion round trip. The phone check is on sheet P (moved 2026-10-04).

Settings: defaults. Undo between checks. Every fixture is in this note: two inline footnotes with the same body^[the same note] and again^[the same note], a different one^[a different note], a normal footnote cited twice[^twice] and here[^twice], a single-line one[^single], and a long one[^long].

## Inline to normal

- [ ] Run **Convert inline footnotes to normal footnotes**: the three inline footnotes above become numbered references, two definitions are appended after the last definition block (the two identical bodies share one), and the toast reads well ("Converted 3 inline footnotes into 2 normal footnotes (1 identical body merged).")
- [ ] One undo brings all three inline footnotes back and removes both definitions at once
- [ ] With **Lint on footnote creation** on, the same command lints straight after (references renumbered if needed) and the note reads right in Reading view

## Normal to inline

- [ ] Run **Convert normal footnotes to inline footnotes**: `[^twice]` becomes two identical inline copies, `[^single]` becomes one, `[^long]` stays with its definition, and the toast names `[^long]` with "more than one line" and says the twice-used definition became copies
- [ ] One undo restores the references and the definitions together

## The round trip

- [ ] Convert to inline, then back to normal: the twice-used footnote comes back as ONE definition with two references (the label is now a number; the sharing is restored)

## Naming styles

Moved here from the feature-round sheet on 2026-10-04. **Preferred footnote naming style** is Keep as written unless a check says otherwise.

- [ ] Set **Preferred footnote naming style** to **Named** and run **Convert inline footnotes to normal footnotes**: the three inline footnotes become `[^same]`, `[^same]`, and `[^different]`, with two definitions to match, and the toast is the same as under Keep as written. Undo
- [ ] Still under **Named**, make some numbered footnotes first: set the style to **Keep as written**, run **Convert inline footnotes to normal footnotes** (they become `[^1]`, `[^1]`, and `[^2]`), set **Named** again, and run **Lint footnotes**: `[^1]` becomes `[^same]` and `[^2]` becomes `[^different]`, each taking a word of its definition, while `[^twice]`, `[^single]`, and `[^long]` keep their names (the lint also moves the references past the commas, as the punctuation rule does), a second lint changes nothing, and Reading view still renders every footnote. Undo twice
- [ ] Set **Preferred footnote naming style** to **Numbered** and run **Lint footnotes**: the named footnotes become numbers by order of appearance, `[^twice]` to `[^1]`, `[^single]` to `[^2]`, and `[^long]` to `[^3]`, and the inline footnotes stay inline. Undo, and set the style back to Keep as written

## Removing an empty section heading

Moved here from the feature-round sheet on 2026-10-04.

- [ ] In a scratch note with **Enable section heading** on, one footnote under `# Footnotes`, and **Remove empty section heading** on (it is greyed out until the heading toggle is on), run **Convert normal footnotes to inline footnotes**: the heading and the blank lines above it go with the definition, and one undo brings all of it back. The same with **Delete footnote everywhere** on that footnote, and with Ctrl+X on a selection holding the footnote's only reference. With the setting off (the default), all three leave the heading standing. Turn both settings back off and delete the scratch note

[^twice]: cited twice, one line
[^single]: one line
[^long]: first line
    second line, so this one has no inline form
