// Imported from the GLM 5.3 Flash cycle 3 hunt of 2026-09-16 (OpenCode worktree); 4 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REVISED 2026-09-16 (probed in Reading view during the import): a label directly under a definition's lazy continuation line RENDERS as a definition ("[^1]: body", "more lazy", "[^2]: second" shows both footnotes), so the born-lazy premise was the plugin's misreading, fixed in definitionStartLines; the append also keeps a blank line after such a block, matching move-to-bottom, and these tests pass either way.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";

import type { FootnotePluginSettings } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { readNote } from "../../src/parsing/note-reading";

// A footnote definition block can end on a line that Obsidian reads as the
// last line of a PARAGRAPH: a plain lazy continuation directly under the
// label ("[^1]: body" then "more lazy" renders one footnote "body more
// lazy", pinned 2026-09-16), or the visible tail after a comment block's
// closer that a continuation line of the block opened ("[^1]: body <!-- c"
// then "--> tail" - the tail after the closer is live paragraph text,
// sheet 11). buildDefinitionAppend's "after the last definition block"
// branch adds a separator only when the line BELOW the insertion point has
// content; it never looks at the line the block ends on. So the new
// "[^2]: " label lands directly under a paragraph line, and by the
// plugin's own prose-label rule (sheet 14, pinned) such a label is lazy
// paragraph text, not a definition.
//
// Two user-visible failures from one root cause:
//
// - The numbered press verifies the append and REFUSES the whole press
//   with "No footnote was created: footnotes can't go inside code, math,
//   or other protected text." - the wrong reason (nothing is protected)
//   for a refusal on a note the user typed without doing anything wrong.
//   The same refusal hits the selection conversion and the multi-caret
//   press, which share the verification.
// - The named command's second press (createMatchingFootnoteDefinition)
//   does not verify at all: it lands the append, and the new definition is
//   born lazy - it renders as plain text, silently, with no notice, the
//   exact never-silent violation ADR 0002 exists to prevent. It stays dead
//   until a manual lint's fix-lazy inserts the blank line.
//
// move-to-bottom got the matching fix already ("keeps a blank line after a
// block ending in a lazy continuation", cycle 3); the append path was not
// part of it. The append should insert the same blank separator after a
// block whose last line reads as paragraph text, and then both presses
// behave as on any other note.
//
// Source of truth: sheet 14 (a label directly under a paragraph line is
// plain text) + the pinned lazy-continuation ruling (the tail belongs to
// the block, so the join after it is the only place a blank can go) +
// sheet 11 (text after a comment block's closer is live paragraph text) +
// ADR 0002 (never silent).
//
// Settings involved: defaults with `Lint on footnote creation` off (the
// silent half) and popup off; the refusal half needs no settings.

function pressHarness(lines: string[], cursor: { line: number; ch: number }): {
    doc: FakeEditor;
    plugin: ReturnType<typeof fakePlugin>;
} {
    const doc = fakeEditor(lines, { cursor, edits: true, wholeDoc: true });
    const settings: Partial<FootnotePluginSettings> = {
        insertAtEndOfWord: false,
        enablePopupEditor: false,
        enableFootnotePrefix: false,
        enableFootnoteSectionHeading: false,
        enableRemoveBlankLastLines: false,
        lintOnFootnoteCreation: false,
    };
    return { doc, plugin: fakePlugin(settings, doc) };
}

const startsOf = (lines: string[]): boolean[] => {
    return readNote(lines).labelLines;
};

describe("a definition appended after a block that ends on a paragraph line", () => {
    beforeEach(resetNotices);

    it("the numbered press creates the footnote instead of refusing it as protected text", async () => {
        const { doc, plugin } = pressHarness(
            ["use[^1].", "", "[^1]: body", "more lazy"],
            { line: 0, ch: 3 },
        );
        await insertAutonumFootnote(plugin);
        expect(messages().some((m) => m.startsWith("No footnote was created"))).toBe(false);
        expect(doc.lines.join("\n")).toContain("[^2]");
        // the new definition's label must be live where it lands
        const labelLine = doc.lines.findIndex((l) => l.startsWith("[^2]:"));
        expect(labelLine).toBeGreaterThanOrEqual(0);
        expect(startsOf(doc.lines)[labelLine]).toBe(true);
    });

    it("the numbered press works with content below the lazy tail too", async () => {
        const { doc, plugin } = pressHarness(
            ["use[^1].", "", "[^1]: body", "more lazy", "", "tail prose"],
            { line: 0, ch: 3 },
        );
        await insertAutonumFootnote(plugin);
        expect(messages().some((m) => m.startsWith("No footnote was created"))).toBe(false);
        const labelLine = doc.lines.findIndex((l) => l.startsWith("[^2]:"));
        expect(labelLine).toBeGreaterThanOrEqual(0);
        expect(startsOf(doc.lines)[labelLine]).toBe(true);
    });

    it("the numbered press works when the block ends on a comment closer's tail", async () => {
        const { doc, plugin } = pressHarness(
            ["use[^1].", "", "[^1]: body <!-- c", "--> tail"],
            { line: 0, ch: 3 },
        );
        await insertAutonumFootnote(plugin);
        expect(messages().some((m) => m.startsWith("No footnote was created"))).toBe(false);
        const labelLine = doc.lines.findIndex((l) => l.startsWith("[^2]:"));
        expect(labelLine).toBeGreaterThanOrEqual(0);
        expect(startsOf(doc.lines)[labelLine]).toBe(true);
    });

    it("the named second press does not plant a definition that never renders", async () => {
        const { doc, plugin } = pressHarness(
            ["use [^1].", "", "[^1]: body", "more lazy", "", "cite[^x] here"],
            { line: 5, ch: 6 },
        );
        await insertNamedFootnote(plugin);
        expect(messages()).toEqual([]);
        const labelLine = doc.lines.findIndex((l) => l.startsWith("[^x]:"));
        expect(labelLine).toBeGreaterThanOrEqual(0);
        expect(startsOf(doc.lines)[labelLine]).toBe(true);
    });
});
