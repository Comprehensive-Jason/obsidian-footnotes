import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG: a definition block is allowed to end while still owning a comment
// opener whose closer is further down the note, so every rule that moves
// whole definition blocks tears the commented-out region in half.
//
// What the user would see: a footnote definition whose continuation line
// opens a comment ("    %%" or "    <!--") to hide the notes underneath it.
// Running lint moves that definition, and the opener travels with it while
// the closer stays where it was. Text the user had hidden becomes visible,
// visible text becomes hidden, and in the worst of the six cases below the
// orphan rule deletes the hidden lines outright.
//
// Why it happens: findDefinitionBlocks walks a definition's continuation
// lines and absorbs the interior of a region that a continuation line
// opens, but it stops at the end of the indented run instead of at the
// region's closer. The block it hands back therefore contains an opener
// and no closer, and every mover trusts the block boundaries it is given.
// This is not a "%%" problem: the HTML-comment twins are protected text and
// misbehave in exactly the same way, which is why all six are pinned here.
//
// Hunt: 2026-09-13. Lens: comments.
// Source of truth: the spec pin "inside a definition continuation, an
// indented opener hides the rest of the body" in spec-obsidian-comments;
// the A1 precedent (2026-09-08) recorded in findDefinitionBlocks' doc
// comment, where move-to-bottom dragged a "-->" away and left the comment
// unclosed; attack-surface "%% comments" row ("nothing inside a block
// comment is moved, renamed, or fixed"); ADR-0002 (lint never eats text the
// user did not opt into losing) for the deletion case.

describe("bug: a definition block carries a comment opener away from its closer", () => {
    // The invariant every case asserts: the lines the user commented out,
    // from the opener down to the closer, come back exactly as they were
    // typed and still next to each other.

    it("move-to-bottom keeps a %% opener in a continuation line with its closer", () => {
        const doc = "x[^1] y[^2]\n\n[^1]: one\n    %%\nhidden[^2] text\n%%\n\ntail";
        expect(moveFootnoteDefinitionsToBottom(doc)).toContain("    %%\nhidden[^2] text\n%%");
    });

    it("move-to-bottom keeps an HTML opener in a continuation line with its closer", () => {
        // the same shape with "<!--" and "-->", where the commented lines
        // are protected text: the definition still drags the opener off and
        // leaves the bare "-->" behind
        const doc = "x[^1] y[^2]\n\n[^1]: one\n    <!--\nhidden[^2] text\n-->\n\ntail";
        expect(moveFootnoteDefinitionsToBottom(doc)).toContain("    <!--\nhidden[^2] text\n-->");
    });

    it("reindex's reordering keeps a %% opener with its closer", () => {
        const doc = "b[^2] a[^1]\n\n[^1]: one\n    %%\nhidden\n%%\n[^2]: two";
        expect(reindexFootnotes(doc)).toContain("    %%\nhidden\n%%");
    });

    it("reindex's reordering keeps an HTML opener with its closer", () => {
        const doc = "b[^2] a[^1]\n\n[^1]: one\n    <!--\nhidden\n-->\n[^2]: two";
        expect(reindexFootnotes(doc)).toContain("    <!--\nhidden\n-->");
    });

    // The deletion half (rewritten to the fix, 2026-09-16). The orphan's
    // block owns the comment its continuation line opened, from the opener
    // down to the closer, so deleting the orphan takes the hidden lines
    // with it as part of its body, the way it takes any other continuation
    // line. What must never happen is the half-way state the bug produced:
    // the opener gone and the closer left behind, hiding or revealing text
    // the user never touched.
    // Corrected 2026-10-03 (the runtime swap): the "%%" and "<!--" inside
    // [^9]'s body open nothing that reaches [^1]. Obsidian reads [^9] on
    // the label line and the opener line, and "[^1]: one" as a definition of
    // its own that "a[^1]" cites (rule D5 in docs/obsidian-reading-rules.md:
    // "[^9]: orphan" / "    %%" / "[^1]: one" / "%%" gives [^9] on lines 1
    // to 2 and [^1] on lines 3 to 4; a label ends a definition, rule E1). So
    // only the orphan [^9] goes, and [^1] stays.
    it("deleting an orphaned definition takes only its own lines when its %% opener reaches no further", () => {
        const doc = "a[^1]\n\n[^9]: orphan\n    %%\n[^1]: one\n%%";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("a[^1]\n\n[^1]: one\n%%");
    });

    // The same reading for the HTML twin. Expected fail until step 2 of the
    // swap: the scanner still reads "<!--" as a comment running to "-->",
    // which hides "[^1]: one", so the cut looks like it changes how the
    // rest of the note reads and is refused.
    it.fails("deleting an orphaned definition takes only its own lines when its HTML opener reaches no further", () => {
        const doc = "a[^1]\n\n[^9]: orphan\n    <!--\n[^1]: one\n-->";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("a[^1]\n\n[^1]: one\n-->");
    });
});
