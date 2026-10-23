import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { lintFootnotes } from "../src/linting/linter";
import { planFootnoteRename } from "../src/commands/rename-footnote";

// Manual sheet 14, "definition labels directly after a prose line".
//
// A footnote definition cannot interrupt a paragraph: a "[^x]:" line
// written directly under a prose line is lazy paragraph text to Obsidian,
// and the sheet's fixtures are the seven shapes where that happens plus
// five controls where the label really does open a definition. What
// Obsidian PAINTS for those twelve is ground truth only a person can read,
// so the sheet keeps its two Reading-view checks. Everything else the sheet
// asked for is text: what a hotkey press does at each fixture, what the
// lint writes with the fix toggle on and off, and the exact alert. Those
// are the checks this file takes over.
//
// Sheet items replaced (the sheet's own order):
//   "The plugin agrees" box 1: a press inside each prose fixture's
//       reference appends a real definition and never jumps to the label
//   "The plugin agrees" box 2: a press on the "[^p1]:" label line, and
//       Rename footnote with the caret inside that line's "[^p1]"
//   "The plugin agrees" box 3: a press inside [^c1] through [^c5]
//       navigates, and on their label lines jumps back to the reference
//   "The plugin agrees" box 4: Lint footnotes with the fix toggle on
//   "The plugin agrees" box 5: linting again says "No linting needed."
//   "The plugin agrees" box 6: linting with move-to-bottom off
//   "With the fix toggle OFF" boxes 1 to 4: the lint output, the one alert
//       naming all seven labels, the surviving references with orphan
//       deletion on, the hand-added blank line, and the press at the end
//       of the callout body line
//
// The document below is the sheet's own fixture and control sections, in
// the sheet's order and wording. The sheet's prose around them (its
// headings and checkbox lines) is left out: it holds no live footnote, so
// it changes none of the outcomes here.

const LINES = [
    "## Fixtures (label directly under prose, no blank line: prose to Obsidian)",
    "",
    "After a paragraph line, reference before it, alpha[^p1] here:",
    "para line",
    "[^p1]: after a paragraph",
    "",
    "After a paragraph line, reference after it:",
    "para line",
    "[^p2]: after a paragraph again",
    "",
    "use it here[^p2] too.",
    "",
    "After a list item, bravo[^l1] here:",
    "- item",
    "[^l1]: after a list item",
    "",
    "After a quote line, charlie[^q1] here:",
    "> quote",
    "[^q1]: after a quote line",
    "",
    "Inside a callout, under its body line, delta[^cb] here:",
    "> [!note]",
    "> callout body",
    "> [^cb]: under the callout body",
    "",
    "Two labels under a paragraph, echo[^d1] and foxtrot[^d2] here:",
    "[^d2]: first label",
    "[^d1]: second label",
    "",
    "## Controls (definitions to Obsidian)",
    "",
    "After a blank line, golf[^c1] here:",
    "",
    "[^c1]: after a blank line",
    "",
    "After a heading, hotel[^c2] here:",
    "# Heading line",
    "[^c2]: after a heading",
    "",
    "After a closed fence, india[^c3] here:",
    "```",
    "code",
    "```",
    "[^c3]: after a closed fence",
    "",
    "Inside a callout, right under its title line, juliet[^c4] here:",
    "> [!note]",
    "> [^c4]: under the callout title",
    "",
    "Inside a quote after a blank quote line, kilo[^c5] here:",
    "> quote body",
    ">",
    "> [^c5]: after the quote's blank line",
];
const SHEET = LINES.join("\n");

// the sheet's settings line: defaults, so both Orphans toggles and Merge
// duplicate definitions are off, the lazy fix and move-to-bottom are on,
// and the popup is off
const PRESS_SETTINGS = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** the line the note's last column-0 definition sits on, "[^c3]: after a closed fence" */
const LAST_DEFINITION_LINE = LINES.indexOf("[^c3]: after a closed fence");

/** run the numbered hotkey at one caret and hand back the editor it acted on */
async function press(line: number, ch: number) {
    const doc = fakeEditor(LINES, {
        cursor: { line, ch },
        edits: true,
        wholeDoc: true,
    });
    await insertAutonumFootnote(fakePlugin(PRESS_SETTINGS, doc));
    return doc;
}

/** the line holding a footnote's reference in the sheet's prose, and a caret inside its brackets */
function referenceCaret(name: string): { line: number; ch: number } {
    const line = LINES.findIndex(
        (text) =>
            !text.replace(/^> ?/, "").startsWith(`[^${name}]:`) &&
            text.includes(`[^${name}]`),
    );
    return { line, ch: LINES[line].indexOf(`[^${name}]`) + 3 };
}

