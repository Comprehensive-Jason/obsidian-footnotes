import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes } from "../../src/linting/linter";
import { definitionsHoldingTheMoveBack, moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): with a section heading set, the move alert names a
// definition the lint has just gathered under that heading, and tells the
// user it could not move it.
//
// What the user would see: the Section heading setting is "# Footnotes",
// the note ends in a list item below that heading, and [^c]'s label is
// indented two spaces. Ctrl+S moves [^c] under the heading, where it
// belongs, and then shows "This note has a footnote definition the lint
// could not move to the bottom ("[^c]") ... Move it by hand". There is
// nothing to move.
//
// The "move alert" is the notice the lint shows after "Move footnotes to
// the bottom" when some definition held the move back.
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X29.
//
// Origin: regression (bb3f729). Before it, the alert said nothing here.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-06): gathered at the END
// of the note, the two-space label would join the list item, but under the
// heading, above the list, it is a top-level definition; ADR 0002, whose
// alerts must say what the lint left, not what it did.
//
// Cause: definitionsHoldingTheMoveBack in
// src/linting/rules/move-footnotes-to-the-bottom.ts works out the gathering
// with no section heading (misreadByGathering), at the end of the note,
// since it is not told the heading. noticeUngatheredDefinitions in
// src/linting/lint-alerts.ts calls it without the heading the lint used.

/** Each definition as "name@first line-last line", the name in lower case. */
const defs = (text: string) => readNote(text.split("\n")).definitions.map((d) => `${d.name.toLowerCase()}@${d.start}-${d.end}`);

beforeEach(resetNotices);

describe("the move alert with a section heading and a list after it", () => {
    const doc = "x[^c] here.\n\n  [^c]: def\n\n# Footnotes\n\n- item";
    const heading = "# Footnotes";

    it("control: with the heading, the move gathers [^c] under it", () => {
        const moved = moveFootnoteDefinitionsToBottom(doc, heading);
        expect(moved).not.toBe(doc);
        expect(defs(moved)).toEqual(["c@4-4"]);
    });

    // Now: "This note has a footnote definition the lint could not move to
    // the bottom ("[^c]"), and the lint left it in place, because moving
    // it would change how Obsidian reads the lines around it. ..."
    it.fails("after the lint gathered [^c] under the heading, the move alert does not name it", () => {
        const after = lintFootnotes(doc, { sectionHeading: heading });
        expect(after).toBe("x[^c] here.\n\n# Footnotes\n\n  [^c]: def\n\n- item");
        noticeLintAlerts(fakePlugin({ lintMoveToBottom: true, enableFootnoteSectionHeading: true, footnoteSectionHeading: heading }), after);
        expect(messages().filter((m) => m.includes("could not move to the bottom"))).toEqual([]);
    });

    // Now: ["c"].
    it.fails("definitionsHoldingTheMoveBack on the gathered note is empty", () => {
        const after = lintFootnotes(doc, { sectionHeading: heading });
        expect(definitionsHoldingTheMoveBack(after)).toEqual([]);
    });

    // The same with text between the heading and the list, and the
    // heading one level down.
    // Now: ["c"].
    it.fails("with text under the heading: no move alert for a definition the lint gathered there", () => {
        const note = "Text[^c].\n\n  [^c]: def\n\n## Footnotes\n\nAfter\n- item";
        const linted = lintFootnotes(note, { sectionHeading: "## Footnotes" });
        expect(linted).toBe("Text.[^c]\n\n## Footnotes\n\n  [^c]: def\n\nAfter\n- item");
        expect(definitionsHoldingTheMoveBack(linted)).toEqual([]);
    });
});
