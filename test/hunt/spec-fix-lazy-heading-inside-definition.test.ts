import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// spec question: when a lazy label has an indented "===" under it, should
// the fix-lazy rule still put in the blank line that makes the label a
// definition, though the footnote's text then shows as a heading?
//
// A "lazy label" is a "[^1]:" line directly under a line of prose, one
// blank line short of being a definition, so Obsidian reads it as more of
// the paragraph. A "setext heading" is a line of text with a line of "="
// marks under it, which Obsidian draws as a heading.
//
// What it does now: "Text[^1] here", "[^1]: def", "    ===" (the "==="
// indented four spaces) is one paragraph, with "===" as plain text. On
// Ctrl+S, the rule "Fix definitions hidden by a missing blank line" puts
// a blank line above the label. Now [^1] is a definition, but its text is
// "def" over "===", which is a setext heading inside the footnote: the
// footnotes list at the end of Reading view shows "def" as a big level 1
// heading. A label at an outer list item's content column, with "    ==="
// under it, does the same inside the list item.
//
// What a user might expect: either the blank line goes in and the footnote
// reads as plain text "def ===", or the rule leaves the label alone and
// the lazy-label alert names it, as it does for a label whose fix would
// change how the lines after it read.
//
// Why it is a question and not a bug: the fix does what the user meant,
// [^1] gets its definition and nothing outside the footnote changes. Only
// the footnote's own text reads differently, and an "===" under a
// definition's first line is an odd thing to write. Whether that is worth
// refusing the fix over is Jason's call. (The nested face started showing
// this after 6081d8b changed how the plugin decides whether a "===" under
// a label underlines it; the top-level face is older.)
//
// Hunt 2026-10-06, cycle 5, lens reader. Cluster X38.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-06): "[^1]: def",
// "    ===", "", "Use[^1]" renders the footnote as a level 1 heading "def"
// inside the footnotes list; that is exactly the note the top-level fix
// writes. The nested face is judged by the note reading only (the
// plugin's model of how Obsidian reads a note). The precedent
// bug-remove-def-creates-setext-heading (2026-07-17) ruled that changing
// a note's heading structure behind the user's back is a defect.
//
// The assertions below are written for "no new heading", so they are red
// today.

/** The innermost block in one line's entry of the reading's lineBlocks, with its "^" when it starts on that line. */
const ownBlock = (blocks: string | undefined): string => (blocks ?? "").split(" ").pop() ?? "";

/** How many headings start in the note, by the note reading. */
const headingLines = (lines: string[]): number => readNote(lines).lineBlocks.filter((blocks) => /^\^heading\d$/.test(ownBlock(blocks))).length;

describe("fix-lazy's blank line over a label with an indented '===' under it", () => {
    const Cases = [
        // Now the result is "Text[^1] here", "", "[^1]: def", "    ===",
        // "", "after", the very note Obsidian was asked about.
        { what: "top level, '===' indented four spaces", lines: ["Text[^1] here", "[^1]: def", "    ===", "", "after"] },
        // Now a blank line goes in above "  [^1]: def", which becomes a
        // definition in the outer list item with a heading inside it.
        { what: "at an outer list item's content column, under a nested item", lines: ["- a", "  - b[^1]", "  [^1]: def", "    ==="] },
    ];

    for (const { what, lines } of Cases) {
        it(`control (${what}): the note has no heading before the fix`, () => {
            expect(headingLines(lines)).toBe(0);
        });

        it.fails(`${what}: the fix does not leave a setext heading inside the new definition`, () => {
            const out = fixLazyDefinitions(lines.join("\n")).split("\n");
            expect(headingLines(out)).toBe(0);
        });
    }
});
