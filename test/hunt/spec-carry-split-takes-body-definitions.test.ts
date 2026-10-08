import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when copied or cut text ends in a definition that was
// part of the selection itself, should a paste through the phone keyboard
// treat that definition as carried, and rename it like one?
//
// What it does now: the user cuts a paragraph that cites [^2] together
// with the "[^1]: one" definition below it; [^1] is still referenced
// elsewhere in the note. They paste it straight back through the phone
// keyboard's clipboard history. That route has no memory of the cut, only
// the clipboard text, so splitCarriedText reads every trailing definition
// as carried: the selection's own [^1] and the carried [^2] alike. [^1]
// clashes with the "keep[^1]" still in the note, so it is renamed to
// [^2], and the carried [^2] moves on to [^3]. The note ends with
// "[^2]: one" and "[^3]: two": the user's own definition comes back under
// a name nothing references, and "keep[^1]" has no definition.
// What a user might expect: pasting a cut straight back puts the note
// back as it was.
// Why it is a question and not a bug: from the clipboard text alone, a
// definition the selection held and one the copy carried look exactly the
// same. On the desktop the plugin's memory of its own copy tells them
// apart; the phone route has no such memory. Telling them apart needs a
// change to the clipboard format or a different rule, which is Jason's
// call.
//
// Hunt 2026-10-02, round 1, lens carry-int. Cluster C31.
//
// Source of truth: the README, "On a phone, text pasted from the
// keyboard's clipboard history lands the same way", and splitCarriedText's
// docstring: "Only a trailing run of definitions (blank lines between them
// allowed) counts".

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

type Pos = { line: number; ch: number };

// A fake editor holding `lines`, with the selection running from `from`
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

// Answered (Jason's rulings 2026-10-07: ADR 0003, rule 2, a cut pasted
// back is an undo; built in stage 4 of the result gate design,
// 2026-10-08). A paste of the last cut's text into the note the cut left,
// at the caret it left, writes the note before the cut back exactly, names
// and blank lines included, so the paste back below gives the note back.
// The test was it.fails until then; what it did before is described above.
describe("spec question: a cut whose selection ends in its own definition, pasted back from a phone keyboard", () => {
    // The phone route: a keyboard's clipboard history commits the text
    // through the input method (the system that turns key presses into
    // text) instead of firing a paste event, so carriedInputHandler sees
    // it.
    it("a cut selection whose body ends in a definition line pasted back through the keyboard history keeps that definition's name", () => {
        // The selection: "intro[^2]" (defined further down, outside the
        // selection) and the "[^1]: one" definition, which "keep[^1]" at
        // the top still uses.
        const src = ["keep[^1]", "", "intro[^2]", "", "[^1]: one", "", "tail", "", "[^2]: two"];
        const doc = editor(src, { line: 2, ch: 0 }, { line: 4, ch: 9 });
        const cut = clipboardEvent();
        handleCut(fakePlugin(on, doc), cut as never);
        const text = cut.written["text/plain"];
        const handle = carriedInputHandler(fakePlugin(on, doc), () => doc);
        const at = doc.posToOffset({ line: 2, ch: 0 });
        handle({} as never, at, at, text);
        expect(doc.lines.join("\n")).toContain("[^1]: one");
        expect(doc.lines.join("\n")).toContain("intro[^2]");
    });
});
