import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes } from "../../src/linting/linter";
import { judgeEdit } from "../../src/editor/result-gate";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss): a definition typed on the line straight under a footnote
// longer than Obsidian's 1,024-character look-ahead is not treated as a
// lazy label, so the lint never gives it back, and with Delete orphaned
// references on it destroys the footnote.
//
// What the user would see: "Text[^1] and[^2] here.", a blank line, then
// "[^1]: A long discursive note: oysters oysters ...", one line of about
// 1,470 characters, and "[^2]: Capital, vol. 3." on the line right under
// it. Obsidian reads "[^2]: Capital, vol. 3." as more text of footnote 1,
// so footnote 2 has no definition. With Delete orphaned references on,
// Ctrl+S deletes the "[^2]" in the text and the "[^2]" of the label,
// leaving ": Capital, vol. 3." inside footnote 1: footnote 2 is gone. At
// the default settings nothing is deleted, but the alerts say the note
// has a reference with no definition ("Write its definition or delete the
// reference") and a footnote nested inside another footnote's definition,
// where the definition the user wrote needs only a blank line above it.
// The same happens when three definitions are packed (no blank lines
// between them) and the middle one is the long one: the third footnote
// has no definition, and with Delete orphaned references on it is lost
// the same way.
//
// A "definition" is the "[^2]: ..." entry that holds a footnote's text,
// and its "label" is the "[^2]:" at its head. A "lazy label" is a label
// Obsidian reads as plain text carrying on the paragraph above it; the
// lint gives one back by adding a blank line above it (fix-lazy), and
// never deletes the reference that points at it.
//
// The fixtures build the long footnote in code: "A long discursive note:"
// and the word "oysters" 180 times. Each long label line holds 1,470
// characters, so the label under it starts at character 1,471, counted
// from the start of the long footnote's label line, as rule E4 counts.
//
// Hunt 2026-10-08, cycle 7. Cluster Y7 (two faces: data loss with Delete
// orphaned references on, wrong output at the default settings).
//
// Origin: pre-existing; red at 97abeac.
//
// Source of truth: docs/obsidian-reading-rules.md E4 (what may end a
// definition is looked for only within its first 1,024 characters,
// counted from the start of its label line; a label that starts at or
// after character 1,024 is lazy text of the definition, and a blank line
// still ends a definition at any length; live Obsidian and stock
// remark-footnotes, 2026-10-03, 185 notes). The lazy-label policy: a label
// Obsidian reads as plain text gets "Add a blank line above it", never
// "Write its definition", and its reference is never an orphan to delete
// (src/linting/lint-alerts.ts, src/linting/rules/remove-orphaned-references.ts,
// test/lazy-definition-alert.test.ts).
//
// Cause: labelShapedLines in src/parsing/label-shapes.ts finds the
// label-shaped lines Obsidian reads as plain text. It skips every line the
// reader places inside a definition, since a label there is normally a
// footnote of its own. A label past the look-ahead is inside the long
// footnote's definition, so it is skipped and never counted as lazy. Fix-
// lazy, the lazy-label alert, and the orphan rule's exemption all get
// their lazy labels through it. With that fixed (c7fix-C), fix-lazy found
// the label, but the result gate refused its blank line: footnote 1 loses
// the label's line from its text, and check 1 compared footnote 1's whole
// text before with its text after. Fix-lazy now tells the gate which
// footnote it ends early and where (EditIntent.shortened), and the gate
// compares that footnote's text above the label alone (c8-tail,
// 2026-10-09).

/** "A long discursive note:" and "oysters" 180 times: a footnote whose label line runs to 1,470 characters. */
const Long = `A long discursive note: ${Array.from({ length: 180 }, () => "oysters").join(" ")}.`;

/** The names of the definitions the note holds, in order, as the plugin's reader (the way Obsidian reads it) finds them. */
const names = (text: string) => readNote(text.split("\n")).definitions.map((d) => d.name);

const note = ["Text[^1] and[^2] here.", "", `[^1]: ${Long}`, "[^2]: Capital, vol. 3."].join("\n");

