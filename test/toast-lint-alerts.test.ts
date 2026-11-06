import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { lintNote } from "../src/linting/linter";
import { DEFAULT_SETTINGS } from "../src/settings";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The lint alerts the shared vocabulary merged (Jason's choice, 2026-10-22,
// run toast-consolidate): one alert for the references, renames, and moves
// the lint left undone, one shape for a label Obsidian does not read as a
// definition, and a nested alert that names both footnotes. The single forms are pinned
// beside the rules that raise them; these pin the plural forms and the
// merging, written out in full.

beforeEach(resetNotices);

const alerts = (lines: string[], settings: Partial<typeof DEFAULT_SETTINGS> = {}) => {
    noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, ...settings }), lines.join("\n"));
    return messages();
};

/** The alerts after a real lint of the note, for the changes only a lint can hold back. */
const alertsAfterLint = (lines: string[], settings: Partial<typeof DEFAULT_SETTINGS>) => {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, ...settings });
    const linted = lintNote(plugin, lines.join("\n"), "");
    resetNotices();
    noticeLintAlerts(plugin, linted);
    return messages();
};

describe("the held-back alert", () => {
    it("one alert names a held reference and a held move together", () => {
        const note = ["It was free[^1]!(sic) here.", "", "- a[^2]", "", "[^2]: two", "- b", "", "[^1]: one"];
        expect(alertsAfterLint(note, { lintFixPunctuation: true, footnotePlacement: "after", lintMoveToBottom: true, lintReindex: false })).toEqual([
            'The lint left "[^2]:" and "[^1]" as they are, because changing them would change how Obsidian reads the text around them. Fix them by hand.',
        ]);
    });
});

// An orphaned or duplicate definition the lint could not fix says what is
// wrong with it, because "Fix it by hand" gives no clue otherwise, and the
// section heading says it was not added, because it never existed to be
// left as it was (Jason's choice, 2026-11-05, run wording-q4, item 2).
const OnToggles = { lintDeleteOrphanedDefinitions: true, lintMergeDuplicateDefinitions: true };
const onTitleLine = (name: string) => [`> [!note] [^${name}]: on the title line`, "> callout body", ""];

describe("an orphaned definition the lint could not delete", () => {
    it("one", () => {
        expect(alerts(["text", "", ...onTitleLine("o")], OnToggles)).toEqual([
            'This note has a footnote definition nothing references ("[^o]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Add a "[^o]" reference in the text, or delete the definition by hand.',
        ]);
    });
    it("two", () => {
        expect(alerts(["text", "", ...onTitleLine("o"), ...onTitleLine("p")], OnToggles)).toEqual([
            'This note has 2 footnote definitions nothing references ("[^o]", "[^p]"). The lint left them as they are, because deleting them would change how Obsidian reads the text around them. Add their references in the text, or delete the definitions by hand.',
        ]);
    });
});

// An orphaned reference the lint could not delete names its problem too,
// because "Fix it by hand" gave no clue that the reference has no definition
// (Jason's ruling, 2026-11-06). Deleting a reference alone on its line here
// would make the indented line under it part of the definition above.
const OrphanReferenceToggle = { lintDeleteOrphanedReferences: true };
const heldOrphan = (name: string, definition: string) => [`[^${definition}]: its text`, "", `[^${name}]`, "", "    indented text", ""];

describe("an orphaned reference the lint could not delete", () => {
    it("one", () => {
        expect(alerts(["a[^1]", "", ...heldOrphan("x", "1")], OrphanReferenceToggle)).toEqual([
            'This note has a footnote reference with no definition ("[^x]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Write its definition or delete the reference by hand.',
        ]);
    });
    it("two", () => {
        expect(alerts(["a[^1] b[^2]", "", ...heldOrphan("x", "1"), ...heldOrphan("y", "2")], OrphanReferenceToggle)).toEqual([
            'This note has 2 footnote references with no definition ("[^x]", "[^y]"). The lint left them as they are, because deleting them would change how Obsidian reads the text around them. Write their definitions or delete the references by hand.',
        ]);
    });
    it("a reference the next lint can delete is not named", () => {
        expect(alerts(["a[^1] stray[^z] here", "", ...heldOrphan("x", "1")], OrphanReferenceToggle)).toEqual([
            'This note has a footnote reference with no definition ("[^x]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Write its definition or delete the reference by hand.',
        ]);
    });
    it("with the toggle off the alert keeps its own words, without 'by hand'", () => {
        expect(alerts(["a[^1]", "", ...heldOrphan("x", "1")])).toEqual([
            'This note has a footnote reference with no definition ("[^x]"). Write its definition or delete the reference.',
        ]);
    });
    it("the held-back alert keeps the references that have a definition", () => {
        const note = ["free[^1]!(sic) here", "", ...heldOrphan("x", "1")];
        expect(alertsAfterLint(note, { ...OrphanReferenceToggle, lintFixPunctuation: true, footnotePlacement: "after", lintReindex: false, lintMoveToBottom: false })).toEqual([
            'This note has a footnote reference with no definition ("[^x]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Write its definition or delete the reference by hand.',
            'The lint left "[^1]" as it is, because changing it would change how Obsidian reads the text around it. Fix it by hand.',
        ]);
    });
});