/** the line holding a footnote's own "[^x]:" label, and a caret inside its brackets */
function labelCaret(name: string): { line: number; ch: number } {
    const line = LINES.findIndex((text) =>
        text.replace(/^> ?/, "").startsWith(`[^${name}]:`),
    );
    return { line, ch: LINES[line].indexOf(`[^${name}]`) + 3 };
}

const LAZY = ["p1", "p2", "l1", "q1", "cb", "d1", "d2"];
const CONTROLS = ["c1", "c2", "c3", "c4", "c5"];

beforeEach(resetNotices);

describe("a press inside a prose fixture's reference builds the definition it is missing", () => {
    // Sheet: "Hotkey inside [^p1] (and any of the seven prose fixtures):
    // the reference has no definition, so the press APPENDS a real [^p1]:
    // definition at the bottom ... it never jumps to the label line".
    // "At the bottom" is the note's definition group, which here is the run
    // of column-0 definitions ending in "[^c3]:" (issue #55: a new
    // definition joins the existing group rather than the very last line).
    it.each(LAZY)("[^%s]", async (name) => {
        const caret = referenceCaret(name);
        const doc = await press(caret.line, caret.ch);
        expect(doc.lines[LAST_DEFINITION_LINE + 1]).toBe(`[^${name}]: `);
        // the lazy label is still there: the note now holds both
        expect(doc.lines.filter((text) => text.includes(`[^${name}]:`))).toHaveLength(2);
        // nothing was navigated to, least of all the lazy label line
        expect(doc.moves).toEqual([]);
        expect(doc.cursor).toEqual({
            line: LAST_DEFINITION_LINE + 1,
            ch: `[^${name}]: `.length,
        });
    });
});

describe("a press on a prose fixture's own label line", () => {
    // The sheet (2026-09-09) says "Hotkey on the [^p1]: line: a plain
    // insert as well". Jason's ruling of 2026-09-15 changed that: a lazy
    // label is treated as the definition the user meant, so the press
    // behaves as it would on a real definition label and jumps to the
    // footnote's reference in the text. See
    // test/hunt/spec-lazy-label-press-navigates.ts and
    // test/hunt/bug-cmd-lazy-label-caret.ts. The sheet's sentence is the
    // one out of date, so the test below carries it.fails and the next
    // test pins what the press really does.

    it.each(LAZY)("[^%s]: jumps to the footnote's reference in the prose instead", async (name) => {
        const caret = labelCaret(name);
        const reference = referenceCaret(name);
        const doc = await press(caret.line, caret.ch);
        expect(doc.transactions).toBe(0);
        expect(doc.lines.join("\n")).toBe(SHEET);
        expect(doc.moves).toEqual([
            {
                line: reference.line,
                ch: LINES[reference.line].indexOf(`[^${name}]`) + `[^${name}]`.length,
            },
        ]);
    });
});

describe("Rename footnote from inside a lazy label's own brackets", () => {
    // Sheet: "Rename footnote with the caret inside that line's [^p1]: it
    // RENAMES (a lazy label's own [^p1] is a live reference), so the label
    // line and the alpha reference change together".
    it("rewrites the prose reference and the label line together", () => {
        const doc = fakeEditor(LINES, { wholeDoc: true });
        const plan = planFootnoteRename(doc, "p1", "pOne");
        expect(plan.kind).toBe("renamed");
        if (plan.kind !== "renamed") return;
        expect(plan.count).toBe(2);
        expect(plan.changes.map((change) => change.from.line)).toEqual([
            referenceCaret("p1").line,
            labelCaret("p1").line,
        ]);
        expect(plan.changes.every((change) => change.text === "pOne")).toBe(true);
    });
});

describe("a press at a control's reference and at its label", () => {
    // Sheet: "Hotkey inside [^c1] through [^c5]: navigates to the
    // definition (or opens the popup); on their label lines it jumps back
    // to the reference". The popup is off in the sheet's settings, so the
    // press jumps both ways here.
    it.each(CONTROLS)("[^%s]: the reference jumps to the definition", async (name) => {
        const caret = referenceCaret(name);
        const doc = await press(caret.line, caret.ch);
        expect(doc.transactions).toBe(0);
        expect(doc.moves).toHaveLength(1);
        expect(doc.moves[0].line).toBe(labelCaret(name).line);
    });

    it.each(CONTROLS)("[^%s]: the label jumps back to the reference", async (name) => {
        const caret = labelCaret(name);
        const doc = await press(caret.line, caret.ch);
        expect(doc.transactions).toBe(0);
        expect(doc.moves).toEqual([
            {
                line: referenceCaret(name).line,
                ch: LINES[referenceCaret(name).line].indexOf(`[^${name}]`) + `[^${name}]`.length,
            },
        ]);
    });
});

