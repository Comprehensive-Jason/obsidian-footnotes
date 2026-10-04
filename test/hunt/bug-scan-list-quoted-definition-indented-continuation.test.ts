import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { lintFootnotes } from "../../src/linting/linter";
import { orphanedFootnoteDefinitionNames } from "../../src/linting/rules/remove-orphaned-definitions";
import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { definitionStartLines, maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";

// BUG (data loss): a quoted definition inside a list item loses its
// indented continuation line, so a reference in that line is dead to the
// plugin and the definition it cites can be deleted as an orphan.
//
// What the user would see: a list item holds a blockquote, and the quote
// holds a definition, "- > [^o]: orphan", with an indented line under it,
// "  >     body[^c] more". Reading view shows footnote o as "orphan
// body[^c] more", with [^c] a live reference to "[^c]: cited". The plugin
// reads the indented line as code instead. The orphaned-definition alert
// names [^c], Delete orphaned definitions deletes "[^c]: cited" (which
// Reading view still lists), and Delete footnote everywhere on [^c]
// reports no references and leaves "body[^c]" behind.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E2.
//
// Source of truth: micromark with the footnote extension, which renders
// "x[^o]", "", "- > [^o]: orphan", "  >     body[^c] more", "",
// "[^c]: cited" as footnote o = "orphan body[^c] more" with [^c] live, and
// 868f834 (B9, quoted definitions own their bodies), which already reads
// the same shape right with the quote at column 0.
//
// Cause: the quoted-definition reading of B9 (quotedDefinitionEnd) only
// recognizes a label whose line opens with the quote marker. Behind a list
// marker the label is not seen as a label at all (its "[^o]" is even
// counted as a reference), so the four-space line inside the quote is
// masked as quoted indented code. The sibling pin
// bug-scan-quoted-list-item-definition is the other nesting order, a list
// inside a quote ("> - [^a]: def").

const DOC = ["x[^o]", "", "- > [^o]: orphan", "  >     body[^c] more", "", "[^c]: cited"].join("\n");

/** Every live reference in `doc`, as "line:name". */
function liveNames(doc: string): string[] {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    return lines.flatMap((l, i) => referenceOccurrences(l, masked[i], starts[i]).map((o) => `${i}:${o.name}`));
}

describe("a quoted definition inside a list item owns its indented quoted continuation", () => {
    it("the [^c] in the body is a live reference", () => {
        // Today: ["0:o", "2:o"], the label counted as a reference and [^c] dead.
        expect(liveNames(DOC)).toContain("3:c");
    });

    it("the orphaned-definition alert does not name [^c]", () => {
        // Today: ["c"].
        expect(orphanedFootnoteDefinitionNames(DOC)).toEqual([]);
    });

    it("Delete orphaned definitions keeps '[^c]: cited'", () => {
        // Today: the "[^c]: cited" line is deleted.
        expect(lintFootnotes(DOC, { removeOrphanedDefinitions: true })).toContain("[^c]: cited");
    });

    it("Delete footnote everywhere on [^c] also cuts the reference in the body", () => {
        const plan = deleteFootnoteEverywhere(DOC, "c");
        // Today: 0 references cut, "body[^c]" left behind.
        expect(plan.kind === "deleted" ? plan.references : -1).toBe(1);
    });

    it("control: the same footnote with the quote at column 0 is read right", () => {
        const doc = ["x[^o]", "", "> [^o]: orphan", ">     body[^c] more", "", "[^c]: cited"].join("\n");
        expect(liveNames(doc)).toContain("3:c");
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual([]);
    });
});
