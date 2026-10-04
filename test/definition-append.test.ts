import { describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

import FootnotePlugin from "../src/main";
import { FootnotePluginSettings } from "../src/settings";
import { buildDefinitionAppend } from "../src/commands/definition-append";
import { docContext } from "../src/editor/doc-context";

// Where a new footnote definition lands. Issue #55: when definitions already
// exist, the new definition belongs right after the LAST existing definition
// block - not at the end of the file, where it strands the footnotes away
// from the section (e.g. "#### Citations") the user keeps them under.
// Only the very first footnote starts a new section at the end of the note.

function fakePlugin(
    overrides: Partial<FootnotePluginSettings> = {},
): FootnotePlugin {
    return sharedFakePlugin({
        enableRemoveBlankLastLines: true,
        enableFootnoteSectionHeading: false,
        footnoteSectionHeading: "# Footnotes",
        ...overrides,
    });
}

describe("buildDefinitionAppend", () => {
    it("starts the first footnote's section at the end of the note", () => {
        const doc = fakeEditor(["Alpha"]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "1", true, fakePlugin());
        expect(change).toEqual({
            from: { line: 0, ch: 5 },
            // with trimming enabled, `to` always spans to the note's end -
            // a no-op range here since there is nothing to trim
            to: { line: 0, ch: 5 },
            text: "\n\n[^1]: ",
        });
        expect(cursor).toEqual({ line: 2, ch: 6 });
    });

    it("trims trailing blank lines for the first footnote when enabled", () => {
        const doc = fakeEditor(["Alpha", "", ""]);
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, fakePlugin());
        expect(change.from).toEqual({ line: 0, ch: 5 });
        expect(change.to).toEqual({ line: 2, ch: 0 });
    });

    it("adds the section heading for the first footnote when enabled", () => {
        const doc = fakeEditor(["Alpha"]);
        const { change } = buildDefinitionAppend(
            docContext(doc),
            "1",
            true,
            fakePlugin({ enableFootnoteSectionHeading: true }),
        );
        // a blank line always separates the heading from the content above
        expect(change.text).toBe("\n\n# Footnotes\n\n[^1]: ");
    });

    it("a blank insertion line already supplies the heading's blank line", () => {
        // trimming off, note ends with an empty line: inserting there must
        // not stack a second blank above the heading
        const doc = fakeEditor(["Alpha", ""]);
        const { change } = buildDefinitionAppend(
            docContext(doc),
            "1",
            true,
            fakePlugin({
                enableFootnoteSectionHeading: true,
                enableRemoveBlankLastLines: false,
            }),
        );
        expect(change).toEqual({
            from: { line: 1, ch: 0 },
            text: "\n# Footnotes\n\n[^1]: ",
        });
    });

    it("appends after the last definition when definitions end the note", () => {
        const doc = fakeEditor(["Alpha[^1] bravo", "", "[^1]: one"]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 2, ch: "[^1]: one".length },
            text: "\n[^2]: ",
        });
        expect(cursor).toEqual({ line: 3, ch: 6 });
    });

    it("appends after a mid-document definition group, not at the end of the file (issue #55)", () => {
        const doc = fakeEditor([
            "Alpha[^1] bravo.",
            "",
            "#### Citations",
            "[^1]: one",
            "",
            "#### Images",
            "picture here",
        ]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 3, ch: "[^1]: one".length },
            text: "\n[^2]: ",
        });
        expect(cursor).toEqual({ line: 4, ch: 6 });
    });

    it("appends after the last definition's continuation lines", () => {
        const doc = fakeEditor([
            "Alpha[^1].",
            "",
            "[^1]: one",
            "    continued",
            "",
            "closing prose",
        ]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change.from).toEqual({ line: 3, ch: "    continued".length });
    });

    it("ignores definition-shaped lines inside fenced code when finding the last block", () => {
        const doc = fakeEditor([
            "Alpha[^1].",
            "",
            "[^1]: one",
            "",
            "```",
            "[^9]: fake",
            "```",
        ]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change.from).toEqual({ line: 2, ch: "[^1]: one".length });
    });
});

// Bug (reported 2026-07-20): a definition inserted directly above prose gets
// that prose pulled INTO the footnote - Obsidian lazily continues a
// definition into the next non-blank line. Every insertion point that can
// have content below it must keep a blank line between the definition and it.
describe("blank line between the new definition and following content", () => {
    it("separates the definition from prose right below the heading slot", () => {
        const doc = fakeEditor([
            "Intro[^1] text",
            "",
            "# Footnotes",
            "prose right after",
        ]);
        const { change, cursor } = buildDefinitionAppend(
            docContext(doc),
            "1",
            true,
            fakePlugin({ enableFootnoteSectionHeading: true }),
        );
        expect(change).toEqual({
            from: { line: 2, ch: "# Footnotes".length },
            text: "\n\n[^1]: \n",
        });
        // the cursor still lands at the end of the definition line itself
        expect(cursor).toEqual({ line: 4, ch: 6 });
    });

    it("separates the definition from prose below a reused blank line", () => {
        const doc = fakeEditor(["Intro[^1]", "", "# Footnotes", "", "prose"]);
        const { change, cursor } = buildDefinitionAppend(
            docContext(doc),
            "1",
            true,
            fakePlugin({ enableFootnoteSectionHeading: true }),
        );
        expect(change).toEqual({ from: { line: 3, ch: 0 }, text: "\n[^1]: \n" });
        expect(cursor).toEqual({ line: 4, ch: 6 });
    });

    it("separates a definition appended after the last block from prose below", () => {
        const doc = fakeEditor([
            "Alpha[^1] bravo.",
            "",
            "#### Citations",
            "[^1]: one",
            "#### Images",
        ]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 3, ch: "[^1]: one".length },
            text: "\n[^2]: \n",
        });
        expect(cursor).toEqual({ line: 4, ch: 6 });
    });

    it("adds no separator when a blank line already follows", () => {
        const doc = fakeEditor([
            "Alpha[^1] bravo.",
            "",
            "[^1]: one",
            "",
            "tail prose",
        ]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change.text).toBe("\n[^2]: ");
    });
});

