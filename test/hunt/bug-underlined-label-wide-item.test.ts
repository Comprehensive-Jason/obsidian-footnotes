import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lazyDefinitionLabelNames, underlinedDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): a footnote label with a "---" underline under it, in a
// list item whose text starts 4 or more columns in, is treated as a plain
// lazy label (one that only needs a blank line above it).
//
// What the user would see: in a "10." item, a nested item, or a "10."
// item inside a quote, the user wrote "[^b]: lazy" with "---" under it.
// Obsidian reads the two lines as a heading. The lint's alert tells the
// user to add a blank line above the label, which would not help, instead
// of the underline's own advice ("reads as a heading"). Delete footnote
// everywhere refuses to delete [^b], though in an item whose text starts
// at column 2 it takes the label and its underline together.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L6. (Two tab-indented
// tests from the probe were dropped.)
//
// Source of truth: live Obsidian 1.14.4 (2026-10-05): "Text[^b].",
// "", "10. item", "", "    [^b]: lazy", "    ---" has no definition (a
// heading inside the item), and only a blank line before the "    ---"
// makes one. The narrow item ("- item", "  [^b]: lazy", "  ---"), where
// underlinedDefinitionLabelNames names the label and Delete footnote
// everywhere deletes it.
//
// Cause: labelShapedLines reads the label from where the line's
// containers end (9dc04b1), but underlineUnder, which decides whether the
// next line underlines it, looks for the "---" or "===" within three
// spaces of the MARGIN (after any quote markers). At a content column of 4
// or more the underline is four spaces in, so it is never seen, and the
// label is filed as lazy. Delete footnote everywhere then cuts only the
// label line, which would leave the "---" under the item's text and turn
// that text into a heading, so its guard refuses.
//
// Fixed 2026-10-05: underlinedAt (it replaced underlineUnder) reads the
// line under the label from where its containers end, as the label is
// read, and counts it an underline when the reading puts it in the same
// containers as the label's line.

beforeEach(resetNotices);

const WIDE: { what: string; note: string[] }[] = [
    { what: "a wide ordered item", note: ["Text[^b].", "", "10. item", "    [^b]: lazy", "    ---"] },
    { what: "a nested item", note: ["Text[^b].", "", "- parent", "  - child", "    [^b]: lazy", "    ---"] },
    { what: "a wide ordered item in a quote", note: ["Text[^b].", "", "> 10. item", ">     [^b]: lazy", ">     ---"] },
];

describe("an underlined label at a wide item's content column", () => {
    for (const { what, note } of WIDE) {
        it(`${what}: the label is underlined, not lazy`, () => {
            // Before the fix: lazyDefinitionLabelNames gives ["b"].
            expect(lazyDefinitionLabelNames(note)).toEqual([]);
            expect(underlinedDefinitionLabelNames(note)).toEqual(["b"]);
        });

        it(`${what}: the alert gives the underline's advice, not "Add a blank line above it"`, () => {
            noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), note.join("\n"));
            // Before the fix: the lazy-label alert ("no blank line above") speaks instead.
            expect(messages().some((m) => m.includes("reads as a heading"))).toBe(true);
            expect(messages().some((m) => m.includes("no blank line above"))).toBe(false);
        });

        // Changed 2026-10-06 (hunt cycle 5, cluster X35): this test first
        // asked for the label and its "---" to go together, as they did in
        // a narrow item. Under a line that carries on the item's paragraph,
        // the note reading takes the "---" for a horizontal rule of its own
        // (docs/obsidian-reading-rules.md D3; live Obsidian 1.14.4 for the
        // same shape at the margin, pin bug-delete-cuts-rule-under-lazy-label),
        // so Delete footnote everywhere now keeps it. Here the "---" left
        // under the item's text would make that text a heading, so the
        // command refuses, which bug-delete-cuts-rule-under-lazy-label
        // accepts.
        it(`${what}: Delete footnote everywhere keeps the '---' (or refuses)`, () => {
            const plan = deleteFootnoteEverywhere(note.join("\n"), "b") as { kind: string; markdown?: string };
            expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes(note[note.length - 1])).toBe(true);
        });
    }
});
