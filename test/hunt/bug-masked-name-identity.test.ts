import { EditorPosition } from "obsidian";
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { createMatchingFootnoteDefinition } from "../../src/commands/create-footnote";
import { shouldJumpFromDefinitionToReference, shouldJumpFromReferenceToDefinition } from "../../src/commands/navigation";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";

// Scenario: a footnote whose name contains an inline-code span ("[^x`c`y]")
// gets a NUL-masked identity on reference-scanning paths but its raw identity on
// definition-listing paths - reference→definition jumps fail, created definition lines
// are stuffed with literal NUL bytes, and reindex severs the pair or deletes
// a still-referenced definition.
// Hunt: 2026-08-09. Lens: offsets.
// Root cause: these paths run the name extraction on the code-MASKED line and
// read match[0]/match[1] straight off the mask without re-slicing the original
// text (the re-slice fix pinned in bug-definition-name-inline-code-nul was only
// applied to the definition-listing path).

function fakeEditor(lines: string[], cursor: EditorPosition = { line: 0, ch: 0 }): FakeEditor {
    return sharedFakeEditor(lines, { cursor, edits: true, wholeDoc: true });
}

function fakePlugin(): FootnotePlugin {
    return sharedFakePlugin({
        enablePopupEditor: false,
        enableFootnoteSectionHeading: false,
        enableRemoveBlankLastLines: true,
        footnoteSectionHeading: "",
        insertAtEndOfWord: false,
        lintOnFootnoteCreation: false,
        enableFootnotePrefix: false,
    });
}

describe("press-jump (reference → definition) with a code-span-named footnote (fixed 2026-08-10)", () => {
    const MARKER_LINE = "ref [^x`c`y] end"; // reference at ch 4..11, caret ch 8 is inside
    const DETAIL_LINE = "[^x`c`y]: body";

    it("jumps from such a reference to its existing definition", () => {
        const doc = fakeEditor([MARKER_LINE, "", DETAIL_LINE], { line: 0, ch: 8 });
        expect(shouldJumpFromReferenceToDefinition(MARKER_LINE, doc.cursor, fakePlugin(), doc)).toBe(true);
        expect(doc.cursor).toEqual({ line: 2, ch: DETAIL_LINE.length });
    });

    it("jumps from [^`1`] to its definition", () => {
        const lines = ["ref [^`1`] here", "", "[^`1`]: the definition"];
        const caret = { line: 0, ch: 7 }; // on the "1" inside "[^`1`]"
        const doc = fakeEditor(lines, caret);
        expect(shouldJumpFromReferenceToDefinition(lines[0], caret, fakePlugin(), doc)).toBe(true);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^`1`]: the definition".length });
    });
});

describe("press-create with a code-span-named footnote (fixed 2026-08-10)", () => {
    it("refuses to create a definition for a backticked name (disallowed, Jason 2026-08-10)", () => {
        // backticked names don't render in Obsidian, so instead of creating
        // a definition (with or without NUL bytes) the press warns and stops -
        // the same treatment as spaced names
        const MARKER_LINE = "ref [^x`c`y] end";
        const doc = fakeEditor([MARKER_LINE, ""], { line: 0, ch: 8 });
        const handled = createMatchingFootnoteDefinition(
            MARKER_LINE,
            doc.cursor,
            fakePlugin(),
            doc,
        );
        expect(handled).toBe(true);
        expect(doc.appliedChanges).toEqual([]);
    });

    it("does NOT append a duplicate definition full of NUL bytes when the definition exists", () => {
        const lines = ["ref [^`1`] here", "", "[^`1`]: the definition"];
        const doc = fakeEditor(lines, { line: 0, ch: 7 });
        createMatchingFootnoteDefinition(lines[0], { line: 0, ch: 7 }, fakePlugin(), doc);
        expect(doc.appliedChanges).toEqual([]);
    });
});

describe("press-jump (definition → reference) with a code-span-named footnote (fixed 2026-08-10)", () => {
    it("finds the reference of a backticked footnote name", () => {
        const lines = ["ref [^`1`] here", "", "[^`1`]: the definition"];
        const doc = fakeEditor(lines, { line: 2, ch: 5 });
        shouldJumpFromDefinitionToReference(lines[2], { line: 2, ch: 5 }, fakePlugin(), doc);
        // "[^`1`]" starts at index 4 and is 6 code units long
        expect(doc.cursor).toEqual({ line: 0, ch: 10 });
    });
});

describe("reindex with a code-span-named footnote (fixed 2026-08-10)", () => {
    const doc = "see[^a`b`c] twice[^a`b`c].\n\n[^a`b`c]: hi";

    it("renumberNamedFootnotes keeps reference and definition paired", () => {
        expect(reindexFootnotes(doc, { renumberNamedFootnotes: true })).toBe(
            "see[^1] twice[^1].\n\n[^1]: hi",
        );
    });

    it("drop-orphans does not delete a referenced code-span-named definition", () => {
        expect(reindexFootnotes(removeOrphanedFootnoteDefinitions(doc))).toBe(doc);
    });

    // The comment span carries no whitespace: a name holding whitespace is
    // prose to Obsidian and to micromark alike (probed 2026-09-16:
    // "see[^a<!-- -->b]" renders as a plain link), so since B6 no rule
    // renames such a name, and the identity check needs a name that IS a
    // footnote.
    it("the same split through a name containing an HTML comment span", () => {
        const commentNamed = "see[^a<!--x-->b].\n\n[^a<!--x-->b]: hi";
        expect(reindexFootnotes(commentNamed, { renumberNamedFootnotes: true })).toBe(
            "see[^1].\n\n[^1]: hi",
        );
    });
});
