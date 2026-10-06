import { beforeEach, describe, expect, it } from "vitest";

import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { lintAfterFootnoteCreation } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): with Lint on footnote creation on, a Section heading
// setting the lint cannot use cancels the lint after a new footnote, and
// nothing says so.
//
// What the user would see: the Section heading setting holds a footnote
// reference ("# Footnotes [^9]"), which the lint rules would renumber, so
// every lint is canceled. A save says so: "Linting canceled: the footnote
// section heading setting contains a footnote reference ("[^9]"), ...". A
// new footnote, typed or pasted, cancels its lint without a word, and the
// lint alerts do not speak either.
//
// Hunt 2026-10-02, round 2, lens interactions. Cluster I4, the section
// heading half (the prefix half is bug-paste-invalid-prefix-lint-silent).
//
// Source of truth: docs/adr/0002-never-silent-lint.md (lint is never
// silent about what it will not fix), and the save path in linter.ts,
// which shows the same reason for the same setting.
//
// Cause: lintAfterFootnoteCreation returns without a word when either the
// prefix or the section heading blocks the lint. Its reason ("the insert
// that just happened has already told the user") holds for the prefix
// only: no press or paste looks at the section heading setting.
//
// Fix (2026-10-06): lintAfterFootnoteCreation stays silent for a blocking
// prefix only; a section heading setting the lint cannot use shows the
// save's own message for 8 seconds.

const BadHeading = "# Footnotes [^9]";

/** The default settings with Lint on footnote creation on and the section heading set to one the lint cannot use. */
const settings = {
    ...DEFAULT_SETTINGS,
    carryFootnotesOnCopy: true,
    enablePopupEditor: false,
    lintOnFootnoteCreation: true,
    enableFootnoteSectionHeading: true,
    footnoteSectionHeading: BadHeading,
};

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a section heading setting that cancels the lint on footnote creation", () => {
    it("after a new footnote, the user hears why the lint was canceled", () => {
        const doc = fakeEditor(["text[^1] here", "", "[^1]: "], { cursor: { line: 2, ch: 6 }, edits: true, wholeDoc: true });
        lintAfterFootnoteCreation(fakePlugin(settings, doc), doc, false);
        // Before the fix: nothing.
        expect(messages().some((m) => m.startsWith("Linting canceled: the footnote section heading setting"))).toBe(true);
    });

    it("after a carried paste, the user hears why the lint was canceled", () => {
        const at = { line: 0, ch: 7 };
        const doc = fakeEditor(["y[^9] z"], { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
        handlePaste(
            fakePlugin(settings, doc),
            {
                defaultPrevented: false,
                clipboardData: { types: ["text/plain"], getData: () => " a[^1] b\n\n[^1]: one", setData() {} },
                preventDefault() {},
                stopPropagation() {},
            } as never,
            doc,
        );
        // Before the fix: nothing.
        expect(messages().some((m) => m.startsWith("Linting canceled: the footnote section heading setting"))).toBe(true);
    });
});
