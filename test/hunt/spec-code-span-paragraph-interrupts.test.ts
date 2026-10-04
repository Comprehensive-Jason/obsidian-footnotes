// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); 1 of 9 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16: Reading view agrees with micromark on every shape below (probed), so the scan's search for a code span's closer now stops at each of these block starts; the pins pass.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// spec question: when a code span's opening backtick run sits on one line
// and a block-level construct that ENDS the paragraph stands between it
// and the next backtick run, does the span reach across the interrupt, or
// does it die at the paragraph's end?
//
// CommonMark's answer (verified against micromark 2026-09-16, this hunt):
// the paragraph ends, the opener never closes, and both backtick runs are
// literal text - so a "[^2]" after the opener is a LIVE reference (in a
// setext heading it renders as a footnote sup inside the heading,
// verified in micromark's HTML output). The constructs that end a
// paragraph here: a setext underline of one or more "=" or "-" signs, a
// blockquote opener, a bullet list item, an ordered list item numbered 1,
// and an HTML block opener such as "<!--".
//
// The plugin's scanner disagrees: closesAhead (markdown-scan.ts) looks for
// the closing run on later lines and stops only at a blank line, a fence,
// an ATX heading, or a 3+ character thematic break. It searches straight
// through every one of the constructs above, so it masks from the opener
// to the next same-length run across the interrupt, and the "[^2]" dies
// inside the mask.
//
// What the user would see if Reading view matches CommonMark: the heading
// text "My `note [^2]" shows a footnote marker on "[^2]", but the plugin
// treats it as dead code - the numbered command mints a duplicate "[^2]",
// reindex renumbers around it, and orphan deletion erases references that
// Reading view shows as live.
//
// The catch: B30 (2026-09-16) ruled that for code spans across lines the
// oracle is Reading view, not Live Preview and not micromark, and sheet 11
// records only the plain-paragraph case ("a run of the same length closes
// it further down ... within the paragraph"). Whether Reading view also
// ends the span's paragraph at these constructs is NOT recorded anywhere.
//
// NEEDS A LIVE CHECK: in Reading view, does "`code [^2]" followed by "==="
// render as a heading whose "[^2]" is a live footnote reference? If yes,
// every case below is a bug; if no, the plugin's masking is right and
// these pins flip.
//
// Source of truth: CommonMark 0.31 (code spans may span line endings
// within a paragraph; a setext underline, blockquote, list, or HTML block
// ends the paragraph) as implemented by micromark, run as this repo's
// oracle. Settings involved: none (scanner facts drive every feature).

const firstLineReferences = (doc: string): string[] => {
    const lines = doc.split("\n");
    return readNote(lines).referencesOn(0).map((o) => o.name);
};

const CASES: [string, string][] = [
    ["a setext = underline", "`code [^2]\n===\ntail` [^1]"],
    ["a setext - underline", "`code [^2]\n-\ntail` [^1]"],
    ["a setext -- underline", "`code [^2]\n--\ntail` [^1]"],
    ["a blockquote opener", "`code [^2]\n> `tail` [^1]"],
    ["a bullet list item", "`code [^2]\n- `tail` [^1]"],
    ["an ordered list item numbered 1", "`code [^2]\n1. `tail` [^1]"],
    ["an HTML comment block", "`code [^2]\n<!-- c -->\n`tail` [^1]"],
];

describe("spec question: does a code span cross a paragraph-ending block start?", () => {
    for (const [name, doc] of CASES) {
        it(`the reference after the opener is live across ${name}`, () => {
            // CommonMark: the paragraph ends at the construct, the opener
            // never closes, and [^2] is a live reference. Today the
            // scanner masks it dead, so this list comes back without "2".
            expect(firstLineReferences(doc)).toContain("2");
        });
    }

    it("control: a lazy continuation (ordered item numbered 2) keeps the span alive across lines", () => {
        // micromark: "2. `tail`" lazily continues the paragraph, the span
        // closes across the lines, and [^2] is dead inside it - the plugin
        // agrees, so this passes today.
        expect(firstLineReferences("`code [^2]\n2. `tail` [^1]")).not.toContain("2");
    });

    it("control: within one plain paragraph the span still crosses lines (B30)", () => {
        // sheet 11: a run that closes on the next line of the SAME
        // paragraph is one code span, and the reference inside is dead
        expect(
            firstLineReferences("Use of a `code\nspan[^7] that wraps` onto the next line."),
        ).not.toContain("7");
    });
});
