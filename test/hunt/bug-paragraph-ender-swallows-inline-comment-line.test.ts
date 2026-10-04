// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// The scanner's paragraphGoesOn ends a paragraph's line-run at any line
// matching /^ {0,3}%%/ - meant for a "%%" BLOCK opener (a lone "%%"). But
// the same regex matches an INLINE comment pair line ("%% c %%"), which
// sheet 11 (2026-09-09) rules is an ordinary paragraph line: "a
// comment-only line is still a paragraph line". So every cross-line
// lookahead that goes through paragraphGoesOn stops one line early:
//
// 1. A code span opened on one line and closing on a later line of the
//    same paragraph (Reading view renders it as ONE span, sheet 11 B30,
//    2026-09-16) stops at the inline-comment line. The reference the span
//    covers stays LIVE to the plugin where Reading view shows it as dead
//    code text.
// 2. An unclosed "<!--" opened mid-line is literal only when no later
//    line of the SAME paragraph closes it (the cycle-3 literalOpeners
//    ruling). The search stops at the inline-comment line, so a closer
//    right after it pairs with nothing: the reference after the opener
//    stays live where Reading view hides it in the comment.
// 3. The same for an unclosed "$$" opened mid-line: the closer line then
//    opens a phantom math BLOCK at its own content start, dead to the end
//    of the note, swallowing everything below.
//
// What the user sees: references inside real code spans and comments get
// counted, renumbered, and alerted on as if they were live, and in the
// math case the note's whole tail goes dead to the linter - move-to-
// bottom refuses to run at all (endsProtected), so their definitions are
// never gathered.
//
// Source of truth: manual sheet 11 ("a comment-only line is still a
// paragraph line", and B30: a wrapped code span is one span to Reading
// view) + the literalOpeners ruling's own condition (the search runs
// through "a later line of the SAME paragraph" - and an inline-comment
// line is one).
//
// Settings involved: none (scanner-level); the lint symptoms ride the
// defaults.

const masked = (doc: string): string[] => {
    const lines = doc.split("\n");
    return [...readNote(lines).maskedLines()];
};

describe("a code span / comment / math region crossing an inline %% pair line", () => {
    it("a code span crossing a comment-only line kills its reference (B30 + the paragraph-line ruling)", () => {
        const out = masked("a `code\n%% c %%\nspan [^1]` tail");
        expect(out[2]).not.toContain("[^1]");
    });

    it("an HTML comment opened mid-line closes after the comment-only line", () => {
        const out = masked("x <!-- [^9]\n%% c %%\n--> b [^2]");
        // the [^9] sits inside the comment: dead; [^2] after the closer: live
        expect(out[0]).not.toContain("[^9]");
        expect(out[2]).toContain("[^2]");
    });

    it("control: a lone %% BLOCK opener really does end the paragraph (the ender's purpose)", () => {
        const out = masked("a `code\n%%\nspan [^1]` tail");
        // the span cannot cross a comment block: [^1] stays live
        expect(out[2]).toContain("[^1]");
    });

    // Corrected 2026-10-03 (the runtime swap): to Obsidian the "$$ b" line
    // opens a display math block that runs to the end of the note (rule M2:
    // a line starting with "$$" that is no closed pair opens one, under a
    // paragraph too; recorded fact 1c658e2, where Obsidian reads no
    // definition after such a line). So everything from line 2 on is math,
    // and the lint should leave the note as it is. Expected fail until step
    // 2 of the swap, when the scanner still read the "$$ b" line as the
    // closer of a pair and the lint renamed and moved text inside the
    // math (fixed there: the masked twin comes from the note reading; the
    // test that had the "$$ b" line close the math opened on line 0 is
    // gone).
    it("the math block the \"$$ b\" line opens runs to the end of the note: the lint leaves it alone", () => {
        const doc = "x $$ a\n%% c %%\n$$ b [^3]\n\n[^4]: def\n\ntext[^4]";
        const once = lintFootnotes(doc, {});
        // the "$$ b" line closes the math opened on line 0, so "[^3]"
        // after the closer is a live (orphaned) reference, the note ends
        // live, and the definition is gathered at the bottom; reindex
        // numbers the two references in order on the way
        expect(once).toBe(doc);
    });
});
