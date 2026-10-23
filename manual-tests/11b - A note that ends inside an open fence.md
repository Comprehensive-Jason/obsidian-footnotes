# 11b: a note that ends inside an open code fence

Settings: defaults, plus **Enable section heading** ON with **Section heading** set to `## Sheet 11b footnotes` (put your own heading back afterwards). **Move definitions to the footnote section** stays ON.

This whole note is the fixture: it ends inside a code fence that never closes, so the checks come first.

Run **Lint footnotes** from the command palette.

- [ ] Both definitions move under the `## Sheet 11b footnotes` heading, above the open fence, and the fence and the line after it stay where they are
- [ ] Then, without undoing, switch to Reading view: alpha's and bravo's footnotes render with their text, and everything from the fence to the end of the note shows as one code block

The fixture:

alpha[^a] and bravo[^b] here.

[^a]: alpha's definition
[^b]: bravo's definition

Prose between the definitions and the heading.

## Sheet 11b footnotes

```
code in a fence that never closes
