import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (command-press property, the day the generator learned to emit a
// "# Footnotes" line, 2026-09-09): with the section-heading setting ON, a
// selection that overlaps the existing "# Footnotes" heading was converted
// with the definition slotted UNDER that heading - a position inside the
// very span the same transaction replaces. The definition landed in the
// middle of the conversion and the paragraph's tail ("orem ipsum ...") was
// glued to it as a lazy continuation. buildDefinitionAppend now takes the
// selection span to avoid: a heading the selection swallows is no slot,
// and the unclosed-region walk-up never stops inside the span either.

describe("a selection that swallows the section heading", () => {
    beforeEach(resetNotices);

    it("appends the definition at the bottom instead of inside the selection", async () => {
        const lines = [
            "^[an inline note]",
            "",
            "# Footnotes",
            "",
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        ];
        const doc = fakeEditor(lines, {
            cursor: { line: 2, ch: 1 },
            selection: { anchor: { line: 2, ch: 1 }, head: { line: 4, ch: 1 } },
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: false,
                    expandSelectionToWholeWords: false,
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    enableFootnoteSectionHeading: true,
                    footnoteSectionHeading: "# Footnotes",
                    enableRemoveBlankLastLines: false,
                },
                doc,
            ),
        );
        expect(messages()).toEqual([]);
        const tail = doc.lines.findIndex((l) => l.includes("orem ipsum"));
        const label = doc.lines.findIndex((l) => l.startsWith("[^1]: "));
        expect(tail).toBeGreaterThan(-1);
        expect(label).toBeGreaterThan(tail);
        // the definition is a real block, with the swallowed heading text as its body
        const block = readNote(doc.lines).blocks.find((b) => b.name === "1");
        expect(block?.start).toBe(label);
        expect(doc.lines[label]).toBe("[^1]: Footnotes");
        // and a fresh heading was slotted above it, since the old one is gone
        expect(doc.lines[label - 2]).toBe("# Footnotes");
    });
});