// Bug #10 (2026-08-11 review, Opus): with the note ending inside an
// UNCLOSED fence / comment / math block, the EOF append minted the new
// definition INSIDE that region - born as inert code, and the next lint
// then deleted its live reference as an orphan (the same endsProtected
// hazard move-footnotes-to-the-bottom refuses). The definition must land
// above the unclosed region instead, and the trailing-blank trimming must
// not fire (its `to` spanning to EOF would delete the region itself).
describe("never appending into an unclosed region at EOF (2026-08-11 bug #10)", () => {
    it("lands the definition above an unclosed fence", () => {
        const doc = fakeEditor(["prose[^9]?", "", "```", "code"]);
        // isFirstFootnote is passed false here (a unit convenience), so the
        // blank separator comes from the prose-above rule instead of the
        // heading slot: a label directly under prose is lazy paragraph text
        // to Obsidian (2026-09-09)
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "1", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 0, ch: "prose[^9]?".length },
            text: "\n\n[^1]: ",
        });
        expect(cursor).toEqual({ line: 2, ch: 6 });
    });

    it("lands the definition after a comment a later line of the paragraph closes", () => {
        // an unclosed opener is literal text unless a later line of its
        // paragraph closes it (Kimi hunt cycle 3, probed in Reading view
        // 2026-09-16); a closer on the next line makes it a real comment,
        // which ends there, so the note ends live and the definition goes
        // after the closer
        const doc = fakeEditor(["alpha[^1].", "", "text <!-- open", "hidden -->"]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change.from).toEqual({ line: 3, ch: "hidden -->".length });
        expect(change.text).toBe("\n\n[^2]: ");
    });

    it("lands the definition at the end when the opener is never closed (literal text)", () => {
        const doc = fakeEditor(["alpha[^1].", "", "text <!-- open", "hidden"]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change.from).toEqual({ line: 3, ch: "hidden".length });
        expect(change.text).toBe("\n\n[^2]: ");
    });

    it("keeps the unclosed opener out of the definition with a blank separator", () => {
        const doc = fakeEditor(["a[^1]!", "$$", "E=mc^2"]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 0, ch: "a[^1]!".length },
            text: "\n\n[^2]: \n",
        });
    });

    it("a note that is one unclosed fence from line 0 gets the definition planted on top", () => {
        const doc = fakeEditor(["```", "code"]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "1", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 0, ch: 0 },
            text: "[^1]: \n\n",
        });
        expect(cursor).toEqual({ line: 0, ch: 6 });
    });

    it("a CLOSED fence at the end of the note still appends at EOF", () => {
        const doc = fakeEditor(["prose[^9]?", "", "```", "code", "```"]);
        const { change } = buildDefinitionAppend(docContext(doc), "1", false, fakePlugin());
        expect(change.from).toEqual({ line: 4, ch: 3 });
    });
});

describe("slotting under an existing section heading (QOL follow-up to #55)", () => {
    const headingOn = () =>
        fakePlugin({ enableFootnoteSectionHeading: true });

    it("the first definition goes under an existing heading, not to EOF", () => {
        const doc = fakeEditor([
            "Intro[^1] text",
            "",
            "# Footnotes",
            "",
            "## Other section",
            "other stuff",
        ]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "1", true, headingOn());
        // the blank line after the heading is reused, not doubled; the
        // trailing "\n" keeps "## Other section" out of the footnote
        expect(change).toEqual({
            from: { line: 3, ch: 0 },
            text: "\n[^1]: \n",
        });
        expect(cursor).toEqual({ line: 4, ch: 6 });
    });

    it("inserts its own blank line when none follows the heading", () => {
        const doc = fakeEditor(["Intro[^1]", "# Footnotes", "## Other"]);
        const { change, cursor } = buildDefinitionAppend(docContext(doc), "1", true, headingOn());
        expect(change).toEqual({
            from: { line: 1, ch: "# Footnotes".length },
            text: "\n\n[^1]: \n",
        });
        expect(cursor).toEqual({ line: 3, ch: 6 });
    });

    it("matches a multi-line heading", () => {
        const doc = fakeEditor([
            "Intro[^1]",
            "",
            "---",
            "## Footnotes",
            "",
            "tail",
        ]);
        const plugin = fakePlugin({
            enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "---\n## Footnotes",
        });
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, plugin);
        expect(change).toEqual({ from: { line: 4, ch: 0 }, text: "\n[^1]: \n" });
    });

    it("with definitions present, the after-last-block rule still wins", () => {
        const doc = fakeEditor([
            "A[^1] b",
            "",
            "# Footnotes",
            "[^1]: one",
            "",
            "tail",
        ]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, headingOn());
        expect(change.from).toEqual({ line: 3, ch: "[^1]: one".length });
    });

    it("a heading line inside a fence does not count", () => {
        const doc = fakeEditor(["A[^1] b", "```", "# Footnotes", "```"]);
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, headingOn());
        // falls through to the EOF path, which adds the real heading
        expect(change.text).toBe("\n\n# Footnotes\n\n[^1]: ");
    });

    it("with the heading feature off, nothing slots", () => {
        const doc = fakeEditor(["A[^1] b", "", "# Footnotes", "", "tail"]);
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, fakePlugin());
        expect(change.from.line).toBe(4); // EOF path
    });
});
