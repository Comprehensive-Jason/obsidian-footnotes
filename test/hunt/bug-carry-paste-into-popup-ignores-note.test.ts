import { beforeEach, describe, expect, it } from "vitest";

import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output): a carried paste into the footnote popup lands a
// second definition of a name the note already uses.
//
// What the user would see: the note reads "Mine[^1] and more[^2]." with
// "[^1]: my own source" and an empty "[^2]: ", and the popup is open on
// [^2]. They paste "see x[^1]", copied in another note with its own [^1].
// Instead of renaming the pasted footnote to a name the note does not use,
// the paste keeps it as [^1]: the popup now holds "see x[^1]", a blank
// line, and "[^1]: their source". When the popup closes, the note defines
// [^1] twice. Obsidian renders only the last definition of a name, so the
// user's own source is hidden, and "Mine[^1]" now points at "their
// source".
//
// Hunt 2026-10-02, round 4, lens plumbing. Cluster U6.
//
// Needs a live check: does Obsidian fire editor-paste for the popup's
// embedded editor? It is an ordinary markdown editor, so it likely does,
// and handlePaste acts on whatever editor it is handed.
//
// Source of truth: the carry docstring in carry-footnotes-hooks.ts (the
// carried definitions go "where a creation press would put a definition,
// merged and renamed to fit the note"); the README's Paste paragraph; and
// navigation.ts's ground truth that Obsidian renders the LAST of two
// same-named definitions (2026-08-12).
//
// Severity: medium. One of the user's own definitions disappears from
// Reading view, silently.
//
// Cause: handlePaste plans its renames against the editor it is handed.
// The popup's editor holds only the definition's own text, not the note,
// so planCarriedPaste sees no [^1] to clash with.

/** A stand-in for the browser's paste event, holding `text` on the clipboard. */
function clipboardEvent(text: string) {
    const event = {
        defaultPrevented: false,
        clipboardData: { types: ["text/plain"], getData: (t: string) => (t === "text/plain" ? text : ""), setData() {} },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a carried paste into the footnote popup", () => {
    it.fails("does not land a second [^1] definition in a note that already defines [^1]", () => {
        // The note, with the popup open on [^2]. The popup's embed holds
        // everything up to and including the label as `before`, and nothing
        // follows the section, so `after` is empty.
        const before = "Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ";
        const after = "";
        // The popup's editor holds the section only, empty so far.
        const popup = fakeEditor([""], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 0 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
        });
        // A clipboard copied in another note: "see x[^1]" carrying its own [^1].
        const event = clipboardEvent("see x[^1]\n\n[^1]: their source");
        const took = handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, popup), event as never, popup);
        // Whatever the popup holds goes back into the note on close.
        const note = before + popup.lines.join("\n") + after;
        const definitionsOf1 = note.split("\n").filter((line) => /^ {0,3}\[\^1\]:/.test(line));
        // Today: two definitions of [^1], the user's and "[^1]: their source".
        expect({ took, definitionsOf1 }).toEqual({ took, definitionsOf1: ["[^1]: my own source"] });
    });
});
