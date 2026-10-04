// Imported from the glm-cycle-11 hunt of 2026-09-16 (OpenCode worktree); rewritten to the probed readings 2026-09-16.
// RESOLVED 2026-09-16 (GLM hunt cycle 11, probed in Reading view): under an indented code line or a two-line link reference definition the label opens a definition whose chunk after the blank gap is its live body (the reading now knows both as blocks of their own); under a quoted definition's label, continuation, or column-0 tail the chunk is CODE, as the reading already read it, so the block walker now leaves indented code where it is; under a quoted fence's content the label is swallowed by the fence.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-11). 4 of 8 tests carry it.fails; the controls do not.
import { describe, expect, it } from "vitest";


import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// BUG: a definition label that starts directly under a line which ends the
// block above it in Reading view but leaves the reading's own block state open
// does not open the reading's inDefinition state. The state machine re-decides
// `inDefinition` from the PREVIOUS line's blockBoundary (`inDefinition =
// DefinitionStart.test(src[i]) ? blockBoundary || inDefinition : ...`), and
// the previous line's blockBoundary is false for exactly the lines that DO
// end a block in Obsidian: a quoted definition's label line, its quoted
// continuation line, its column-0 lazy tail, an indented-code line (the
// indented-code branch sets blockBoundary = false), a two-line link
// reference definition's destination line, and the column-0 line that killed
// a quoted fence. So the indented chunk after the new definition's BLANK GAP
// - which the pinned control in bug-definition-chunk-after-ender records as
// the definition's live continuation ("a chunk after the definition's blank
// gap IS its continuation", readNote(["[^1]: body", "", "    chunk[^73]"])
// -> all false) - is read as INDENTED CODE (isProtected true).
//
// The plugin's own readers disagree about the very same lines:
// definitionStartLines says the label is a definition start (its own doc:
// "A label may start ... after a protected line (a fence closer, a comment,
// frontmatter, indented code)"), and findDefinitionBlocks absorbs the chunk
// into the block (blocks say 1-3) - while scanDocument.protectedLines says the
// chunk is code. micromark agrees with the two live readers: "    code",
// "[^1]: body", "", "    chunk[^9]" parses as code("code") and then ONE
// footnoteDefinition holding two paragraphs - "body" and "chunk[^9]" - so
// the reference in the chunk is live.
//
// What the user would see: the "[^9]" they cite in their footnote's second
// paragraph is live in Reading view but invisible to the plugin - reindex
// skips it, the orphan and missing-definition alerts never name it, the
// numbered command hands its number out again, and the chunk-owning block's
// move by the first lint FLIPS the reference live and renumbers it (the
// conservation property's exact crime: one lint changed what is live).
//
// Source of truth: micromark oracle (one footnoteDefinition, two paragraphs)
// + the plugin's own pinned control (bug-definition-chunk-after-ender: a
// chunk after a definition's blank gap is its continuation) + the plugin's
// own definitionStartLines, which starts a definition under every line named
// above. Two readers in markdown-reading.ts disagree; the protected one loses.
//
// Settings involved: none for the reading; every rule and press guard inherits
// the misread (the first lint's move flips the reference live).

const liveRefIn = (doc: string, line: number): string[] => {
    const lines = doc.split("\n");
    return readNote(lines).referencesOn(line).map((o) => o.name);
};

describe("an indented chunk after a definition's blank gap, under a label that opens at a boundary", () => {
    it("under an indented code line, the chunk is live, not code", () => {
        // Reading view: a code block, then one footnote "body chunk" with
        // the reference live (probed 2026-09-16)
        const lines = ["    code", "[^1]: body", "", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([true, false, false, false]);
    });

    it("under a two-line link reference definition's destination line", () => {
        const lines = ["[foo]:", "/url", "[^1]: body", "", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false, false]);
    });

    it("REFUTED under a quoted definition's label line: the chunk is code, as the reading read it", () => {
        // Reading view renders "chunk[^9]" as a code block after the two
        // footnotes (probed 2026-09-16), so the reading was right; the block
        // walker now leaves the chunk where it is instead of moving it
        // with the definition and waking it up
        const lines = ["> [^1]: qbody", "[^2]: body", "", "    chunk[^9]"];
        const reading = readNote(lines);
        expect(reading.protectedLines).toEqual([false, false, false, true]);
        // "[^2]: body" is a lazy line of the quote, so the note reading puts
        // footnote 2 inside the quote with footnote 1: neither is a block
        // that moves (Jason's ruling 1, option a, 2026-10-03), so nothing
        // can carry the chunk away
        expect(readNote(lines).blocks.map((b) => [b.start, b.end])).toEqual([]);
    });

    it("REFUTED under a quoted definition's continuation line: code", () => {
        const lines = ["> [^1]: qbody", "> cont", "[^2]: body", "", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false, true]);
    });

    it("REFUTED under a quoted definition's column-0 lazy tail: code", () => {
        const lines = ["> [^1]: qbody", "tail", "[^2]: body", "", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false, true]);
    });

    it("REFUTED under a quoted fence's content: the label itself is swallowed by the fence", () => {
        // "> ```", "> code", "[^1]: body" renders the label inside the code
        // block; the blank line ends the fence and the chunk after it is
        // code (probed 2026-09-16)
        const lines = ["> ```", "> code", "[^1]: body", "", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([true, true, true, false, true]);
    });

    it("the reference in the chunk is live to the scanner (indented-code case)", () => {
        expect(liveRefIn("    code\n[^1]: body\n\n    chunk[^9]", 3)).toEqual(["9"]);
    });

    it("the reference is live before and after the lint's move", () => {
        const doc = "    code\n[^1]: body\n\n    chunk[^9]";
        expect(liveRefIn(doc, 3)).toEqual(["9"]);
        const out = lintFootnotes(doc, { fixPunctuation: false, fixLazyDefinitions: false, moveDefinitionsToBottom: true, reindex: false });
        const chunkLine = out.split("\n").findIndex((l) => l.startsWith("    chunk"));
        expect(liveRefIn(out, chunkLine)).toEqual(["9"]);
    });

    it("control: the same chunk at the note start is live (pinned control)", () => {
        const lines = ["[^1]: body", "", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false]);
    });

    it("control: a chunk directly after a heading is code (pinned)", () => {
        const lines = ["# H", "    chunk[^9]"];
        expect(readNote(lines).protectedLines).toEqual([false, true]);
    });
});
