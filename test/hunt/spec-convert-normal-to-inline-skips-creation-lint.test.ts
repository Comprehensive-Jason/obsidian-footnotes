import { beforeEach, describe, expect, it } from "vitest";

import { convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// spec question: should Convert normal footnotes to inline footnotes run
// the lint afterwards when Lint on footnote creation is on?
//
// What it does now: the note has [^1] (one line) and [^2] (two lines, so it
// cannot become inline). The conversion turns [^1] into "^[one]" and
// leaves "[^2]" as it is. With Lint on footnote creation on, nothing lints
// afterwards, so the footnote left behind keeps its number 2 although it
// is now the first numbered footnote in the note. Convert inline to normal
// does lint afterwards.
// What a user might expect: the Lint on footnote creation description says
// "Lint the note right after a new footnote is created in it, including
// when the convert commands or a paste create them."
// Why it is a question and not a bug: converting to inline creates no new
// normal footnote, so "a new footnote is created" can be read as not
// covering it; "the convert commands" (plural) reads as covering it.
// Either the conversion lints, or the description narrows; Jason's call.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR8.
//
// Source of truth: the Lint on footnote creation description in
// src/settings.ts, quoted above.

/** A fake editor holding `lines`, caret at the start. */
function doc(lines: string[]) {
    return fakeEditor(lines, {
        wholeDoc: true,
        edits: true,
        cursor: { line: 0, ch: 0 },
        selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
    });
}

beforeEach(resetNotices);

describe("spec question: Lint on footnote creation after Convert normal footnotes to inline footnotes", () => {
    it.fails("lints straight after, so the footnote left behind is renumbered", async () => {
        const d = doc(["a[^1] b[^2]", "", "[^1]: one", "[^2]: first", "    second"]);
        await convertNormalToInlineCommand(fakePlugin({ ...DEFAULT_SETTINGS, lintOnFootnoteCreation: true }, d));
        // Today: ["a^[one] b[^2]", "", "[^2]: first", "    second"].
        expect(d.lines).toEqual(["a^[one] b[^1]", "", "[^1]: first", "    second"]);
    });
});
