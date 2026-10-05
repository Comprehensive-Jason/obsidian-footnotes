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
| 12 | Lint triggers (on save, on creation) and the settings page; the command palette and the settings text (from the feature-round sheet, 2026-10-04) | 7 |
| 14 | Definition labels directly after a prose line are prose (Obsidian's rule, matched 2026-09-09) | 2 |
| 15 | Delete footnote everywhere: the command, the right-click menu, undo (added 2026-09-21; its phone check moved to sheet P on 2026-10-04); the list-item delete from the feature-round sheet (2026-10-04) | 9 |
| 16 | Footnote reference placement: the dropdown, inserting under each placement, the lint rule under Before (added 2026-09-21); inline footnotes and the punctuation rule, from the feature-round sheet (2026-10-04) | 9 |
| 17 | Converting between footnote styles: both commands, undo, the transclusion round trip (added 2026-09-21; its phone check moved to sheet P on 2026-10-04); the naming styles and removing an empty section heading, from the feature-round sheet (2026-10-04) | 10 |
| 18 | Copying, cutting, and pasting footnotes: the real clipboard, a second note, other apps (added 2026-09-22), and a cut in the search box or the title left alone (2026-10-04); 18b is its paste-target companion and its phone checks moved to sheet P (both 2026-10-04); the matched-name paste and a cut through Notepad, from the feature-round sheet (2026-10-04) | 12 |
| P | Phone and mobile emulation, run on its own once a beta reaches the phone (lettered rather than numbered on 2026-10-04 so it stands apart from the desktop sheets), with the beta-only speed test on the "Footnote Speed Test" notes (added 2026-10-04) and the phone checks of sheets 15, 17, and 18 and the feature-round sheet, plus Obsidian's own Cut, Copy, and Paste buttons (2026-10-04) | 17 |

Sheet 19, the September 2026 feature round in one sitting (with its companion 19b), was retired on 2026-10-04: its checks repeated sheets 15 to 18 apart from thirteen, which moved onto sheets 12, 15, 16, 17, and 18 (and its phone checks onto sheet P); its second-pane check is left to the smoke suite ("lint leaves a second pane on the same note where it was").

Inter-plugin compatibility sheets live separately in the repo's `compat-tests/` folder (vault mirror: "Footnote Compat Tests"); they need other plugins installed and follow different pass/fail rules.

The repo's `manual-tests/` folder is the source of truth; the vault folder "Footnote Tests" is a synced copy. Move finished sheets to "Footnote Tests USED" rather than leaving ticked boxes here.

Troubleshooting: if EVERY footnote hotkey is dead, check the plugin is actually enabled; a killed smoke-test run once left it session-enabled only, so an Obsidian restart brought the vault up with the plugin off (smoke script fixed 2026-08-21).
