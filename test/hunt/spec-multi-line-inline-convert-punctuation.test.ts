import { describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: should Convert inline to normal and the punctuation rule handle an inline
// footnote that runs over a line break, or at least say they skipped it?
//
// What it does now: Convert inline to normal never sees one. On "text ^[an inline" /
// "note here] after." it converts nothing, counts nothing as skipped, and says there are no
// inline footnotes to convert. The punctuation rule (part of the default lint) moves a one-line
// inline footnote after the full stop that follows it ("b^[one]." becomes "b.^[one]") but
// leaves a multi-line one before its full stop ("a^[x" / "y]." stays as it is).
// What a user might expect: the same treatment as a one-line inline footnote: converted to a
// numbered footnote and moved after the punctuation; or, for Convert, a notice naming it as
// skipped, as Convert already counts the one-line inline footnotes it skips.
// Why it is a question and not a bug: a multi-line inline footnote is a fact of the note
// reading only since 2e58d86, and nothing has ruled whether these two features should act on
// one. Converting one has to decide what happens to the line break inside its body (a
// definition's text over two lines needs indented continuation lines), and Jason owns that.
//
// An "inline footnote" is "^[text]" written in the line itself; Obsidian lets one run over the
// line breaks of its paragraph.
//
// Hunt 2026-10-05, round 2, lens mix. Cluster R5.
//
// Source of truth: Obsidian renders an inline footnote over a line break (its answers
// broad:20261004-726 and others, cited in 2e58d86); the one-line behaviour of both features.

describe("multi-line inline footnotes, Convert inline to normal and the punctuation rule", () => {
    // Today: converted 0, skipped 0.
    it.fails("Convert inline to normal converts a multi-line inline footnote, or counts it as skipped", () => {
        const lines = ["text ^[an inline", "note here] after."];
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        const result = convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
        expect(result.converted + result.skipped.reduce((n, s) => n + s.count, 0)).toBe(1);
    });

    // Today: "a^[x\ny].\n\nb.^[one]" (only the one-line footnote moves).
    it.fails("the punctuation rule moves a multi-line inline footnote as it moves a one-line one", () => {
        expect(footnoteAfterPunctuation("a^[x\ny].\n\nb^[one].")).toBe("a.^[x\ny]\n\nb.^[one]");
    });
});
