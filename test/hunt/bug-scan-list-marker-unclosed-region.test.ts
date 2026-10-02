import { describe, expect, it } from "vitest";

import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { definitionStartLines, maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";

// BUG (wrong output): an HTML comment or math block opened on a list
// item's own line ("- <!--", "- $$") and never closed is read as plain
// text, though Obsidian hides everything after it.
//
// What the user would see: a list item starts "- <!--" and the comment
// is never closed. Reading view hides the rest of the note. The plugin
// reads the comment as plain text, so a "[^99]" inside it reserves a
// number, hidden references get renumbered by the lint, and a new
// definition can be appended inside the hidden region where it never
// shows. "- $$" left open behaves the same.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X9. Likely a regression
// from 1c658e2.
//
// Source of truth: 7a6583d (2026-09-16, a Reading-view fact: "an HTML
// comment or a math block opened in an item runs on to its closer or the
// end of the note"). The same opener on the item's continuation line is
// already read that way.

// Every live reference in `doc`, as "line:name", and the scan.
function facts(doc: string) {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    const live = lines.flatMap((l, i) => referenceOccurrences(l, masked[i], starts[i]).map((o) => `${i}:${o.name}`));
    return { scan, live };
}

describe("an unclosed region opened on a list item's marker line", () => {
    it.fails("'- <!--' unclosed runs on: hidden[^99] reserves no number", () => {
        expect(facts("- <!--\n  hidden[^99]\nplain[^1]").live).toEqual([]);
    });

    it.fails("'- $$' unclosed runs on: the line under it is protected and plain[^1] is hidden", () => {
        expect(facts("- $$\n  x = 1\nplain[^1]").scan.isProtected).toEqual([false, true, true]);
    });
});
