import { describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { planDefinitionAppend } from "../../src/commands/definition-append";
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
//
// Fix (2026-10-06): linter.ts trims the blank lines at the start and end of
// the setting (trimmedSectionHeading), both where the commands read the
// setting and where the pure lint takes the heading as an option, so the
// heading is matched as the note holds it.
//
// Fix, the append half (2026-10-06, found while fixing): the first
// footnote's append in src/commands/definition-append.ts read the setting
// untrimmed in both of its places, so a new heading got two blank lines
// under it and a "# Footnotes" already ending the note was not found and
// was added again. It reads the setting through trimmedSectionHeading too
// (the last describe below; red without the fix).

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
        it(`${JSON.stringify(heading)}: linting twice changes nothing the second time`, () => {
            const once = lint("Text[^1] here.\n\n[^1]: a", heading);
            // Today for "# Footnotes\n": the first lint gives one heading, the
            // second a second heading, the third moves one below the definition.
            expect(lint(once, heading)).toBe(once);
        });
    }

    it('"# Footnotes\\n": a note already holding "# Footnotes" keeps one heading after a lint', () => {
        const out = lint("Text[^1] here.\n\n# Footnotes\n\n[^1]: a", "# Footnotes\n");
        // Before the fix: two "# Footnotes" lines.
        expect(out.split("\n").filter((l) => l === "# Footnotes")).toHaveLength(1);
    });

    it('"# Footnotes\\n" + Remove empty section heading: deleting the last footnote removes the heading', async () => {
        const doc = fakeEditor(["a[^1] b", "", "# Footnotes", "", "[^1]: one"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 2 },
            selection: { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
        });
        await deleteFootnote(
            fakePlugin({ enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes\n", removeEmptySectionHeading: true }, doc),
        );
        // Before the fix: ["a b", "", "# Footnotes"].
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

describe("a section heading setting ending in a line break, and the first footnote's append", () => {
    // A press that writes [^1] at the end of "Alpha", with the heading set
    // to `heading`; returns the note as the press leaves it. Found while
    // fixing, 2026-10-06: the append in definition-append.ts read the
    // setting untrimmed, in both of its places.
    function press(lines: string[], heading: string): string[] {
        const plugin = fakePlugin({ enableFootnoteSectionHeading: true, footnoteSectionHeading: heading, enableRemoveBlankLastLines: true });
        return planDefinitionAppend({ lines, edits: [{ from: { line: 0, ch: 5 }, text: "[^1]" }], footnoteId: "1", plugin }).final;
    }

    for (const heading of ["# Footnotes\n", "\n# Footnotes\n\n"]) {
        it(`${JSON.stringify(heading)}: the first footnote gets the heading with one blank line under it, as "# Footnotes" does`, () => {
            // Before the fix for "# Footnotes\n": two blank lines under the heading.
            expect(press(["Alpha"], heading)).toEqual(press(["Alpha"], "# Footnotes"));
            expect(press(["Alpha"], heading)).toEqual(["Alpha[^1]", "", "# Footnotes", "", "[^1]: "]);
        });

        it(`${JSON.stringify(heading)}: a "# Footnotes" heading already ending the note is reused, not added again`, () => {
            // Before the fix: a second "# Footnotes" at the end of the note.
            expect(press(["Alpha", "", "# Footnotes"], heading)).toEqual(["Alpha[^1]", "", "# Footnotes", "", "[^1]: "]);
        });
    }
});
