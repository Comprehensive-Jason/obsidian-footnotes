import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// spec question: should a press inside an inline footnote that runs over
// two lines hop the caret out of it, as a press inside a one-line inline
// footnote does?
//
// What it does now: an inline footnote is written "^[...]". When its text
// runs over a soft line break inside its paragraph ("text ^[an inline" on
// one line, "note here] after" on the next), the plugin leaves it out of
// its list of inline footnotes. A press with the caret inside it is
// refused with the protected-text toast.
// What a user might expect: the same as on one line, where the press
// moves the caret past the closing "]" and shows no toast.
// Why it is a question and not a bug: footnote-facts.ts leaves a
// multi-line inline footnote out on purpose ("one running over several
// lines is left out"), and refusing is safe: nothing is written. Whether
// the hop should reach across lines is Jason's call.
//
// Hunt 2026-10-05, round 1, lens reading. Cluster RD4.
//
// Source of truth: Obsidian's answers broad:20261004-726, -3168, -3366,
// and -5280 ("^[starts here\nholds [^x]]" is one inline footnote, and the
// [^x] inside it is no reference); the one-line hop, which the control
// below describes.

describe("an inline footnote over two lines", () => {
    beforeEach(resetNotices);

    it.fails("a press inside it hops past it as on a one-line inline footnote, without a protected-text refusal", async () => {
        // A control: ["text ^[an inline note here] after"] at ch 21 hops the
        // caret past "]" with no toast.
        const lines = ["text ^[an inline", "note here] after"];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, words: true, cursor: { line: 1, ch: 4 } });
        await insertAutonumFootnote(fakePlugin({}, doc));
        // Today: the protected-text toast.
        expect(messages()).toEqual([]);
    });
});
