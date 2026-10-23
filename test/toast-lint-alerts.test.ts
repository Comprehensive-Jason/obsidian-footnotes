import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../src/settings";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The lint alerts the shared vocabulary merged (Jason's choice, 2026-10-22,
// run toast-consolidate): one alert for everything the lint left undone,
// one shape for a label Obsidian does not read as a definition, and a
// nested alert that names both footnotes. The single forms are pinned
// beside the rules that raise them; these pin the plural forms and the
// merging, written out in full.

beforeEach(resetNotices);

const alerts = (lines: string[], settings: Partial<typeof DEFAULT_SETTINGS> = {}) => {
    noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, ...settings }), lines.join("\n"));
    return messages();
};

describe("the held-back alert", () => {
    it("one alert names everything the lint left, an orphaned definition and an unmergeable duplicate together", () => {
        const note = ["a[^a] b", "", "> [!note] [^o]: on the title line", "> callout body", "", "- [^a]: in the item", "", "[^a]: at the top"];
        expect(alerts(note, { lintDeleteOrphanedDefinitions: true, lintMergeDuplicateDefinitions: true })).toEqual([
            'The lint left "[^o]:" and "[^a]:" as they are, because changing them would change how Obsidian reads the text around them. Fix them by hand.',
        ]);
    });
});

describe("the not-a-definition alert", () => {
    it("two labels a line of '=' or '-' makes headings", () => {
        const note = ["a[^a] b[^b]", "", "[^a]: one", "===", "", "[^b]: two", "---"];
        expect(alerts(note)).toEqual([
            'Obsidian reads "[^a]:" and "[^b]:" as headings, not as footnote definitions. Put a blank line between each and the line of "=" or "-" under it.',
        ]);
    });
});

describe("the nested alert names the footnotes inside and the definition they sit in", () => {
    it("one footnote inside one definition", () => {
        expect(alerts(["a[^a]", "", "[^a]: see [^b]", "[^b]: two"])).toEqual([
            '"[^b]" sits inside the definition of "[^a]". Nested footnotes don\'t survive export and most tools can\'t read them. Move "[^b]" into the text.',
        ]);
    });
    it("a reference and an inline footnote inside one definition", () => {
        expect(alerts(["a[^a]", "", "[^a]: see [^b] and ^[an aside]", "[^b]: two"])).toEqual([
            '"[^b]" and "^[an aside]" sit inside the definition of "[^a]". Nested footnotes don\'t survive export and most tools can\'t read them. Move them into the text.',
        ]);
    });
    it("footnotes inside two definitions", () => {
        expect(alerts(["a[^a] c[^c]", "", "[^a]: see [^x]", "[^c]: see [^y]", "[^x]: x", "[^y]: y"])).toEqual([
            '"[^x]" and "[^y]" sit inside the definitions of "[^a]" and "[^c]". Nested footnotes don\'t survive export and most tools can\'t read them. Move them into the text.',
        ]);
    });
    it("a definition written in another's body is named by its label", () => {
        expect(alerts(["a[^a] b[^b]", "", "[^a]: outer", "", "    [^b]: inner"])).toEqual([
            '"[^b]:" sits inside the definition of "[^a]". Nested footnotes don\'t survive export and most tools can\'t read them. Move "[^b]:" into the text.',
        ]);
    });
});
