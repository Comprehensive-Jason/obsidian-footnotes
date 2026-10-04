# How Obsidian reads footnotes: the observed rules

Drafted by Claude (Opus 5.5), for Jason's review. These are observations, not rulings.

Obsidian's Reading view, its metadata cache, and Obsidian Publish share one Markdown parser, a fork of remark-parse 8 with readers of Obsidian's own. Its code is closed, so the plugin's reader (`src/parsing/obsidian-markdown.ts`) is written clean room: it starts from remark-parse 8.0.3, remark-footnotes 2.0.0, and remark-math 3.0.1, and adds one small named reader per rule below. The code cites the rules by their letter and number. Every rule rests on notes saved with Obsidian's answers in `test/obsidian-answers/`, which the referee suite (`test/obsidian-referee.test.ts`) checks the reader against.

How the rules were found: the oracle (`scripts/oracle/`, described in `TESTING.md`) feeds notes to Obsidian's own parser through the undocumented `app.metadataCache.computeMetadataAsync`, compares its answer with the reader's, shrinks each disagreement to a short note, and then families of notes vary one thing at a time around it until the rule can be said in a sentence or two. Reading view is the court of appeal: one note per cluster was rendered there.

App: Obsidian 1.14.4 (installer 1.14.3), desktop, `app.isMobile` false on every call. Not covered: mobile, Live Preview's editor parse, and notes with Windows line breaks beyond a few frontmatter probes.

Notation: a note is written as one string, `\n` is a line break, `\t` a tab, and `/` separates lines in running text. Lines and columns are counted from 1. "Stock" means remark-parse 8.0.3 with remark-footnotes 2.0.0 and remark-math 3.0.1, as they come.

## Where the reader stands

| Notes | Reader agrees | Scanner agrees |
|---|---|---|
| Fuzz, seed 20261003, 3000 container-heavy notes | 3000 | 1683 |
| Broad run, seed 20261004, 20,000 notes | 19,844 | 8,177 |
| Broad run, seed 20261005, 20,000 notes (a fresh check after the fixes) | 19,837 | 8,251 |
| Container-heavy run, seed 20261006, 20,000 notes (the fuzz generator) | 20,000 | 11,535 |

The scanner column is history: the plugin has read notes through the reader since the runtime swap (2026-10-03), and the hand-written scanner is gone.

"Agrees" means the oracle's comparison finds nothing: the same definitions with the same last lines, the same live references at the same places, and every line of an Obsidian code block protected. The broad generator (`generateBroadNotes` in `scripts/oracle/generate.mjs`) writes notes the way people write them as well as the container-heavy shapes; its notes hold frontmatter, wikilinks, tables, nested callouts, long definitions, and text in other scripts. Every note the reader still disagrees on (156 and 163) is one of the column quirks under P below, where Obsidian reports the wrong column. In about 290 notes of each run the oracle could not ask whether some reference is live (frontmatter notes, where it cannot put its probe definitions at the top, and notes that end inside an unclosed block); the comparison leaves those references out. At the start of that night, before the fixes and with the older harness, the reader agreed on 17,355 of the first run's notes and the scanner on 8,427.

## A. Callouts

**A1. What a callout title is.** A quote is a callout when its first line, after `>` and at most one space, is `[!type]`, then at most one `+` or `-`, then the end of the line, a space, or a tab. The type is one or more characters other than `]`; spaces, `|`, digits, and a second `!` are all fine.

- Callouts: `> [!note]`, `>[!note]`, `> [!NOTE]`, `> [!note]+`, `> [!note]-`, `> [!note]- Title`, `> [!note]\tTitle`, `> [!note]  Title`, `> [!note] ` (a trailing space), `> [!my note]`, `> [!note|meta]`, `> [!123]`, `> [!!note]`.
- Not callouts (the next line is lazy paragraph text): `> [!note]Title`, `> [!note]+Title`, `> [!note]+-`, `> [!note](x)`, `> [!no]te]`, `> [!]`, `>  [!note]` (two spaces after `>`). `>\t[!note]` is quoted indented code.

**A2. The title line stands alone.** The line after a title starts a fresh block, as if the title were a closed paragraph. `> [!note]\n> [^1]: def` defines [^1] on line 2; `> [!note]\n>     code[^2]` is quoted code, so [^2] is dead; `> [!note]\n> 2. [^1]: def` defines [^1]. The quote still collects its lines as stock does, lazy column-0 lines included; only its content is split after the title. So `> [!note]\nlazy[^2]\n> [^1]: def` is one callout whose body paragraph swallows the label as lazy text.

