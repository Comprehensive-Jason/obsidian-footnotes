// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (Kimi hunt cycle 3, probed in Reading view): micromark's reading holds. An opener with no closer on its line runs on only when a later line of the SAME paragraph closes it (a blank line, a heading, a list, a quote, a fence, a rule, a setext underline, an HTML block, or a "%%" block ends the search); otherwise it is literal text and the rest of the note is live. Block math ("$$" at the start of a line's content) and a "<!--" at the start of a continuation line's content keep running as blocks.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// SPEC QUESTION: an HTML comment (or "$$" math block) opened mid-line at
// the DOCUMENT level and never closed - does the rest of the note go
// dead, or does the unterminated opener end as literal text with its
// paragraph?
//
// micromark parses "x <!--\n\nlive[^1] here" as two plain paragraphs of
// literal text (an unterminated comment is NOT an html node), and "x
// <!--\n> > [^a]: def" with the definition LIVE inside the nested quote;
// the block boundary (a blank line, a heading, a list, a fence, a quote)
// ends the opener's paragraph and everything after it is ordinary
// markdown. The plugin's scanner runs the region on: everything after
// the opener, through the next "-->" anywhere or to the end of the note,
// is protected (dead) - so every rule skips it, move-to-bottom refuses to
// work at the note's end at all ("a note that ends inside an unclosed
// comment comes back untouched"), and a creation appends ABOVE the
// phantom region.
//
// Why this is a spec question and not a bug pin: the pinned ground truth
// nearby only covers the QUOTED twin (Sol bug #4, 2026-08-10, verified
// against metadataCache: an unclosed region opened inside a blockquote
// dies with its quote) and asserts the document-level-to-EOF behavior
// without a recorded probe (bug-blockquote-region-outlives-quote's last
// test). The plugin's reading also has one thing going for it: Live
// Preview's highlighter paints an unclosed comment to the end of the
// note (sheet 11's `<!-->` note) - but Live Preview is not the oracle,
// Reading view is.
//
// NEEDS A LIVE CHECK: in Reading view, with a note reading "x <!--",
// blank, "live[^1] here" (and the same shape for "$$"), does the second
// paragraph render live (a footnote superscript once a definition
// exists), or is everything after the opener hidden? Same check for "x
// <!--\n# Heading [^1]" and "x <!--\n> > [^a]: def".
//
// Source of truth if Reading view agrees with micromark: an unterminated
// "<!--" or "$$" is literal text ending with its paragraph; the reading must
// not protect anything past the paragraph's end, and endsProtected must
// be false. Settings involved: every rule inherits the reading; `Move
// definitions to the bottom` refuses outright under the current reading.

const refsAt = (doc: string, line: number): string[] => {
    const lines = doc.split("\n");
    return readNote(lines).referencesOn(line).map((o) => o.name);
};

describe("spec: a document-level unclosed comment or math block", () => {
    it("micromark's reading: text after an unclosed \"x <!--\" is live", () => {
        expect(refsAt("x <!--\n\nlive[^1] here", 2)).toEqual(["1"]);
    });

    it("micromark's reading: a definition in a quote after \"x <!--\" is live", () => {
        const doc = "x <!--\n> > [^a]: def\n\nuse[^a]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([false, false, false, false]);
    });

    it("micromark's reading: the note does not end protected", () => {
        expect(readNote("x <!--\n\nafter".split("\n")).openRegionFrom !== -1).toBe(false);
    });

    it("micromark's reading: same for an unclosed \"x $$\"", () => {
        expect(readNote("x $$\n\nafter".split("\n")).openRegionFrom !== -1).toBe(false);
    });

    it("the opener is literal text: nothing is protected and the note ends live (Reading view, 2026-09-16)", () => {
        const doc = "x <!--\n\nafter";
        const reading = readNote(doc.split("\n"));
        expect(reading.protectedLines).toEqual([false, false, false]);
        expect(reading.openRegionFrom !== -1).toBe(false);
    });

    it("a closer on a later line of the SAME paragraph makes it a real comment", () => {
        const doc = "x <!--\nhidden\n--> live[^1]";
        const reading = readNote(doc.split("\n"));
        expect(reading.protectedLines).toEqual([false, true, false]);
        expect(refsAt(doc, 2)).toEqual(["1"]);
    });

    it("a closer after a blank line pairs with nothing: all literal", () => {
        const doc = "x <!--\n\nhidden[^1]\n\n--> after";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([false, false, false, false, false]);
        expect(refsAt(doc, 2)).toEqual(["1"]);
    });

    it("the quoted twin's pinned ground truth stands: the region dies with its quote", () => {
        const doc = "> <!--\n> draft\n\nafter[^1]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([true, true, false, false]);
    });
});
