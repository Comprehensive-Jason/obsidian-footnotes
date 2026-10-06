import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// Settled behaviour: Convert inline to normal and the punctuation rule leave an inline footnote
// that runs over a line break as it is, and Convert counts it among the ones it skipped.
//
// An "inline footnote" is "^[text]" written in the line itself; Obsidian lets one run over the
// line breaks of its paragraph ("text ^[an inline" / "note here] after.").
//
// Convert inline to normal skips it and says so: on a note holding only that one, the notice
// reads "No inline footnotes converted: skipped 1 on more than one line." ("on more than one
// line" echoes the "more than one line" reason Convert normal to inline gives for a definition
// it cannot fold into one line). The punctuation rule (part of the default lint) moves a
// one-line inline footnote after the full stop that follows it ("b^[one]." becomes "b.^[one]")
// and leaves a multi-line one before its full stop ("a^[x" / "y]." stays as it is).
//
// This started as an open spec question from the hunt (2026-10-05, round 2, lens mix, cluster
// R5): Convert never saw such a footnote, so it counted nothing as skipped and said "No inline
// footnotes to convert." although one was there. Jason's triage decision Q8 (2026-10-05)
// settled it: skip them honestly, counted in the "skipped" notice, rather than convert or move
// them (converting one has to decide what happens to the line break inside its body, since a
// definition's text over two lines needs indented continuation lines).
//
// Source of truth: Jason's triage decision Q8, 2026-10-05; Obsidian renders an inline footnote
// over a line break (its answers broad:20261004-726 and others, cited in 2e58d86).

beforeEach(resetNotices);

/** Convert inline to normal on a note given as lines; returns the result and the note after. */
function convert(lines: string[]) {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    const result = convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
    return { result, after: doc.getValue() };
}

describe("multi-line inline footnotes, Convert inline to normal and the punctuation rule", () => {
    it("Convert inline to normal counts a multi-line inline footnote as skipped and says so", () => {
        const lines = ["text ^[an inline", "note here] after."];
        const { result, after } = convert(lines);
        expect(result.converted).toBe(0);
        expect(result.skipped).toEqual([{ reason: "on more than one line", count: 1 }]);
        expect(after).toBe(lines.join("\n"));
        expect(messages()).toContain("No inline footnotes converted: skipped 1 on more than one line.");
    });

    it("beside a one-line inline footnote, the one-line one is converted and the multi-line one is counted", () => {
        const { result, after } = convert(["One^[short].", "", "text ^[an inline", "note here] after."]);
        expect(result.converted).toBe(1);
        expect(result.skipped).toEqual([{ reason: "on more than one line", count: 1 }]);
        expect(after).toContain("text ^[an inline\nnote here] after.");
        expect(messages().some((m) => m.startsWith("Converted 1 inline footnote") && m.endsWith(" Skipped 1 on more than one line."))).toBe(true);
    });

    it("an inline footnote held inside a multi-line one is not counted on its own", () => {
        const { result } = convert(["text ^[an ^[inner] inline", "note here] after."]);
        expect(result.skipped.find((s) => s.reason === "on more than one line")?.count).toBe(1);
    });

    it("the punctuation rule leaves a multi-line inline footnote before its full stop and moves a one-line one", () => {
        expect(footnoteAfterPunctuation("a^[x\ny].\n\nb^[one].")).toBe("a^[x\ny].\n\nb.^[one]");
    });
});