**A3. Only the quote's first line.** `> text\n> [!note]\n> [^1]: def` is a plain quote: no definition.

**A4. The text after the marker is block content of its own line.** One space or tab after the marker is skipped, and the rest is read as blocks: `> [!note] [^1]: def` defines [^1] on line 1 (and only line 1, so `> continued[^2]` below it is a separate paragraph), and so do `> [!note] - [^1]: def` and `> [!note] > [^1]: def`. `> [!note]     code[^2]`, `> [!note]\t\tTitle[^1]`, and `> [!note] \tTitle[^1]` make the title text indented code, so the reference is dead; `> [!note]\tTitle[^1]` and `> [!note]\t  Title[^1]` hold a live reference. A reference after a definition on the title line sits at its true column (`> [!note] [^1]: abc [^2]` puts [^2] at column 21); the reader once placed it short by the marker's length, about 1,100 notes of the 2026-10-03 run.

**A5. Nesting.** A callout inside a callout, in a list item (`- > [!note]\n  > [^1]: def`), or as an item's second block behaves as A2.

## B. Lists

**B1. A tab after the marker starts an item.** `-\t[^1]: def` (likewise `*`, `+`, `1.`, `1)`, `2.`, `10.`) is a definition inside a list item. `-\t\t[^1]: def` and `- \t[^1]: def` are code inside the item. Stock.

**B2. Content column and code threshold.** For a line after a blank line, Obsidian matches stock exactly. The label is outside the item below the first number, inside up to the second, and indented code from the third:

| Item | Outside | Inside | Code |
|---|---|---|---|
| `- `, `* `, `+ `, `- \t`, `-     ` (5 spaces) | 1 space | 2-5 | 6+ |
| `-  ` | 1-2 | 3-6 | 7+ |
| `1) ` | 1-2 | 3-6 | 7+ |
| `1. ` | 1-2 | 3-7 | 8+ |
| `-   `, `1.  `, `10. `, `-\t`, `-\t\t`, `10.\t` | 1-3 | 4-7 | 8+ |
| `-    ` (4 spaces) | 1-3 | 5-8 (4 is code) | 9+ |
| `100. ` | 1-3 | 5-8 (4 is code) | 9+ |

A tab in the indentation is consumed whole, so `\t` and `\t  ` count as inside the `- ` item, and `  \t` as code.

**B3. A lazy line does not cancel an item's de-indentation.** Stock remark-parse strips an item's lines by the smallest indentation among them, and a line with no indentation at all (a lazy line) makes that zero, so every 4-space line after it becomes code. Obsidian leaves unindented lines out of the minimum. So `- a\nlazy\n\n    [^1]: def` defines [^1] inside the item. The reader vendors stock's list reader with this one change (`src/parsing/remark-parse-list.js`).

**B4. Laziness and what ends an item.** Column-0 text after an item's paragraph is lazy, and so is a column-0 label (`- item\n[^1]: def` defines nothing). After an in-item definition's text, a column-0 label starts a new definition. Fences, `$$` blocks, and HTML blocks inside items and quotes run on through column-0 lines. A column-0 heading, list item, or fence opener ends the item; so does a blank line followed by column-0 text. Stock.

**B5. Ordered markers other than 1.** `2.`, `2)`, and `0.` cannot interrupt a paragraph or a definition's text, and cannot start a nested list under an item's paragraph. At column 0 under a bullet item they start a new list. Stock.

**B6. An in-item definition's continuation after a blank line** needs as much indentation as the B2 code threshold. Stock.

**B7. Empty items.** `+  \n\n\n    It[^2]` keeps the item open across two blank lines. A bare `-` directly under a label line is a setext underline (D3). Stock.

## C. Tables

**C1. Header and delimiter must share a pipe style.** A row's style is whether its very first character is `|`. A row indented by even one space does not start with a pipe. So `| a | b |\n| --- | --- |` and `a | b\n--- | ---` are tables, `| a | b |\n | --- | --- |` (an indented delimiter) and `a | b\n| --- | --- |` are not, and ` | a | b |\n | --- | --- |` (both indented) is. A tab before the header makes it indented code. Under a label, a pair that is not a table is lazy definition text. Cell counts do not matter. Refined on 2026-10-03: the first-character test replaced "after any spaces" (45 notes of the run; family of 55).

**C2. Body rows must share the table's style.** In a piped table a row starts with `|` and has a second `|` somewhere; in a pipeless table a row does not start with `|` and has a `|` somewhere. The first line that is not a row ends the table and starts a new block. So `| a | b |\n| --- | --- |\n | c[^2] | d |` ends the table before the indented row, while `a | b\n--- | ---\n    | c[^2] | d` keeps it as a row (it does not start with a pipe), and [^2] is live.

