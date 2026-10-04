import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { describe, expect, it } from "vitest";

import { endOfWordOffset } from "../../src/editor/cursor-motion";

// BUG (wrong output): a press on the last word of a collapsed or full
// reference-style link breaks the link.
//
// What the user would see: the line reads "see [text][] now" or "see
// [text][ref] now", a link whose address sits in a "[text]: http://u"
// line elsewhere in the note. A press on "text" writes "[text][^1][]" or
// "[text][^1][ref]". From then on the link no longer renders: Reading view
// shows the literal "[text]" followed by the footnote number (and, for the
// full form, a stray link reading "ref").
//
// Needs a Reading-view check: micromark (the referee below) shows the
// link dying; Obsidian's own rendering of the result has not been probed.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G2.
//
// Source of truth: CommonMark 0.31.2, section 6.3 (collapsed and full
// reference links), with micromark plus micromark-extension-gfm-footnote
// as referee, and Jason's landing ruling (2026-09-15) that a reference
// never breaks a link (linkLikeEndAt's docstring: "A reference belongs
// after the whole construct, never inside it"). Landing after the whole
// construct keeps both working: micromark renders "[text][][^1]" and
// "[text][ref][^1]" as the link followed by the footnote.
//
// Cause: the landing walk (referenceLandingAfter in
// src/parsing/markdown-scan.ts) steps over the "]" as an ordinary closing
// mark and stops at the "[" that follows. Only an inline link's "(url)"
// tail is stepped over whole; a "[]" or "[ref]" tail is not.
//
// The shortcut form, a bare "[text]", is a separate spec question:
// spec-landing-shortcut-reference-link.

/** The text of every working reference-style link in the note's first paragraph, read the way micromark with GFM footnotes reads it. */
function linkTexts(md: string): string[] {
    const tree = fromMarkdown(md, { extensions: [gfmFootnote()], mdastExtensions: [gfmFootnoteFromMarkdown()] });
    const paragraph = tree.children[0] as { children?: { type: string; children?: { value?: string }[] }[] };
    return (paragraph.children ?? [])
        .filter((node) => node.type === "linkReference")
        .map((node) => (node.children ?? []).map((child) => child.value ?? "").join(""));
}

/** The line after a press with the caret one character into `word`: "[^1]" written where the landing walk puts it. */
const pressAt = (line: string, word: string) => {
    const at = endOfWordOffset(line, line.indexOf(word) + 1);
    return line.slice(0, at) + "[^1]" + line.slice(at);
};

describe("a press on the last word of a reference-style link keeps the link", () => {
    it("collapsed link: the link still renders after the press", () => {
        const out = pressAt("see [text][] now", "text");
        // Before the fix: "see [text][^1][] now", read as the text "see [text]" plus the footnote
        expect(linkTexts(`${out}\n\n[text]: http://u\n[^1]: n`)).toContain("text");
    });

    it("full link: the link still renders after the press", () => {
        const out = pressAt("see [text][ref] now", "text");
        // Before the fix: "see [text][^1][ref] now", read as the text "see [text]", the
        // footnote, and a stray link reading "ref"
        expect(linkTexts(`${out}\n\n[ref]: http://u\n[^1]: n`)).toContain("text");
    });
});
