import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// BUG: a section heading the user has commented out with "%%" still acts as
// the anchor for footnote definitions, so the plugin writes inside the
// comment block.
//
// What the user would see: in a note whose only "# Footnotes" line sits
// inside a "%%" comment, with the section heading setting turned on,
// creating the first footnote puts the new definition inside that comment.
// Obsidian hides it, so the footnote renders as plain text and the next
// lint run reports its reference as an orphan. The move-to-bottom rule has
// the same blind spot from the other direction: it gathers the note's one
// definition in under the commented-out heading, which also breaks the
// comment into pieces.
//
// Why it happens: the shared heading finder, findLineRunEnd, only refuses a
// line that is protected. A "%%" comment line is deliberately left
// unprotected so that references inside it still bind their definitions, so
// nothing in that search ever asks whether the line is inside a comment
// block. An HTML-commented heading IS protected and is correctly skipped,
// which is the green control at the bottom of this file.
//
// Hunt: 2026-09-13. Lens: comments.
// Source of truth: manual sheet 11 line ~118 ("nothing is inserted or moved
// inside either %% block"); attack-surface "%% comments" row ("nothing
// inside a block comment is moved, renamed, or fixed; the definition append
// never lands inside an unclosed block").

const headingPlugin = () =>
    fakePlugin({
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: "# Footnotes",
    });

describe("bug: a commented-out section heading still anchors the definition append", () => {
    // Only the sourced half is pinned here. Exactly which line the append
    // ought to pick is a design question nobody has ruled on; that it must
    // not pick a line inside the comment is the recorded rule.
    it("the first definition is not written inside the %% comment block", () => {
        const lines = ["alpha[^1].", "", "%%", "# Footnotes", "%%", "", "tail"];
        const doc = fakeEditor(lines, { wholeDoc: true });
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, headingPlugin());
        expect(readNote(lines).commentLines[change.from.line]).toBe(false);
    });

    it("move-to-bottom leaves the commented-out heading in one piece", () => {
        const doc = "x[^1]\n\n[^1]: one\n\n%%\n# Footnotes\n%%\n\ntail";
        const out = moveFootnoteDefinitionsToBottom(doc, "# Footnotes");
        // the three lines the user commented out must come back untouched
        // and still next to each other
        expect(out).toContain("%%\n# Footnotes\n%%");
    });

    // Green controls: the same two presses on the HTML-comment twin, where
    // the commented lines are protected, already do the right thing.
    it("an HTML-commented heading is skipped and the append goes to the end of the note", () => {
        const lines = ["alpha[^1].", "", "<!--", "# Footnotes", "-->", "", "tail"];
        const doc = fakeEditor(lines, { wholeDoc: true });
        const { change } = buildDefinitionAppend(docContext(doc), "1", true, headingPlugin());
        expect(change).toEqual({
            from: { line: 6, ch: "tail".length },
            text: "\n\n# Footnotes\n\n[^1]: ",
        });
    });

    it("move-to-bottom leaves an HTML-commented heading in one piece", () => {
        const doc = "x[^1]\n\n[^1]: one\n\n<!--\n# Footnotes\n-->\n\ntail";
        expect(moveFootnoteDefinitionsToBottom(doc, "# Footnotes")).toContain("<!--\n# Footnotes\n-->");
    });
});