**C3. A label line ends a piped table even when it holds a pipe.** `| a | b |\n| --- | --- |\n[^1]: x | y` defines [^1]. In a pipeless table, `[^1]: x | y` is a row.

**C4. Interrupts.** A table interrupts a definition but not a paragraph. Any non-row line after a table ends it. Stock.

**C5. Tables in containers.** Rows follow their container: in a quote or a list item, a row's first character is the one after the quote marker or at the item's content column. Stock apart from C1 to C3.

## D. Obsidian-only syntax

**D1. Wikilinks and embeds.** A wikilink runs from `[[` to the first `]]` on the same line, with something between that holds no second `[[`; nothing inside it is read. So `[[note|[^1]]]`, `[[note[^1]]]`, `![[img.png|[^1]]]`, and `[[a [b] [^1]]]` hold dead text, and a reference right after a link (`[[note]][^1]`) is live. A second `[[` moves the start: in `[[a [[b]] [^5]]]` only `[[b]]` is a link and [^5] is live, and `[[^5][[]]` holds no link at all. `[[]]` is not a link. Refined on 2026-10-03 (16 notes of the run; families of 55).

**D2. Frontmatter.** A first line that is exactly `---` opens a YAML section, which closes at the first later line that starts with `---` at column 0. The section ends right after those three dashes; the rest of the closing line is ordinary Markdown: `---[^2]: two` closes the section and defines [^2], `--- # H` starts a heading, `---x` starts a paragraph that takes the next line lazily, and `---- [ ] [^2]: two` a list item. Inside the section labels define nothing and references are dead. `--- ` or `----` on the first line opens nothing, ` ---` and `...` close nothing, and without a closing line there is no frontmatter. Refined on 2026-10-03 (27 notes of the run; family of 38).

**D3. Setext underlines under a label.** `[^1]: def\n---`, `[^1]: def\n===`, and `[^1]: def\n-` turn the label line into a heading: no definition, and its [^1] is a live reference. Under a continuation line, `---` is a thematic break, `===` is lazy text, and `-` an empty list item. Stock.

**D4. Block ids, tags, highlights, and strikethrough change nothing.** Stock.

**D5. `%%` does not end a definition.** `[^9]: orphan\n    %%\n[^1]: one\n%%` gives [^9] on lines 1-2 and [^1] on lines 3-4. A `%%` line never opens a comment while a definition's text runs on; it is lazy text. Stock remark-footnotes would end the definition there; the reader registers its comment reader after the footnote plugin, so `%%` is not in the definition's interrupt list.

## E. The footnote readers

**E1. What ends a definition.** ATX headings, thematic breaks, fences, a `$$` line, HTML blocks, list items (`-`, `*`, `+`, `1.`, `1)`), quotes and callouts, tables, another label, and a link reference definition. Lazy text, so the definition continues: `%%` lines, `2.` items, `####### H`, `#H`, `<span>`, and plain or indented text. Stock, apart from `%%` (D5).

**E2. Continuation and labels.** After a blank line, 4 spaces or a tab continue the definition and 8 spaces make indented code inside it. `[^1]: def\n\n    [^2]: two` nests a definition. `[^1]: [^2]: x` is two definitions on line 1. `[^1]:\nx[^3]` is line 1 alone. `   [^1]: x` is a definition, `    [^1]: x` is code, `[^1]:x` is a definition, and `[^]: x` and `[^a b]: x` are not. Stock.

**E3. Inside `^[...]` everything is dead.** References, labels, and nested inline footnotes inside an inline footnote are dead text: `a^[x [^1] y]`, `a^[x ^[y [^1]] z] w[^2]` ([^2] is live). Brackets must balance; an unclosed or escaped caret makes no inline footnote. An empty inline footnote `^[]` appears among the metadata cache's references with an empty name, not as an inline footnote, but Reading view renders nothing there, so it is no reference; the oracle's comparison leaves it out (2026-10-03: about 1,300 notes of the run held one).

**E4. The 1,024-character limit.** What may end a definition is looked for only within the definition's first 1,024 characters, counted from the start of its label line. A heading, fence, list item, label, or table that starts at or after character 1,024 is lazy text of the definition, and one that starts just before is cut off: a label at character 1,020 no longer fits (`[^2]` without its colon), nor a fence at 1,022. A blank line still ends the definition at any length. Obsidian and stock remark-footnotes agree exactly (2026-10-03, 185 notes, label lines and continuation lines from 900 to 2,100 characters).

