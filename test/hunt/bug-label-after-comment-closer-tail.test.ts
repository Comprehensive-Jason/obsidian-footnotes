// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 3 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";

import { readNote } from "../../src/parsing/note-reading";

// A multi-line comment that opened MID-LINE is inline HTML, so its closer
// line keeps whatever live text follows the "-->": "x <!-- a\n--> tail"
// is ONE paragraph, and the plugin itself agrees - bug-comment-boundary-lines
// pins that a reference in that tail is live ("a reference after an inline
// comment closer still counts").
//
// So a "[^1]:" label directly under such a closer line sits directly under
// a PROSE line, and manual sheet 14's rule (Obsidian's, matched by the
// plugin since 2026-09-09) says it is lazy paragraph text: "A label starts
// a definition only after a blank line, the note start, a heading, a
// closed fence, a callout's title line, or another definition." A prose
// line is none of those.
//
// The scanner's own math branch already encodes exactly this: for a "$$"
// closer line it asks whether live text follows the closer and reports a
// paragraph when it does ("verified in Reading view", markdown-scan.ts
// definitionStartLines). The comment branch has no such check: ANY closer
// line of an inline comment ends the block, so the label under "--> tail"
// is read as a real definition.
//
// What the user sees: their "[^1]: definition" line renders as plain
// paragraph text in Reading view, but the linter never says so - with the
// fix toggle ON no blank line is inserted (the label is "already a
// definition"), and with it OFF the lazy-definition alert never names it.
// The missing-definition alert stays silent too, because as far as the
// plugin is concerned the definition exists.
//
// Source of truth: manual sheet 14's stated rule (a label directly under a
// prose line is lazy) + the plugin's own math-branch precedent (verified
// in Reading view per the code comment).
//
// Settings involved: `Fix definitions hidden by a missing blank line` and
// its alert twin when the toggle is off.

const doc = "use[^1] here\nx <!-- a\n--> tail\n[^1]: the definition";

const startsOf = (markdown: string): boolean[] => {
    const lines = markdown.split("\n");
    return readNote(lines).labelLines;
};

const lazyNames = (markdown: string): string[] => {
    const lines = markdown.split("\n");
    return lazyDefinitionLabelNames(lines);
};

describe("a definition label directly under an inline comment's closer line with tail text", () => {
    it("is a LAZY label, not a definition start (sheet 14's rule)", () => {
        expect(startsOf(doc)[3]).toBe(false);
    });

    it("the fix inserts the missing blank line above it", () => {
        expect(fixLazyDefinitions(doc)).toBe(
            "use[^1] here\nx <!-- a\n--> tail\n\n[^1]: the definition",
        );
    });

    it("the lazy-definition alert names it", () => {
        expect(lazyNames(doc)).toEqual(["1"]);
    });

    it("under a BARE inline-comment closer line the label is lazy as well (Reading view)", () => {
        // the closer line of a comment opened mid-line is part of the same
        // paragraph whether or not text follows the "-->" (probed
        // 2026-09-16), so the pin's original control went the other way
        expect(startsOf("use[^1] here\nx <!-- a\n-->\n[^1]: the definition")[3]).toBe(false);
    });

    it("control: under a BLOCK comment's closer line with tail (the whole line is raw HTML) the label is a definition", () => {
        expect(startsOf("use[^1] here\n<!-- a\n--> tail\n[^1]: the definition")[3]).toBe(true);
    });

    it("control: the math branch already does this right - a label under '$$ tail' is lazy", () => {
        expect(startsOf("use[^1] here\nx $$\n$$ tail\n[^1]: the definition")[3]).toBe(false);
    });
});
