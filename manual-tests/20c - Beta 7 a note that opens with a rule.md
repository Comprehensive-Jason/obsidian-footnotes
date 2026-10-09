---

# 20c: beta 7, a note that opens with a rule (2026-10-09)

Claude: a companion to sheet 20, added 2026-10-09. This note opens with a line of three hyphens, has no other, and holds no footnote yet, so the first footnote written here would bring the section heading with it, and a heading that starts with such a line would turn everything above it into frontmatter. The plugin refuses that edit, and these are the places where its most general words show. Automated coverage: both refusals are pinned in test/hunt/bug-frontmatter-from-nothing-notice.test.ts; run `npm test` before this sheet. What is left is how the words read.

Settings: **Enable section heading** ON, and **Section heading** set to two lines, `---` and then `## Footnotes` (the setting accepts dividers; press Enter between the two), as the last check of sheet 20b leaves them. Everything else default, with `Edit footnotes in a popup` OFF. Put your own section heading settings back afterwards. Undo between checks.

- [ ] Select the word `beta` in the fixture line at the bottom and press the numbered key: nothing changes, and the notice reads "No footnote was created: it would change how Obsidian reads the text around it." (the general refusal; Jason's wording for this selection, 2026-10-09)
- [ ] On sheet 20, select `a phrase with its own footnote[^src]` in its Carry source line and press Ctrl+C. Back here, click at the end of the fixture line and press Ctrl+V: nothing is pasted, and the notice reads "Nothing was pasted: it would change how Obsidian reads the text around it."

Fixture: alpha beta gamma, the line the checks above select in and paste after.
