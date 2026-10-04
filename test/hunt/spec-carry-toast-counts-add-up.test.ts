import { beforeEach, describe, expect, it } from "vitest";

import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question (UI text): should the paste toast's counts add up to its
// total?
//
// What it does now: sheet 18's rename check pastes four footnotes, one of
// which is renamed to fit the note, and the toast reads "Pasted with 4
// footnote definitions: 4 added, 1 renamed." That reads as five things
// for four: a renamed definition is counted in "added" and again in
// "renamed".
// What a user might expect: parts that add up to the total, for example
// "3 added, 1 renamed", or "4 added (1 renamed)".
// Why it is a question and not a bug: the counts are each true, and the
// unit test "takes the paste over when the text matches the register" pins
// the current shape ("1 added, 1 renamed"). The wording is Jason's call;
// offer drafts.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR7.
//
// Source of truth: the README's Paste paragraph ("The toast says how many
// were added, reused, and renamed") and manual sheet 18's rename check.

/** A stand-in for the browser's clipboard event, holding `text` to paste and recording what the hook writes. */
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

/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: the paste toast's counts", () => {
    it.fails("sheet 18 rename check: the counts add up to the total", () => {
        const sentence = "shared[^shared] and[^shared] own[^own] chain[^chain]";
        const source = editor(
            [sentence, "", "[^shared]: s", "[^own]: used once", "[^chain]: cites[^inner]", "[^inner]: in"],
            { line: 0, ch: 0 },
            { line: 0, ch: sentence.length },
        );
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, source), copy as never);
        const destination = editor(["Existing[^1] text.", "", "[^1]: an existing one", "[^own]: a different body"], {
            line: 0,
            ch: "Existing[^1] text.".length,
        });
        handlePaste(fakePlugin(on, destination), clipboardEvent(copy.written["text/plain"]) as never, destination);
        const toast = messages().find((m) => m.startsWith("Pasted with")) as string;
        const total = Number(/Pasted with (\d+)/.exec(toast)?.[1]);
        const parts = [...toast.matchAll(/(\d+) (added|reused|renamed|matched)/g)].reduce((n, m) => n + Number(m[1]), 0);
        // Today: "Pasted with 4 footnote definitions: 4 added, 1 renamed." (parts 5).
        expect({ toast, parts }).toEqual({ toast, parts: total });
    });
});
