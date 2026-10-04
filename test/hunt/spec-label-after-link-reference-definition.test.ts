// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16: Reading view agrees with micromark (probed: the label under a link reference definition renders as a definition), so a link reference definition ends the block; the pin passes.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// spec question: is a `[^x]:` label directly under a LINK REFERENCE
// DEFINITION ("[foo]: /url") a footnote definition, or lazy paragraph
// text?
//
// CommonMark's answer (verified against micromark 2026-09-16, this hunt):
// a link reference definition is a block-level construct, not a
// paragraph, so the label under it starts a footnote definition -
// micromark parses "[foo]: /url\n[^1]: x" as definition(foo) followed by
// footnoteDefinition(1), and the footnote body renders.
//
// The plugin's scanner disagrees: definitionStartLines treats the
// "[foo]: /url" line as an ordinary paragraph line, so the label under
// it is a lazy label - not a definition start. The definition is then
// invisible to move-to-bottom, to the orphan rules as a definition, and
// to reindex as a definition, while its "[^1]" counts as a live
// REFERENCE (the lazy-label rule), the opposite identity from the one
// micromark reports.
//
// What the user would see if Reading view matches micromark: the lint's
// fix inserts a blank line (harmless), but with the fix off the alert
// calls their working definition "plain text ... no blank line above
// it", and a note holding both this label and a real "[^1]:" elsewhere
// has its two definitions read as "definition + reference" by the plugin
// and "duplicate definitions" by Obsidian.
//
// The catch: sheet 14's list of what a definition may follow ("a blank
// line, the note start, a heading, a closed fence, a callout's title
// line, or another definition") was ground-truthed in Reading view on
// ten shapes, and a link reference definition was not one of them. Sheet
// 25 also warns micromark cannot referee this rule (its GFM footnotes
// let a definition interrupt a paragraph) - but here micromark is not
// interrupting anything: the link reference definition is a block, and
// the footnote definition simply follows it.
//
// NEEDS A LIVE CHECK: in Reading view, does "[foo]: /url" followed
// directly by "[^1]: x" render the footnote? If yes, the plugin
// under-counts a definition; if no, the label is lazy as the plugin says.
//
// Source of truth: CommonMark 0.31 (a link reference definition is a
// block, not a paragraph) via micromark. Settings involved: `Fix
// definitions hidden by a missing blank line` and its alert.

const startsOf = (doc: string): boolean[] => {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
};

describe("spec question: a definition label directly under a link reference definition", () => {
    it("reading one (micromark): the label IS a definition start", () => {
        // micromark parses "[foo]: /url\n[^1]: x" as definition(foo) then
        // footnoteDefinition(1). The plugin says lazy, so starts[1] is
        // false today.
        expect(startsOf("[foo]: /url\n[^1]: x")[1]).toBe(true);
    });

    it("control: the same label under ordinary prose stays lazy (sheet 14)", () => {
        expect(startsOf("para line\n[^1]: x")[1]).toBe(false);
    });

    it("control: the same label after a blank line is a definition (sheet 14)", () => {
        expect(startsOf("[foo]: /url\n\n[^1]: x")[2]).toBe(true);
    });
});
