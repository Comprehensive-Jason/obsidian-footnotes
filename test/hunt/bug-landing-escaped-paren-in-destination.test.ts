// Imported from the GLM 5.3 Flash cycle 4 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// Hunt cycle 8 (GLM 5.3 Flash, 2026-09-16): an ESCAPED round bracket
// inside a link destination ends the landing walk's step-over early, so
// the reference is inserted INSIDE the destination and never renders.
//
// Scenario: "insert at end of word" on, caret at the end of a link's TEXT
// where the destination carries an escaped ")":
//
//   see [docs](http://a.com/x\)y).
//             ^
//
// (that destination is "http://a.com/x\)y" - a backslash-paren, then "y",
// then the closing paren.)
//
// What the user would see in Reading view: the link points at
// "http://a.com/x)y" - CommonMark treats "\)" as a literal parenthesis
// inside the destination, so the link runs to the LAST ")". The
// micromark oracle in node_modules agrees: fromMarkdown parses the
// destination as "http://a.com/x)y" and consumes through the closing
// paren. The footnote reference belongs AFTER the whole link and its
// trailing punctuation: "see [docs](http://a.com/x\)y).[^1]".
//
// What goes wrong: the landing walk's balancedParenEnd counts raw "(" and
// ")" characters without honoring escapes (markdown-scan.ts), so it
// stops at the escaped "\)" as if it closed the destination. The walk
// resumes INSIDE the destination at "y", finds a word character, and
// lands there; the masker's own "](" branch shares the same
// escape-blind helper, so the born-dead simulation cannot catch the
// insertion either. The press writes "[^1]" into the URL.
//
// What the user would see from the plugin: "see [docs](http://a.com/x\)[^1]y)."
// - the destination is mangled and the reference renders as plain text
// inside the link, while its definition is appended at the bottom. The
// landing convention's own contract says "a reference belongs after the
// whole construct, never inside it" (markdown-scan.ts, Jason's landing
// rulings 2026-09-15), and the pinned link-caret fixes
// (bug-cmd-link-url-caret, bug-landing-link-balanced-parens) cover
// carets inside the destination and BALANCED parens, but not escaped
// ones.
//
// Source of truth: CommonMark's escape rules for link destinations,
// confirmed against the micromark oracle, plus the landing convention
// recorded in markdown-scan.ts.
//
// Settings involved: "Insert at end of word" ON; everything else
// default-off in the fake plugin.

import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { referenceLandingAfter } from "../../src/parsing/landing";

const LINE = "see [docs](http://a.com/x\\)y).";

function fakeEditor(lines: string[], ch: number): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor: { line: 0, ch },
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: true,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

describe("an escaped paren inside a link destination does not end the link", () => {
    it("the landing walk steps over the whole destination", () => {
        // end of "docs" is index 9; the whole link plus its trailing "."
        // is stepped over, so the landing is the end of the line
        expect(referenceLandingAfter(LINE, 9)).toBe(LINE.length);
    });

    it("the autonum press lands after the link, not inside the url", async () => {
        const doc = fakeEditor([LINE], "see [docs".length);
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe(`${LINE}[^1]`);
    });

    it("control: balanced unescaped parens already land after the link (pinned shape)", () => {
        const text = "see [docs](http://a.com/(x)y).";
        expect(referenceLandingAfter(text, 9)).toBe(text.length);
    });

    it("control: an unclosed paren tail ends the walk right after the ] (pinned shape)", () => {
        const text = "see [docs](http://a.com/x.";
        expect(referenceLandingAfter(text, 9)).toBe(10);
    });
});
