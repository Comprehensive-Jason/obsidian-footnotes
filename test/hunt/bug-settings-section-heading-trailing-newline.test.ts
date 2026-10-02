import { describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { deleteFootnote } from "../../src/commands/delete-footnote";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (wrong output): a Section heading setting that ends in a line break
// ("# Footnotes" and then Enter) makes the lint add the heading again and
// again.
//
// What the user would see: the Section heading setting is a text box that
// takes several lines, so pressing Enter after "# Footnotes" is one
// keystroke away. After that, a note that already has "# Footnotes" gets a
// second "# Footnotes" on its next lint, and with Lint on save every save
// reshuffles the headings again: one lint gives one heading, the next
// gives two, the next moves one below the definitions. Remove empty section
// heading also stops working: deleting the last footnote leaves the heading
// behind.
//
// Hunt 2026-10-02, round 4, lens settings. Cluster S2 (the setting half;
// the half about the note's own heading line is
// spec-lint-section-heading-line-variants).
//
// Source of truth: the setting's description ("An existing one is
// reused"); the README ("if it already exists in the note it's reused
// instead of duplicated"); the lint's idempotence promise, lint(lint(x))
// equals lint(x) (test/properties.test.ts); and sectionHeadingProblem's
// precedent (Kimi hunt cycle 1, 2026-09-16), where a heading setting that
// made every lint append one more copy was ruled a bug. Obsidian 1.14.4's
// declarative textarea stores the value verbatim, trailing line break
// included (checked in app.js), so the value reaches the plugin as typed.
//
// Severity: medium. The note gains headings the user did not write, on
// every save with Lint on save.
//
// Cause: the heading is matched against the note's lines with an exact
// string compare, so "# Footnotes\n" never equals the line "# Footnotes".
// The converter's own append already finds it (the control below passes).

/** The lint with the section heading set to `heading` and the main rules on. */
function lint(md: string, heading: string): string {
    const plugin = fakePlugin({
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: heading,
        lintFixPunctuation: true,
        footnotePlacement: "after",
        lintFixLazyDefinitions: true,
        lintMoveToBottom: true,
        lintReindex: true,
        footnoteNaming: "keep",
    });
    return lintFootnotes(md, lintOptionsFromSettings(plugin, heading, md));
}

describe("a section heading setting ending in a line break", () => {
    for (const heading of ["# Footnotes\n", "# Footnotes\n\n", "---\n"]) {
        it.fails(`${JSON.stringify(heading)}: linting twice changes nothing the second time`, () => {
            const once = lint("Text[^1] here.\n\n[^1]: a", heading);
            // Today for "# Footnotes\n": the first lint gives one heading, the
            // second a second heading, the third moves one below the definition.
            expect(lint(once, heading)).toBe(once);
        });
    }

    it.fails('"# Footnotes\\n": a note already holding "# Footnotes" keeps one heading after a lint', () => {
        const out = lint("Text[^1] here.\n\n# Footnotes\n\n[^1]: a", "# Footnotes\n");
        // Today: two "# Footnotes" lines.
        expect(out.split("\n").filter((l) => l === "# Footnotes")).toHaveLength(1);
    });

    it.fails('"# Footnotes\\n" + Remove empty section heading: deleting the last footnote removes the heading', async () => {
        const doc = fakeEditor(["a[^1] b", "", "# Footnotes", "", "[^1]: one"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 2 },
            selection: { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
        });
        await deleteFootnote(
            fakePlugin({ enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes\n", removeEmptySectionHeading: true }, doc),
        );
        // Today: ["a b", "", "# Footnotes"].
        expect(doc.lines).toEqual(["a b"]);
    });

    it('control: "# Footnotes\\n": the converter reuses the heading already in the note', () => {
        const doc = fakeEditor(["a^[one]", "", "# Footnotes", "", "[^5]: five", "b[^5]"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 0 },
        });
        const plugin = fakePlugin({ enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes\n" }, doc);
        convertInlineFootnotesToNormal(plugin, doc);
        expect(doc.lines.filter((l) => l === "# Footnotes")).toHaveLength(1);
    });
});
