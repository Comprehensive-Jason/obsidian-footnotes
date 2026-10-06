import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../src/linting/linter";

// The composed cleanup: punctuation → move to bottom → reindex, each step
// individually skippable (the settings tab exposes the toggles). The three
// transforms carry their own specs; these tests pin the composition order,
// the toggles, and that the pipeline is idempotent as a whole.

describe("lintFootnotes", () => {
    const MESSY = "Alpha[^2], bravo[^1].\n\n[^2]: two\n\nCharlie tail.";

    it("applies all three cleanups in one pass", () => {
        const expected =
            "Alpha,[^1] bravo.[^2]\n\nCharlie tail.\n\n[^1]: two";
        expect(lintFootnotes(MESSY)).toBe(expected);
    });

    it("adds the section heading when given", () => {
        const input = "Word[^1].\n\n[^1]: def";
        const expected = "Word.[^1]\n\n# Footnotes\n\n[^1]: def";
        expect(lintFootnotes(input, { sectionHeading: "# Footnotes" })).toBe(
            expected,
        );
    });

    it("leaves a linted document unchanged", () => {
        const text = "Alpha.[^1] bravo,[^2]\n\n[^1]: one\n[^2]: two";
        expect(lintFootnotes(text)).toBe(text);
    });

    it("skips the punctuation fix when toggled off", () => {
        const expected =
            "Alpha[^1], bravo[^2].\n\nCharlie tail.\n\n[^1]: two";
        expect(lintFootnotes(MESSY, { fixPunctuation: false })).toBe(expected);
    });

    it("skips moving definitions when toggled off", () => {
        // the definition stays mid-document; reindex still renumbers
        const expected =
            "Alpha,[^1] bravo.[^2]\n\n[^1]: two\n\nCharlie tail.";
        expect(lintFootnotes(MESSY, { moveDefinitionsToBottom: false })).toBe(
            expected,
        );
    });

    it("skips reindexing when toggled off", () => {
        const expected =
            "Alpha,[^2] bravo.[^1]\n\nCharlie tail.\n\n[^2]: two";
        expect(lintFootnotes(MESSY, { reindex: false })).toBe(expected);
    });

    it("returns the input unchanged when every step is off", () => {
        expect(
            lintFootnotes(MESSY, {
                fixPunctuation: false,
                moveDefinitionsToBottom: false,
                reindex: false,
            }),
        ).toBe(MESSY);
    });

    it("passes reindex options through", () => {
        const input = "Word[^note].\n\n[^note]: def";
        const expected = "Word.[^1]\n\n[^1]: def";
        expect(
            lintFootnotes(input, {
                reindexOptions: { renumberNamedFootnotes: true },
            }),
        ).toBe(expected);
    });

    it("is idempotent", () => {
        const messy =
            "b[^9]... a[^note],\n\n[^9]: nine\n\nmid text[^3].\n\n[^3]: three\n[^8]: orphan";
        const options = {
            sectionHeading: "# Footnotes",
            reindexOptions: { renumberNamedFootnotes: true },
        };
        const once = lintFootnotes(messy, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });
});

describe("repeated linting with a section heading (bug reported 2026-07-17)", () => {
    it("never duplicates a single-line heading", () => {
        const options = { sectionHeading: "# Footnotes" };
        const once = lintFootnotes("b[^2] a[^1].\n\n[^1]: one\n[^2]: two", options);
        const twice = lintFootnotes(once, options);
        expect(twice).toBe(once);
        expect(twice.split("# Footnotes").length - 1).toBe(1);
    });

    it("never duplicates a mid-document heading (hunt 2026-07-17)", () => {
        // the old endsWith presence check only inspected the tail of the
        // body, so a heading already sitting mid-document got a twin
        const input = "body[^1].\n# Footnotes\n\n[^1]: def\n\ntrailing prose";
        const out = lintFootnotes(input, { sectionHeading: "# Footnotes" });
        const count = out.split("\n").filter((l) => l === "# Footnotes").length;
        expect(count).toBe(1);
    });

    it("never duplicates a multi-line divider heading", () => {
        const options = { sectionHeading: "---\n## Footnotes" };
        const once = lintFootnotes("b[^2] a[^1].\n\n[^1]: one\n[^2]: two", options);
        const twice = lintFootnotes(once, options);
        const thrice = lintFootnotes(twice, options);
        expect(twice).toBe(once);
        expect(thrice).toBe(once);
        expect(thrice.split("## Footnotes").length - 1).toBe(1);
    });
});
