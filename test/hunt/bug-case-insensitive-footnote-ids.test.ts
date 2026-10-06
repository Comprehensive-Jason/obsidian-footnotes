import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";

import FootnotePlugin from "../../src/main";
import { createMatchingFootnoteDefinition } from "../../src/commands/create-footnote";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG: Obsidian footnote labels are case-insensitive - "[^Note]" and "[^note]:"
// are the SAME footnote, and the metadata cache lowercases ids. The plugin's own
// popup code already relies on this (footnote-popup.ts lowercases the id, issue
// #50), but every other comparison keys on the raw match and is case-sensitive.
// Three concrete failures:
//  1. Data loss on reindex: keepOrphanedDefinitions:false (an option since
//     removed, hunt 2026-10-05 round 2, cluster L7) classified "[^note]:"
//     as an orphan of "[^Note]" ("note" !== "Note") and DELETES the definition.
//  2. Split pair: renumberNamedFootnotes:true numbers the reference [^1] and its
//     definition [^2] - one footnote torn into a broken pair.
//  3. Duplicate creation: with the caret in "[^Note]" and a "[^note]:" definition
//     already present, the named command creates a second definition instead of
//     navigating to the existing one.
// Scenario: references/definitions differing only in letter case are treated as unrelated.
// fixed 2026-07-17: ids are folded to lowercase for identity everywhere they
// are compared (reindex pairing/orphans/numbering, definition scans, jump logic),
// while original casing is preserved in untouched output text.
// Provenance: iteration-1/eval-1/without_skill/run-1 (bug sweep, BUG 1).

function fakePlugin(overrides: Record<string, unknown> = {}): FootnotePlugin {
    return sharedFakePlugin({
        insertAtEndOfWord: false,
        enablePopupEditor: false,
        ...overrides,
    });
}

describe("bug: footnote ids compared case-sensitively", () => {
    it("reindex must not delete a definition referenced with different casing", () => {
        const result = reindexFootnotes(
            removeOrphanedFootnoteDefinitions("Alpha[^Note].\n\n[^note]: the definition text"),
        );
        expect(result).toContain("the definition text");
    });

    it("renumbering named footnotes keeps reference and definition paired", () => {
        const result = reindexFootnotes(
            "Alpha[^Note].\n\n[^note]: the definition text",
            { renumberNamedFootnotes: true },
        );
        expect(result).toBe("Alpha[^1].\n\n[^1]: the definition text");
    });

    it("the named command must not create a duplicate case-variant definition", () => {
        const lines = ["Alpha[^Note].", "", "[^note]: existing definition"];
        const doc = fakeEditor(lines, { edits: true });
        // caret inside the [^Note] reference; a definition for this footnote exists
        // (case-insensitively), so this press should navigate, not create
        createMatchingFootnoteDefinition(
            "Alpha[^Note].",
            { line: 0, ch: 8 },
            fakePlugin(),
            doc,
        );
        expect(doc.lines).toEqual(lines);
    });
});