**E5. Names.** A reference's name runs to the first `]` and stops at whitespace, and may hold a `[` or a `^`: `a[^^[x]]`, `a[^[x]`, and `a[^x[y]` each hold a live reference (named `^[x`, `[x`, `x[y`), and `a[^x [y]` holds none. Stock. (Until 2026-10-03 the oracle never asked about names holding a `[`, which made `a[^^[x]]` look dead.)

## F. `%%` comments

A reference inside a comment counts as live (Jason's ruling, 2026-10-03, which is what Obsidian's parser says).

**F1. Opener.** A line whose text, after any spaces, starts with `%%` and holds no other `%` at all opens a block comment: `%%` and `%% note` do. Any further `%` on the line makes it an ordinary paragraph instead, whether doubled or lone, escaped, in a code span, or in math: `%%%`, `%% %`, `%% 50%`, `%% x %%`. Not openers either: `x %%` (mid-line) and `\%%`. Corrected on 2026-10-03: the old note said only "no second `%%`", which read `%%%` alone on a line as an unclosed comment hiding everything below it (54 notes of the run; family of 35 opener shapes).

**F2. Closer.** The closer is the first `%%` anywhere in a later line, even escaped, inside backticks, or behind `> `. Text after the closer starts a paragraph that takes lazy lines. Without a closer the comment runs to the end of its container.

**F3.** `%% a %%` alone on a line is a paragraph, so a label right under it is lazy text.

**F4. A `%%` opener interrupts a paragraph, a quote, and a list item, and is never a lazy line of a container.** `> %%\n> x\n%%\n[^1]: def` is a quote and then a new comment from line 3 to the end. A comment opened inside a quote, callout, or item ends with its container. It does not end a definition (D5).

**F5. An opener indented four spaces still ends a list item.** Because F1 allows any spaces before `%%`, an opener indented four spaces, too shallow for the item above it, ends the list and is then read as top-level indented code: `1. p\n  10.     q\n    %%` (item content at column 7). A tab, six spaces, or plain text in its place stays in the item. At block level an indentation of four or more is indented code before the comment reader is asked, so this is the only place it shows. Found on 2026-10-03; it explained fuzz note 1463, the one unexplained note of the first 3000.

## M. Math

**M1. A `$$ ... $$` pair inside a paragraph is math.** It runs from `$$` to the first `$$` after it, spaces and single dollars included, and may span the paragraph's lines but not a blank line: `x $$ m[^3] $$ y`, `x $$ a $ b [^1] $$ y`, and `x $$ m [^a$] $$ y` hold dead references. `x $$ a $$ b [^1] $$ c $$ y` pairs from the left and leaves [^1] live. Single-dollar math is stock. Refined on 2026-10-03: single dollars inside (56 notes of the run, every one a footnote name holding a `$`; family of 22).

**M2. A line that starts with `$$` and is not a closed pair opens a display block** to a closing `$$` line or the end of the note. Stock.

## P. Places where Obsidian reports a column wrong

In these two shapes the metadata cache and the reader agree that a reference is live and on which line, and the cache reports the wrong column. The reader keeps the column in the text, and the referee lists a representative of each shape as a known disagreement.

**P1. Text on a `%%` opener line** is placed as if the line's indentation and the `%%` were not there: `%% a[^1]` reports [^1] at column 3 instead of 5, and `  %% a[^1]` at 3 instead of 7.

**P2. The line right under a callout title** with anything after its marker (a title, even only a space), when the callout sits in a list item or another quote: a lazy line is shifted right by the outer container's width (`1. > [!note] T\nab cd[^1]` reports [^1] at column 9 instead of 6), and in a task item a quoted line is shifted too (`- [ ] > [!note] T\n  > ab[^1]` reports column 9 instead of 7). Under a callout with nothing after its marker, under a plain quote, at the top level, and two lines down there is no shift.

## Where the evidence is

- `test/obsidian-answers/probes.json`: the families of the first round (callouts, lists, tables, Obsidian syntax, the footnote readers, `%%`, list indentation).
- `test/obsidian-answers/fuzz-20261003.json` and `reproducers.json`: the first fuzz and its shrunk notes.
- `test/obsidian-answers/broad-20261004.json`: a few hundred notes of the 2026-10-03 run that the reader agreed on, and whole notes behind each rule found that night.
- `test/obsidian-answers/overnight-probes.json`: that night's families and shrunk reproducers, with ids naming the rule (`night:f1c-...`, `night:d2c-...`, `night:c6-...`).
