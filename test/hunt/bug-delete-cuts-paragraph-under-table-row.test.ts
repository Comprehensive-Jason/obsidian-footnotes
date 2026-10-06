import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss): Delete footnote everywhere on a table row that starts
// like a label, with a "===" paragraph under the table, cuts that "==="
// paragraph along with the row.
//
// What the user would see: a table written without outer pipes ("a | b",
// "--- | ---"), whose last row is "[^1]: x | y", and a line "===" right
// under the table. Reading view draws the table with that row, and the
// "===" as a short paragraph of its own under it. The user runs Delete
// footnote everywhere on [^1]. The row goes, which is the footnote's own
// line, but the "===" paragraph goes too, though it belongs to no
// footnote. The shape is unnatural, but the line lost is the user's.
//
// A "pipeless table" is a table whose rows do not start and end with "|".
//
// Hunt 2026-10-06, cycle 5, lens reader. Cluster X36.
//
// Origin: pre-existing.
//
// Source of truth: docs/obsidian-reading-rules.md C2 (the first line that
// is not a row ends a table and starts a new block; "===" holds no pipe,
// so it is no row) and C3 (in a pipeless table, "[^1]: x | y" is a row);
// the note reading agrees (the control below). The README promises that
// Delete footnote everywhere never changes text it was not asked to touch.
// Same root as bug-delete-cuts-rule-under-lazy-label (cluster X35).
//
// Cause: underlinedAt in src/parsing/label-shapes.ts files the row as an
// "underlined" label (one a setext underline sits under), because once a
// blank line went in above it, the row and the "===" would read as a
// heading. deleteFootnoteEverywhere in src/commands/delete-footnote.ts
// then cuts an underlined label together with the line under it, without
// asking whether that line is a block of its own in the note as it is.

const Lines = ["a | b", "--- | ---", "[^1]: x | y", "===", "", "More"];

describe("a label-shaped last row of a pipeless table over a '===' paragraph", () => {
    // The note reading (the plugin's model of how Obsidian reads the note)
    // puts the row in the table and starts a paragraph on the "===" line.
    it("control: the reading puts the row in the table and the '===' in a paragraph of its own", () => {
        const reading = readNote(Lines);
        expect(reading.lineBlocks[2]).toBe("table");
        expect(reading.lineBlocks[3]).toBe("^paragraph");
    });

    // Now the "===" line is gone from the result. Keeping it, or refusing
    // the deletion, would both be acceptable.
    it.fails("Delete footnote everywhere keeps the '===' line (or refuses)", () => {
        const plan = deleteFootnoteEverywhere(Lines.join("\n"), "1") as { kind: string; markdown?: string };
        expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes("===")).toBe(true);
    });
});
