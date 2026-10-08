import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes, lintNote } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (annoyance): reindex leaves the definitions out of order, with an
// alert, when putting them in order would place a short definition right
// under one longer than Obsidian's 1,024-character look-ahead.
//
// What the user would see: "Profit rates fell[^1] in the period. The
// cause is contested[^2], and so is the measure[^3].", then "[^1]: Brenner
// 2006.", a footnote 2 of about 170 words, a blank line, and "[^3]:
// Heinrich 2013.". They press the numbered key after "period", type
// "Shaikh 2016.", and save. The lint renumbers the references 1 to 4 in
// the order they appear, but leaves the definitions in the order 1, 3, 4,
// 2, and says "This note has 3 footnote definitions the lint could not
// put in order ...". Nothing is lost; the order just is not fixed.
//
// A "definition" is the "[^1]: ..." entry that holds a footnote's text,
// and its "label" is the "[^1]:" at its head. "Reindex" is the lint rule
// that renumbers footnotes 1, 2, 3 in the order they appear and reorders
// their definitions to match.
//
// The long footnotes are built in code: a sentence of 295
// characters said four times (1,185 characters on its label line), and
// "A long discursive note:" with the word "oysters" 180 times (1,470
// characters on its label line).
//
// Hunt 2026-10-08, cycle 7. Cluster Y8 (the reindex face, Y8a). A known
// item: the report of the cycle 6 fix job c6fix-B found it on 2026-10-08
// ("Not fixed", item 2) and left it without a pin; this cycle pinned it.
//
// Origin: pre-existing. More reachable since ec8d89a, which lets a press
// create a footnote after a long one at all (it puts a blank line in
// front of the new label).
//
// Source of truth: the README and CONTEXT.md (Reindex renumbers and
// reorders by appearance); docs/obsidian-reading-rules.md E4 (what may
// end a definition is looked for only within its first 1,024 characters,
// counted from the start of its label line, and a blank line ends a
// definition at any length). So the order is reachable: a blank line
// after the long definition keeps the next one a definition, as the move
// and the append already write since ec8d89a.
//
// Cause (from c6fix-B's report): reindex packs the reordered definitions
// with no blank line between them, and adds one only after a definition
// that ends in a lazy line (endsInLazyLine in
// src/linting/rewrite-document.ts; a "lazy" line carries the paragraph
// above it on without the indentation it would normally need). It never
// asks whether a definition is too long for the next label to end it, as
// labelOutrunsLookahead in
// src/linting/rules/move-footnotes-to-the-bottom.ts does for the move. The
// order it wants would turn the label under the long footnote into more of
// that footnote's text, so the change is refused and reindex holds the
// order back.

beforeEach(resetNotices);

/** The names of the definitions the note holds, in order, as the plugin's reader (the way Obsidian reads it) finds them. */
const order = (text: string) => readNote(text.split("\n")).definitions.map((d) => d.name);

describe("a press between footnotes 1 and 2, then the lint, with footnote 2 long", () => {
    // The press's settings: no end-of-word adjustment, no popup, no prefix,
    // no section heading, and no lint on creation, so the lint runs once,
    // as Ctrl+S runs it.
    const settings = {
        insertAtEndOfWord: false,
        enablePopupEditor: false,
        enableFootnotePrefix: false,
        enableFootnoteSectionHeading: false,
        footnoteSectionHeading: "",
        enableRemoveBlankLastLines: false,
        lintOnFootnoteCreation: false,
        expandSelectionToWholeWords: false,
    };
    const sentence =
        "Marx develops this point at length in the third volume, where the falling rate of profit is treated not as a law that acts directly but as a tendency, checked by counteracting causes such as the cheapening of the elements of constant capital, the relative surplus population, and foreign trade. ";
    const longBody = sentence.repeat(4).trim();

    // Before c7fix-C the definitions stayed in the order 1, 3, 4, 2, with the alert
    // "This note has 3 footnote definitions the lint could not put in
    // order ...".
    it("the lint puts the four definitions in order, all defined, and says nothing", async () => {
        const lines = [
            "Profit rates fell[^1] in the period. The cause is contested[^2], and so is the measure[^3].",
            "",
            "[^1]: Brenner 2006.",
            `[^2]: ${longBody}`,
            "",
            "[^3]: Heinrich 2013.",
        ];
        const ch = lines[0].indexOf(". The cause");
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        const pressed = doc.lines.join("\n").replace("[^4]: ", "[^4]: Shaikh 2016.");
        expect(pressed).toContain("fell[^1] in the period[^4]");
        resetNotices();
        const plugin = fakePlugin({});
        (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ file: { path: "c7 workflow.md" } }) };
        const linted = lintNote(plugin, pressed, "");
        noticeLintAlerts(plugin, linted);
        expect({ order: order(linted), alerts: messages() }, linted.replace(longBody, "<LONG>")).toEqual({ order: ["1", "2", "3", "4"], alerts: [] });
    });
});

// From the same hunt's look at the rules next to a long footnote: a new
// footnote cited first in the text, its definition appended last.
describe("reindex next to a long footnote", () => {
    const Long = `A long discursive note: ${Array.from({ length: 180 }, () => "oysters").join(" ")}.`;
    const note = ["New point[^4]. First[^1]. Second[^2]. Third[^3].", "", "[^1]: short one", `[^2]: ${Long}`, "", "[^3]: short three", "[^4]: new one"].join("\n");
    const sorted = (text: string) => order(text).sort();

    it("control: the note as written defines all four", () => {
        expect(sorted(note)).toEqual(["1", "2", "3", "4"]);
    });

    it("control: reindex alone keeps every footnote defined", () => {
        expect(sorted(reindexFootnotes(note))).toEqual(["1", "2", "3", "4"]);
    });

    // Before c7fix-C the definitions stayed in the order 2, 3, 4, 1 after the
    // references were renumbered.
    it("reindex puts the definitions in order (a blank line after the long one makes room)", () => {
        expect(order(reindexFootnotes(note))).toEqual(["1", "2", "3", "4"]);
    });

    it("the default lint keeps every footnote defined and puts them in order", () => {
        const out = lintFootnotes(note);
        expect(sorted(out)).toEqual(["1", "2", "3", "4"]);
        expect(order(out)).toEqual(["1", "2", "3", "4"]);
    });

    it("control: the default lint is idempotent", () => {
        const once = lintFootnotes(note);
        expect(lintFootnotes(once)).toBe(once);
    });
});
