# 11: protected text and read-only views

Settings: defaults, all lint rules ON.

## Reading view

Switch this note to Reading view:

- [ ] The footnote commands are missing from the command palette in Reading view; **Set footnote prefix** stays available

## Obsidian `%%` comments

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
