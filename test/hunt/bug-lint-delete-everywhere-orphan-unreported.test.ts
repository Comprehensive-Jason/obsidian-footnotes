import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnote } from "../../src/commands/delete-footnote";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (silent): with Delete orphaned definitions on, Delete footnote
// everywhere can leave a new orphan behind and say nothing about it.
//
// What the user would see: footnote n's definition cites footnote m ("[^n]:
// see[^m]"), and nothing else cites m. They run Delete footnote everywhere
// on n. Now nothing references m, but its definition stays in the note, and
// no alert says so. With Delete orphaned definitions off, the orphan alert
// names m (the control); with it on, the user expects m either deleted or
// named, and gets neither.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A4. The same root reaches
// the carried paste and Convert inline footnotes to normal footnotes when
// Lint on footnote creation is off.
//
// Source of truth: deleteFootnote's docstring in delete-footnote.ts ("Then
// the lint alerts speak, since a deletion can leave something for them to
// say (a definition only the deleted one's body was citing is now an
// orphan)"); ADR 0002 (every orphan is either deleted or reported).
//
// Severity: low. A stray definition stays in the note unannounced.
//
// Cause: with the toggle on, the orphan alert assumes the text it reads
// came out of a full lint, so it stays quiet about any orphan the rule
// would have deleted. No lint runs after this command, so nobody deletes
// it either.
//
// Fix (2026-10-06): noticeLintAlerts takes afterLint, false from the
// commands that run no lint (Delete footnote everywhere, both conversions,
// the creation lint's other-note branch); then the orphan alerts speak as
// with their toggles off. The carried paste's call (carry-footnotes-
// hooks.ts, lintAfterPaste) still passes nothing, so a paste with Lint on
// footnote creation off is not covered yet.

const LINES = ["a[^n] b", "", "[^n]: see[^m]", "[^m]: cited only by n"];

/** A fake editor holding the note, with the caret on the reference to n. */
function editor() {
    return fakeEditor([...LINES], {
        wholeDoc: true,
        edits: true,
        cursor: { line: 0, ch: 3 },
        selection: { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    });
}

beforeEach(resetNotices);

describe("Delete footnote everywhere and the definition it leaves orphaned", () => {
    it("with Delete orphaned definitions on, the definition left orphaned is either deleted or named", async () => {
        const doc = editor();
        await deleteFootnote(fakePlugin({ ...DEFAULT_SETTINGS, lintDeleteOrphanedDefinitions: true }, doc));
        const stillThere = doc.getValue().includes("[^m]: cited only by n");
        const named = messages().some((m) => m.includes('"[^m]"') && m.includes("nothing references"));
        // Before the fix: still there, and not named.
        expect(!stillThere || named).toBe(true);
    });

    it("control: with the toggle off it is named", async () => {
        const doc = editor();
        await deleteFootnote(fakePlugin({ ...DEFAULT_SETTINGS }, doc));
        expect(messages().some((m) => m.includes('"[^m]"') && m.includes("nothing references"))).toBe(true);
    });
});
