import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";
import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// spec question: is the closing "$$" line of a display-math block a paragraph
// ender, so that a label written directly under it is a real definition?
//
// Reading one, "yes, it is a block like any other": Obsidian documents "$$"
// as a block, and the scanner already models it as one, the same way it
// models a code fence and an HTML comment. Manual sheet 14 pins both of those
// closers as paragraph enders (a label under a closed fence is a definition,
// control c3; a label under the "-->" that closes a comment is a definition,
// ground truth 2026-09-09). A "$$" block should behave the same, so the label
// under its closer is a real definition.
//
// Reading two, "no, leave it as it is": nothing has been checked in Obsidian
// itself for this shape. No manual-test sheet has a label under a "$$"
// closer, and the plugin's current answer is that the paragraph is still
// open, so the label is a lazy label (paragraph text that only looks like a
// definition).
//
// The code leans towards reading one without following through: the start
// rule handles the comment case by hand and reads the scan's
// startsInComment flag to spot the closing "-->", because that closer line is
// deliberately left unprotected so live text after it still counts. The scan
// carries exactly the same flag for math, startsInMath, and the start rule
// never consults it outside the branch for protected lines.
//
// Hunt: 2026-09-13. Lens: the prose-label rule (attack-surface row 1).
// Still owed: a live Reading-view check of "$$" / "x = 1" / "$$" /
// "[^1]: real" before either reading is adopted.

const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).blocks.map((b) => `${b.name}@${b.start}`);
};
const lastLineStarts = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).labelLines.at(-1);
};
const lazyNames = (doc: string) => {
    const lines = doc.split("\n");
    return lazyDefinitionLabelNames(lines);
};

describe("a label directly under a closed $$ math block", () => {
    it("control: the fence and comment closers already end the paragraph", () => {
        expect(lastLineStarts("t[^1]\npara\n```\ncode\n```\n[^1]: real")).toBe(true);
        expect(lastLineStarts("t[^1]\npara\n<!--\nc\n-->\n[^1]: real")).toBe(true);
    });

    it("under reading one, the math closer ends it too", () => {
        expect(blocksOf("t[^1]\n\n$$\nx = 1\n$$\n[^1]: real")).toEqual(["1@5"]);
        expect(lastLineStarts("t[^1]\npara\n\n$$\nx = 1\n$$\n[^1]: real")).toBe(true);
    });

    it("so the definition under it would not be a lazy label", () => {
        expect(lazyNames("use[^1] here\n\n$$\nx = 1\n$$\n[^1]: real definition")).toEqual([]);
    });

    it.fails("and the lint would leave such a note alone", () => {
        const doc = "use[^1] here\n\n$$\nx = 1\n$$\n[^1]: real definition";
        // today the lint inserts a blank line above the label
        expect(lintFootnotes(doc)).toBe(doc);
    });

    it("and a press on the reference would jump instead of appending an empty duplicate", async () => {
        const lines = ["use[^1] here", "", "$$", "x = 1", "$$", "[^1]: real definition"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 5 }, wholeDoc: true, edits: true });
        await insertAutonumFootnote(
            fakePlugin({ insertAtEndOfWord: false, enablePopupEditor: false, lintOnFootnoteCreation: false }, doc),
        );
        // Obsidian renders only the LAST definition of a name, so the empty
        // "[^1]: " appended at the bottom would hide the body the user wrote
        expect(doc.lines).toEqual(lines);
    });
});
