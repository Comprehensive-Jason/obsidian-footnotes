# Manual footnote tests

- Use default settings unless a sheet says otherwise. Every sheet holds the fixtures it needs.
- Undo (Ctrl+Z) between checks.
- The automated tests are run before a pass, so the sheets hold only what needs a person.
- The vault folder "Footnote Tests" is a copy of the repo's `manual-tests/`. Move finished sheets to "Footnote Tests USED" rather than leaving ticked boxes here.

If every footnote hotkey is dead, check that the plugin is enabled.

| Sheet | Theme | Checks |
| --- | --- | --- |
| 01 | Named footnotes: undo after the two-step flow | 1 |
| 02 | The popup editor | 5 |
| 03 | Navigation | 2 |
| 04 | Selection to footnote: undo, the name modal, rendering | 5 |
| 05 | Selection block zoo: how each block renders in a footnote | 14 |
| 06 | Tables | 1 |
| 07 | Rename footnote: the command and the right-click menu | 6 |
| 08 | Footnote prefix: the Set footnote prefix command | 2 |
| 09 | Footnote prefix and the linter | 1 |
| 10 | An invalid footnote-prefix property | 1 |
| 11 | Protected text, Reading view, and `%%` comments | 2 |
| 11b | A note that ends inside an open code fence | 2 |
| 12 | Lint triggers, the settings page, and the command palette | 7 |
| 14 | Definition labels right after a prose line | 2 |
| 15 | Delete footnote everywhere | 9 |
| 16 | Footnote reference placement | 9 |
| 17 | Converting between footnote styles | 10 |
| 18 | Copying, cutting, and pasting footnotes (18b is its paste target) | 12 |
| 20 | Beta 7: notices, Reading view, cut, paste, and undo | 14 |
| 20b | Beta 7: lint alerts | 3 |
| 20c | Beta 7: a note that opens with a rule | 2 |
| 20d | Beta 7: a very long footnote | 1 |
| P | Phone and mobile emulation, once a beta reaches the phone | 21 |
