import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

import { noticeSegments } from "../src/editor/notice";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { lazyDefinitionLabelNames } from "../src/linting/rules/remove-orphaned-references";

// The lazy-definition alert (Jason, 2026-09-09, right after the prose-label
// rule shipped): a "[^x]:" directly under a prose line is lazy paragraph
// text to Obsidian, one blank line short of the definition the user
// typed. The generic missing-definition alert said "write its definition",
// which is wrong advice for this case, so these labels get their own alert
// (label form, since the label LINE is what to fix), drop out of the
// missing-definition alert, and their references are never deleted as
// orphans. Plural form counts, like every other lint alert.

const SHEET = [
    "alpha[^p1] here:",
    "para line",
    "[^p1]: after a paragraph",
    "",
    "bravo[^l1] here:",
    "- item",
    "[^l1]: after a list item",
    "",
    "> [!note]",
    "> callout body",
    "> [^cb]: under the callout body",
    "",
    "golf[^c1] here:",
    "",
    "[^c1]: after a blank line",
].join("\n");

function names(doc: string): string[] {
    const lines = doc.split("\n");
    return lazyDefinitionLabelNames(lines);
}

describe("lazyDefinitionLabelNames", () => {
    it("names every label-shaped line that is not a definition start, once, in order", () => {
        expect(names(SHEET)).toEqual(["p1", "l1", "cb"]);
    });

    it("ignores real definitions, protected fakes, and repeats", () => {
        expect(names("a[^1]\n\n[^1]: real")).toEqual([]);
        expect(names("para\n```\n[^1]: fenced\n```")).toEqual([]);
        expect(names("para\n[^X]: one\npara\n[^x]: twice")).toEqual(["X"]);
    });
});

describe("the lazy-definition alert", () => {
    beforeEach(resetNotices);

    it("singular: names the label line and says to add the blank line", () => {
        noticeLintAlerts(fakePlugin({}), "a[^1]\npara\n[^1]: mid");
        expect(messages()).toEqual([
            'This note has a footnote definition that Obsidian reads as plain text because there is no blank line above it ("[^1]:"). Add a blank line above it.',
        ]);
    });

    it("plural: counts, lists every label, and keeps them out of the missing-definition alert", () => {
        noticeLintAlerts(fakePlugin({}), SHEET);
        const all = messages();
        expect(all).toContain(
            'This note has 3 footnote definitions that Obsidian reads as plain text because there is no blank line above them ("[^p1]:", "[^l1]:", "[^cb]:"). Add a blank line above each.',
        );
        expect(all.some((m) => m.includes("with no definition"))).toBe(false);
    });

    it("a reference with no label anywhere still gets the missing-definition alert", () => {
        noticeLintAlerts(fakePlugin({}), "a[^1] b[^9]\npara\n[^1]: mid");
        const all = messages();
        expect(all.some((m) => m.includes('no definition ("[^9]")'))).toBe(true);
        expect(all.some((m) => m.includes('("[^1]:")'))).toBe(true);
    });

    it("the quoted label stays on one line in the toast", () => {
        const segments = noticeSegments('short ("[^p1]:", "[^l1]:") tail');
        expect(segments.filter((s) => s.nowrap).map((s) => s.text)).toEqual(['"[^p1]:"', '"[^l1]:"']);
    });
});
