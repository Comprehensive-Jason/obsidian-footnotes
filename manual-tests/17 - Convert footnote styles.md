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

[^twice]: cited twice, one line
[^single]: one line
[^long]: first line
    second line, so this one has no inline form
