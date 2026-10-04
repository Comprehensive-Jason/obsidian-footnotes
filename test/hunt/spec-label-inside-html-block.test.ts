// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); 5 of 7 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16: Reading view agrees with micromark (probed: the label inside <div>, <script>, <?php, and <![CDATA[ defines nothing; the one under <!DOCTYPE html> does), so the scan reads HTML blocks of types 1, 3, 4, 5, and 6; the pins pass.
import { describe, expect, it } from "vitest";

import { lazyDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// spec question: what is a `[^x]:` label that sits inside one of
// CommonMark's seven HTML block types - raw HTML text (micromark's
// answer), a lazy label one blank line short of a definition (the
// plugin's answer), or, for `<!DOCTYPE html>`, a real definition
// (micromark's answer, the plugin's "lazy")?
//
// CommonMark 0.31 section 4.6 defines seven HTML block kinds; verified
// against micromark 2026-09-16, this hunt:
//
//   type 1  <script>/<pre>/<style> ... matching close    label is raw html
//   type 2  <!-- ... -->                                 (the plugin covers this one)
//   type 3  <? ... ?>                                    label is raw html
//   type 4  <!A-Z ... >  (ends at the first ">")         label UNDER it is a definition
//   type 5  <![CDATA[ ... ]]>                            label is raw html
//   type 6  <div>/<p>/... block tags ... blank line      label is raw html
//   type 7  other complete tags, at a block boundary     label is raw html
//
// The plugin's scanner only knows type 2. Every other type's content is
// "paragraph text" to it, so a label inside one is reported as a lazy
// label: the alert names it, and the fix-lazy rule inserts a blank line
// above it. For a label under `<!DOCTYPE html>` the disagreement flips:
// micromark's type 4 ends at the ">", so the label IS a footnote
// definition, while the plugin still calls it lazy - so move-to-bottom
// leaves behind a definition Obsidian may be showing, and the
// lazy-definition alert names a definition that works.
//
// What the user would see: for type 1/3/5/6/7, lint tells them their
// deliberately-raw HTML text is "one blank line short" of a footnote and
// offers to fix what isn't broken (the insertion then mints a footnote
// they never had). For `<!DOCTYPE html>`, lint insists a working
// definition is broken.
//
// The catch: Obsidian's own parser is not micromark, and the manual
// sheets record no Reading-view observation of HTML blocks other than
// comments. NEEDS A LIVE CHECK: in Reading view, is "<div>\n[^1]: x" raw
// text, and is "<!DOCTYPE html>\n[^1]: x" a footnote? If Reading view
// matches micromark on either, that pin flips to a bug.
//
// Source of truth: CommonMark 0.31 section 4.6 via micromark. Settings
// involved: `Fix definitions hidden by a missing blank line` and its
// alert.

const verdict = (doc: string): { starts: boolean[]; lazy: number[] } => {
    const lines = doc.split("\n");
    const starts = readNote(lines).labelLines;
    return { starts, lazy: lazyDefinitionLabelLines(lines) };
};

describe("spec question: definition labels inside CommonMark HTML blocks", () => {
    it("reading one (micromark): the label under <!DOCTYPE html> IS a definition", () => {
        // type 4 ends at the first ">", so the next line is free.
        // micromark: footnoteDefinition. The plugin says lazy, so
        // starts[1] is false today.
        expect(verdict("<!DOCTYPE html>\n[^1]: x").starts[1]).toBe(true);
    });

    it("reading one (micromark): the label inside <script> is raw HTML, not a lazy label", () => {
        // type 1 runs to its matching close; the label is HTML text.
        // micromark: one html node. The plugin reports it as a lazy label
        // today (alert + fix), so this list is [1].
        expect(verdict("<script>\n[^1]: x\n</script>").lazy).toEqual([]);
    });

    it("reading one (micromark): the label inside <div> is raw HTML, not a lazy label", () => {
        // type 6 runs to a blank line; no blank line here, so the label
        // is HTML text. The plugin reports it as a lazy label today.
        expect(verdict("<div>\n[^1]: x\n</div>").lazy).toEqual([]);
    });

    it("reading one (micromark): the label inside <![CDATA[ is raw HTML, not a lazy label", () => {
        expect(verdict("<![CDATA[\n[^1]: x\n]]>").lazy).toEqual([]);
    });

    it("reading one (micromark): the label inside <?php is raw HTML, not a lazy label", () => {
        expect(verdict("<?php\n[^1]: x\n?>").lazy).toEqual([]);
    });

    it("control: the plugin already reads the type-2 comment block like micromark", () => {
        // a label UNDER a closed comment line is a definition in both
        // readings (sheet 11)
        expect(verdict("<!-- c -->\n[^1]: x").starts[1]).toBe(true);
    });

    it("control: the label under <div> IS a definition once a blank line ends the block (both readings)", () => {
        expect(verdict("<div>\n\n[^1]: x\n</div>").starts[2]).toBe(true);
    });
});
