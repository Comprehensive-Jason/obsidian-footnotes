import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { readNote } from "../../src/parsing/note-reading";

// spec question: a lazy label whose fix, a blank line above it, would
// turn it into a heading: what should the alert advise?
//
// What it does now: a note reads "- item[^1]", then "[^1]: def" at the
// left margin on the very next line (a lazy label: it carries on the list
// item's text, so it is no definition), then "---" at the left margin.
// The "---" ends the list as a horizontal rule, so the label is filed as
// lazy and the alert says "Add a blank line above it." Following that
// advice takes the label out of the item, and the "---" right under it
// then underlines it: Obsidian reads a heading "[^1]: def", still no
// definition. Fix lazy definitions rightly leaves it alone.
// What a user might expect: advice that works, such as also putting a
// blank line between the label and the "---" (the advice the underlined
// alert gives).
// Why it is a question and not a bug: nothing is lost and the alert's
// first sentence is true (Obsidian reads the label as plain text); only
// the remedy falls short, and its wording is Jason's to pick. The test
// below accepts any alert for "[^1]:" whose advice is not only "Add a
// blank line above it."
//
// Hunt 2026-10-06, cycle 4, lens labels. Cluster B3.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4, 2026-10-06: "- item[^1]" / "" /
// "[^1]: def" / "---" is a heading on lines 2 to 3, not a definition (a
// blank line above that label makes a heading). The note reading agrees
// (the control below).

beforeEach(() => {
    resetNotices();
});

describe("spec question: the lazy alert's advice for a label a blank line above would make a heading", () => {
    it("control: '- item' / '[^1]: def' / '---' with a blank line above the label is a heading, not a definition", () => {
        const reading = readNote(["- item", "", "[^1]: def", "---"]);
        expect(reading.labelLines[2]).toBe(false);
        expect(reading.lineBlocks[2]).toBe("^heading2");
    });

    it.fails("the alert for '- item[^1]' / '[^1]: def' / '---' does not advise only adding a blank line above the label", () => {
        noticeLintAlerts(fakePlugin({}), ["- item[^1]", "[^1]: def", "---"].join("\n"));
        const advice = messages().filter((m) => m.includes('"[^1]:"'));
        expect(advice.length).toBeGreaterThan(0);
        // Today the one alert ends "Add a blank line above it."
        expect(advice.every((m) => m.endsWith("Add a blank line above it."))).toBe(false);
    });
});
