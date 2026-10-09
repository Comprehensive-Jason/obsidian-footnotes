---

# 20b: beta 7, lint alerts (2026-10-09)

Claude: a companion to sheet 20, added 2026-10-09. Automated coverage: what the lint writes and which alerts it shows for each fixture below are pinned in test/lint-held-alerts.test.ts, test/lint-underlined-lazy-label-alert.test.ts, test/hunt/spec-punctuation-rule-space-before-reference.test.ts, and test/hunt/bug-held-section-heading-silent.test.ts; run `npm test` before this sheet. What is left is how the alerts read when they show, and how the attached references look in Reading view.

This note opens with a line of three hyphens and has no other, for the last check: a footnote section heading that starts with such a line would turn everything above it into frontmatter.

Settings: defaults for the first two checks (**Placement relative to punctuation** on After punctuation, **Enable section heading** OFF, every lint rule at its default). Undo after each lint.

- [ ] Run **Lint footnotes**. Two alerts show, and each reads well on its own. The held change (stage 5 of the result gate design, 2026-10-08): "This note has a footnote reference the lint could not move to the other side of its punctuation (`"[^free]"`), and the lint left it in place, because moving it would change how Obsidian reads the lines around it." The label that needs a blank line on both sides (Jason's ruling Q9, 2026-10-07): "This note has a footnote definition that Obsidian reads as plain text (`"[^lazy]:"`). Put a blank line above it and another below it." (The three other held-change alerts, for a footnote prefix, a rename, and definitions left out of order, use the same pattern; their shapes are too rare to stage here and are pinned in test/lint-held-alerts.test.ts.)
- [ ] After that lint, the two references typed with a space before them are attached to their words (Jason's ruling Q35, 2026-10-09): the first fixture line reads `Oysters filter water.[^w]` and the second `A claim,[^claim] and more.` In Reading view each superscript sits right after its punctuation, with no gap in front of it. One Ctrl+Z brings the spaces back
- [ ] Turn **Enable section heading** ON and set **Section heading** to two lines, `---` and then `## Footnotes` (the setting accepts dividers; press Enter between the two). Run **Lint footnotes** again: the same two references are attached, no heading is added, and besides the two alerts above a third reads "The lint could not add the footnote section heading, because it would change how Obsidian reads the text around it." (Jason's ruling 2 of the subtraction follow-ups, 2026-10-09; before, the lint held the heading back without a word). Undo, and keep this heading setting for sheet 20c

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
