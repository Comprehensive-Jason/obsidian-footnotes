import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal, convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

// BUG (wrong output): both convert commands convert a footnote that sits on
// the continuation line of a list-item definition, nesting one footnote
// inside another.
//
// What the user would see: a list item holds a definition, "- [^i]: in the
// item", and the indented line under it, "  see[^1]", carries on that
// definition's text. Converting normal footnotes to inline turns that line
// into "  see^[one]", an inline footnote inside footnote i. Converting
// inline footnotes to normal does the mirror image: "  more ^[nested]"
// becomes "  more [^1]", a reference inside footnote i. The same shapes in
// a blockquote ("> [^q]: quoted" over "> see[^1]") are skipped, as they
// should be.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V1.
//
// Source of truth: docs/adr/0001-no-nested-footnotes.md (the plugin never
// creates nesting) and spec-label-after-list-marker (a list-item definition
// is a definition in Reading view). GFM continues a paragraph inside its
// list item, so the indented line belongs to the definition. The
// converters already skip the quoted twin with the reason "referenced from
// inside another footnote".
//
// Cause: both converters treat only the label line of an in-item
// definition as inside a definition; its continuation lines read as plain
// body text.

const convert = (lines: string[]) => convertNormalFootnotesToInline(lines.join("\n"));

// Runs the inline-to-normal command on a fake editor holding `lines`.
function run(lines: string[], settings: Record<string, unknown> = {}) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    const plugin = fakePlugin(settings, doc);
    const result = convertInlineFootnotesToNormal(plugin, doc);
    return { doc, result };
}

beforeEach(resetNotices);

describe("a footnote on an in-item definition's continuation line", () => {
    it("normal to inline: a reference on the continuation line is inside a footnote and is skipped", () => {
        const r = convert(["a[^1] b[^i]", "", "- [^i]: in the item", "  see[^1]", "", "[^1]: one"]);
        // Today the continuation line becomes "  see^[one]".
        expect(r.skipped).toContainEqual({ name: "1", reason: "referenced from inside another footnote" });
        expect(r.markdown).toContain("see[^1]");
    });

    it("inline to normal: an inline footnote on the continuation line is left alone", () => {
        const { doc, result } = run(["a[^i]", "", "- [^i]: in the item", "  more ^[nested]"]);
        // Today the line becomes "  more [^1]" and "[^1]: nested" is added.
        expect(doc.lines.slice(0, 4)).toEqual(["a[^i]", "", "- [^i]: in the item", "  more ^[nested]"]);
        expect(result.converted).toBe(0);
    });
});
