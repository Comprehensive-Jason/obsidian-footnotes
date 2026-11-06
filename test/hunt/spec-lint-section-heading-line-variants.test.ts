import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { removeEmptySectionHeading } from "../../src/linting/rules/remove-empty-section-heading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// Should a section heading line written slightly differently from the setting,
// but rendering the same, count as the existing heading?
//
// Jason's ruling, 2026-11-05: trailing whitespace does not count when matching
// the heading, on the note's line or in the setting. The space is invisible in
// the editor, and "# Footnotes " used to get a second "# Footnotes" under it.
// The heading line itself is left as the user wrote it.
//
// A closing hash is a deliberate spelling and a rare one, so it is still not a
// match; see the characterization test below.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster S2 (the note-line half).
// Entry 16 of the spec sort of 2026-11-05. The setting-side twin (a setting
// value ending in a line break) is a confirmed bug:
// bug-settings-section-heading-trailing-newline.
//
// Source of truth: Jason's ruling above; the README ("if it already exists in
// the note it's reused instead of duplicated"); CommonMark 4.2.

/** Convert the inline footnotes in `lines` with `settings`, returning the editor afterwards. */
function runInline(lines: string[], settings: Record<string, unknown>) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    convertInlineFootnotesToNormal(fakePlugin(settings, doc), doc);
    return doc;
}

const heading = { enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes" };

beforeEach(resetNotices);

describe("an existing section heading spelled slightly differently", () => {
    it("a heading line with a trailing space is reused (Jason's ruling, 2026-11-05)", () => {
        const doc = runInline(["a^[one]", "", "# Footnotes "], heading);
        expect(doc.lines).toEqual(["a[^1]", "", "# Footnotes ", "", "[^1]: one"]);
    });

    it("so is one ending in a tab or several spaces, with the line left as it was written", () => {
        expect(runInline(["a^[one]", "", "# Footnotes\t"], heading).lines).toEqual(["a[^1]", "", "# Footnotes\t", "", "[^1]: one"]);
        expect(runInline(["a^[one]", "", "# Footnotes   "], heading).lines).toEqual(["a[^1]", "", "# Footnotes   ", "", "[^1]: one"]);
    });

    it("a setting ending in a space finds a heading line without one", () => {
        const settings = { enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes " };
        expect(runInline(["a^[one]", "", "# Footnotes"], settings).lines).toEqual(["a[^1]", "", "# Footnotes", "", "[^1]: one"]);
    });

    it("each line of a heading that runs over several lines is matched the same way", () => {
        const settings = { enableFootnoteSectionHeading: true, footnoteSectionHeading: "---\n## Notes" };
        expect(runInline(["a^[one]", "", "--- ", "## Notes "], settings).lines).toEqual(["a[^1]", "", "--- ", "## Notes ", "", "[^1]: one"]);
    });

    it("a press under a heading line with a trailing space goes under it", () => {
        const lines = ["text", "", "# Footnotes "];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 4 } });
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, fakePlugin(heading, doc));
        expect(change.text).toBe("\n\n[^1]: ");
        expect(change.from).toEqual({ line: 2, ch: "# Footnotes ".length });
    });

    it("the move to the bottom gathers under it, and a second lint changes nothing", () => {
        const before = "[^1]: one\n\ntext[^1]\n\n# Footnotes \n";
        const once = moveFootnoteDefinitionsToBottom(before, "# Footnotes");
        expect(once).toBe("text[^1]\n\n# Footnotes \n\n[^1]: one\n");
        expect(moveFootnoteDefinitionsToBottom(once, "# Footnotes")).toBe(once);
    });

    it("Remove empty section heading takes it out, as it does a heading with no trailing space", () => {
        expect(removeEmptySectionHeading("text\n\n# Footnotes \n", "# Footnotes")).toBe("text");
        expect(removeEmptySectionHeading("text\n\n# Footnotes\n", "# Footnotes")).toBe("text");
    });

    it("control: a heading that differs by more than trailing whitespace is another heading", () => {
        expect(runInline(["a^[one]", "", " # Footnotes"], heading).lines.filter((l) => l.trim() === "# Footnotes")).toHaveLength(2);
    });

    // Characterization test (behaviour pinned as it is, 2026-11-05, when the
    // spec pins were sorted under Jason's scope rule of 2026-10-07): a closing
    // hash is a deliberate spelling and a rare one, and nothing is lost. It was
    // it.fails until then. The trailing space above is invisible, so a person
    // could plausibly hit it, and it is still open.
    it("characterization: a heading with a closing hash sequence is not reused, and a second heading is added", () => {
        const doc = runInline(["a^[one]", "", "# Footnotes #"], heading);
        expect(doc.lines.filter((l) => l.startsWith("# Footnotes"))).toEqual(["# Footnotes #", "# Footnotes"]);
    });
});
