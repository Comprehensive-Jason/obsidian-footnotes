import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when the pasted text holds a definition of its own,
// should the carried definitions land in the middle of what was just
// pasted?
//
// What it does now: the user copies "[^x]: ex", a blank line, and
// "See[^a] and[^x]." (a definition line, then the text citing it and
// [^a]) and pastes it under "Intro." in a note with no definitions. The
// carry writes [^a]'s definition after the last definition as the note
// reads after the paste, which is the pasted "[^x]: ex". The note becomes
// "Intro.", "", "[^x]: ex", "[^a]: first", "", "See[^a] and[^x].": the
// carried definition sits between the pasted definition and the pasted
// sentence.
// What a user might expect: the pasted text stays together as it was
// copied, and the carried definition goes after it (or at the note's
// bottom).
// Why it is a question and not a bug: both footnotes stay live and show
// their own text; only where the carried line lands is in question, and
// "after the last definition" is the carry's placement rule.
//
// Hunt 2026-10-05, round 2, lens carry. Cluster C5.
//
// Source of truth: the carry's placement rule (planDefinitionAppend in
// src/commands/definition-append.ts, which reads the note after the
// paste); no ruling covers a pasted text that holds a definition line.

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

const on = { carryFootnotesOnCopy: true };

/** A stand-in for the browser's clipboard event: what was written, and whether the editor's own action was stopped. */
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

function editor(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

/** Copy from..to of source; return the clipboard text (or null when the editor's own copy runs). */
function copyText(source: string[], from: Pos, to: Pos): string | null {
    const doc = editor(source, from, to);
    const ev = clipboardEvent();
    handleCopy(fakePlugin(on, doc), ev as never);
    return ev.written["text/plain"] ?? null;
}

/** Paste `text` into dest at `at` through the paste hook; returns dest lines (a plain insert when the hook declines). */
function pasteInto(text: string, dest: string[], at: Pos): string[] {
    const doc = editor(dest, at);
    const taken = handlePaste(fakePlugin(on, doc), clipboardEvent(text) as never, doc);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines;
}

describe("carried definitions and the text just pasted", () => {
    it.fails("selection \"[^x]: ex\", blank, \"See[^a] and[^x].\" pasted under \"Intro.\": the carried definition lands after the pasted sentence", () => {
        const source = ["[^x]: ex", "", "See[^a] and[^x].", "", "[^a]: first"];
        const text = copyText(source, { line: 0, ch: 0 }, { line: 2, ch: 16 }) as string;
        const dest = pasteInto(text, ["Intro.", "", ""], { line: 2, ch: 0 });
        // Today: ["Intro.", "", "[^x]: ex", "[^a]: first", "", "See[^a] and[^x]."]
        const pastedProse = dest.indexOf("See[^a] and[^x].");
        const carried = dest.indexOf("[^a]: first");
        expect({ dest, carriedAfterPastedText: carried > pastedProse }).toEqual({ dest, carriedAfterPastedText: true });
    });
});
