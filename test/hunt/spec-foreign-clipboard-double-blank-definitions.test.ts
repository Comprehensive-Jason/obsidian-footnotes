import { describe, expect, it } from "vitest";

import { splitCarriedText } from "../../src/commands/carry-footnotes";

// spec question: a clipboard from another app whose trailing definitions
// are spaced by two blank lines: does its text end in a line break?
//
// What it does now: "See[^1] and[^2].", a blank line, "[^1]: one", two
// blank lines, "[^2]: two", copied from a Markdown file in another app
// and pasted into the middle of a line, splits that line: the text is
// taken as ending in a line break, because the second blank line between
// the definitions is read as the selection's own closing line break.
// What a user might expect: the text lands inside the line, since nothing
// in the clipboard asked for a line break after "See[^1] and[^2].".
// Why it is a question and not a bug: d77449d chose this on purpose. The
// plugin's own copy of a line-wise selection whose definitions are carried
// from outside it reads exactly the same way (the selection's closing
// line break, then one blank line, then the carried definitions), and on
// a phone keyboard's clipboard history or from another window that
// clipboard is all the plugin gets. A foreign clipboard spaced by two
// blank lines cannot be told apart from it. The commit message records
// the change: "a clipboard from elsewhere whose trailing definitions have
// two or more blank lines between them now pastes its text as ending in a
// line break". (The plugin's own copy, where the register knows the
// selection, is a bug and pinned in
// bug-own-copy-double-blank-definitions-split-line.)
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K2 (the foreign face).
//
// Origin: regression (since ea38e82, from d77449d, declared there).
//
// Source of truth: the clipboard text itself; d77449d's commit message
// and splitCarriedText's own comment in src/commands/carry-footnotes.ts.
//
// Answered (Jason's ruling Q16, 2026-10-07, after he found that Gboard's
// clipboard history keeps a trailing line break; stage 4 of the result
// gate design, 2026-10-08): a whole-line copy is marked the way plain
// editors mark one, by a line break at the very end of the copied text,
// and read back that way, so the blank lines between two definitions are
// spacing and nothing else. The foreign two-blank clipboard now pastes
// inside the line, as the plugin's own copy of the same selection does.
// The test was it.fails until then. The plugin's own copy of a line-wise
// selection with a definition carried from outside it now ends its text in
// a line break (test/whole-line-copy.test.ts), so the two can be told
// apart.

describe("spec question: a foreign clipboard with two blank lines between its trailing definitions", () => {
    it("a hand-written clipboard with two blank lines between its definitions keeps its body on one line", () => {
        const split = splitCarriedText(["See[^1] and[^2].", "", "[^1]: one", "", "", "[^2]: two"].join("\n"));
        // Before the ruling, the body was "See[^1] and[^2].\n".
        expect(split.body).toBe("See[^1] and[^2].");
        expect(split.carried.map((c) => c.name)).toEqual(["1", "2"]);
    });
});
