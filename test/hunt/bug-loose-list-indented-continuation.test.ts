import { describe, expect, it } from "vitest";

import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { readNote } from "../../src/parsing/note-reading";

// Sol re-review bug #2 (2026-08-10), ground truth verified against
// Obsidian's metadataCache (sections: "list:0-2"): a blank line and then
// 4-space-indented content following a list item is a LIVE loose-list
// continuation - indented code inside a list item starts 4 columns past
// the item's CONTENT indent, not at column 4 of the document. The scanner
// classified such continuations as indented code, so references in them
// were invisible - and orphan-definition deletion deleted a definition
// whose only reference sat in one (silent data loss on ordinary lists).

describe("loose-list indented continuations are live content", () => {
    it("keeps a nested list item live after a blank", () => {
        const prot = readNote("- a\n\n    - b[^1]\n\n[^1]: def".split("\n")).protectedLines;
        expect(prot).toEqual([false, false, false, false, false]);
    });

    it("keeps a continuation paragraph live after a blank", () => {
        const prot = readNote("- see\n\n    details[^1]\n\n[^1]: def".split("\n")).protectedLines;
        expect(prot).toEqual([false, false, false, false, false]);
    });

    it("orphan-definition deletion sees the continuation's reference", () => {
        const doc = "- see\n\n    details[^1]\n\n[^1]: def\n[^9]: orphan";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(
            "- see\n\n    details[^1]\n\n[^1]: def",
        );
    });

    it("code inside a list item still needs content indent + 4", () => {
        // content indent 2 → code starts at column 6; 8 spaces is code
        const prot = readNote("- a\n\n        code[^8]".split("\n")).protectedLines;
        expect(prot).toEqual([false, false, true]);
    });

    it("a double-digit ordered item shifts the code threshold too", () => {
        // "10. " content indent 4 → its 4-space continuation is live,
        // 8-space content is code
        const live = readNote("10. a\n\n    cont[^1]".split("\n")).protectedLines;
        expect(live).toEqual([false, false, false]);
        const code = readNote("10. a\n\n         code[^1]".split("\n")).protectedLines;
        expect(code).toEqual([false, false, true]);
    });

    it("a paragraph after the list restores the document threshold", () => {
        // the blank + column-0 paragraph closes the item - the later
        // 4-space chunk is plain indented code again
        const prot = readNote("- a\n\npara\n\n    code[^7]".split("\n")).protectedLines;
        expect(prot).toEqual([false, false, false, false, true]);
    });
});
