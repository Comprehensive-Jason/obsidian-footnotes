import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong output): the lint moves a definition whose label is indented
// one to three spaces to the bottom of a note that ends in a list item,
// and there the definition becomes part of that list item.
//
// What the user would see: "Text[^c]", then "  [^c]: def" (two spaces in
// front), then "- last item" at the end. Ctrl+S moves the definition below
// the list item, after a blank line. Reading view now draws the footnote
// inside the list item, the list turns "loose" (wider spacing between its
// items), and the lint can never move that definition again. When the
// definition had a lazy second line such as "2. two", that line is left
// behind as a new numbered list.
//
// A "lazy" line is one that carries on the paragraph above it without the
// indentation it would normally need.
//
// Hunt 2026-10-06, cycle 4, lens lint. Cluster L3.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4: "Text[^c]", "- item", "",
// "  [^c]: def" defines c at line 3, column 2, inside the list (lines 1 to
// 3); CommonMark's list item rule (after a blank line, a line indented to
// the item's content column belongs to the item); the lint's promise that
// a moved definition reads the same as before.
//
// Cause: moveFootnoteDefinitionsToBottom in
// src/linting/rules/move-footnotes-to-the-bottom.ts writes the definition
// with its indentation kept. Its guards only check that the text above
// reads the same and that the note defines as many footnotes as before;
// neither notices that the definition changed container.

/** The containers (quotes, list items, footnotes) definition `name` sits in. */
const container = (text: string, name: string) => readNote(text.split("\n")).definitions.find((d) => d.name === name)?.container;

/** Definition `name`'s lines, each trimmed, joined by spaces; or null when the note does not define it. */
const bodyOf = (text: string, name: string) => {
    const lines = text.split("\n");
    const d = readNote(lines).definitions.find((x) => x.name === name);
    return d ? lines.slice(d.start, d.end + 1).map((l) => l.trim()).join(" ") : null;
};

beforeEach(resetNotices);

describe("move-to-bottom puts an indented top-level label into the list item above it", () => {
    it("control: the label starts top-level", () => {
        expect(container("Text[^c]\n\n  [^c]: def\n\n- last item", "c")).toEqual({ quotes: 0, listItems: 0, footnotes: 0 });
    });

    // Now: "Text[^c]", "", "- last item", "", "  [^c]: def", with the
    // definition inside the list item.
    it("two-space label, bullet item: the moved definition stays at the top level", () => {
        const out = moveFootnoteDefinitionsToBottom("Text[^c]\n\n  [^c]: def\n\n- last item", "");
        expect(container(out, "c")).toEqual({ quotes: 0, listItems: 0, footnotes: 0 });
    });

    // Now: "Text[^c]", "- item", "", "  [^c]: two-space c", "2. two[^c]":
    // the definition is only "two-space c", and "2. two[^c]" is a new list.
    it("the default lint keeps the definition's text whole (a lazy '2. two' line stays its text)", () => {
        const doc = "  [^c]: two-space c\n2. two[^c]\n\nText[^c]\n- item";
        expect(bodyOf(doc, "c")).toBe("[^c]: two-space c 2. two[^c]");
        const out = lintFootnotes(doc, {});
        expect(bodyOf(out, "c")).toBe("[^c]: two-space c 2. two[^c]");
    });

    // Added with the fix (hunt 2026-10-06, cycle 4): the move is skipped,
    // so the move alert names the definition it left, as for a definition
    // between two lists (ADR 0002: the lint is never silent about what it
    // leaves). The wording is the existing one.
    it("the lint leaves the note as it is, and the move alert names [^c]", () => {
        const doc = ["Text[^c]", "", "  [^c]: def", "", "- last item"].join("\n");
        const out = lintFootnotes(doc, {});
        expect(out).toBe(doc);
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), out);
        expect(messages()).toContain(
            'This note has a footnote definition the lint could not move to the bottom ("[^c]"), and the lint left it in place, because moving it would change how Obsidian reads the lines around it. Move it by hand, and the next lint gathers the rest.',
        );
    });
});
