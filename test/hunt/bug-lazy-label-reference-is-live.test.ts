import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { lintFootnotes } from "../../src/linting/linter";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import {
    orphanedFootnoteDefinitionNames,
    removeOrphanedFootnoteDefinitions,
} from "../../src/linting/rules/remove-orphaned-definitions";
import {
    lazyDefinitionLabelNames,
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
} from "../../src/linting/rules/remove-orphaned-references";
import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import {
    definitionStartLines,
    findDefinitionBlocks,
    maskProtectedLines,
    scanDocument,
} from "../../src/parsing/markdown-scan";

// Second review of the prose-label rule (2026-09-09), ground-truthed in
// Reading view the same day:
// - a lazy label's own "[^1]" IS a live reference ("prose\n[^1]: lazy
//   body\n\n[^1]: real body" renders two [1] superscripts resolving to the
//   real definition), yet the grammar excluded every column-0 label from
//   the reference set - so orphan-definition deletion destroyed the real
//   definition, and reindex could hand the lazy line's number to another
//   footnote, minting a live reference in the user's prose;
// - a blockquote interrupts a paragraph ("prose\n> [^1]: quoted def" is a
//   definition) and a setext "===" underline ends one ("H\n===\n[^1]:
//   real" is a definition), neither of which the start rule knew;
// - deleting an orphaned reference could promote the lazy label under
//   it into a live definition, a reclassification the deletion's own
//   guard promised to refuse.

const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return findDefinitionBlocks(lines, scanDocument(lines)).map((b) => `${b.name}@${b.start}`);
};
const lazyOf = (doc: string) => {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    return lazyDefinitionLabelNames(lines, scan, masked, definitionStartLines(lines, scan, (i) => masked[i]));
};

describe("a lazy label's own reference is live", () => {
    it("referenceOccurrences counts it when the line is not a definition start", () => {
        expect(referenceOccurrences("[^1]: lazy body", "[^1]: lazy body", false).map((o) => o.name)).toEqual(["1"]);
        expect(referenceOccurrences("[^1]: real body", "[^1]: real body", true)).toEqual([]);
        expect(referenceOccurrences("[^1]: real body", "[^1]: real body")).toEqual([]);
    });

    it("keeps the real definition it points at out of orphan deletion", () => {
        const doc = "prose\n[^1]: lazy body\n\n[^1]: real body";
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual([]);
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(doc);
        // fixLazyDefinitions off: this pins the lazy semantics themselves (on,
        // the fix promotes the label and orphan deletion then removes both
        // unreferenced definitions - test/fix-lazy-definitions.test.ts)
        expect(lintFootnotes(doc, { removeOrphanedDefinitions: true, fixLazyDefinitions: false })).toBe(doc);
    });

    it("reserves its number in the reindex order", () => {
        expect(reindexFootnotes("prose\n[^1]: lazy text\n\npara[^9]\n\n[^9]: real")).toBe(
            "prose\n[^1]: lazy text\n\npara[^2]\n\n[^2]: real",
        );
    });

    it("is never deleted as an orphan reference, and neither is a plain reference to the same name", () => {
        const doc = "a[^1]\npara\n[^1]: mid";
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });
});

describe("two more paragraph enders the start rule knows", () => {
    it("a blockquote interrupts a paragraph", () => {
        const doc = "prose\n> [^1]: quoted def\n\nbody[^1]";
        expect(lazyOf(doc)).toEqual([]);
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
    });

    it("a setext underline ends one", () => {
        expect(blocksOf("text[^1]\n\nH\n===\n[^1]: real")).toEqual(["1@4"]);
        expect(lazyOf("text[^1]\n\nH\n===\n[^1]: real")).toEqual([]);
    });

    it("a label directly under a callout title, quoted or not, is a definition (ground truth)", () => {
        // the label is a lazy line of the callout, so the note reading puts
        // the definition inside it: a definition (it starts on line 1), but
        // not a block that moves (Jason's ruling 1, option a, 2026-10-03)
        expect(blocksOf("> [!note] Title\n[^1]: x\n\nbody[^1]")).toEqual([]);
        expect(definitionStartLines("> [!note] Title\n[^1]: x\n\nbody[^1]".split("\n"))[1]).toBe(true);
        expect(lazyOf("> [!note] Title\n> [^1]: x\n\nbody[^1]")).toEqual([]);
    });
});

describe("orphan-reference deletion never promotes a lazy label", () => {
    it("refuses a deletion that would leave the label under a blank line", () => {
        const doc = "[^9]\n[^1]: def\n\ntext[^1]";
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });
});

describe("the v1 settings migration parses the tidy keys it copies", () => {
    it("a mistyped tidy value falls back to the default", async () => {
        const plugin = new (FootnotePlugin as unknown as new () => FootnotePlugin)();
        plugin.loadData = () => Promise.resolve({ settingsVersion: 0, tidyReindex: "no", tidyOnSave: true });
        plugin.saveData = () => Promise.resolve();
        await plugin.loadSettings();
        expect(plugin.settings.lintReindex).toBe(true);
        expect(plugin.settings.lintOnSave).toBe(true);
    });
});
