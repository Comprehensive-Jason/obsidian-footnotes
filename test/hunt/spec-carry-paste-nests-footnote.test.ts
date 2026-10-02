import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: should a paste that carries footnotes be allowed to land
// inside another footnote, with the caret in a definition's body or
// inside an inline footnote?
//
// What it does now: the paste is taken over as anywhere else. The pasted
// reference lands inside the other footnote, so one footnote is nested in
// another, and its definition is added at the bottom as usual. Inside an
// inline footnote ("^[inline ]") this happens with no word at all.
// What a user might expect: the plugin prevents nesting everywhere else
// (ADR 0001), so either the paste is refused with a toast, or the text
// lands without the footnote machinery, or it lands and lint flags it.
// Why it is a question and not a bug: ADR 0001 covers what the plugin
// creates, and a paste is the user's own text arriving. The ADR also says
// hand-typed nesting is "surfaced by lint, never" destroyed, so landing it
// and leaving lint to speak is one defensible reading. Which way pastes go
// is Jason's call.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C20.
//
// Source of truth: docs/adr/0001-no-nested-footnotes.md ("We refuse to
// create nesting anywhere") and CONTEXT.md's Nested footnote entry
// ("Prevented plugin-wide").

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
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

// A fake editor holding `lines`, with the selection running from `from`
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a paste that carries footnotes, with the caret inside another footnote", () => {
    it.fails("a paste with the caret on a definition line does not nest a footnote inside that definition", () => {
        const dest = editor(["a[^1]", "", "[^1]: one "], { line: 2, ch: 10 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // Today line 2 becomes "[^1]: one c[^7]".
        expect(dest.lines[2]).not.toContain("[^7]");
    });

    it.fails("a paste inside an inline footnote does not nest a footnote", () => {
        const dest = editor(["a^[inline ] b"], { line: 0, ch: 10 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // Today line 0 becomes "a^[inline c[^7]] b".
        expect(dest.lines[0]).not.toMatch(/\^\[inline c\[\^7\]/);
    });
});
