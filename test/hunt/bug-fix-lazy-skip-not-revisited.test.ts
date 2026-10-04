// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 2 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";

// The fix-lazy rule walks its lazy labels topmost first, inserting one
// blank line at a time, and SKIPS a label whose blank would reclassify
// protected text below it (the swallow guard). The skip verdict depends
// on the CURRENT state of the note - and the rule's own insertions change
// that state. A label skipped early is never revisited, even after a
// LATER insertion in the same run makes its blank line safe.
//
// Here: inserting [^3]'s blank closes the open list item, which strands
// [^21]'s indented continuation as indented code - while [^21] is still
// lazy. So [^3] is skipped. But the same run then fixes [^21], whose
// continuation is now a definition's content and no longer code. The
// second run inserts [^3]'s blank without trouble - so fixLazy twice
// changes what fixLazy once produced, and the pinned invariant
// "fixLazyDefinitions on its own is idempotent" (test/properties.test.ts)
// breaks.
//
// What the user sees: with the fix toggle ON, the lazy label stays prose
// after the first lint (the alert nags about it); only a SECOND lint
// heals it. Anything downstream of the definition count - orphans,
// duplicates, reindex - sees the note change between runs.
//
// Source of truth: the idempotence invariant pinned for this very rule
// in test/properties.test.ts ("fixLazyDefinitions on its own is
// idempotent") + the rule's own contract (insert the one blank line a
// hidden definition needs).
//
// Settings involved: `Fix definitions hidden by a missing blank line` ON
// (the default).

const doc =
    "- item\n  [^37]: a\nx $$\n$$ tail\n[^3]: b\nstray[^26] reference\n[^21]: first\n    continuation\n\n    second para[^22]";

describe("fix-lazy's skip verdict is state-dependent and skipped labels are never revisited", () => {
    it("fixLazyDefinitions on its own is idempotent", () => {
        const once = fixLazyDefinitions(doc);
        expect(fixLazyDefinitions(once)).toBe(once);
    });

    // Corrected in step 2 of the runtime swap (2026-10-03): once [^37]
    // gets its blank line, Obsidian reads "$$ tail" as a display math block
    // (rule M2) inside the list item, and such a block runs on through the
    // column-0 lines under it (rule B4), so "[^3]: b" is math text, not a
    // lazy label, and there is nothing to fix there. The scanner read the
    // "$$" lines as a closed pair and saw a lazy label. The run is still
    // idempotent, which is what this pin is about.
    it("the label inside the math block that \"$$ tail\" opens is left alone, in the first run as in the second", () => {
        const out = fixLazyDefinitions(doc);
        expect(out).toContain("$$ tail\n[^3]: b");
    });

    it("control: the first run's other lazy label gets its blank; the label under a definition's lazy line needs none", () => {
        // "[^21]: first" sits under "stray[^26] reference", which is the
        // lazy continuation of "[^3]: b", and a label there renders as a
        // definition already (GLM hunt cycle 3, probed in Reading view
        // 2026-09-16), so it is not lazy and gets no blank line
        const out = fixLazyDefinitions(doc);
        expect(out).toContain("\n\n  [^37]: a");
        expect(out).toContain("stray[^26] reference\n[^21]: first");
    });
});
