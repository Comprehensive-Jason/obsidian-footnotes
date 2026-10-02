import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when the clipboard holds only definition lines, and the
// note has references with those names but no definitions, should the
// paste supply the missing definitions instead of renaming them?
//
// What it does now: the note reads "x[^1]" with no [^1] definition. The
// user copies "[^1]: one" from another app and pastes it at the bottom.
// The paste sees that the note already uses the name 1 (as a reference),
// so it renames the pasted definition to [^2]. Now [^1] still has no
// definition, and nothing references the new [^2] footnote. Both sides
// end up orphaned.
// What a user might expect: pasting a definition for a reference that
// lacks one fills the gap, so the note gains "[^1]: one" and [^1] reads
// "one".
// Why it is a question and not a bug: the rename rule treats any name the
// destination uses, reference or definition, as taken, which is what
// keeps a pasted footnote from capturing a reference that belongs to
// something else. Whether a clipboard with no body is a different case,
// one where the user means to supply definitions, is a product decision
// for Jason.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C27.
//
// Source of truth: planCarriedPaste's docstring, "a name the destination
// does not use (as a definition or a reference) is kept; a name the
// destination uses for a different body is renamed".

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
// to `to`.
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a clipboard that is only a definition line, pasted where its reference has none", () => {
    it.fails("pasting [^1]: one into a note whose [^1] reference has no definition supplies that definition, not a renamed orphan", () => {
        const dest = editor(["x[^1]", "", ""], { line: 2, ch: 0 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("[^1]: one") as never, dest);
        expect(dest.lines.join("\n")).toContain("[^1]: one");
        expect(dest.lines.join("\n")).not.toContain("[^2]");
    });
});
