// Imported from the GLM 5.3 Flash cycle 1 hunt of 2026-09-16 (OpenCode worktree); 3 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (probed in Reading view): the one-letter scheme is dead text there too (refuted), a bare <span> line does open a raw HTML block (fixed: type 7), and a plain line under a definition is its lazy continuation (fixed: the block walker and the scan own it).
import { describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// SPEC QUESTION 1: does Reading view render "<a://b[^1]>" (a single-letter
// scheme) as a URI autolink?
//
// CommonMark 0.31 (§6.7): an autolink's scheme is ALPHA followed by 1 to 31
// more ALPHA/DIGIT/+/-/. characters - at least TWO. "<a://b>" therefore is
// NOT an autolink; it is not a valid HTML tag either ("a://b" is no tag
// name), so it is literal text, and a "[^1]" inside it renders as a live
// footnote reference - micromark agrees (probed for this hunt: the document
// "<a://b[^1]>\n\n[^1]: def" parses to footnoteReference(1) + definition(1)).
//
// The plugin's autolink scanner (maskLineRegions) accepts a scheme of ANY
// length: /^<[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]*>/ has no {1,31} bound and
// no two-character minimum. It blots the interior, so the "[^1]" is dead to
// the plugin while CommonMark renders it live. (The same holds for a scheme
// longer than 32 characters, which CommonMark also refuses.)
//
// What the user would see if Reading view follows CommonMark: a "[^1]"
// typed inside "<a://b...>" renders as a footnote, but the plugin's scan
// treats it as dead - reindex skips it, the orphan alert never names it,
// and with Delete orphaned references ON nothing happens (masking hides it
// from every rule). If instead Obsidian is laxer than CommonMark (it has
// been before: sheet 14's footnote-interruption ruling), the code is right
// and this pin should be deleted.
//
// NEEDS A LIVE CHECK: does "[^1]" inside "<a://b[^1]>" render as a footnote
// reference in Reading view (with a definition present)?
//
// Source of truth: CommonMark 0.31 §6.7 via micromark; Obsidian unprobed.
// Settings involved: none (the scan feeds every rule).

const refs = (line: string): string[] => {
    return readNote([line]).referencesOn(0).map((o) => o.name);
};

describe("spec: a single-letter URI scheme is not an autolink, so the [^1] inside is live", () => {
    // RESOLVED 2026-09-16, refuted: Reading view renders "<a://b[^1]>" as
    // the text "a://b[^1]" with no footnote (probed), so the reference is
    // dead there too and the scan's reading stands, whatever CommonMark's
    // scheme-length rule says.
    it("Reading view: the [^1] inside <a://b[^1]> is dead, as the scan says", () => {
        expect(refs("<a://b[^1]>")).toEqual([]);
    });

    it("control: a two-letter scheme IS an autolink per CommonMark, and the [^1] inside is dead", () => {
        expect(refs("<ab://x[^1]>")).toEqual([]);
    });
});

// SPEC QUESTION 2: HTML block type 7. A complete tag alone on a line
// ("<span>", "<span>x</span>" with nothing else) opens a type-7 HTML block
// that runs to the next blank line, and CommonMark renders everything
// inside as raw HTML - micromark: "<span>\nbody [^1] here\n</span>\n\n[^1]:
// def" sees NO footnoteReference in the span. The scanner deliberately
// reads only types 1-6 ("type 7, any other tag alone on a line, is not
// read"), so a "[^1]" under a bare "<span>" counts as a live reference and
// a "[^1]: def" label there counts as a definition start (the next line is
// paragraph text). If Reading view treats the type-7 block as raw HTML,
// every rule acts on a footnote Obsidian does not render - reindex numbers
// it, the orphan alert nags, and Delete orphaned references would cut text
// out of the user's HTML.
//
// NEEDS A LIVE CHECK: does "<span>\nbody [^1] here\n</span>" render the
// "[^1]" as a footnote reference in Reading view, or as raw text inside the
// span?
//
// Source of truth: CommonMark 0.31 §4.6 (type 7) via micromark; Obsidian
// unprobed. Settings involved: `Delete orphaned references` (the
// destructive half).

describe("spec: a bare <span> line opens a type-7 HTML block", () => {
    it("the scan counts [^1] inside the span block as live", () => {
        const doc = "<span>\nbody [^1] here\n</span>\n\n[^1]: def";
        const lines = doc.split("\n");
        const occurrences = readNote(lines).referencesOn(1);
        // CommonMark: raw HTML inside the span, the reference is dead
        expect(occurrences).toEqual([]);
    });

    it("control: <span> mid-paragraph is inline HTML and the reference stays live", () => {
        const lines = ["para <span> x[^1] y</span>"];
        expect(readNote(lines).referencesOn(0).map((o) => o.name)).toEqual(["1"]);
    });
});

// SPEC QUESTION 3: does a NON-INDENTED line directly under a column-0
// footnote definition join the definition's body in Reading view? micromark
// says yes (lazy continuation: "[^1]: body\nmore lazy" parses to one
// footnoteDefinition whose paragraph is "body\nmore lazy"). The plugin's
// block walker requires an indented (1+ space) continuation line and ends
// the block at the first non-indented line, so for move-to-bottom the lazy
// line is a stray paragraph: moving the definition to the bottom strands
// the body text as an ordinary paragraph, which changes the rendered
// footnote from "body more lazy" to "body" and leaves "more lazy" behind.
//
// There is recorded ground truth for the QUOTED twin: Obsidian continues a
// quoted definition across non-blank quoted lines at the same depth ("a
// lazy continuation, or an indented one" - quotedDefinitionEnd, verified in
// Reading view 2026-09-16), which suggests the column-0 definition gets the
// same continuation. But sheet 14's ten probed shapes are about what a
// DEFINITION may follow, not what a definition's continuation is, and no
// sheet records the column-0 lazy body line.
//
// NEEDS A LIVE CHECK: in Reading view, does "[^1]: body\nmore lazy" render
// footnote 1's body as "body more lazy"? If yes, move-to-bottom's
// block cutting relocates body text out of the footnote (a conservation
// break), and findDefinitionBlocks must absorb lazy lines.
//
// Source of truth: micromark (GFM footnote container semantics) + the
// quoted-definition continuation ruling; Obsidian unprobed for column 0.
// Settings involved: `Move definitions to the bottom` (on by default).

describe("spec: a non-indented line under a definition (its lazy body line)", () => {
    it("micromark's reading: the lazy body line belongs to the definition block", () => {
        const doc = "para[^1].\n\n[^1]: body\nmore lazy";
        const lines = doc.split("\n");
        const blocks = readNote(lines).blocks;
        // micromark (and, if Obsidian agrees, Reading view) parses "more
        // lazy" as part of footnote 1's body, so the block runs to line 3
        expect(blocks.map((b) => [b.start, b.end])).toContainEqual([2, 3]);
    });

    it("move-to-bottom keeps the lazy body line with its definition (RESOLVED 2026-09-16)", () => {
        // Reading view agrees with micromark (probed): "[^1]: body" then
        // "more lazy" is one footnote reading "body more lazy", so the
        // block walker owns the lazy line and the move keeps them together
        const doc = "para[^1].\n\n[^1]: body\nmore lazy";
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });
});