// the note as the lint hands it back with the fix toggle on: the six
// column-0 labels have become definitions and gathered at the bottom with
// the three column-0 controls, "[^cb]:" has its bare ">" and stays inside
// the callout, and the two quoted controls have not moved
const FIXED = [
    "## Fixtures (label directly under prose, no blank line: prose to Obsidian)",
    "",
    "After a paragraph line, reference before it, alpha[^p1] here:",
    "para line",
    "",
    "After a paragraph line, reference after it:",
    "para line",
    "",
    "use it here[^p2] too.",
    "",
    "After a list item, bravo[^l1] here:",
    "- item",
    "",
    "After a quote line, charlie[^q1] here:",
    "> quote",
    "",
    "Inside a callout, under its body line, delta[^cb] here:",
    "> [!note]",
    "> callout body",
    ">",
    "> [^cb]: under the callout body",
    "",
    "Two labels under a paragraph, echo[^d1] and foxtrot[^d2] here:",
    "",
    "## Controls (definitions to Obsidian)",
    "",
    "After a blank line, golf[^c1] here:",
    "",
    "After a heading, hotel[^c2] here:",
    "# Heading line",
    "",
    "After a closed fence, india[^c3] here:",
    "```",
    "code",
    "```",
    "",
    "Inside a callout, right under its title line, juliet[^c4] here:",
    "> [!note]",
    "> [^c4]: under the callout title",
    "",
    "Inside a quote after a blank quote line, kilo[^c5] here:",
    "> quote body",
    ">",
    "> [^c5]: after the quote's blank line",
    "",
    "[^p1]: after a paragraph",
    "[^p2]: after a paragraph again",
    "[^l1]: after a list item",
    "[^q1]: after a quote line",
    "[^d1]: second label",
    "[^d2]: first label",
    "[^c1]: after a blank line",
    "[^c2]: after a heading",
    "[^c3]: after a closed fence",
].join("\n");

describe("Lint footnotes with the fix toggle on (its default)", () => {
    it("gives every hidden definition the line it was missing and gathers the column-0 ones", () => {
        expect(lintFootnotes(SHEET)).toBe(FIXED);
    });

    it("inserts six lines in all, one of them a bare quote marker", () => {
        // counted where they land, before the move rule carries the
        // definitions off: a blank above "[^p1]:", "[^p2]:", "[^l1]:",
        // "[^q1]:" and "[^d2]:", and a bare ">" above "> [^cb]:".
        // "[^d1]:" needs nothing once "[^d2]:" above it is a definition.
        const inPlace = lintFootnotes(SHEET, {
            moveDefinitionsToBottom: false,
            reindex: false,
        }).split("\n");
        expect(inPlace).toHaveLength(LINES.length + 6);
        for (const name of ["p1", "p2", "l1", "q1", "d2"]) {
            const at = inPlace.findIndex((text) => text.startsWith(`[^${name}]:`));
            expect(inPlace[at - 1]).toBe("");
        }
        const cb = inPlace.findIndex((text) => text.startsWith("> [^cb]:"));
        expect(inPlace[cb - 1]).toBe(">");
        // "[^d1]:" follows "[^d2]:" with nothing inserted between them
        expect(inPlace[inPlace.indexOf("[^d2]: first label") + 1]).toBe("[^d1]: second label");
    });

    it("raises no lazy-definition alert and no missing-definition alert", () => {
        noticeLintAlerts(fakePlugin({}), lintFootnotes(SHEET));
        expect(messages()).toEqual([]);
    });

    it("linting again changes nothing, which is what 'No linting needed.' reports", () => {
        expect(lintFootnotes(FIXED)).toBe(FIXED);
    });
});

describe("Lint footnotes with move-to-bottom off", () => {
    // Sheet: "the seven labels stay where they are, each one line further
    // down". Six of them do. The two labels under ONE paragraph swap:
    // reindex, which is on by default, puts a paragraph's definitions into
    // the order their references appear in, and "echo[^d1] and
    // foxtrot[^d2]" references d1 first. So "[^d2]: first label" and
    // "[^d1]: second label" come back the other way round.
    const inPlace = () =>
        lintFootnotes(SHEET, { moveDefinitionsToBottom: false }).split("\n");

    it("the five single labels stay put, one line further down", () => {
        const lines = inPlace();
        for (const name of ["p1", "p2", "l1", "q1"]) {
            const at = lines.findIndex((text) => text.startsWith(`[^${name}]:`));
            expect(at).toBe(LINES.findIndex((text) => text.startsWith(`[^${name}]:`)) + countInsertedAbove(name));
            expect(lines[at - 1]).toBe("");
        }
        expect(lines.findIndex((text) => text.startsWith("> [^cb]:"))).toBeGreaterThan(0);
    });

    it("the pair under one paragraph comes back in reference order", () => {
        const lines = inPlace();
        expect(lines.indexOf("[^d1]: second label")).toBeLessThan(
            lines.indexOf("[^d2]: first label"),
        );
        // with reindex off as well, the pair keeps the order it was typed in
        const noReindex = lintFootnotes(SHEET, {
            moveDefinitionsToBottom: false,
            reindex: false,
        }).split("\n");
        expect(noReindex.indexOf("[^d2]: first label")).toBeLessThan(
            noReindex.indexOf("[^d1]: second label"),
        );
    });
});

