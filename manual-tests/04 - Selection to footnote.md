# 04: selection to footnote

Settings: defaults. Undo between checks.

This fixture keeps a numbered footnote alive[^5] for the name-collision check below.

[^5]: five

## Undo and the popup

Select `move this aside` in the next line before each press:

The paragraph wants to move this aside for later readers. A second sentence rides along for the multi-line checks.

- [ ] NUMBERED hotkey, then undo ONCE: the sentence is back exactly as it was, definition and all, in one step. The same for the NAMED hotkey's modal (type a name, Enter, one undo)
- [ ] With `Edit footnotes in a popup` ON, select BOTH sentences of that paragraph plus this line and press the NUMBERED hotkey: the popup shows the whole multi-paragraph body, and no Properties widget bleeds into it

## The name modal

- [ ] With a selection and the NAMED hotkey: typing `5` (a name already in use) or a name with a space shows the reason inline and the modal STAYS OPEN; Escape cancels with nothing changed; with an invalid name typed, any footnote hotkey shows the same inline reason and keeps the modal open

## Rendering and alignment

The line above the fence.

```
select me in here
```

- [ ] Select the fence above ALONE (opening ``` through closing ```) and press the NUMBERED hotkey: the footnote renders as a code block in Reading view, though its label line is empty. Undo, then select from `The line above the fence.` through the closing ```: that one renders as a paragraph followed by the code block

- [ ] With the popup ON, open it on the heading definition below: the top of the heading sits level with the top of the `[^h]:` label, as in the core Footnotes view; a plain one-line definition lines up as before. In the core Footnotes view, click into that heading footnote: its heading stays level with the label while editing, and the label colour and gap follow the sidebar's theme

A reference for the heading fixture[^h].

[^h]: # A heading starts this definition's body
