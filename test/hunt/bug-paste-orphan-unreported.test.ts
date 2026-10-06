import { beforeEach, describe, expect, it } from "vitest";

import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (silent): with Delete orphaned definitions on and Lint on footnote
// creation off, a carried paste can leave a new orphan behind and say
// nothing about it.
//
// What the user would see: the note reads "a[^1] b" with "[^1]: one" under
// it. They select "a[^1] b" and paste text that carries a footnote of its
// own ("x[^2] y" and "[^2]: two"). Now nothing references [^1], but its
// definition stays in the note, because no lint runs after the paste, and
// no alert names it. With Delete orphaned definitions off, the orphan
// alert names [^1] (the control); with it on, the user expects [^1]
// either deleted or named, and gets neither.
//
// Found while fixing, 2026-10-06 (the paste face of hunt 2026-10-02, round
// 4, cluster A4, whose pin bug-lint-delete-everywhere-orphan-unreported
// says the carried paste was not covered yet).
//
// Source of truth: ADR 0002 (every orphan is either deleted or reported);
// lintAfterPaste's docstring in carry-footnotes-hooks.ts (the lint on
// footnote creation, or its alerts when that trigger is off); Delete
// footnote everywhere and both conversions, which already pass
// afterLint false to noticeLintAlerts since 9488357.
//
// Severity: low. A stray definition stays in the note unannounced.
//
// Cause: lintAfterPaste called noticeLintAlerts without afterLint, so the
// orphan alert assumed the text came out of a full lint and stayed quiet
// about an orphan the rule would have deleted. No lint ran, so nobody
// deleted it either.
//
// Fix (2026-10-06): lintAfterPaste passes afterLint false when Lint on
// footnote creation is off, as the delete and the conversions do.

const NOTE = ["a[^1] b", "", "[^1]: one"];

/** Pastes "x[^2] y" carrying "[^2]: two" over the first line's text, and returns what the note holds after. */
function pasteOverReference(settings: Partial<typeof DEFAULT_SETTINGS>): string {
    resetCarryRegister();
    const selection = { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } };
    const doc = fakeEditor([...NOTE], { wholeDoc: true, edits: true, cursor: selection.head, selection });
    const took = handlePaste(
        fakePlugin({ ...DEFAULT_SETTINGS, carryFootnotesOnCopy: true, lintOnFootnoteCreation: false, ...settings }, doc),
        {
            defaultPrevented: false,
            clipboardData: { types: ["text/plain"], getData: () => "x[^2] y\n\n[^2]: two", setData() {} },
            preventDefault() {},
            stopPropagation() {},
        } as never,
        doc,
    );
    expect(took).toBe(true);
    return doc.getValue();
}

/** Whether a toast names [^1] as a footnote nothing references. */
function orphanNamed(): boolean {
    return messages().some((m) => m.includes('"[^1]"') && m.includes("nothing references"));
}

beforeEach(resetNotices);

describe("a carried paste that leaves an orphaned definition, with Lint on footnote creation off", () => {
    it("with Delete orphaned definitions on, the definition left orphaned is either deleted or named", () => {
        const after = pasteOverReference({ lintDeleteOrphanedDefinitions: true });
        const stillThere = after.includes("[^1]: one");
        // Before the fix: still there, and not named.
        expect(!stillThere || orphanNamed()).toBe(true);
    });

    it("control: with the toggle off it is named", () => {
        pasteOverReference({ lintDeleteOrphanedDefinitions: false });
        expect(orphanNamed()).toBe(true);
    });
});