describe("a duplicate definition the lint could not merge", () => {
    it("one name", () => {
        expect(alerts(["a[^a]", "", "- [^a]: in the item", "", "[^a]: at the top"], OnToggles)).toEqual([
            'This note defines "[^a]" more than once. Obsidian renders only the last definition. The lint left them as they are, because merging them would change how Obsidian reads the text around them. Merge them by hand.',
        ]);
    });
    it("two names", () => {
        const note = ["a[^a] b[^b]", "", "- [^a]: in the item", "", "- [^b]: in the item", "", "[^a]: at the top", "[^b]: at the top"];
        expect(alerts(note, OnToggles)).toEqual([
            'This note defines 2 footnotes more than once ("[^a]", "[^b]"). Obsidian renders only each one\'s last definition. The lint left them as they are, because merging them would change how Obsidian reads the text around them. Merge them by hand.',
        ]);
    });
});

describe("each thing the lint left has one alert that fits it", () => {
    it("an orphaned definition and a duplicate get an alert each, and the held-back alert keeps the rest", () => {
        const note = ["a[^a] free[^1]!(sic) here", "", ...onTitleLine("o"), "- [^a]: in the item", "", "[^a]: at the top", "[^1]: one"];
        expect(alertsAfterLint(note, { ...OnToggles, lintFixPunctuation: true, footnotePlacement: "after", lintReindex: false })).toEqual([
            'This note has a footnote definition nothing references ("[^o]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Add a "[^o]" reference in the text, or delete the definition by hand.',
            'This note defines "[^a]" more than once. Obsidian renders only the last definition. The lint left them as they are, because merging them would change how Obsidian reads the text around them. Merge them by hand.',
            'The lint left "[^1]" as it is, because changing it would change how Obsidian reads the text around it. Fix it by hand.',
        ]);
    });
    it("an orphaned definition that also holds the move back is named once, with its problem", () => {
        expect(alerts(["- a", "", "[^o]: one", "- b"], { ...OnToggles, lintMoveToBottom: true })).toEqual([
            'This note has a footnote definition nothing references ("[^o]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Add a "[^o]" reference in the text, or delete the definition by hand.',
        ]);
    });
    it("a section heading the move could not add has its own alert", () => {
        const note = ["---", "", "[^n]: alpha", "", "alpha[^n]. alpha"];
        expect(alerts(note, { lintMoveToBottom: true, enableFootnoteSectionHeading: true, footnoteSectionHeading: "---\n## Footnotes" })).toEqual([
            "The lint did not add the footnote section heading, because it would change how Obsidian reads the text around it.",
            'The lint left "[^n]:" as it is, because changing it would change how Obsidian reads the text around it. Fix it by hand.',
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
    it("a definition written in another's body is named by its label, and moves out of that definition", () => {
        expect(alerts(["a[^a] b[^b]", "", "[^a]: outer", "", "    [^b]: inner"])).toEqual([
            '"[^b]:" sits inside the definition of "[^a]". Nested footnotes don\'t survive export and most tools can\'t read them. Move "[^b]:" out of the definition of "[^a]".',
        ]);
    });
    it("two definitions in one definition's body", () => {
        expect(alerts(["a[^a] x[^x] y[^y]", "", "[^a]: outer", "", "    [^x]: one", "", "    [^y]: two"])).toEqual([
            '"[^x]:" and "[^y]:" sit inside the definition of "[^a]". Nested footnotes don\'t survive export and most tools can\'t read them. Move them out of the definition of "[^a]".',
        ]);
    });
    it("definitions in the bodies of two definitions", () => {
        expect(alerts(["a[^a] c[^c] x[^x] y[^y]", "", "[^a]: outer", "", "    [^x]: one", "", "[^c]: outer", "", "    [^y]: two"])).toEqual([
            '"[^x]:" and "[^y]:" sit inside the definitions of "[^a]" and "[^c]". Nested footnotes don\'t survive export and most tools can\'t read them. Move them out of the definitions of "[^a]" and "[^c]".',
        ]);
    });
    it("a reference and a definition inside one definition: each gets the advice that fits it", () => {
        expect(alerts(["a[^a] b[^b] c[^c]", "", "[^a]: see [^b]", "", "    [^c]: inner", "", "[^b]: two"])).toEqual([
            '"[^b]" and "[^c]:" sit inside the definition of "[^a]". Nested footnotes don\'t survive export and most tools can\'t read them. Move "[^b]" into the text. Move "[^c]:" out of the definition of "[^a]".',
        ]);
    });
    it("a reference in one definition and a definition in another: only the one holding a definition is named in its advice", () => {
        expect(alerts(["a[^a] c[^c] x[^x] y[^y]", "", "[^a]: see [^x]", "", "[^c]: outer", "", "    [^y]: inner", "", "[^x]: x"])).toEqual([
            '"[^x]" and "[^y]:" sit inside the definitions of "[^a]" and "[^c]". Nested footnotes don\'t survive export and most tools can\'t read them. Move "[^x]" into the text. Move "[^y]:" out of the definition of "[^c]".',
        ]);
    });
});
