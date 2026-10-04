// Imported from the GLM 5.3 Flash cycle 6 hunt of 2026-09-16 (OpenCode worktree); 1 of 1 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (GLM hunt cycle 6, probed in Reading view): the line is hidden as a link reference definition and the label under it renders a footnote; the plugin's lenient label pattern matches Obsidian.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// SPEC QUESTION (GLM hunt, cycle after 9, 2026-09-16): CommonMark 4.7
// forbids an unescaped "[" inside a link reference definition's label,
// so "[a[b]: /url" is PARAGRAPH text (the repo's micromark oracle: a
// paragraph node, no definition). The plugin's LinkReferenceDefinition
// pattern only excludes "]", so it accepts "[a[b]" as a label and treats
// the line as an LRD block.
//
// The two readings disagree about the line under it. If Reading view
// follows CommonMark's label rule, "[a[b]: /url" is plain paragraph
// text, "[^1]: x" directly under it is a lazy label, and the lint must
// treat it exactly like the pinned prose-label shapes (fix-lazy may
// insert the blank line, the lazy alert may speak). The plugin instead
// reads the LRD as a block of its own, so the label under it starts a
// definition: the lint would move, renumber, and reindex a line
// Obsidian renders as prose.
//
// Jason decides: probe Reading view with
//
//     [a[b]: /url
//     [^1]: x
//
// If the label renders as a definition, the plugin is right and this
// pin should be deleted; if it renders as lazy prose, the LRD pattern
// must refuse a label holding an unescaped "[".
//
// Source of truth: micromark oracle output for this hunt (paragraph,
// no definition node) + CommonMark 4.7's label rule. Not probed in
// Reading view this cycle - the live app was out of scope.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (the alert/fix pair), plus the default reindex and move-to-bottom.

const doc = "[a[b]: /url\n[^1]: x";

describe("spec: does a link reference label with an unescaped [ end the line's paragraph?", () => {
    it("REFUTED: Obsidian takes '[a[b]: /url' as a link reference definition, so the label under it starts", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).labelLines).toEqual([
            false,
            true,
        ]);
    });
});
