import { Editor } from "obsidian";
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { lintFootnotes } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

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

const DOC = "---\n\nalpha[^1]. alpha\n\n[^Note]: alpha";
const HEADING = "---\n## Footnotes";

describe("phantom frontmatter from a leading thematic break", () => {
    it("move-to-bottom pins line 0 as content before adding a --- divider", () => {
        expect(moveFootnoteDefinitionsToBottom(DOC, HEADING)).toBe(
            "\n---\n\nalpha[^1]. alpha\n\n---\n## Footnotes\n\n[^Note]: alpha",
        );
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
        // reference's [^1], which still points nowhere on purpose
        expect(out).toBe(
            "\n---\n\nalpha[^1]. alpha\n\n---\n## Footnotes\n\n[^2]: alpha",
        );
        // and Obsidian reads the head as a thematic break, not YAML
        // (verified live via metadataCache sections)
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
