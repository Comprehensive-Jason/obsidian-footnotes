// Imported from the GLM 5.3 Flash cycle 1 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

import { readNote } from "../../src/parsing/note-reading";

// Scenario: a footnote definition whose LABEL line the block scanner does
// not recognise as opening a definition - a label directly under a LINK
// REFERENCE DEFINITION ("[foo]: /url"), under a GFM TABLE ROW, or after a
// "%%" block comment's closer - followed by a blank line and an INDENTED
// chunk that carries a reference-shaped string ("    code [^2]").
//
// What Obsidian does (both halves are recorded Reading-view ground truth):
// the label renders as a definition (spec-label-after-link-reference-
// definition, RESOLVED: "Reading view agrees with micromark"; Jason's A2
// ruling for the table row), and an indented line after a definition's
// blank line CONTINUES that definition, where a reference-shaped string
// "woke up as a live reference" (manual former sheet 20, section I, Jason's
// ruling 2026-09-16 - the same swallowing move-to-bottom must avoid). So
// the chunk's "[^2]" is a live nested reference to footnote 2, and any
// renumbering of footnote 2 must rename it too.
//
// What the plugin does: definitionStartLines DOES know both label shapes
// and starts a block there, and findDefinitionBlocks even absorbs the
// indented chunk into that block (it is protected and starts with four
// spaces, so it is "absorbable"). But scanDocument's own indented-code
// decision never saw the definition open: its inDefinition state is set
// only when the label line passes the plain DefinitionStart check at a
// block boundary, and neither an LRD line nor a table row is a block
// ender. So the chunk is marked isProtected, its masked twin is all NULs,
// and the "[^2]" inside it is dead to every rename rule. reindex renames
// the definition to "[^2]" and reorders the blocks around it while the
// chunk keeps "[^2]" - in Reading view the nested citation now points at
// the wrong footnote (below, the chunk cited footnote "two" before the
// lint and cites the "body cites" definition after it; in the %% variant
// the citation ends up pointing at the definition that holds it).
//
// What the user sees: they run lint (reindex is on by default), nothing
// looks deleted, and a citation inside a footnote's continuation text
// silently changes which footnote it points to.
//
// Source of truth: manual former sheet 20 §I ("the code stopped being code and a
// reference-shaped string inside it woke up as a live reference", Jason's
// ruling 2026-09-16) + the RESOLVED Reading-view probe recorded in
// spec-label-after-link-reference-definition.test.ts + the A2 ruling
// recorded in the definitionsInsideTable alert. Settings involved:
// `Reindex` (on by default); the same masked scan feeds every rename rule
// (apply-prefix, rename), so they all miss the chunk.

const opts = { renumberNamedFootnotes: false, keepOrphanedDefinitions: true };

const protectedFlags = (doc: string): readonly boolean[] => readNote(doc.split("\n")).protectedLines;

describe("a definition continuation under a label the block walker misreads stays masked", () => {
    it("reindex renames the nested reference inside the chunk when the label sits under a link reference definition", () => {
        const doc = "b[^2] a[^1].\n\n[foo]: /url\n[^1]: body cites [^2]\n\n    code [^2]\n\n[^2]: two\n[^1]: one";
        // the chunk is the definition's continuation, live, and the block
        // absorbs it (the pin as written asserted the buggy protected
        // state as its premise; rewritten to the fix 2026-09-16)
        expect(protectedFlags(doc)[5]).toBe(false);
        expect(readNote(doc.split("\n")).blocks.map((b) => [b.start, b.end])).toContainEqual([3, 5]);
        const out = reindexFootnotes(doc, opts);
        // Obsidian reads the chunk as the definition's continuation, so the
        // citation inside it renames with the footnote it cites
        expect(out).toContain("code [^1]");
    });

    it("reindex renames the nested reference inside the chunk when the label sits under a table row", () => {
        // a REAL table, with its delimiter row: a lone pipe line is a
        // paragraph in Obsidian, and the label under it would be lazy
        const doc = "b[^2] a[^1].\n\n| a | b |\n| --- | --- |\n[^1]: body cites [^2]\n\n    code [^2]\n\n[^2]: two\n[^1]: one";
        expect(protectedFlags(doc)[6]).toBe(false);
        expect(readNote(doc.split("\n")).blocks.map((b) => [b.start, b.end])).toContainEqual([4, 6]);
        const out = reindexFootnotes(doc, opts);
        expect(out).toContain("code [^1]");
    });

    it("reindex renames the nested reference inside the chunk when the label follows a %% closer", () => {
        const doc = "b[^2] a[^1].\n\n%%\nhidden\n%% [^1]: body cites [^2]\n\n    code [^2]\n\n[^2]: two\n[^1]: one";
        // the chunk is live: the label after the closer defines, and the
        // scan's own definition state opens there too
        expect(protectedFlags(doc)[6]).toBe(false);
        const out = reindexFootnotes(doc, opts);
        // today the chunk keeps [^2], which the lint just reassigned to the
        // "body cites" definition itself - the citation points at its own
        // footnote in Reading view
        expect(out).toContain("code [^1]");
    });

    it("control: with a plain column-0 label the chunk is live and renames with the rest", () => {
        const doc = "b[^2] a[^1].\n\n[^1]: body cites [^2]\n\n    code [^2]\n\n[^2]: two\n[^1]: one";
        expect(protectedFlags(doc)[4]).toBe(false);
        expect(reindexFootnotes(doc, opts)).toContain("code [^1]");
    });

    it("control: the chunk's own text is never lost by the reindex swap", () => {
        const doc = "b[^2] a[^1].\n\n[foo]: /url\n[^1]: body cites [^2]\n\n    code [^2]\n\n[^2]: two\n[^1]: one";
        // the chunk keeps its indent and words; only the reference inside
        // it is renumbered with the rest of the note
        expect(reindexFootnotes(doc, opts)).toMatch(/ {4}code \[\^\d\]/);
    });
});