describe("Delete orphaned references on, a label straight under a long footnote", () => {
    // Before c7fix-C: "Text[^1] and here.", "", "[^1]: <long>", ": Capital, vol. 3.".
    it("keeps the reference to footnote 2 and its label", () => {
        const out = lintFootnotes(note, { removeOrphanedReferences: true });
        expect(out).toContain("and[^2]");
        expect(out).toContain("[^2]: Capital, vol. 3.");
    });

    // Open from c7fix-C to c8-tail: fix-lazy found the label, but the
    // result gate refused its blank line, since footnote 1 loses the
    // label's line from its text. The reference and the label stayed, and
    // the alert said to add the blank line.
    it("ends with footnote 2 defined", () => {
        const out = lintFootnotes(note, { removeOrphanedReferences: true });
        expect(names(out)).toEqual(["1", "2"]);
    });
});

describe("default settings, the same note: what the user is told", () => {
    beforeEach(resetNotices);

    // Before c7fix-C the lint left the note as it was, and the alerts said "Write its
    // definition or delete the reference" for [^2] and that [^1] holds a
    // nested footnote.
    it("the lint fixes it, or the alert names the label and says to add a blank line", () => {
        const out = lintFootnotes(note);
        noticeLintAlerts(fakePlugin({}), out);
        const fixed = names(out).includes("2");
        const said = messages().join(" | ");
        expect(fixed || said.includes("Add a blank line above it"), said).toBe(true);
        expect(said).not.toContain("Write its definition");
    });

    // Before c8-tail: footnote 2 ran over lines 3 and 4, with "[^3]:
    // Heinrich 2013." as its lazy text, and footnote 3 had no definition,
    // for the result gate's reason above.
    it("packed by hand: short, long, short", () => {
        const packed = ["One[^1] two[^2] three[^3].", "", "[^1]: Brenner 2006.", `[^2]: ${Long}`, "[^3]: Heinrich 2013."].join("\n");
        const out = lintFootnotes(packed);
        expect(names(out)).toEqual(["1", "2", "3"]);
    });
});

// From the same hunt's look at the rules next to a long footnote: a note
// from beta.6, whose append wrote each label with no blank line above it.
describe("a label written straight under a long footnote by the old append", () => {
    const old = ["Text[^a] and[^b].", "", `[^a]: ${Long}`, "[^b]: short"].join("\n");

    it("control: Obsidian (rule E4) reads [^b]'s label as text of footnote a", () => {
        expect(names(old)).toEqual(["a"]);
    });

    // Before c8-tail fix-lazy gave the note back unchanged, for the result
    // gate's reason above.
    it("fix-lazy gives b its definition back", () => {
        expect(names(fixLazyDefinitions(old))).toEqual(["a", "b"]);
    });

    // Before c8-tail the default lint moved only the period, and [^b]
    // stayed undefined.
    it("the default lint gives b its definition back", () => {
        expect(names(lintFootnotes(old))).toEqual(["a", "b"]);
    });
});

// The gate's side of the fix: told that footnote a ends early, above the
// label's line, it passes the blank line fix-lazy adds there, and it still
// refuses any other change to footnote a.
describe("the result gate, told that footnote a ends where [^b]'s label sits", () => {
    const before = ["Text[^a] and[^b].", "", `[^a]: ${Long}`, "[^b]: short"];
    const after = ["Text[^a] and[^b].", "", `[^a]: ${Long}`, "", "[^b]: short"];
    const told = { defined: ["b"], shortened: { name: "a", line: 3 } };

    it("passes the blank line above the label", () => {
        expect(judgeEdit(before, after, told)).toEqual({ pass: true });
    });

    // A characterization: this is what the gate said before c8-tail.
    it("control: not told, it refuses the blank line as a change to footnote a", () => {
        expect(judgeEdit(before, after, { defined: ["b"] })).toMatchObject({ pass: false, check: 1, detail: "[^a]" });
    });

    it("refuses when footnote a's text above the label changes too", () => {
        const changed = [...after.slice(0, 2), `[^a]: ${Long.replace("discursive", "short")}`, ...after.slice(3)];
        expect(judgeEdit(before, changed, told)).toMatchObject({ pass: false, check: 1, detail: "[^a]" });
    });

    it("refuses when the line it names is footnote a's own label line, not its text", () => {
        expect(judgeEdit(before, after, { defined: ["b"], shortened: { name: "a", line: 2 } })).toMatchObject({ pass: false, check: 1, detail: "[^a]" });
    });

    it("refuses when it names a footnote that does not hold the line", () => {
        expect(judgeEdit(before, after, { defined: ["b"], shortened: { name: "b", line: 3 } })).toMatchObject({ pass: false, check: 1, detail: "[^a]" });
    });
});
