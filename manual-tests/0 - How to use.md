# Manual footnote tests

One sheet = one theme (2026-09-08 restructure: the 43 scenario sheets were too many and split single features across several files). Every sheet states the settings it needs, carries EVERY fixture it uses (no typing or pasting to set a check up), and expects an undo (Ctrl+Z) between checks. Default settings unless a sheet says otherwise.

## 2026-09-20: the sheets hold only what needs a human

Claude: the 304 checks of 2026-09-08 were pruned on 2026-09-20 to the 55 that need a person in the real app (how something looks, feels, or behaves in the live editor, or wording judged by taste), and the sheets were renumbered 01 to 14 the same day, the ten sheets that had nothing left retired. Everything else moved to the automated layers: one `test/manual-<theme>.test.ts` file per former sheet pins what it used to ask for, or a scenario in `scripts/smoke-test.mjs` covers it. Before a manual pass, run both layers and read their results as the first checks of every sheet:

```
npm test
npm run test:smoke
```

The smoke suite drives the real plugin inside the running sandbox vault (Obsidian open, the hot-reload plugin on) and takes a few minutes.

| Sheet | Theme | Human checks |
| --- | --- | --- |
| 01 | Named footnotes: the two-step flow, the empty-reference guard | 1 |
| 02 | The popup editor: basics, persistence, rapid entry | 5 |
| 03 | Navigation: jumps both ways, tricky names, orphans, duplicates | 2 |
| 04 | Selection to footnote: conversions and their refusals | 5 |
| 05 | Selection block zoo: every block type travels whole | 13 |
| 06 | Tables: inserting in cells, converting in cells, cut refusals | 1 |
| 07 | Rename footnote: the command and the right-click menu | 6 |
| 08 | Footnote prefix: inserting under it, the Set footnote prefix command | 2 |
| 09 | Footnote prefix and the linter (apply-prefix rule) | 1 |
| 10 | A note whose footnote-prefix property is invalid | 1 |
| 11 | Protected text and read-only views: creation guards, Reading view, lint, Obsidian `%%` comments | 2 |
| 12 | Lint triggers (on save, on creation) and the settings page | 5 |
| 13 | Phone and mobile emulation (needs a beta on the phone), with the beta-only speed test on the "Footnote Speed Test" notes (added 2026-10-04) | 10 |
| 14 | Definition labels directly after a prose line are prose (Obsidian's rule, matched 2026-09-09) | 2 |
| 15 | Delete footnote everywhere: the command, the right-click menu, undo, the phone (added 2026-09-21) | 9 |
| 16 | Footnote reference placement: the dropdown, inserting under each placement, the lint rule under Before (added 2026-09-21) | 8 |
| 17 | Converting between footnote styles: both commands, undo, the transclusion round trip (added 2026-09-21) | 7 |
| 18 | Copying, cutting, and pasting footnotes: the real clipboard, a second note, other apps, the phone (added 2026-09-22), and a cut in a search box or the title left alone (2026-10-04) | 12 |
| 19 | The September 2026 feature round in one sitting: sheets 15 to 18 gathered, plus the inline-footnote lint change and the icons; 19b is its paste-target companion (added 2026-09-22) | 42 |

Inter-plugin compatibility sheets live separately in the repo's `compat-tests/` folder (vault mirror: "Footnote Compat Tests"); they need other plugins installed and follow different pass/fail rules.

The repo's `manual-tests/` folder is the source of truth; the vault folder "Footnote Tests" is a synced copy. Move finished sheets to "Footnote Tests USED" rather than leaving ticked boxes here.

Troubleshooting: if EVERY footnote hotkey is dead, check the plugin is actually enabled; a killed smoke-test run once left it session-enabled only, so an Obsidian restart brought the vault up with the plugin off (smoke script fixed 2026-08-21).

## Where the sheets of 2026-09-08 went

Code comments, tests, commit messages, and memory notes written before 2026-09-20 cite the 2026-09-08 numbers (a citation reads "former sheet 23" where the sheet is gone). This map keeps those citations readable.

| 2026-09-08 sheet | Now |
| --- | --- |
| 01 | `test/manual-numbered-footnotes.test.ts` |
| 02 | sheet 01 |
| 03 | `test/manual-inline-footnotes.test.ts` |
| 04 | sheet 02 |
| 05 | sheet 03 |
| 06 | sheet 04 |
| 07 | sheet 05 |
| 08 | sheet 06 |
| 09 | `test/manual-multiple-cursors.test.ts` |
| 10 | sheet 07 |
| 11 | `test/manual-section-heading.test.ts` |
| 12 | `test/manual-heading-already-in-the-note.test.ts` |
| 13 | `test/manual-divider-heading-already-in-the-note.test.ts` |
| 14 | sheet 08 |
| 15 | sheet 09 |
| 16 | sheet 10 |
| 17 | `test/manual-tricky-footnote-names.test.ts` |
| 18 | sheet 11 |
| 19 | retired 2026-09-11 |
| 20 | `test/manual-lint-rules.test.ts` |
| 21 | `test/manual-lint-stability.test.ts` |
| 22 | sheet 12 |
| 23 | `test/manual-lint-alerts.test.ts` |
| 24 | sheet 13 |
| 25 | sheet 14 |

## Where the sheets of before 2026-09-08 went

The 43 scenario sheets that came before carried ids like A19 and L12; older citations use them.

| Old | New | | Old | New |
| --- | --- | --- | --- | --- |
| A1, A2, A15 | `test/manual-numbered-footnotes.test.ts` | | L1 to L6 | `test/manual-lint-rules.test.ts` |
| A16 | sheet 01 | | L7, L8 | `test/manual-section-heading.test.ts` |
| A17 | `test/manual-inline-footnotes.test.ts` | | L9, L10, L15 | sheet 12 |
| A3, A12, A20 | sheet 02 | | L11 | sheet 09 |
| A22 | sheet 03 | | L12 | sheet 11 |
| A8, A9 | sheet 04 (tables to sheet 06) | | L13, L14 | `test/manual-lint-alerts.test.ts` |
| A13 | sheet 05 | | L16 | `test/manual-numbered-footnotes.test.ts` and `test/manual-lint-rules.test.ts` |
| A21 | sheet 06 | | L17 | `test/manual-lint-stability.test.ts` |
| A14 | `test/manual-multiple-cursors.test.ts` | | P1 | sheet 13 |
| A10, A11 | sheet 07 | | | |
| A4, A5 | `test/manual-section-heading.test.ts`, `test/manual-heading-already-in-the-note.test.ts`, `test/manual-divider-heading-already-in-the-note.test.ts` | | | |
| A6, A7 | sheet 08 (invalid property to sheet 10) | | | |
| A18, A19 | sheet 11 | | | |
| A23 | `test/manual-tricky-footnote-names.test.ts` (prefix items to sheet 08 and sheet 10) | | | |
| A24 | sheet 01, sheet 04, `test/manual-multiple-cursors.test.ts`, sheet 07, `test/manual-lint-alerts.test.ts` | | | |
