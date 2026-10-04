import { describe, expect, it } from "vitest";

import { listExistingFootnoteDefinitions } from "../src/editor/doc-context";
import { shouldJumpFromDefinitionToReference, shouldJumpFromReferenceToDefinition } from "../src/commands/navigation";
import { computeNextFootnoteNumber } from "../src/parsing/footnote-grammar";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import { readNote } from "../src/parsing/note-reading";

// Issue #41: [^x]-shaped text inside code - fenced blocks, inline code, or
// frontmatter - must be invisible to every scan the insert/navigate
// commands make. Before the fix, a code sample containing "[^7]" skewed
// autonumbering, suppressed the section heading (a fenced "[^x]:" counted
// as an existing definition), and hijacked the hotkey on that line.

const fakePlugin = sharedFakePlugin({ enablePopupEditor: false });

describe("computeNextFootnoteNumber ignores code", () => {
    it("skips numbered references inside fenced code blocks", () => {
        expect(
            computeNextFootnoteNumber("real[^1]\n```\nfake[^7]\n```"),
        ).toBe(2);
    });

    it("skips numbered references inside inline code", () => {
        expect(computeNextFootnoteNumber("real[^1] and `[^7]`")).toBe(2);
    });

    it("skips numbered definitions inside fenced code blocks", () => {
        expect(computeNextFootnoteNumber("```\n[^7]: fake\n```")).toBe(1);
    });

    it("skips frontmatter", () => {
        expect(
            computeNextFootnoteNumber("---\nkey: [^9]\n---\nreal[^1]"),
        ).toBe(2);
    });
});

describe("listExistingFootnoteDefinitions ignores code", () => {
    it("does not count a definition-shaped line inside a fence", () => {
        const doc = fakeEditor(["```", "[^1]: fake", "```", "[^2]: real"]);
        expect(listExistingFootnoteDefinitions(doc)).toEqual(["2"]);
    });
});

// reference listing composed from the primitives the cascade uses (the old
// dedicated lister died production-dead - 2026-08-11 review cleanliness)
function referenceLocations(lines: string[]) {
    const references: { footnote: string; lineNum: number; startIndex: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of readNote(lines).referencesOn(i)) {
            references.push({
                footnote: lines[i].slice(occurrence.start, occurrence.end),
                lineNum: i,
                startIndex: occurrence.start,
            });
        }
    }
    return references;
}

describe("reference occurrences ignore code", () => {
    it("skips references inside inline code but keeps real ones placed after", () => {
        expect(referenceLocations(["use `[^1]` then real[^2]"])).toEqual([
            { footnote: "[^2]", lineNum: 0, startIndex: 20 },
        ]);
    });

    it("skips references inside fenced code blocks", () => {
        expect(referenceLocations(["```", "x[^1]", "```", "y[^2]"])).toEqual([
            { footnote: "[^2]", lineNum: 3, startIndex: 1 },
        ]);
    });
});

describe("shouldJumpFromReferenceToDefinition ignores code", () => {
    it("does not navigate from a reference inside a fenced code block", () => {
        const doc = fakeEditor(["```", "fake[^1]", "```", "[^1]: real"]);
        // caret inside the fenced "[^1]" - plain text, so the press must
        // fall through to insertion instead of navigating
        const handled = shouldJumpFromReferenceToDefinition(
            "fake[^1]",
            { line: 1, ch: 6 },
            fakePlugin,
            doc,
        );
        expect(handled).toBeFalsy();
    });

    it("does not navigate from a reference inside inline code", () => {
        const doc = fakeEditor(["see `x[^1]` here", "", "[^1]: real"]);
        const handled = shouldJumpFromReferenceToDefinition(
            "see `x[^1]` here",
            { line: 0, ch: 8 },
            fakePlugin,
            doc,
        );
        expect(handled).toBeFalsy();
    });

    it("still navigates from a real reference on a line that also has code", () => {
        const doc = fakeEditor([
            "`[^1]` real[^1]",
            "",
            "[^1]: definition",
        ]);
        const handled = shouldJumpFromReferenceToDefinition(
            "`[^1]` real[^1]",
            { line: 0, ch: 13 },
            fakePlugin,
            doc,
        );
        expect(handled).toBe(true);
        expect(doc.moves).toEqual([{ line: 2, ch: "[^1]: definition".length }]);
    });
});

describe("shouldJumpFromDefinitionToReference ignores code", () => {
    it("a definition-shaped line inside a fence is not a definition", () => {
        const doc = fakeEditor(["```", "[^1]: fake", "```", "real[^1]"]);
        const handled = shouldJumpFromDefinitionToReference(
            "[^1]: fake",
            { line: 1, ch: 3 },
            fakePlugin,
            doc,
        );
        expect(handled).toBeFalsy();
    });

    it("the jump-target search skips references inside code", () => {
        const doc = fakeEditor([
            "```",
            "x[^1]",
            "```",
            "real[^1]",
            "",
            "[^1]: definition",
        ]);
        const handled = shouldJumpFromDefinitionToReference(
            "[^1]: definition",
            { line: 5, ch: 3 },
            fakePlugin,
            doc,
        );
        expect(handled).toBe(true);
        // the first REAL occurrence is on line 3 - not the fenced line 1
        expect(doc.moves).toEqual([{ line: 3, ch: 8 }]);
    });
});

// A fence lives in the CONTAINER that opened it (fixed 2026-08-10): a
// blockquoted delimiter is content to a document-level fence, a blockquoted
// fence dies when its quote ends, and a bare delimiter after that opens a
// NEW fence. List-item fences ("- ```") are still a known gap, deferred to
// the container-model spec decision (test/hunt/bug-list-item-fence).
describe("fence delimiters respect their container", () => {
    it("a blockquoted delimiter is content to a document-level fence", () => {
        expect(computeNextFootnoteNumber("```\ncode\n> ```\nstill code[^9]")).toBe(1);
    });

    it("a plain line directly under a quoted fence's content is swallowed by the fence", () => {
        // Reading view renders "live[^7]" inside the code block (GLM hunt
        // cycle 11, probed 2026-09-16); the blank line in the next test is
        // what ends the quote and its fence
        expect(computeNextFootnoteNumber("> ```\n> code[^9]\nlive[^7]")).toBe(1);
    });

    it("a blank line ends the quote - and its fence", () => {
        expect(computeNextFootnoteNumber("> ```\n> code[^9]\n\nlive[^7]")).toBe(8);
    });

    it("a bare delimiter after an ended blockquoted fence opens a new fence", () => {
        expect(
            computeNextFootnoteNumber("> ```\n> code[^9]\n```\nnow code[^7]"),
        ).toBe(1);
    });

    it("a nested-deeper delimiter does not close a blockquoted fence", () => {
        expect(
            computeNextFootnoteNumber("> ```\n> > code[^9]\n> ```\n> live[^7]"),
        ).toBe(8);
    });
});
