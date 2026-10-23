---

# 20b: beta 7, lint alerts

The `---` line at the top is part of the fixture; the note has no other.

Settings: defaults for the first two checks (**Placement relative to punctuation** on After punctuation, **Enable section heading** OFF, every lint rule at its default). Undo after each lint.

- [ ] Run **Lint footnotes**. Two alerts show, and each reads well on its own. The held change: "This note has a footnote reference the lint could not move to the other side of its punctuation (`"[^free]"`), and the lint left it in place, because moving it would change how Obsidian reads the lines around it." The label that needs a blank line on both sides: "This note has a footnote definition that Obsidian reads as plain text (`"[^lazy]:"`). Put a blank line above it and another below it."
- [ ] After that lint, the two references typed with a space before them are attached to their words: the first fixture line reads `Oysters filter water.[^w]` and the second `A claim,[^claim] and more.` In Reading view each superscript sits right after its punctuation, with no gap in front of it. One Ctrl+Z brings the spaces back
- [ ] Turn **Enable section heading** ON and set **Section heading** to two lines, `---` and then `## Footnotes` (press Enter between the two). Run **Lint footnotes** again: the same two references are attached, no heading is added, and besides the two alerts above a third reads "The lint could not add the footnote section heading, because it would change how Obsidian reads the text around it." Undo, and keep this heading setting for sheet 20c

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
