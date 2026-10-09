import { Editor } from "obsidian";
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
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

    it("the insert path's first-footnote heading gets the same guard", () => {
        const doc = {
            getLine: (n: number) => ["---", "", "alpha"][n],
            lineCount: () => 3,
            lastLine: () => 2,
        } as unknown as Editor;
        const plugin = {
            settings: {
                enableRemoveBlankLastLines: true,
                enableFootnoteSectionHeading: true,
                footnoteSectionHeading: HEADING,
            },
        } as unknown as FootnotePlugin;
        const definition = buildDefinitionAppend(docContext(doc), "1", true, plugin);
        expect(definition.prepend).toEqual({
            from: { line: 0, ch: 0 },
            text: "\n",
        });
        // cursor accounts for the whole document shifting down one line:
        // insertion line 2 + five inserted lines ("\n\n---\n## Footnotes\n\n[^1]: ")
        // + the prepended blank
        expect(definition.cursor.line).toBe(2 + 5 + 1);
    });

    it("the insert path leaves ----free headings and normal notes alone", () => {
        const doc = {
            getLine: (n: number) => ["---", "", "alpha"][n],
            lineCount: () => 3,
            lastLine: () => 2,
        } as unknown as Editor;
        const plugin = {
            settings: {
                enableRemoveBlankLastLines: true,
                enableFootnoteSectionHeading: true,
                footnoteSectionHeading: "## Footnotes",
            },
        } as unknown as FootnotePlugin;
        expect(buildDefinitionAppend(docContext(doc), "1", true, plugin).prepend).toBeUndefined();
    });
});
