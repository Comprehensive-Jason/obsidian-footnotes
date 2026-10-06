import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// Cutting a definition at line 0 strands a "---" at DOCUMENT START, and a leading --- plus a later --- line manufactures a YAML frontmatter block that swallows live prose; reindex drop-orphans then DELETES the still-referenced definition.
// Hunt: 2026-08-09. Lens: properties.
// Root cause: removeLineRanges' setext guard only fires mid-document (out.length > 0), so a cut at line 0 can leave "---" at document start where it parses as frontmatter.

describe("fixed 2026-08-10: a cut stranding '---' at document start manufactures frontmatter", () => {
    it("move-to-bottom does not turn live prose into a frontmatter block", () => {
        const doc = "[^1]: def\n---\ntext[^1]\n---\nmore";
        const out = moveFootnoteDefinitionsToBottom(doc);
        const lines = out.split("\n");
        const proseLine = lines.findIndex((l) => l.startsWith("text[^"));
        expect(readNote(lines).protectedLines[proseLine]).toBe(false);
    });

    it("the orphan rule and reindex keep the definition whose reference sits after a stranded '---'", () => {
        // "[^9]: orphan" over "---" is an H2 heading to Obsidian, not a
        // definition (Kimi hunt cycle 3, probed in Reading view
        // 2026-09-16), so its "[^9]" is a bare reference that reindex may
        // renumber; the live definition must survive under whatever
        // number its reference gets
        const doc = "[^9]: orphan\n---\ntext[^1]\n---\n\n[^1]: def";
        const out = reindexFootnotes(removeOrphanedFootnoteDefinitions(doc));
        const reference = /text\[\^([^\]]+)\]/.exec(out);
        expect(reference).not.toBeNull();
        expect(out).toContain(`[^${reference?.[1] ?? ""}]: def`);
    });

    it("the composed lint does not manufacture frontmatter either", () => {
        const doc = "[^1]: def\n---\ntext[^1]\n---\nmore";
        const out = lintFootnotes(doc);
        const lines = out.split("\n");
        const proseLine = lines.findIndex((l) => l.startsWith("text[^"));
        expect(readNote(lines).protectedLines[proseLine]).toBe(false);
        expect(out).toContain("[^1]: def");
    });
});
