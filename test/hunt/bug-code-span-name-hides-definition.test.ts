import { describe, expect, it } from "vitest";

import { definitionLabelWithName } from "../../src/parsing/footnote-grammar";
import { maskedLineAt } from "../../src/parsing/markdown-scan";
import { fakeEditor } from "../helpers/fake-editor";
import { listExistingFootnoteDefinitions } from "../../src/editor/doc-context";

// BUG (hunt 2026-08-25, grammar lens): a definition whose NAME contains a
// backtick that pairs with a backtick in the BODY ("[^a`b]: c`d") is
// invisible to the plugin. The inline-code mask runs over the whole line
// before the label is carved off, the emergent span `b]: c` swallows the
// label's own "]:", and DefinitionStart no longer matches the masked
// twin. Ground truth (micromark + gfm-footnote, the differential-oracle
// convention): footnote-label recognition is NOT inline-tokenized - the
// line parses as footnoteDefinition{identifier:"a`b"} with body "c`d",
// so Obsidian renders and links a definition this plugin can't see
// (listing, orphan detection, navigation all blind). Real parsers carve
// the label first and only inline-tokenize the surviving body.
// Skeptic-confirmed. NOTE the twin PROBE-ERROR ruling from the same
// hunt: for "[^a`]:`x]" the label side WINS per ground truth (the raw
// gate in referenceOccurrenceAtCursor is CORRECT to see a definition
// there; the masked twin's phantom reference is the wrong side) - a fix
// must resolve the label before masking, not weaken the label check.

describe("code-span-shaped names inside definition labels", () => {
    it("definitionLabelWithName finds the definition GFM sees", () => {
        const line = "[^a`b]: c`d";
        const masked = maskedLineAt([line], 0);
        const hit = definitionLabelWithName(line, masked);
        expect(hit).not.toBeNull();
        expect(hit?.name).toBe("a`b");
    });

    it("the definition listing includes it", () => {
        const doc = fakeEditor(["ref[^a`b] here", "", "[^a`b]: c`d"], {
            wholeDoc: true,
        });
        expect(listExistingFootnoteDefinitions(doc)).toContain("a`b");
    });
});
