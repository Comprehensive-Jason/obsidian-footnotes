---

# 20b: beta 7, lint alerts

The `---` line at the top is part of the fixture; the note has no other.

Settings: defaults for the first two checks (**Placement relative to punctuation** on After punctuation, **Enable section heading** OFF, every lint rule at its default). Undo after each lint.

- [ ] Run **Lint footnotes**. Two alerts show, and each reads well on its own. The label that needs a blank line on both sides: "Obsidian reads `"[^lazy]:"` as plain text, not as a footnote definition. Put a blank line above it and another below it." The held change: "The lint left `"[^free]"` as it is, because changing it would change how Obsidian reads the text around it. Fix it by hand."
- [ ] After that lint, the two references typed with a space before them are attached to their words: the first fixture line reads `Oysters filter water.[^w]` and the second `A claim,[^claim] and more.` In Reading view each superscript sits right after its punctuation, with no gap in front of it. One Ctrl+Z brings the spaces back
- [ ] Turn **Enable section heading** ON and set **Section heading** to two lines, `---` and then `## Footnotes` (press Enter between the two). Run **Lint footnotes** again: the same two references are attached, no heading is added, the label alert shows as above, and the held-change alert now reads "The lint left the footnote section heading and `"[^free]"` as they are, because changing them would change how Obsidian reads the text around them. Fix them by hand." Undo, and keep this heading setting for sheet 20c

The fixtures:

Oysters filter water [^w].

A claim [^claim], and more.

It was free[^free]!(sic) here.

Para text[^lazy]
[^lazy]: lazy text that Obsidian reads as more of the paragraph
===

[^w]: Smith 2020
[^claim]: Jones 2021
[^free]: the reference the lint cannot move past the exclamation mark
