import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: should a cut refuse to take an orphaned definition
// along when removing it would change how the lines around it read, as
// the lint's orphaned-definition rule refuses the same deletion?
//
// What it does now: the note is "a[^4] b", "", "para", "===",
// "[^4]: x $$", "$$ tail", "[^3]: y". The definition of [^4] opens a
// math block ("$$") that "$$ tail" closes, so the plugin reads both lines
// as one definition block. "[^3]: y" is a lazy label: it sits right
// under that block, so Obsidian reads it as more of [^4]'s text, not as
// a definition of its own. Cutting "a[^4] " (the only [^4] reference)
// takes the whole [^4] block along: the clipboard is
// "a[^4] \n\n[^4]: x $$\n$$ tail", and the note becomes "b", "", "para",
// "===", "[^3]: y". Nothing is lost, but "[^3]: y" now sits directly
// under the "===" underline of a heading, where it IS a real definition,
// one nothing references.
// What a user might expect: the cut leaves the lazy label reading as it
// did, the way the lint does. With Delete orphaned definitions on, the
// lint refuses this very deletion because it would change how another
// line reads, and leaves the orphan for the user to sort out.
// Why it is a question and not a bug: no text goes missing (the removed
// lines are all in the clipboard), and the user asked for the cut. The
// choice is between keeping the orphaned [^4] block in the note (and
// carrying a copy), refusing to take it along, or accepting that a cut
// can turn a lazy label into a definition. That is a design call.
//
// Hunt 2026-10-02, round 1, lens carry-sel. Cluster C6.
//
// Source of truth: linesReadDifferently in
// src/linting/rules/remove-orphaned-definitions.ts, which the
// orphaned-definition rule and the Delete footnote command both use to
// refuse a deletion that changes how any other line reads (pinned by
// test/hunt/bug-orphan-definition-delete-reclassifies.test.ts). handleCut
// removes orphaned blocks without that check.

/** A stand-in for the browser's clipboard event: it records what the hook writes and whether the hook took the event over. */
function clipboardEvent() {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: () => "",
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

/** Run the cut hook on a note given as lines, and report the note and the clipboard. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
    // Nothing written means the hook left the cut to the editor.
    return { lines: doc.lines, clipboard: event.written["text/plain"] ?? "" };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a cut whose orphan removal would turn a lazy label into a real definition", () => {
    it.fails("a cut whose orphan removal would turn a lazy label below into a real definition leaves the lazy label's reading alone", () => {
        const r = cut(["a[^4] b", "", "para", "===", "[^4]: x $$", "$$ tail", "[^3]: y"], { line: 0, ch: 0 }, { line: 0, ch: 6 });
        expect(r.lines).toContain("$$ tail");
    });
});
