# 11: protected text and read-only views

Automated coverage: 26 former checks now live in test/manual-protected-text.test.ts and the smoke suite; run `npm test` and `npm run test:smoke` before this sheet.

Settings: defaults; the lint half needs all lint rules ON. Undo between checks. Every fixture is already in this note.

Pinned by units and smoke, not repeated here: creation refused in code, math, comments and frontmatter by all four insert hotkeys; creation working again just outside a code span, at `$5 or [^n]$6`, and in front of a lone backslash; navigation unaffected by the guards; the Properties-widget refusal and its Rename message; the lint leaving every protected region byte-for-byte while the live references swap; the numbered command reserving nothing from a protected shape; the presses and the lint over the `%%` fixture below, orphan deletion included; the wrapped code span's numbering and alerts; and the refusals in block syntax (since 2026-10-03 a caret in front of or inside a quote or list marker, a task box, or heading marks, or on a thematic break or a setext underline, gets its own notice, "No footnote was created: a footnote here would break the line's formatting. Move the caret into the text.") and next to a link (since 2026-10-04 a press on the last word of `[sic]` or `[text]` gets "No footnote was created: Obsidian would read it as part of a link."; the protected-text notice is now only for code, math, comments, and other protected text).

## Reading view (fixed 2026-08-08)

Switch this note to Reading view:

- [ ] The footnote commands are missing from the command palette while in Reading view; **Set footnote prefix** stays available (a frontmatter edit is fine there)

## Obsidian `%%` comments (2026-09-09)

Obsidian hides a `%%` comment but still parses it: a reference inside a comment is a real reference (it binds its definition and takes a number, though its own superscript is hidden), while a definition inside a `%%` block comment is dead. A `%%` at the start of a line with no second `%%` on that line opens a block comment through the next `%%` anywhere; a mid-line `%%` pairs only within its own line. The plugin matches this. This rendering is the ground truth the units are written against, so it is worth re-checking by eye.

Hidden reference, live definition: november[^n1] here.
%%
A commented paragraph with a hidden reference[^n2] in it.
%%

Dead definition: oscar[^o1] here.
%%
[^o1]: this definition sits inside a comment and never renders
%%

Inline comment with a hidden reference: papa %%hidden[^n3]%% here.

Numbering counts hidden references: romeo[^1] %%hidden[^2]%% sierra[^3] here.

A comment-only line is still a paragraph line, tango[^p9] here:
%% a comment-only line %%
[^p9]: a label right under a comment line (lazy)

An HTML comment line is a block, uniform[^h1] here:
<!-- an HTML comment line -->
[^h1]: a label right under an HTML comment line (a definition)

[^n1]: november
[^n2]: the hidden reference's definition: it renders, with no visible marker
[^n3]: papa's hidden reference's definition
[^1]: romeo
[^2]: the hidden second reference's definition
[^3]: sierra

- [ ] Reading view: `[^n1]`, `[^h1]`, `[^1]`, `[^3]` render as footnotes; the `n2`, `n3`, and `2` entries appear in the footnote list (each with a back-arrow) though no marker is visible for them; `sierra` shows as `[3]`, not `[2]`; `oscar[^o1]` renders as plain text; `tango[^p9]` renders as plain text and the `[^p9]:` line reads as prose