/** how many inserted lines sit above this label by the time the lint is done */
function countInsertedAbove(name: string): number {
    const order = ["p1", "p2", "l1", "q1"];
    return order.indexOf(name) + 1;
}

const ALERT =
    'Obsidian reads "[^p1]:", "[^p2]:", "[^l1]:", "[^q1]:", "[^cb]:", "[^d2]:", and "[^d1]:" as plain text, not as footnote definitions. Put a blank line above each.';

describe("Lint footnotes with the fix toggle off", () => {
    const off = () => lintFootnotes(SHEET, { fixLazyDefinitions: false });

    it("leaves the seven prose fixtures exactly where they are", () => {
        const lines = off().split("\n");
        for (const name of LAZY) {
            const source = LINES.findIndex((text) =>
                text.replace(/^> ?/, "").startsWith(`[^${name}]:`),
            );
            expect(lines[source]).toBe(LINES[source]);
        }
    });

    it("gathers the three column-0 controls and leaves the two quoted ones", () => {
        const lines = off().split("\n");
        expect(lines.slice(-3)).toEqual([
            "[^c1]: after a blank line",
            "[^c2]: after a heading",
            "[^c3]: after a closed fence",
        ]);
        expect(lines).toContain("> [^c4]: under the callout title");
        expect(lines).toContain("> [^c5]: after the quote's blank line");
    });

    it("raises ONE alert naming all seven labels in first-appearance order", () => {
        noticeLintAlerts(fakePlugin({ lintFixLazyDefinitions: false }), off());
        expect(messages()).toEqual([ALERT]);
    });

    it("keeps those seven out of the missing-definition alert", () => {
        noticeLintAlerts(fakePlugin({ lintFixLazyDefinitions: false }), off());
        expect(messages().some((text) => text.includes("with no definition"))).toBe(false);
    });

    it("with Delete orphaned references on, the seven references survive and the alert repeats", () => {
        const deleted = lintFootnotes(SHEET, {
            fixLazyDefinitions: false,
            removeOrphanedReferences: true,
        });
        expect(deleted).toBe(off());
        noticeLintAlerts(
            fakePlugin({ lintFixLazyDefinitions: false, lintDeleteOrphanedReferences: true }),
            deleted,
        );
        expect(messages()).toEqual([ALERT]);
    });

    it("a blank line added above [^p1] by hand takes it out of the alert and gathers it", () => {
        const byHand = [...LINES];
        byHand.splice(LINES.indexOf("[^p1]: after a paragraph"), 0, "");
        const linted = lintFootnotes(byHand.join("\n"), { fixLazyDefinitions: false });
        expect(linted.split("\n").slice(-4)).toEqual([
            "[^p1]: after a paragraph",
            "[^c1]: after a blank line",
            "[^c2]: after a heading",
            "[^c3]: after a closed fence",
        ]);
        noticeLintAlerts(fakePlugin({ lintFixLazyDefinitions: false }), linted);
        expect(messages()).toEqual([
            'Obsidian reads "[^p2]:", "[^l1]:", "[^q1]:", "[^cb]:", "[^d2]:", and "[^d1]:" as plain text, not as footnote definitions. Put a blank line above each.',
        ]);
    });
});

describe("a press at the end of the callout's body line", () => {
    // Sheet: "Put the caret at the end of '> callout body' and press the
    // numbered hotkey: the new definition lands at the bottom under a
    // blank line (never glued to the line above it)".
    it("puts the reference in the callout and the definition in the note's definition group", async () => {
        const body = LINES.indexOf("> callout body");
        const doc = await press(body, LINES[body].length);
        expect(doc.lines[body]).toBe("> callout body[^1]");
        // the definition joins the column-0 group, one line below the last
        // definition already there, and nothing is glued to the callout
        expect(doc.lines[LAST_DEFINITION_LINE + 1]).toBe("[^1]: ");
        expect(doc.lines[body + 1]).toBe("> [^cb]: under the callout body");
    });
});
