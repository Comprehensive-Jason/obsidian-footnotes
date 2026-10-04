// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { readNote } from "../../src/parsing/note-reading";

// A definition block OWNS a region one of its lines opens: the column-0
// walk (findDefinitionBlocks) absorbs the interior and closer lines of a
// comment, math block, or fence opened on a continuation line, "so the
// definition owns all of it" (markdown-scan.ts) - a rule added after
// whole-block deletions "took the opener away from its closer" (Claude
// sweep 2026-09-13). The QUOTED walk, quotedDefinitionEnd, never got that
// memo: it stops at the region's first protected interior line, so the
// block ends early.
//
// When the orphaned-definition rule then cuts the quoted block, the
// comment's (or math block's) opener goes with it but the interior and
// closer stay behind - and with the opener gone the interior turns into
// LIVE text. Reference-shaped text the user had hidden inside a comment
// wakes up as a live reference.
//
// What the user sees, with `Delete orphaned definitions` ON: lint deletes
// their orphaned quoted definition, and where it stood there is now
// "> hidden [^9]" and a dangling ">" closer line, rendered as ordinary
// text - the comment they wrote is dismembered around the deletion.
//
// Source of truth: the rule's own contract ("Protected text, and
// everything that is referenced, stays exactly where it is",
// remove-orphaned-definitions.ts) and the column-0 precedent in
// findDefinitionBlocks (a definition owns the regions its lines open,
// verified in Reading view 2026-09-16 per the code comment).
//
// Settings involved: `Delete orphaned definitions` ON (non-default).

const doc = "> [^1]: def\n> tail <!-- open\n> hidden [^9]\n> -->\n\nafter";
const mathDoc = "> [^1]: def\n> tail $$\n> math [^9]\n> $$\n\nafter";

function liveReferenceNames(markdown: string): string[] {
    const lines = markdown.split("\n");
    const names: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of readNote(lines).referencesOn(i)) {
            names.push(occurrence.name);
        }
    }
    return names;
}

describe("orphan deletion of a quoted definition whose continuation opens an inline comment", () => {
    it("takes the whole comment region with the definition", () => {
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("after");
    });

    it("never wakes the reference hidden inside the comment", () => {
        expect(liveReferenceNames(removeOrphanedFootnoteDefinitions(doc))).not.toContain("9");
    });

    it("the math-region twin: takes the whole math block with the definition", () => {
        expect(removeOrphanedFootnoteDefinitions(mathDoc)).toBe("after");
    });

    it("control: the column-0 shape already takes the whole region (the precedent)", () => {
        expect(
            removeOrphanedFootnoteDefinitions("[^1]: def\n    tail <!-- open\n    hidden [^9]\n    -->\n\nafter"),
        ).toBe("after");
    });

    it("control: the comment lines stay dead while the definition is present", () => {
        expect(liveReferenceNames(doc)).not.toContain("9");
    });
});
