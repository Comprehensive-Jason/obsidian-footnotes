// Imported from the GLM 5.3 Flash cycle 7 hunt of 2026-09-16 (OpenCode worktree); 2 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-7). 2 of 3 tests carry it.fails; the control does not.
import { describe, expect, it } from "vitest";

import { docContext } from "../../src/editor/doc-context";
import { warnTableEdgeCaretIfOutside } from "../../src/commands/press-guards";
import { scanDocument, tableRowLinesOf } from "../../src/parsing/markdown-scan";
import { fakeEditor } from "../helpers/fake-editor";

// BUG: the repo has TWO table readers, and after Kimi hunt cycle 3 they
// disagree. tableRowLinesOf (the scanner's, used by definitionStartLines
// and the in-table alert) learned the Reading-view rule "a table cannot
// interrupt a paragraph - a table header directly under plain paragraph
// text or a list item line is no table at all" (Kimi hunt cycle 3, probed
// in Reading view 2026-09-16; the markdown-scan header even claims "The
// same rule as tableRowLines in the editor's table module"). tableRowLines
// (the editor's, in table-cursor.ts, used by the caret guards in
// press-guards.ts and the selection verdicts in selection-footnote.ts)
// never learned it: it marks the pipe run a table from the delimiter row
// alone, whatever sits above.
//
// So on a note where pipe-shaped prose sits directly under a paragraph
// line (a shell flag table typed mid-prose, say), which Reading view
// renders as ONE paragraph of literal pipes - no table, no cell editor,
// nothing to protect - the plugin:
//
//   - refuses the numbered/named/inline press with the caret on the
//     "| --- |" line ("the caret is on the row of dashes under a table's
//     header" - false: there is no table and no header),
//   - refuses a press past a row's closing pipe with the table-edge
//     notice,
//   - and refuses a selection running from inside the pipe run into the
//     text below as "cutting through a table's pipes", where the README
//     promises multi-paragraph selections convert.
//
// Source of truth: the recorded Reading-view probe (bug-table-under-lt-
// line's header, cycle 3: the run under plain paragraph text is no table)
// + tableRowLinesOf, which already implements it + markdown-scan.ts's own
// comment claiming the two readers share one rule. Caveat recorded
// honestly: these guards also serve Live Preview's table sub-editor, and
// no sheet records Live Preview's rendering of this shape; Reading view
// is the stated oracle, and there the run is a paragraph.
//
// Settings involved: every creation press's caret guards (the numbered,
// named, and inline keys) and the selection-to-footnote conversion.
//
// Step 2 of the runtime swap (2026-10-03) left one table reader: the note
// reading's, which reads tables the way Obsidian does (rules C1 to C5);
// the editor's own reader is gone, and the caret guards and the selection
// verdicts ask the reading.

const DOC = ["prose", "| a | b |", "| --- |", "| c | d |", "", "tail"];

describe("the editor table reader under plain paragraph text", () => {
    it("a pipe run under prose is no table", () => {
        expect(tableRowLinesOf(DOC)).toEqual(DOC.map(() => false));
        // the same under a list item line, the second half of the pinned
        // Reading-view rule
        const itemLines = ["- item", "| a | b |", "| --- |"];
        expect(tableRowLinesOf(itemLines)).toEqual([false, false, false]);
    });

    it("the caret on the dashes line is NOT refused as a table delimiter", () => {
        const editor = fakeEditor(DOC, { cursor: { line: 2, ch: 1 } });
        const refused = warnTableEdgeCaretIfOutside(
            null,
            { line: 2, ch: 1 },
            docContext(editor),
        );
        expect(refused).toBe(false);
    });

    it("control: the same run after a blank line is a table to both readers", () => {
        const lines = ["prose", "", "| a | b |", "| --- |", "| c | d |"];
        expect(tableRowLinesOf(lines)).toEqual([false, false, true, true, true]);
        expect(scanDocument(lines).isProtected).toEqual([false, false, false, false, false]);
    });
});