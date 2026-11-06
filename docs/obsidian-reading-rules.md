# How Obsidian reads footnotes: the observed rules

Drafted by Claude (Opus 5.5), for Jason's review. These are observations, not rulings.

Obsidian's Reading view, its metadata cache, and Obsidian Publish share one Markdown parser, a fork of remark-parse 8 with readers of Obsidian's own. Its code is closed. Since 2026-11-06 the plugin reads notes with `@quartz-community/remark-obsidian` 2.1.0, a shared package that started from this plugin's own earlier reader, through the adapter in `src/parsing/obsidian-markdown.ts`. The code cites the rules by their letter and number. Every rule rests on notes saved with Obsidian's answers in `test/obsidian-answers/`, which the referee suite (`test/obsidian-referee.test.ts`) checks the reader against.

How the rules were found: the oracle (`scripts/oracle/`, described in `TESTING.md`) feeds notes to Obsidian's own parser through the undocumented `app.metadataCache.computeMetadataAsync`, compares its answer with the reader's, shrinks each disagreement to a short note, and then families of notes vary one thing at a time around it until the rule can be said in a sentence or two. Reading view is the court of appeal: one note per cluster was rendered there.

App: the rules were recorded on Obsidian 1.14.4 (installer 1.14.3), desktop, `app.isMobile` false on every call. On 2026-11-05 all 6,852 saved answers were asked again on 1.15.0 and none flipped, and on 2026-11-06 86 more questions were asked there (`test/obsidian-answers/remark-obsidian-live.json`, ids `vet:` and `rules:`), which corrected B8, C1, D1, D3, D4, D5, E1, E5, M1, and M2, and added D9, D10, E6, and P3. A rule without a 1.15.0 note is from 1.14.4 and is held on 1.15.0 only by its saved answers. Not covered: mobile, Live Preview's editor parse, and notes with Windows line breaks beyond a few frontmatter probes.

Notation: a note is written as one string, `\n` is a line break, `\t` a tab, and `/` separates lines in running text. Lines and columns are counted from 1. "Stock" means remark-parse 8.0.3 with remark-footnotes 2.0.0 and remark-math 3.0.1, as they come.

## Where the reader stands

| Notes | Reader agrees | Scanner agrees |
|---|---|---|
| Fuzz, seed 20261003, 3000 container-heavy notes | 3000 | 1683 |
| Broad run, seed 20261004, 20,000 notes | 19,844 | 8,177 |
| Broad run, seed 20261005, 20,000 notes (a fresh check after the fixes) | 19,837 | 8,251 |
| Container-heavy run, seed 20261006, 20,000 notes (the fuzz generator) | 20,000 | 11,535 |

The table is history, from the plugin's earlier reader on 1.14.4. The scanner column is older still: the plugin has read notes through a reader since the runtime swap (2026-10-03), and the hand-written scanner is gone.

Today's reader, the package through the adapter, against fresh notes asked of 1.15.0 on 2026-11-05 (seeds 7711011 to 7711051): it agrees on all 49,999 distinct container-heavy notes and on 49,604 of 49,995 distinct broad ones. Each of the 391 it does not agree on is P2: both sides read the same references on the same lines, and the cache's column is 1 to 5 further right, on the line right under a callout title.

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

**B3. A lazy line does not cancel an item's de-indentation.** Stock remark-parse strips an item's lines by the smallest indentation among them, and a line with no indentation at all (a lazy line) makes that zero, so every 4-space line after it becomes code. Obsidian leaves unindented lines out of the minimum. So `- a\nlazy\n\n    [^1]: def` defines [^1] inside the item.

**B4. Laziness and what ends an item.** Column-0 text after an item's paragraph is lazy, and so is a column-0 label (`- item\n[^1]: def` defines nothing). After an in-item definition's text, a column-0 label starts a new definition. Fences, `$$` blocks, and HTML blocks inside items and quotes run on through column-0 lines. A column-0 heading, list item, or fence opener ends the item; so does a blank line followed by column-0 text. Stock.

**B5. Ordered markers other than 1.** `2.`, `2)`, and `0.` cannot interrupt a paragraph or a definition's text, and cannot start a nested list under an item's paragraph. At column 0 under a bullet item they start a new list. Stock.

