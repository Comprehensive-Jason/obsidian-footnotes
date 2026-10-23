# 14: definition labels directly after a prose line

Settings: defaults. Both checks only look at Reading view.

## Fixtures (label directly under prose, no blank line: prose to Obsidian)

After a paragraph line, reference before it, alpha[^p1] here:
para line
[^p1]: after a paragraph

After a paragraph line, reference after it:
para line
[^p2]: after a paragraph again

use it here[^p2] too.

After a list item, bravo[^l1] here:
- item
[^l1]: after a list item

After a quote line, charlie[^q1] here:
> quote
[^q1]: after a quote line

Inside a callout, under its body line, delta[^cb] here:
> [!note]
> callout body
> [^cb]: under the callout body

Two labels under a paragraph, echo[^d1] and foxtrot[^d2] here:
[^d2]: first label
[^d1]: second label

## Controls (definitions to Obsidian)

After a blank line, golf[^c1] here:

[^c1]: after a blank line

After a heading, hotel[^c2] here:
# Heading line
[^c2]: after a heading

After a closed fence, india[^c3] here:
```
code
```
[^c3]: after a closed fence

Inside a callout, right under its title line, juliet[^c4] here:
> [!note]
> [^c4]: under the callout title

Inside a quote after a blank quote line, kilo[^c5] here:
> quote body
>
> [^c5]: after the quote's blank line

## Reading view

- [ ] `[^p1]`, `[^p2]`, `[^l1]`, `[^q1]`, `[^cb]`, `[^d1]`, `[^d2]`: the reference renders as plain text (no superscript) and the label line reads as prose; NO entry at the bottom
- [ ] The five controls render as real footnotes: superscript references, entries at the bottom
