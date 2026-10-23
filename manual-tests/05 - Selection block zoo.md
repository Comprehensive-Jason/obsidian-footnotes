# 05: selection conversion across every block type

Settings: defaults, popup OFF (ON for the popup pass at the end). Use Source mode for the table fixtures: Live Preview's table widget fights multi-line drags. The wikilinked image is in the vault's Attachments folder.

For each fixture, select from the prose line ABOVE the block through the prose line BELOW it, press the numbered key, and look at how the footnote RENDERS (Reading view or the popup). Undo between checks.

## Numbered key: each block becomes a multi-paragraph definition

The rendered footnote must show the construct, not its raw markdown.

Bulleted list (nested item included):

before the list

- alpha
    - nested
- beta

after the list

- [ ] The footnote renders the list with its nesting

Numbered list and a task item:

before numbers

1. first
2. second
- [ ] task item

after numbers

- [ ] The footnote renders the ordered list and the checkbox

Blockquote:

before the quote

> quoted line
> second quoted

after the quote

- [ ] The footnote renders a quote block

Callout:

before the callout

> [!note] Heads up
> callout body

after the callout

- [ ] The footnote (and the popup) renders the callout box

Horizontal rule:

before the rule

---

after the rule

- [ ] The footnote shows a divider (not a stray `---` or a setext effect)

Heading:

before the heading

## Section title

after the heading

- [ ] The footnote shows the heading text (styled or plain is fine; note which)

Image links, both flavors:

before the images
![alt text](https://theindex.moe/img/karenneko.gif)
![[some vault image.png]]
after the images

- [ ] The embeds render inside the footnote / popup

Table (Source mode):

before the table

| a | b |
| --- | --- |
| 1 | 2 |

after the table

- [ ] The footnote renders the table

Fenced code and `$$` math:

before the fence
```
fenced code here
```
$$
E = mc^2
$$
inline math before $1+1\neq3$ and after
after the fence

- [ ] The footnote renders the code block AND the math block

## Two whole tables, and a one-line quoted code block

Two tables in one selection: select from the first character of the first table (the `|` before `e`) to the last character of the second table (the `|` after `8`), and press the numbered key.

before the two tables

| e | f |
| --- | --- |
| 5 | 6 |

| g | h |
| --- | --- |
| 7 | 8 |

after the two tables

- [ ] The footnote renders both tables, one after the other, each with its header row

A quote holding a line of indented code: drag the whole quoted line below, from the start of the line to the start of the line under it, and press the numbered key.

before the quoted code

>     > gap code

after the quoted code

- [ ] The footnote renders a quote holding a code block whose text is `> gap code`, as the line rendered before the press

## Inline key

- [ ] A SINGLE image link selected on its own line + INLINE hotkey: the embed still renders inside the inline footnote

## Popup pass

Turn the popup setting ON and redo ONE list, the callout, and the table fixture with the numbered key:

- [ ] The popup opens showing the whole multi-paragraph body, editable, no Properties-widget bleed
- [ ] Escape closes the popup and the caret comes back to the end of the LAST body line
