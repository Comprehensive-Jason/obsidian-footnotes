// BUG (wrong output): cutting the first line of a list item that has more
// under it (a sub-item, a second paragraph) is refused when the line cites
// a footnote.
//
// What the user would see: an outline "- Oysters filter water[^1]." /
// "  - up to 50 gallons a day" / "- Tides rise." with "[^1]: Smith 2020."
// below. They put the caret on the first line, press Shift+Down, then
// Ctrl+X. Nothing is cut: "Nothing was cut: it would change how Obsidian
// reads the text around it." The editor's own cut of the same line without
// a footnote goes through, and the sub-bullet comes up a level. The same
// happens with a numbered outline, a task list, and a bullet whose second
// paragraph follows a blank line.
//
// Hunt 2026-10-09, cycle 8. Cluster V7, lenses carry and the gate (found
// by both).
// Source of truth: ADR 0003 (when the plugin cannot tell what the user
// meant, it does what the editor would do without it); cluster Z19 and its
// pin bug-cut-first-line-of-block-refused (taking out a list's first item
// leaves the next line to start the list, which is what the cut means).
// Origin: a regression from 24ef25f (2026-10-08, the result gate deciding
// the cut), missed by cycles 6 and 7: green at 24ef25f's parent, red at
// 24ef25f, 34d5377, and 3a47f7a. e17bb02 (Z19) forgave a change of start
// marks next to the cut text, not a change of depth or a line two below.
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change (ADR 0003).

import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// Probe (hunt cycle 8). A harder variant of cluster Z19
// (pin bug-cut-first-line-of-block-refused, fixed by e17bb02): a
// Shift+Down cut of a list item's first line that cites a footnote is
// refused with "Nothing was cut: it would change how Obsidian reads the
// text around it." when the item has more under it: a sub-list, a second
// paragraph, or a definition of its own. The editor's own cut (the same
// line with no footnote) goes through. The line under the cut changes how
// it reads only because the line above it was taken out, which is what
// the cut means (ADR 0003: when the plugin cannot tell what the user
// meant, it does what the editor would do). Found by hand and by this
// a move survey (kept in the scratch): 35 of 36
// cut refusals at 5 seeds x 1500 runs were the sub-list shape.
//
// Gate verdicts (judgeEdit, with and without the definition taken): check
// 5, "formatting". In the outline shapes, on the sub-bullet the cut leaves
// ("  - up to 50 gallons a day" comes out of its parent item, its
// containers change); with a second paragraph or an in-item definition, on
// "- Tides rise.", which comes to start the list two lines below the cut,
// out of reach of e17bb02's leeway for the line next to the cut text.
//
// Origin: pre-existing (red at 34d5377 and at 3a47f7a).

function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}
type Pos = { line: number; ch: number };
const settings = {
    carryFootnotesOnCopy: true,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    removeEmptySectionHeading: false,
    lintOnFootnoteCreation: false,
    enableFootnotePrefix: false,
    enableRemoveBlankLastLines: false,
    footnotePlacement: "after" as const,
};
function pluginIn(doc: FakeEditor, path = "note.md"): FootnotePlugin {
    const plugin = fakePlugin(settings, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path } }), getLeavesOfType: () => [] };
    return plugin;
}
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}
/** The note after a cut, the clipboard text, the caret; when the plugin leaves the cut alone, the editor's own cut takes the text. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    if (!event.defaultPrevented) {
        const clip = sliceText(lines, from, to);
        doc.transaction({ changes: [{ from, to, text: "" }] });
        return { lines: doc.lines.slice(), clip, caret: from, taken: false };
    }
    return { lines: doc.lines.slice(), clip: event.written["text/plain"] ?? "", caret: doc.getCursor(), taken: true };
}
const state = (x: unknown) => JSON.stringify({ x, notices: messages() });
const Refused = "Nothing was cut: it would change how Obsidian reads the text around it.";

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a Shift+Down cut of a list item's first line, the item having more under it", () => {
    // Now: refused, the note unchanged.
    it("outline: the first parent bullet, its sub-bullet left behind", () => {
        const note = ["- Oysters filter water[^1].", "  - up to 50 gallons a day", "- Tides rise.", "", "[^1]: Smith 2020."];
        const c = cut(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        expect(messages(), state(c)).not.toContain(Refused);
        expect(c.lines.join("\n"), state(c)).not.toContain("Oysters filter water");
        expect(c.lines, state(c)).toContain("  - up to 50 gallons a day");
        expect(c.clip, state(c)).toContain("[^1]: Smith 2020.");
    });

    // Now: refused. Numbered and task lists are refused the same way (the survey).
    it("outline, a numbered list: the first parent item", () => {
        const note = ["Steps:", "", "1. Collect oysters[^1].", "   - at low tide", "2. Measure them.", "", "[^1]: Smith 2020."];
        const c = cut(note, { line: 2, ch: 0 }, { line: 3, ch: 0 });
        expect(messages(), state(c)).not.toContain(Refused);
        expect(c.lines.join("\n"), state(c)).not.toContain("Collect oysters");
    });

    // Now: refused.
    it("a bullet with a second paragraph: its first line", () => {
        const note = ["- Oysters filter water[^1].", "", "  They also build reefs.", "- Tides rise.", "", "[^1]: Smith 2020."];
        const c = cut(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        expect(messages(), state(c)).not.toContain(Refused);
        expect(c.lines.join("\n"), state(c)).toContain("They also build reefs.");
    });

    it("control: the second parent bullet, its sub-bullet left behind, goes through", () => {
        const note = ["- Tides rise.", "- Oysters filter water[^1].", "  - up to 50 gallons a day", "- Gulls cry.", "", "[^1]: Smith 2020."];
        const c = cut(note, { line: 1, ch: 0 }, { line: 2, ch: 0 });
        expect(messages(), state(c)).not.toContain(Refused);
        expect(c.taken).toBe(true);
    });

    it("control: the first of two plain bullets goes through", () => {
        const note = ["- Oysters filter water[^1].", "- Tides rise.", "", "[^1]: Smith 2020."];
        const c = cut(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        expect(c.lines, state(c)).toEqual(["- Tides rise."]);
    });

    it("control: the editor's own cut of the parent bullet with no footnote", () => {
        const note = ["- Oysters filter water.", "  - up to 50 gallons a day", "- Tides rise."];
        const c = cut(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        expect(c.taken).toBe(false);
        expect(c.lines).toEqual(["  - up to 50 gallons a day", "- Tides rise."]);
    });
});