**B6. An in-item definition's continuation after a blank line** needs as much indentation as the B2 code threshold. Stock.

**B7. Empty items.** `+  \n\n\n    It[^2]` keeps the item open across two blank lines. A bare `-` directly under a label line is a setext underline (D3). Stock.

**B8. A task box holds any one character.** `- [/] task`, `- [-] task`, and `- [>] task` are tasks just as `- [ ] task` and `- [x] done` are, and `- [/] [^a]: text` defines [^a] at column 7 (`h2:rf2-custom-task-def-slash`, `h2:rf1-custom-task-items`, asked of the live app on 2026-10-05). Obsidian's own list reader takes any one character between the brackets (`/^\[(.)][ \t]/` in its app code); stock takes only a space, `x`, or `X`. That pattern counts UTF-16 units, so a character outside the Basic Multilingual Plane, an emoji for one, is two and makes no box: `- [😀] [^a]: text` is a plain item with a live [^a] at column 8 and no definition (`rules:rmk:doc-b8-astral`, 1.15.0).

**B9. Two lists with only blank lines between them are one list.** `1. first list\n\n1. second list` is one ordered list of two items (the second shown as 2.), `- a\n- b\n\n- c\n- d` one loose list of four, and `1. first list\n\n5. second list` one list numbered from 1. Anything else between them, a footnote definition included, keeps them apart (`h2:cn2-*`, 2026-10-05). Stock. So removing or moving a definition that sits between two lists joins them, and the plugin refuses to (the lists carry a start mark in the reading's lineBlocks).

**B10. A blank line between two items makes the whole list loose.** `- apples\n- pears\n- plums` draws three plain items, and `- apples\n\n- pears\n- plums` draws all three as paragraphs inside their items (`li > p`, with the wider spacing that gives); `1. Mix\n1. Bake` against `1. Mix\n\n1. Bake` the same. A label between two items with no blank line (`- apples\n[^1]: from the market\n- pears`) is the first item's lazy text, shown as "1: from the market" (`c6:z2-*`, Reading view, Obsidian 1.14.4 on sprout, 2026-10-08). Stock. The reading's lineBlocks do not tell a loose list from a tight one.

## C. Tables

**C1. Header and delimiter must share a pipe style.** A row's style is whether its very first character is `|`. A row indented by even one space does not start with a pipe. So `| a | b |\n| --- | --- |` and `a | b\n--- | ---` are tables, `| a | b |\n | --- | --- |` (an indented delimiter) and `a | b\n| --- | --- |` are not, and ` | a | b |\n | --- | --- |` (both indented) is. A tab before the header makes it indented code. Under a label, a pair that is not a table is lazy definition text. Header and delimiter need not have the same number of cells, but a row needs a `|` after its first character: `|a\n|---` is a paragraph, and `a | b\n---` is a heading (`rules:rmk:doc-c1-*`, sections on 1.15.0; these two shapes are all that was asked). Refined on 2026-10-03: the first-character test replaced "after any spaces" (45 notes of the run; family of 55). Corrected on 2026-11-06: this used to say cell counts do not matter at all.

**C2. Body rows must share the table's style.** In a piped table a row starts with `|` and has a second `|` somewhere; in a pipeless table a row does not start with `|` and has a `|` somewhere. The first line that is not a row ends the table and starts a new block. So `| a | b |\n| --- | --- |\n | c[^2] | d |` ends the table before the indented row, while `a | b\n--- | ---\n    | c[^2] | d` keeps it as a row (it does not start with a pipe), and [^2] is live.

**C3. A label line ends a piped table even when it holds a pipe.** `| a | b |\n| --- | --- |\n[^1]: x | y` defines [^1]. In a pipeless table, `[^1]: x | y` is a row.

**C4. Interrupts.** A table interrupts a definition but not a paragraph. Any non-row line after a table ends it. Stock.

**C5. Tables in containers.** Rows follow their container: in a quote or a list item, a row's first character is the one after the quote marker or at the item's content column. Stock apart from C1 to C3.

## D. Obsidian-only syntax

**D1. Wikilinks and embeds.** A wikilink runs from `[[` to the first `]]` on the same line, with something between that holds no second `[[`; nothing inside it is read. So `[[note|[^1]]]`, `[[note[^1]]]`, `![[img.png|[^1]]]`, and `[[a [b] [^1]]]` hold dead text, and a reference right after a link (`[[note]][^1]`) is live. A second `[[` moves the start: in `[[a [[b]] [^5]]]` only `[[b]]` is a link and [^5] is live, and `[[^5][[]]` holds no link at all. `[[]]` is not a link. Refined on 2026-10-03 (16 notes of the run; families of 55). Right after a `]`, the first `[` of `[[` joins a reference link instead, so there is no wikilink: in `[x][[a|[^1]]]`, [^1] is live at column 8 (`rules:rmk:doc-d1-after-bracket`, 1.15.0). "On the same line" treats U+2028 as a line break: `[[a<U+2028>b]][^1]` holds no link and its [^1] is dead, and `[[a<U+2028>b]] [^1]` has a live [^1] (`rules:rmk:c8-line-separator`, `vet:rmk:W1`, 1.15.0).

**D2. Frontmatter.** A first line that is exactly `---` opens a YAML section, which closes at the first later line that starts with `---` at column 0. The section ends right after those three dashes; the rest of the closing line is ordinary Markdown: `---[^2]: two` closes the section and defines [^2], `--- # H` starts a heading, `---x` starts a paragraph that takes the next line lazily, and `---- [ ] [^2]: two` a list item. Inside the section labels define nothing and references are dead. `--- ` or `----` on the first line opens nothing, ` ---` and `...` close nothing, and without a closing line there is no frontmatter. Refined on 2026-10-03 (27 notes of the run; family of 38).

**D3. Setext underlines under a label.** `[^1]: def\n---`, `[^1]: def\n===`, and `[^1]: def\n-` turn the label line into a heading: no definition, and its [^1] is a live reference. Under an unindented continuation line, `---` makes that line a heading and ends the definition above it: `[^1]: def\nmore\n---` is a definition on line 1 alone and a heading on lines 2-3 (`rules:rmk:doc-d3-lazy`, sections on 1.15.0). Under an indented continuation line, `---` is a thematic break, `===` is lazy text, and `-` an empty list item. The underline must be marks alone from column 0 of the line's text (after its containers): `  ---` and `--- ` (a space in front or behind) are thematic breaks and `   ===` and `=== ` are text, so none of them makes a heading; with a blank line above, `[^1]: def` over any of them is a definition (live, 2026-10-06, answers c3:ul-*). Its text is then read from where the label ends, so `[^1]: def` over `   ===` draws "def" as a level 1 heading inside the footnote, as `[^1]: def` over `    ===` does, while over `=== ` it is text; and with `> Text[^1] here` above and `> ===` under the label, the `> ===` is a quote of its own (Reading view, 2026-10-08). Stock.

**D4. Block ids and strikethrough change nothing** to the footnote readers. Stock. Highlights and tags do change something: see D9 and D10. Strikethrough was not asked again on 1.15.0. A block id counts only at the very end of its block: `Oysters filter water.[^1] ^water1` registers the block `water1`, and `Oysters filter water. ^water1[^1]` registers none, so a `[[#^water1]]` link finds nothing, while both show footnote 1 (`c6:z12-*`, the metadata cache's blocks and Reading view, 2026-10-08; the app's block-id pattern ends in `$`).

**D9. A highlight's closing `==` can end what it falls inside.** A bare web address stops at a `==` that closes a highlight: in `==see http://a.b==[^1]` and `==https://b.c==[^1]` [^1] is live (`vet:rmk:H1-url` in Reading view too, `rules:rmk:c16-highlight-url`, 1.15.0). It takes a `==` that closes none: `see http://a.b==[^1]` is one link with no footnote, and `see http://a.b== more[^1]` links `http://a.b==` with the footnote live (Reading view, 1.15.0, 2026-11-06, hunt cycle 9, H2). A code span loses to it: in ``==`a[^1]==`b`` [^1] is live, so the backticks made no code (`rules:rmk:c16-highlight-code`). So does a reference's name: `==a [^x==] b` holds no reference to `x==` (`rules:rmk:c16-highlight-name`). Not settled: a link, wikilink, `$` math, `%%` comment, inline footnote, or reference link straddling the closer. The notes asked (`vet:rmk:H5-link` to `H10-reference-link`, such as `==a [b==](u) [^1]`) have the reference outside the straddling construct, so it is live whichever side wins. A reference inside it would tell, as in `==a [b==[^1]](u)`.

**D10. A tag takes the front of a bare address.** `#http://a.b[^1]`, `#www.a.b[^1]`, `#taghttp://a.b[^1]`, and `text #t/ahttp://a.b[^1]` each hold a live [^1], since the tag takes the letters and no bare link is left to swallow it (`rules:rmk:c17-*`; `vet:rmk:T2-url` and `T3-url-after-text` in Reading view too, 1.15.0). Not settled: an email address after a tag. `#tag@b.co [^1]` and `#1a@b.co [^1]` have a space before the reference, so it is live whichever side wins.

**D8. An email address takes a period that text follows.** `Write to me@example.com.` links `me@example.com` and leaves the period out, but `Write to me@example.com.[^1]` links `me@example.com.`, period included, then shows footnote 1; `Write to me@example.com[^1].` links the address alone and shows footnote 1 (`c6:z17-*`, Reading view, 2026-10-08). Stock remark-parse 8. So a reference typed after such a period changes the link drawn. `Write to me@example.com. [^1]`, with a space, lets the link take the period too (Jason, live, with his ruling Q30, 2026-10-08), so a press there lands in front of the period under After and Before. A table cell reads the same way: `| Write to me@example.com.[^1] |` links `mailto:me@example.com.` and shows footnote 1, and `| Write to me@example.com[^1]. |` links the address alone and shows footnote 1 (sprout Obsidian 1.14.4, Reading view, hunt cycle 7, 2026-10-08).

**D5. `%%` does not end a definition.** `[^9]: orphan\n    %%\n[^1]: one\n%%` gives [^9] on lines 1-2 and [^1] on lines 3-4, and `[^9]: orphan\n%%\n[^1]: one` gives [^9] on lines 1-2 and [^1] on line 3 (`rules:rmk:doc-d5-comment-in-def`, 1.15.0). Stock remark-footnotes would end the definition there. Not settled: what the `%%` is inside the definition. This rule used to call it lazy text, while the reader reads a comment opening there. The cache's answer is the same either way, since the definitions' lines match and a reference inside a comment counts as live, so only Reading view could tell.

**D6. A link reference definition reads across blank lines.** Its title can start after blank lines and run over lines, and an `<...>` destination can run over a blank line: in `[foo]: /url\n\n'tit [^1]\nle'` the title holds the [^1], which is dead, and `[foo]: <a\n\nb\nc>` defines `[foo]` (`h2:rd2-*`, 2026-10-05). Stock. An inline HTML tag's attribute value can run over a line break too: in `a <span title="x\n[^9]: y">z</span>` the second line is part of the tag, not a definition (`h2:rg2-html-attribute-over-line`).

**D7. Footnotes inside bracketed text that is no link.** `[text][^1]` is a reference link labelled `^1` to Obsidian, whatever the note defines, so a reference glued after the `]` of bracketed text is dead (answers swap34:br-*). Inside the brackets it is live: `as noted [see p. 5[^1]] here` and `[see p. 5[^1]].` each show footnote 1, and `see [sic^[a note]] now` shows an inline footnote "a note" (Reading view and the metadata cache, Obsidian 1.14.4 on sprout, 2026-10-08, answers gs45:q2-*). So a press on the last word of bracketed text lands inside the brackets under every placement (Jason's ruling Q2, 2026-10-07). `see [sic^[]] now`, the inline key's empty footnote there, is in the metadata cache as an empty-named reference, as E3 says, but Reading view drew a footnote marker [1] with an empty footnote for it on that day, where E3 says it renders nothing. Stock.

## E. The footnote readers

**E1. What ends a definition.** ATX headings, thematic breaks, fences, a `$$` line that a line break follows (M2), HTML blocks, list items (`-`, `*`, `+`, `1.`, `1)`), quotes and callouts, tables, another label, and a link reference definition. Lazy text, so the definition continues: `%%` lines, `2.` items, `####### H`, `#H`, `<span>`, and plain or indented text. Stock, apart from `%%` (D5).

**E2. Continuation and labels.** After a blank line, 4 spaces or a tab continue the definition and 8 spaces make indented code inside it. `[^1]: def\n\n    [^2]: two` nests a definition. `[^1]: [^2]: x` is two definitions on line 1. `[^1]:\nx[^3]` is line 1 alone, while `[^1]: ` with a trailing space takes the next line as its text: `[^1]: \nnext line` is footnote 1 holding "next line", and `[^1]:\nnext line` an empty footnote above a paragraph (Reading view and the cache's sections, 1.15.0, 2026-11-06, hunt cycle 9, H38). `   [^1]: x` is a definition, `    [^1]: x` is code, `[^1]:x` is a definition, and `[^]: x` and `[^a b]: x` are not. Stock. Text on the label line is read as a block start like any other: `[^1]: 2. Aufl., S. 34` draws footnote 1 as an ordered list starting at 2 (`c6:z7-ordered`, Reading view, 2026-10-08). A list on the label line goes on in lines indented 4 spaces, its sub-items and an item's code 2 spaces further: `[^1]: - C\n    - D` draws a list of C and D inside footnote 1, `[^1]: 3. C\n    4. D` an ordered list starting at 3, and `[^1]: - B\n      - b1` B with the sub-list b1 (`lr:*`, Reading view, 2026-10-17). Inside a definition, an indented line right under an indented quote or list item is that block's lazy text: `[^a]: Smith, p. 4:\n\n    > The tide rose.\n    See also Jones.` shows "See also Jones." inside the quote, and under `    - p. 9` inside that bullet (`c6:z20-*`). A label right after a quote's empty `>` line is a definition, and a `> ` line right under it is its lazy text, not a quote: `> Quote one.\n>\n[^1]: def\n> Quote two.` shows footnote 1 as "def Quote two." (`c6:lead-quote-label`).

**E3. Inside `^[...]` everything is dead.** References, labels, and nested inline footnotes inside an inline footnote are dead text: `a^[x [^1] y]`, `a^[x ^[y [^1]] z] w[^2]` ([^2] is live). An inline footnote may run over a soft line break, and everything inside it stays dead (`a^[x\n[^1] y] w[^2]`, `probe:e3-lines`), so a label-shaped line inside one is no definition. Brackets must balance; an unclosed or escaped caret makes no inline footnote. An empty inline footnote `^[]` appears among the metadata cache's references with an empty name, not as an inline footnote, but Reading view renders nothing there, so it is no reference; the oracle's comparison leaves it out (2026-10-03: about 1,300 notes of the run held one).

**E4. The 1,024-character limit.** What may end a definition is looked for only within the definition's first 1,024 characters, counted from the start of its label line. A heading, fence, list item, label, or table that starts at or after character 1,024 is lazy text of the definition, and one that starts just before is cut off: a label at character 1,020 no longer fits (`[^2]` without its colon), nor a fence at 1,022. A blank line still ends the definition at any length. Obsidian and stock remark-footnotes agree exactly (2026-10-03, 185 notes, label lines and continuation lines from 900 to 2,100 characters).

**E5. Names.** A reference's name runs to the first `]` and stops at whitespace, and may hold a `[` or a `^`: `a[^^[x]]`, `a[^[x]`, and `a[^x[y]` each hold a live reference (named `^[x`, `[x`, `x[y`), and `a[^x [y]` holds none. Stock. (Until 2026-10-03 the oracle never asked about names holding a `[`, which made `a[^^[x]]` look dead.) Whitespace here is a space, a tab, or a line break. A no-break or ideographic space stays in the name: `x[^a<NBSP>b] y\n\n[^a<NBSP>b]: def` holds a live reference and its definition (`swap34:name-nbsp`, `swap34:name-ideographic-space`). `a[^b<NBSP>c]` with no definition could not be asked: the cache lists only defined references, and the oracle's name pattern gives this name no probe definition, so its saved answer of no reference is empty rather than a verdict (a known disagreement in the referee).

**E6. A block left open at the end of a definition.** The definition's last line is the line holding the opener, or the last line the block takes. `[^1]: def\n    ```\n` ends on line 2. Text at the left margin under it stays in the definition: `[^1]: def\n    ```\nafter[^1]` ends on line 3 with [^1] dead as code, and `[^1]: def\n    %%\nafter[^1]` ends on line 3 with [^1] live, since a comment's references count (`vet:rmk:C1-*`, `C2-*`, `C4-*`, 1.15.0). `[^1]: ```\n    c\n\nx` ends on line 2 (`rules:rmk:c14-fence-in-definition`), and `> [^a]: Definition\n>      $$\n>   > quoted[^a]\n` ends on line 2 with the quoted [^a] live (`vet:rmk:C3-math-quote`).

## F. `%%` comments

A reference inside a comment counts as live (Jason's ruling, 2026-10-03, which is what Obsidian's parser says).

**F1. Opener.** A line whose text, after any spaces, starts with `%%` and holds no other `%` at all opens a block comment: `%%` and `%% note` do. Any further `%` on the line makes it an ordinary paragraph instead, whether doubled or lone, escaped, in a code span, or in math: `%%%`, `%% %`, `%% 50%`, `%% x %%`. Not openers either: `x %%` (mid-line) and `\%%`. Corrected on 2026-10-03: the old note said only "no second `%%`", which read `%%%` alone on a line as an unclosed comment hiding everything below it (54 notes of the run; family of 35 opener shapes).

**F2. Closer.** The closer is the first `%%` anywhere in a later line, even escaped, inside backticks, or behind `> `. Text after the closer starts a paragraph that takes lazy lines. Without a closer the comment runs to the end of its container.

**F3.** `%% a %%` alone on a line is a paragraph, so a label right under it is lazy text.

**F4. A `%%` opener interrupts a paragraph, a quote, and a list item, and is never a lazy line of a container.** `> %%\n> x\n%%\n[^1]: def` is a quote and then a new comment from line 3 to the end. A comment opened inside a quote, callout, or item ends with its container. It does not end a definition (D5).

**F5. An opener indented four spaces still ends a list item.** Because F1 allows any spaces before `%%`, an opener indented four spaces, too shallow for the item above it, ends the list and is then read as top-level indented code: `1. p\n  10.     q\n    %%` (item content at column 7). A tab, six spaces, or plain text in its place stays in the item. At block level an indentation of four or more is indented code before the comment reader is asked, so this is the only place it shows. Found on 2026-10-03; it explained fuzz note 1463, the one unexplained note of the first 3000.

**F6. A note that ends inside an open fence or comment.** The fence or comment runs from its opener to the end of the note, and a definition above the opener is a definition like any other: ``intro[^1] text\n\n# Footnotes\n\n[^1]: one\n\n```\nunclosed code`` shows footnote 1 as "one" and the last two lines as a code block, and the same with `%%` and `open comment` shows footnote 1 and hides the comment (`gs3:a1-fence`, `gs3:a1-comment`, Reading view, 2026-10-08). Stock.

## G. Lines right under a paragraph

**G1. A line written into the blank line under a paragraph carries that paragraph on, and so do the lines under it that cannot start a block of their own.** A table, indented code, and a footnote label cannot interrupt a paragraph (C4, E1), so each becomes more of the paragraph's text; a thematic break, a heading, a list, a quote, or a fence still starts its own block (D3). Asked with `[^1]` written into the empty line, as a press there writes it (Reading view, Obsidian 1.14.4, 2026-10-08: Jason checked the five on sprout himself, and the oracle's parse saved them): `Results were mixed.\n[^1]\n---` is one paragraph and a horizontal rule, no heading (`gs3:b1-rule`); `The tide rose.\n[^1]\nOysters closed.` is one paragraph of three lines (`gs3:b1-prose`); `Some text.\n[^1]\n| a | b |\n| --- | --- |\n| c | d |` is one paragraph, the table's rows shown as text with their pipes (`gs3:b1-table`); `text[^1] and[^2]\n[^2]\n[^1]: d` is one paragraph, so `[^1]: d` is a lazy label and footnote 1 has no definition (`gs3:b1-definition`); `Para.\n[^1]\n    code line` is one paragraph and the code is text (`gs3:b1-code`). Stock. The result gate lets a press join the paragraph next to it and refuses one that turns a table, a definition, or code into paragraph text (Jason's ruling B1, 2026-10-08).

**G2. A quote holding indented code reads the same inside a definition.** `[^1]: >     > gap code[^88]` shows footnote 1 as a quote holding a code block whose text is `> gap code[^88]`, as the same line drew at the top of the note, and the `[^88]` is code text (`gs3:a3-moved`, Reading view, 2026-10-08). Stock.

## M. Math

**M1. A `$$ ... $$` pair inside a paragraph is math.** It runs from `$$` to the first `$$` after it that no backslash escapes, spaces and single dollars included, and may span the paragraph's lines but not a blank line: `x $$ m[^3] $$ y`, `x $$ a $ b [^1] $$ y`, and `x $$ m [^a$] $$ y` hold dead references. `x $$ a $$ b [^1] $$ c $$ y` pairs from the left and leaves [^1] live. Single-dollar math is stock. Refined on 2026-10-03: single dollars inside (56 notes of the run, every one a footnote name holding a `$`; family of 22). Corrected on 2026-11-06, on 1.15.0:

- A backslash escapes a closer. `$$ a \$$ [^1] $$ b` and `$$ a\$$[^1]$$` run on to the last `$$`, so [^1] is dead (`vet:rmk:E1-pair`, `E4-inside`, Reading view too); so does `$$a\$$ b[^1] $$` (`rules:rmk:c6-escaped-middle`). With no other closer there is no math: `$$a\$$ [^1]`, `$$\$$ [^1]`, and `x $$ a[^1] \$$` hold a live [^1] (`vet:rmk:E2-no-pair`, `E3-tight`, `rules:rmk:c6-escaped-closer`).
- Four dollars in a row are an empty pair. `a $$$$ b [^1] $$ c`, `$$$$ z $$ [^1]`, `$$$$[^1]$$`, and `A $$$$ [^1] B $$` hold a live [^1] (`vet:rmk:M1-pair`, Reading view too, `M2-text`, `rules:rmk:c5-*`). So do the runs of five and six in `a $$$$$ [^1]` and `$$$$$$y$$ [^1]` (`vet:rmk:M3-five`, `M4-six`), though those two notes do not show how such a run pairs up.
- Since `$$$$` closes at once, it takes nothing below it. In `a$$$$b\n[^1]: d $$ e` and `- [/] x$$$$\n  [^1]: d $$` the second line is lazy paragraph text, not math, with a live [^1] and no definition (`vet:rmk:M6-*`, `M5-*`, Reading view too).

**M2. A line that starts with `$$` and is not a closed pair opens a display block** to a line that ends in `$$`, or to the end of the note. Stock. The closing line need not be `$$` alone: `$$\nm\nx $$\nq[^1]` is math on lines 1-3 with a live [^1] on line 4, while `$$ x` closes nothing, so `$$\nm\n$$ x\nq[^1]` is math on lines 1-4 with [^1] dead (`rules:rmk:doc-m2-closer`, `doc-m2-not-closer`, 1.15.0). On the note's last line with no line break after it, `$$` is text: `$$` alone is a paragraph, while `$$\n` is math on lines 1-2, and `[^1]: def\n$$` keeps the `$$` as the definition's second line (`rules:rmk:doc-m2-*`). Not asked on 1.15.0: a closing line that is indented, which both readers take as a closer.

## P. Places where Obsidian reports a column wrong

In these three shapes the metadata cache and the reader agree that a reference is live and on which line, and the cache reports a column other than the one in the text. The reader keeps the column in the text, and the referee lists a representative of each shape as a known disagreement.

**P1. Text on a `%%` opener line** is placed as if the line's indentation and the `%%` were not there: `%% a[^1]` reports [^1] at column 3 instead of 5, and `  %% a[^1]` at 3 instead of 7.

**P2. The line right under a callout title** with anything after its marker (a title, even only a space), when the callout sits in a list item or another quote: a lazy line is shifted right by the outer container's width (`1. > [!note] T\nab cd[^1]` reports [^1] at column 9 instead of 6), and in a task item a quoted line is shifted too (`- [ ] > [!note] T\n  > ab[^1]` reports column 9 instead of 7). Under a callout with nothing after its marker, under a plain quote, at the top level, and two lines down there is no shift. On 1.15.0 the shift was 1 to 5 columns across 391 fresh notes, and a shift of 1 or 3 is not always the outer container's width (`broad:20261004-8185` and `-12474`): the width's rule is not worked out.

**P3. A byte order mark at the very start of the note.** The cache's columns on line 1 leave the mark out, since its worker decodes the note's bytes with a plain `new TextDecoder().decode`, which drops it before the parser sees the text: `<BOM>- a[^1]` reports [^1] at column 4 instead of 5, and likewise for a callout and a paragraph (`vet:rmk:B1-callout`, `B2-list`, `rules:rmk:c3-bom-code`, 1.15.0). Other lines and the reading itself are not affected: `<BOM>> [!note]\n> [^1]: def` is a callout with a definition on line 2, and `<BOM><BOM>---\n---` is frontmatter, so the parser reads past both marks (`rules:rmk:c9-*`). The editor's own count includes a mark, and so does Obsidian's parser when it is handed text that still has one (it adds one to its first column and offset, as stock does), so the plugin's column is the one an edit lands by. A note opened from disk holds no mark in the editor, because `Vault.read` drops one, so a mark is there only when pasted or typed (all read from the app code of 1.15.0, 2026-11-06).

## Where the evidence is

- `test/obsidian-answers/probes.json`: the families of the first round (callouts, lists, tables, Obsidian syntax, the footnote readers, `%%`, list indentation).
- `test/obsidian-answers/fuzz-20261003.json` and `reproducers.json`: the first fuzz and its shrunk notes.
- `test/obsidian-answers/broad-20261004.json`: a few hundred notes of the 2026-10-03 run that the reader agreed on, and whole notes behind each rule found that night.
- `test/obsidian-answers/overnight-probes.json`: that night's families and shrunk reproducers, with ids naming the rule (`night:f1c-...`, `night:d2c-...`, `night:c6-...`).
- `test/obsidian-answers/h2-live-probes.json`: the shapes the pre-stable hunt of 2026-10-05 left to the live app (B8, B9, D6, the HTML tag, and a reference right after a bare email), ids `h2:...`.
- `test/obsidian-answers/gate-s3-live.json`: the shapes the result gate's stage 3 asked of the live app on 2026-10-08 (F6, G1, G2), ids `gs3:...`.
- `test/obsidian-answers/c6-hunt-live.json`: the shapes hunt cycle 6 asked of the live app on 2026-10-08 (B10, D4's block ids, D8, E2's label-line blocks and lazy lines), ids `c6:...`.
- `test/obsidian-answers/list-run-live.json`: the notes list items moved into a footnote leave, asked of the live app on 2026-10-17 (E2's lists on the label line), ids `lr:...`.
- `test/obsidian-answers/remark-obsidian-live.json`: the questions that vetting the package left to the live app, asked of 1.15.0 on 2026-11-06 (B8, C1, D1, D3, D5, D9, D10, E5, E6, M1, M2, P3), ids `vet:rmk:...` and `rules:rmk:...`. The saved form holds definitions, references, and code sections. Other sections, such as `heading` and `math`, were read from that run's raw results, and Reading view was asked only for the `vet:rmk:` notes where the old reader disagreed.

## What the answers could not settle

- Link labels. `[ß] x` over `[SS]: /u`, `[x][ a]` over `[a]: /u`, `[a<NBSP>b] x` over `[a b]: /u`, and `[x][ ]` over `[ ]: /u` hold no footnote, and the oracle saves nothing about reference links, so the reader's folding of labels is unchecked (`vet:rmk:F*`, `rules:rmk:c10-*` to `c13-*`). Reading view could tell, and so could the `referenceLinks` list the metadata cache builds (seen in the app code; the oracle does not read it yet).
- The straddling highlights of D9, the tagged email addresses of D10, the `%%` of D5, and the indented closer of M2, each as that rule says.
- `[a][[w]]`: it holds no reference, so the answer does not show whether a wikilink is drawn (`rules:rmk:doc-d1-after-bracket2`).
- `a^[]` on 1.15.0: the cache still lists an empty-named reference (E3), and Reading view was not asked again.
