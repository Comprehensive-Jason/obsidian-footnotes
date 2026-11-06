import { describe, expect, it } from "vitest";

import { countEmptyFootnoteReferences } from "../../src/linting/lint-alerts";

// A task list with a custom checkbox whose character is a caret: "- [^] task".
// A task box holds any one character, so this is a checked task and no footnote.
//
// What the user saw: "This note has an unnamed footnote reference ("[^]"). Give it
// a name or delete it.", on every lint of the note.
//
// Hunt 2026-11-06, cycle 9, finding H12. Severity: annoyance. Origin: pre-existing.
//
// Source of truth: the live answer on Obsidian 1.15.0 (H12): "- [^] task" draws a
// checked checkbox and no reference. Rule B8 of docs/obsidian-reading-rules.md.

describe("a task box whose character is a caret is no unnamed footnote", () => {
    it.each(["- [^] task", "* [^] task", "+ [^] task", "1. [^] task", "1) [^] task", "  - [^] nested", "> - [^] quoted", "- [^]\ttabbed"])("%s", (line) => {
        expect(countEmptyFootnoteReferences(`Before.\n\n${line}\n\nAfter.`)).toBe(0);
    });

    it.each(["text [^] more", "- item [^] more", "- [ ] [^] task", "- [^]"])("control: %s is still one", (line) => {
        expect(countEmptyFootnoteReferences(`Before.\n\n${line}\n\nAfter.`)).toBe(1);
    });
});
