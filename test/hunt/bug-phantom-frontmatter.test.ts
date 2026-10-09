import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";
import { definitionsHoldingTheMoveBack, moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// Found by the remark differential oracle on its first soak (2026-08-10),
// ground truth verified against Obsidian's metadataCache: a note whose
// FIRST line is a bare unclosed "---" is a THEMATIC BREAK - but the moment
// an edit introduces a column-0 "---" further down (the "---\n## Footnotes"
// section-heading divider), Obsidian re-reads the entire head as a YAML
// frontmatter block. The prose in it (with its references) silently leaves
// the note body, and reindex then renumbered an orphaned definition onto
// the swallowed reference's name - minting a footnote pairing that never
// existed. Fix: when a rebuild/insert would flip that interpretation, a
// blank line is prepended (renders identically; frontmatter can only open
// on the very first line).
//
// Subtraction pass 2026-10-08: the gate now refuses this rare shape on the
// lint's side. The move no longer puts a blank line in front; the result
// gate refuses a move that would turn the top of the note into
// frontmatter, so the lint leaves the definitions where they are and the
// move alert names them. The insert path keeps its own blank line.

const DOC = "---\n\nalpha[^1]. alpha\n\n[^Note]: alpha";
const HEADING = "---\n## Footnotes";

/** The settings a press reads, with the Section heading setting on. */
const pressSettings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: true,
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

describe("phantom frontmatter from a leading thematic break", () => {
    it("move-to-bottom leaves the note as it is rather than add a --- divider", () => {
        // before the subtraction pass: "\n---\n\nalpha[^1]. alpha\n\n---\n## Footnotes\n\n[^Note]: alpha"
        expect(moveFootnoteDefinitionsToBottom(DOC, HEADING)).toBe(DOC);
        // The definition already ends this note, so only the heading is
        // missing and the move alert has nothing to name. A definition in
        // the middle of such a note stays where it is, and the alert names it.
        expect(definitionsHoldingTheMoveBack(DOC, HEADING)).toEqual([]);
        const middle = "---\n\n[^Note]: alpha\n\nalpha[^1]. alpha";
        expect(moveFootnoteDefinitionsToBottom(middle, HEADING)).toBe(middle);
        expect(definitionsHoldingTheMoveBack(middle, HEADING)).toEqual(["Note"]);
    });

    it("move-to-bottom leaves real frontmatter and ----free headings alone", () => {
        // real frontmatter: line 0 already protected - no prepend
        expect(
            moveFootnoteDefinitionsToBottom(
                "---\ntitle: t\n---\n\nalpha[^1].\n\n[^1]: one",
                HEADING,
            ),
        ).toBe("---\ntitle: t\n---\n\nalpha[^1].\n\n---\n## Footnotes\n\n[^1]: one");
        // no divider in the heading: the head stays an unclosed opener
        expect(
            moveFootnoteDefinitionsToBottom(DOC, "## Footnotes"),
        ).toBe("---\n\nalpha[^1]. alpha\n\n## Footnotes\n\n[^Note]: alpha");
    });

    it("full lint keeps the swallowed reference live and reserves its name", () => {
        const out = lintFootnotes(DOC, {
            fixPunctuation: false,
            moveDefinitionsToBottom: true,
            reindex: true,
            reindexOptions: {
                renumberNamedFootnotes: true,
            },
            removeOrphanedReferences: false,
            removeOrphanedDefinitions: false,
            orphanSafePrefix: "",
            applyNotePrefix: false,
            sectionHeading: HEADING,
        });
        // the orphaned definition takes [^2] - NOT the orphaned
        // reference's [^1], which still points nowhere on purpose. The
        // move is held back (subtraction pass 2026-10-08; before it the
        // lint gave "\n---\n\nalpha[^1]. alpha\n\n---\n## Footnotes\n\n[^2]: alpha"),
        // so the head stays a thematic break, not YAML
        expect(out).toBe("---\n\nalpha[^1]. alpha\n\n[^2]: alpha");
    });

    // Subtraction pass 2026-10-08: the gate now refuses this rare shape on
    // the insert path too. The append used to put a blank line at the top
    // of the note in the same edit (its prepend; cursor on line 2 + 5 + 1),
    // so the note's "---" stayed a thematic break; now the result gate
    // refuses the press, as it refuses the move above, and the note is left
    // as it was.
    it("the insert path's first-footnote heading is refused by the result gate", async () => {
        const note = ["---", "", "alpha"];
        const doc = fakeEditor([...note], { wholeDoc: true, edits: true, words: true, cursor: { line: 2, ch: 5 } });
        await insertAutonumFootnote(fakePlugin({ ...pressSettings, footnoteSectionHeading: HEADING }, doc));
        expect(doc.lines).toEqual(note);
        // the head would read as frontmatter, which the gate counts as
        // protected text, hence this notice
        expect(messages()).toEqual(["No footnote was created: footnotes can't go inside code, math, or other protected text."]);
    });

    it("the insert path leaves ----free headings and normal notes alone", async () => {
        const doc = fakeEditor(["---", "", "alpha"], { wholeDoc: true, edits: true, words: true, cursor: { line: 2, ch: 5 } });
        await insertAutonumFootnote(fakePlugin({ ...pressSettings, footnoteSectionHeading: "## Footnotes" }, doc));
        expect(doc.lines).toEqual(["---", "", "alpha[^1]", "", "## Footnotes", "", "[^1]: "]);
    });
});
