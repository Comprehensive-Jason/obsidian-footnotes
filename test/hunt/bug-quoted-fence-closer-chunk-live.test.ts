// Imported from the GLM 5.3 Flash cycle 7 hunt of 2026-09-16 (OpenCode worktree); 2 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-7). 3 of 5 tests carry it.fails; the controls do not.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// BUG: the scan's blockquote state records where an indented chunk may
// OPEN as quoted code (the `quote.boundary` flag: "quote content indented
// 4 or more columns past the innermost > marker is code when it opens at
// a boundary INSIDE the quote, meaning the quote's start or a blank '>'
// line" plus the block-enders "a quoted heading, thematic break, or
// setext underline ends its block just as an unquoted one does, so an
// indented chunk on the next quoted line is code" - and a quoted comment,
// HTML block, or $$ math block got the same treatment, pinned as probed in
// Reading view, GLM hunt cycles 2 and 6). A quoted FENCE is the one
// container block missing from that list: the fence branch `continue`s
// before the quote-state update on every one of its lines, and its closer
// sets only the document-level `blockBoundary`, never `quote.boundary`.
// So the indented quoted chunk DIRECTLY under a quoted fence's closer is
// read as LIVE text, while CommonMark (and the micromark oracle, run as
// the repo's designated hint) render it as indented code inside the
// blockquote: "> ```\n> code\n> ```\n>     chunk" gives
// <pre><code>chunk</code></pre> inside the blockquote. The plugin's own
// readers disagree with each other on the very same closer:
// definitionStartLines treats the closer as a boundary (a label under it
// starts a definition), and the document-level control (a chunk after a
// column-0 fence's closer is code) is pinned
// (bug-definition-chunk-after-ender). The sibling pinned probes cover the
// quoted comment, HTML, and math blocks ending their quote's block
// (cycle 2/6), so the fence is the gap.
//
// What the user would see: a "[^9]" typed in that chunk is inert code in
// Reading view but live to the plugin - reindex hands out and renumbers
// it, the missing-definition alert names it, the punctuation rule moves
// it, apply-prefix renames it. Worse, a creation press with the caret in
// the chunk is not refused as protected text (the guard reads the same
// isProtected facts), so the plugin writes a footnote into code.
//
// Source of truth: CommonMark 4.4 + micromark oracle (the chunk parses as
// an indented code block sibling of the fence, inside the blockquote) + the
// plugin's own recorded quote-code model (bug-indented-code-after-quoted-
// heading, bug-indented-code-after-blank-quote) + the column-0 control pin
// (bug-definition-chunk-after-ender, micromark-verified). Note: the same
// boundary gap exists for a quoted %% block's bare closer ("> %% ... > %%"
// then ">     chunk"); that flavor is Obsidian-specific and unprobed, so
// it is recorded here as a note rather than pinned.
//
// Settings involved: none for the scan; every rule and press guard
// inherits the misread (reindex, the orphan alerts, creation liveness).

const quoted = "> ```\n> code\n> ```\n>     chunk[^9]";
const docLevel = "```\ncode\n```\n    chunk[^9]";

describe("an indented quoted chunk directly under a quoted fence's closer", () => {
    it("is protected quoted code, like the document-level control", () => {
        const lines = quoted.split("\n");
        expect(readNote(lines).protectedLines).toEqual([true, true, true, true]);
    });

    it("a reference-shaped string in it does not reserve a number", () => {
        const lines = quoted.split("\n");
        const masked = [...readNote(lines).maskedLines()];
        // the [^9] sits inside what Reading view renders as a code block,
        // so it must be masked dead and reserve nothing (a protected line
        // is blotted end to end, quote marker included; the pin's original
        // expectation was written for a column-0 line)
        expect(masked[3]).toBe("\0".repeat(lines[3].length));
        expect(masked.join("\n")).not.toContain("[^9]");
    });

    it("control: the plugin's own readers already agree the closer is a boundary - a label under it is a definition", () => {
        // the internal inconsistency: definitionStartLines already treats
        // the quoted fence closer as a block boundary
        const lines = "> ```\n> code\n> ```\n> [^1]: x".split("\n");
        expect(readNote(lines).labelLines).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });

    it("control: a chunk after a column-0 fence's closer is code (pinned)", () => {
        expect(readNote(docLevel.split("\n")).protectedLines).toEqual([
            true,
            true,
            true,
            true,
        ]);
    });

    it("control: a chunk after a quoted heading's boundary is code (pinned)", () => {
        const lines = "> # H\n>     chunk".split("\n");
        expect(readNote(lines).protectedLines).toEqual([false, true]);
    });
});