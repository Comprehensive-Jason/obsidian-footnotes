import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { nestedFootnoteDefinitionNames, noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong alert): with "Fix definitions hidden by a missing blank line"
// turned off, a definition typed on the line straight under a footnote
// longer than Obsidian's 1,024-character look-ahead gets a second alert
// that is wrong: "This note has a footnote nested inside another
// footnote's definition ("[^1]")... Move it into the text."
//
// What the user would see: "Text[^1] and[^2] here.", a blank line, then
// "[^1]: A long discursive note: oysters oysters ...", one line of about
// 1,470 characters, and "[^2]: Capital, vol. 3." on the line right under
// it. Obsidian reads "[^2]: Capital, vol. 3." as more text of footnote 1
// (a lazy label), and the lint alerts "Add a blank line above it", which
// is right. Next to it, the nesting alert tells the user to move a
// footnote out of footnote 1, where all the label needs is that blank
// line.
//
// A "lazy label" is a label ("[^2]:" at the head of a definition) that
// Obsidian reads as plain text carrying on the text above it; a blank
// line above it makes it a definition. A "nested footnote" is a footnote
// sitting inside another footnote's text.
//
// The fixtures build the long footnote in code: "A long discursive note:"
// and the word "oysters" 180 times, one label line of 1,470 characters.
//
// Hunt 2026-10-08, cycle 7, cluster Y7 (c7fix-C's report, item 2; c8-tail's
// report, decision 3). Jason approved the fix on 2026-10-09.
//
// Origin: pre-existing; red at 18c6fe2. At the default settings it no
// longer shows, since fix-lazy adds the blank line there (c8-tail).
//
// Source of truth: docs/obsidian-reading-rules.md E4 (a label that starts
// at or after character 1,024 of a definition is lazy text of it). The
// lazy-label policy: such a label gets "Add a blank line above it"
// (test/lazy-definition-alert.test.ts). The nesting alert is for a
// footnote inside another's text (test/nested-footnote-alert.test.ts).
//
// Cause: nestedFootnoteDefinitionNames in src/linting/lint-alerts.ts
// counts every reference inside a definition's text, and the lazy label's
// own "[^2]" is one: Obsidian reads it as a reference inside footnote 1.

/** "A long discursive note:" and "oysters" 180 times: a footnote whose label line runs to 1,470 characters. */
const Long = `A long discursive note: ${Array.from({ length: 180 }, () => "oysters").join(" ")}.`;

const NestedAlert = "nested inside";
const LazyAlert = "Add a blank line above it";

/** The alerts a lint with fix-lazy turned off leaves on `lines`. */
function alertsWithoutFixLazy(lines: string[]): string {
    resetNotices();
    const out = lintFootnotes(lines.join("\n"), { fixLazyDefinitions: false });
    noticeLintAlerts(fakePlugin({}), out);
    return messages().join(" | ");
}

describe("fix-lazy off, a label straight under a long footnote", () => {
    beforeEach(resetNotices);

    const note = ["Text[^1] and[^2] here.", "", `[^1]: ${Long}`, "[^2]: Capital, vol. 3."];

    it("the lazy-label alert, and no nesting alert", () => {
        const said = alertsWithoutFixLazy(note);
        expect(said).toContain(LazyAlert);
        expect(said).not.toContain(NestedAlert);
    });

    it("footnote 1 holds no nested footnote", () => {
        expect(nestedFootnoteDefinitionNames(note)).toEqual([]);
    });

    it("packed by hand: short, long, short", () => {
        const packed = ["One[^1] two[^2] three[^3].", "", "[^1]: Brenner 2006.", `[^2]: ${Long}`, "[^3]: Heinrich 2013."];
        const said = alertsWithoutFixLazy(packed);
        expect(said).toContain(LazyAlert);
        expect(said).not.toContain(NestedAlert);
    });

    it("in a quote", () => {
        const quoted = ["> Text[^1] and[^2] here.", ">", `> [^1]: ${Long}`, "> [^2]: Capital, vol. 3."];
        expect(nestedFootnoteDefinitionNames(quoted)).toEqual([]);
    });
});

// Real nesting next to a long footnote still alerts.
describe("controls: a footnote really inside the long one", () => {
    it("control: a reference in the long footnote's text", () => {
        const note = ["Text[^1] and[^2] here.", "", `[^1]: ${Long} See[^2].`, "", "[^2]: Capital, vol. 3."];
        expect(nestedFootnoteDefinitionNames(note)).toEqual(["1"]);
    });

    it("control: a label indented under the long footnote, inside its text even with a blank line", () => {
        const note = ["Text[^1] and[^2] here.", "", `[^1]: ${Long}`, "    [^2]: Capital, vol. 3."];
        expect(nestedFootnoteDefinitionNames(note)).toEqual(["1"]);
    });

    it("control: a reference after the lazy label, on its line", () => {
        const note = ["Text[^1] and[^2] here[^3].", "", `[^1]: ${Long}`, "[^2]: Capital, see[^3].", "", "[^3]: Marx."];
        expect(nestedFootnoteDefinitionNames(note)).toEqual(["1"]);
    });

    it("control: a short footnote whose text holds a reference", () => {
        expect(nestedFootnoteDefinitionNames(["a[^1] b[^2].", "", "[^1]: cites[^2] here", "[^2]: two"])).toEqual(["1"]);
    });
});
