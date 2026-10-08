import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../src/settings";

// A footnote label on the line right under a paragraph's text (a list
// item's included), with a line of "-" or "=" right under the label, reads
// as plain text: the label carries on the paragraph, and the line under it
// is a horizontal rule, more text, or an empty list item
// (docs/obsidian-reading-rules.md D3; live Obsidian 1.14.4, 2026-10-06).
// A blank line above alone would make the label a heading with that line,
// so it needs one above and one below, and gets one alert that says so;
// the lazy-label alert ("Add a blank line above it") and the underline's
// ("reads as a heading") stop speaking for it (Jason's ruling Q9,
// 2026-10-07; stage 5 of the result gate design, 2026-10-08).

beforeEach(resetNotices);

const alerts = (lines: string[]) => {
    noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), lines.join("\n"));
    return messages();
};
const One = (label: string) => `This note has a footnote definition that Obsidian reads as plain text ("${label}:"). Put a blank line above it and another below it.`;

describe("a label right under paragraph text, with a line of '-' or '=' right under it", () => {
    it("over '---' at the margin", () => {
        expect(alerts(["Para text[^b]", "[^b]: lazy", "---"])).toEqual([One("[^b]")]);
    });

    it("over '==='", () => {
        expect(alerts(["Para text[^b]", "[^b]: lazy", "==="])).toEqual([One("[^b]")]);
    });

    it("over a lone '-', an empty list item under the label, which a blank line above would make its underline", () => {
        expect(alerts(["Para text[^b]", "[^b]: lazy", "-"])).toEqual([One("[^b]")]);
    });

    it("in a quote", () => {
        expect(alerts(["> Para[^b]", "> [^b]: lazy", "> ---"])).toEqual([One("[^b]")]);
    });

    it("two of them, in one alert", () => {
        expect(alerts(["Para[^a] and[^b]", "[^a]: one", "---", "", "More text", "[^b]: two", "==="])).toEqual([
            'This note has 2 footnote definitions that Obsidian reads as plain text ("[^a]:", "[^b]:"). Put a blank line above and below each.',
        ]);
    });

    it("control: with a blank line above, the label is a heading, and the underline's alert speaks", () => {
        const said = alerts(["Text[^b].", "", "[^b]: lazy", "---"]);
        expect(said.some((m) => m.includes("reads as a heading"))).toBe(true);
        expect(said.some((m) => m.includes("reads as plain text (\""))).toBe(false);
    });

    it("control: a lazy label with nothing under it gets the lazy-label alert", () => {
        expect(alerts(["Para text[^b]", "[^b]: lazy"])).toEqual([
            'This note has a footnote definition that Obsidian reads as plain text because there is no blank line above it ("[^b]:"). Add a blank line above it.',
        ]);
    });

    it("control: an indented '  ---' under it is no underline (a blank line above makes a definition), so the lazy-label alert speaks", () => {
        expect(alerts(["Para text[^b]", "[^b]: lazy", "  ---"])).toEqual([
            'This note has a footnote definition that Obsidian reads as plain text because there is no blank line above it ("[^b]:"). Add a blank line above it.',
        ]);
    });
});
