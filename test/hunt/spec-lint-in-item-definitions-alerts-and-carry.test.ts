// RULED 2026-10-03 by Jason's ruling 1, option a (a definition inside a list item is modelled everywhere, like any other; the runtime swap, step 1): the nested-footnote, duplicate, and orphan-definition alerts all count in-item definitions, an in-item label is no reference, and a copy carries an in-item definition with its lines as they stand. The question below is kept as it was asked.
import { beforeEach, describe, expect, it } from "vitest";

import { carriedDefinitions } from "../../src/commands/carry-footnotes";
import { nestedFootnoteDefinitionNames, noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { duplicateFootnoteDefinitionNames } from "../../src/linting/rules/merge-duplicate-definitions";
import { orphanedFootnoteDefinitionNames } from "../../src/linting/rules/remove-orphaned-definitions";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { readNote } from "../../src/parsing/note-reading";

// spec question: should the never-silent alerts and copy-and-paste know
// footnote definitions written inside a list item?
//
// What it does now: Jason's ruling 1 (2026-09-20, commit f098798) listed
// the readers that learned in-item definitions: the orphan-reference alert
// and its deletion, navigation, reindex, and rename. Four readers were not
// on that list. The nested-footnote alert stays quiet about a reference
// typed inside an in-item definition ("- [^1]: see[^2]"). The duplicate
// alert stays quiet about a name defined both in a list item and at column
// 0, although Obsidian renders only one of them. The orphan-definition
// alert (round 4) stays quiet about an in-item definition nothing
// references ("- [^i]: in item orphan"), and the in-item label's own
// "[^i]" even counts as a reference, so it keeps a column-0 orphan of the
// same name from being named. And a copy of "alpha[^1] beta" whose
// footnote is defined in a list item reports [^1] as missing, so the paste
// toast says "[^1] has no definition to carry", which is false: the note
// defines it.
// What a user might expect: the alerts name the footnote, and the copy
// either carries the in-item definition (as a column-0 definition at the
// destination) or says it is defined inside a list item.
// Why it is a question and not a bug: ruling 1 chose option b on purpose,
// recognizing in-item definitions only where ignoring them misfired, and
// copy and paste (issue #59, 0.3.0) came after the ruling. Whether these
// readers join option b's list, and what a carried in-item definition
// should turn into, are Jason's calls. The press faces of the same root
// are spec-press-in-item-definition-guards.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E7. The orphan-definition
// tests: round 4, lenses alerts and root causes, clusters A8 and O5 (the
// same question again). The undo notice's face of it is
// spec-undo-notice-in-item-definitions, and the paste's destination side
// is spec-carry-paste-reuse-in-item-definition.
//
// Source of truth: ruling 1 (in-item definitions are real definitions),
// ADR 0002 (the lint is never silent about what it cannot fix), and the
// README's Paste paragraph.

/** The scanner's readings of `doc` that the alerts take: the lines, the reading, the masked twin, and which lines start a definition. */
function readers(doc: string) {
    const lines = doc.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { lines, reading, masked, starts };
}

describe("spec question: the never-silent alerts and in-item definitions", () => {
    it("the nested-footnote alert names an in-item definition holding a reference", () => {
        const { lines } = readers(["text[^1] [^2]", "", "- [^1]: see[^2]", "", "[^2]: two"].join("\n"));
        // Today: [].
        expect(nestedFootnoteDefinitionNames(lines)).toEqual(["1"]);
    });

    it("the duplicate alert names a footnote defined in an item and again at column 0", () => {
        // Today: [].
        expect(duplicateFootnoteDefinitionNames(["text[^1]", "", "- [^1]: in item", "", "[^1]: col0"].join("\n"))).toEqual(["1"]);
    });
});

/** Lint `doc` on default settings, then run the alerts on the result, as linter.ts does. */
function lintThenAlerts(doc: string) {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS });
    const after = lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc));
    resetNotices();
    noticeLintAlerts(plugin, after);
    return messages();
}

/** Does some toast say nothing references the footnote `name`? */
function namedAsOrphan(alerts: string[], name: string): boolean {
    return alerts.some((m) => m.includes(`"[^${name}]"`) && m.includes("nothing references"));
}

describe("spec question: the orphan-definition alert and in-item definitions", () => {
    beforeEach(resetNotices);

    it("an in-item definition nothing references is named with Delete orphaned definitions off", () => {
        // Today: no orphan alert.
        expect(namedAsOrphan(lintThenAlerts("Text.\n\n- [^i]: in item orphan\n"), "i")).toBe(true);
    });

    it("an in-item label does not keep a column-0 orphan of the same name alive", () => {
        // Today: no orphan alert; the in-item label's "[^i]" counts as a reference.
        expect(namedAsOrphan(lintThenAlerts("Text.\n\n- [^i]: in item\n\n[^i]: col0\n"), "i")).toBe(true);
    });

    it("'- [^a]: def' with no reference anywhere is reported by the orphan-definition reader", () => {
        // Today: [].
        expect(orphanedFootnoteDefinitionNames("Text here.\n\n- [^a]: def\n")).toEqual(["a"]);
    });
});

describe("spec question: carrying a footnote defined inside a list item", () => {
    it("the copy does not report an in-item definition as missing", () => {
        const doc = ["alpha[^1] beta", "", "- [^1]: in item"].join("\n");
        // Today: ["1"].
        expect(carriedDefinitions(doc, { line: 0, ch: 0 }, { line: 0, ch: 14 }).missing).toEqual([]);
    });
});
