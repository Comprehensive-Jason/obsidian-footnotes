import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// Scenario: definitionStartLines looks at the raw line when it asks whether
// the line above was a thematic break or a setext underline, and its regexes
// are anchored at the end of the line. A trailing carriage return therefore
// defeats them, and the label underneath is wrongly called lazy.
//
// LATENT, and unreachable today. Every lint path normalizes the line endings
// before the scan runs, and CodeMirror 6 strips the carriage return when it
// loads a document, so an editor line never carries one. This is an
// inconsistency inside one module rather than something a user can hit: the
// same module's scanDocument already strips the carriage return (stripCr),
// so the two halves of the scan disagree about the same document. Worth a
// cheap hardening, not a fire.
//
// What the user would see IF a raw carriage-return document ever reached
// this code: a definition under a "---" divider or under a setext underline
// would be treated as ordinary paragraph text, so the fix-lazy rule would
// push a blank line in above it, and the caret and selection resolvers would
// read its label as a reference rather than as a label.
//
// Hunt: 2026-09-13. Lens: contexts.
//
// Source of truth: the module's own carriage-return contract. scanDocument
// strips the carriage return before judging a line, and that contract is
// already pinned in test/hunt/bug-crlf-protection.test.ts. The heading and blank
// line cases below show what the module intends: the trailing carriage
// return must not change the answer.

const starts = (lines: string[]) => {
    return readNote(lines).labelLines;
};

describe("a trailing carriage return must not change what starts a definition", () => {
    it("a label under a thematic break starts a definition", () => {
        expect(starts(["prose\r", "\r", "---\r", "[^1]: real\r"])).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });

    it("a label under a setext underline starts a definition", () => {
        expect(starts(["H\r", "===\r", "[^1]: real\r"])).toEqual([false, false, true]);
    });

    it("control: a label under a heading already starts a definition", () => {
        expect(starts(["prose\r", "# Heading\r", "[^1]: real\r"])).toEqual([
            false,
            false,
            true,
        ]);
    });

    it("control: a label under a blank line already starts a definition", () => {
        expect(starts(["prose\r", "\r", "[^1]: real\r"])).toEqual([false, false, true]);
    });
});
