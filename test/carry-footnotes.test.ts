import { describe, expect, it } from "vitest";

import {
    carriedDefinitions,
    planCarriedPaste,
    planCut,
    splitCarriedText,
    withCarriedText,
} from "../src/commands/carry-footnotes";

// Carrying footnote definitions along on copy, cut and paste (issue #59;
// Jason's rulings 2026-09-21 and 22). The first seam: which definition
// blocks a selection needs. A reference inside the selection whose
// definition sits outside it needs that definition carried; a reference
// inside a carried definition's body needs its own definition too, all the
// way down; a definition the selection already contains travels with the
// text and is not carried again. What has no definition to carry (an
// orphan, a lazy label, a definition inside a list item, which the plugin
// does not model) is reported as missing so the toast can say so.

function carry(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    return carriedDefinitions(lines.join("\n"), from, to);
}

describe("carriedDefinitions", () => {
    it("carries the definition of a reference inside the selection when its block lies outside", () => {
        expect(carry(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 })).toEqual({
            carried: [{ name: "1", lines: ["[^1]: one"] }],
            missing: [],
        });
    });

    it("does not carry a definition the selection already contains", () => {
        expect(carry(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 2, ch: 9 })).toEqual({
            carried: [],
            missing: [],
        });
    });

    it("follows references inside a carried body, in first-reference order, and stops there", () => {
        expect(
            carry(["a[^a] z[^z]", "", "[^a]: see[^b]", "[^b]: bee", "[^c]: cee", "[^z]: zed"], { line: 0, ch: 0 }, { line: 0, ch: 11 }),
        ).toEqual({
            carried: [
                { name: "a", lines: ["[^a]: see[^b]"] },
                { name: "b", lines: ["[^b]: bee"] },
                { name: "z", lines: ["[^z]: zed"] },
            ],
            missing: [],
        });
    });

    // A quoted definition comes out of its quote, continuation and all
    // (Jason, 2026-10-05, Q1: carried definitions land unwrapped).
    it("carries a multi-line block whole and a quoted definition unwrapped, with its continuation", () => {
        expect(carry(["a[^m]", "", "[^m]: first", "    second"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "m", lines: ["[^m]: first", "    second"] },
        ]);
        expect(carry(["a[^q]", "", "> [^q]: quoted", "> more"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "q", lines: ["[^q]: quoted", "more"] },
        ]);
    });

    it("reports a reference with nothing to carry: an orphan, a lazy label", () => {
        expect(carry(["a[^x]"], { line: 0, ch: 0 }, { line: 0, ch: 5 })).toEqual({ carried: [], missing: ["x"] });
        expect(carry(["a[^l]", "[^l]: lazy"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).missing).toEqual(["l"]);
    });

    // Jason's ruling 1, option a (2026-10-03): a definition in a list item
    // is carried like a quoted one. Jason, 2026-10-05, Q1: it travels as an
    // ordinary top-level definition, list marker and the item's
    // indentation taken off, and its own continuation lines indented 4, as
    // a top-level definition's are.
    it("carries an in-item definition lifted to the top level", () => {
        expect(carry(["- a[^i]", "- [^i]: in the item"], { line: 0, ch: 0 }, { line: 0, ch: 7 })).toEqual({
            carried: [{ name: "i", lines: ["[^i]: in the item"] }],
            missing: [],
        });
        expect(carry(["a[^i]", "", "10. [^i]: one", "", "        two", "    lazy"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "i", lines: ["[^i]: one", "", "    two", "lazy"] },
        ]);
        expect(carry(["a[^i]", "", "> - [^i]: one", ">       two"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "i", lines: ["[^i]: one", "    two"] },
        ]);
    });

    it("ignores a reference in protected text and one the selection cuts through", () => {
        expect(carry(["`x[^p]` y[^q]", "", "[^p]: p", "[^q]: q"], { line: 0, ch: 0 }, { line: 0, ch: 13 }).carried).toEqual([
            { name: "q", lines: ["[^q]: q"] },
        ]);
        expect(carry(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 3 }).carried).toEqual([]);
    });

    it("carries the last of duplicate definitions, the one Obsidian renders, and keeps the note's line endings out of the lines", () => {
        expect(carry(["a[^d]", "", "[^d]: one", "", "[^d]: two"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "d", lines: ["[^d]: two"] },
        ]);
        expect(carriedDefinitions("a[^1]\r\n\r\n[^1]: one", { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "1", lines: ["[^1]: one"] },
        ]);
    });
});

// The second seam: how carried definitions land in a destination note.
// An incoming definition whose body equals an existing one is merged into
// it whatever its label (Jason, 2026-09-21: "if there are identical
// footnotes, merge them"); a name the destination already uses for a
// different body is renamed, a number to the next free number, a name to
// name-2, name-3; a free name is kept. The renames reach the pasted body
// and the carried blocks alike, so the pasted footnotes come out unique
// with no setup on the user's side (the forum threads' requirement).
describe("planCarriedPaste", () => {
    const one = (name: string, ...lines: string[]) => ({ name, lines });

    it("keeps a free name and adds its definition", () => {
        expect(planCarriedPaste("x[^1]\n\n[^1]: one", "a[^2]", [one("2", "[^2]: two")])).toEqual({
            body: "a[^2]",
            definitions: [one("2", "[^2]: two")],
            added: 1,
            reused: 0,
            repointed: 0,
            renamed: 0,
            landsInProtectedText: false,
        });
    });

    it("reuses an identical definition, under the same label or another one, and points the references at it", () => {
        expect(planCarriedPaste("s[^s]\n\n[^s]: Smith 2024", "a[^s]", [one("s", "[^s]: Smith 2024")])).toMatchObject({
            body: "a[^s]",
            definitions: [],
            reused: 1,
        });
        expect(planCarriedPaste("s[^smith]\n\n[^smith]: Smith 2024", "a[^1] b[^1]", [one("1", "[^1]: Smith 2024")])).toMatchObject({
            body: "a[^smith] b[^smith]",
            definitions: [],
            reused: 1,
            renamed: 0,
            // the references were pointed at a name the note already had,
            // which the toast says (Jason's question, 2026-09-22: a second
            // paste of a renamed footnote reuses own-2 by its body)
            repointed: 1,
        });
        expect(planCarriedPaste("s[^s]\n\n[^s]: Smith 2024", "a[^s]", [one("s", "[^s]: Smith 2024")])).toMatchObject({
            reused: 1,
            repointed: 0,
        });
    });

    it("compares bodies with whitespace collapsed, continuation lines included", () => {
        const destination = "m[^m]\n\n[^m]: first\n    second";
        expect(planCarriedPaste(destination, "a[^x]", [one("x", "[^x]:  first", "     second ")])).toMatchObject({
            body: "a[^m]",
            reused: 1,
        });
    });

    it("renames a numeric name the destination uses for a different body to the next FREE number, not max plus one", () => {
        expect(planCarriedPaste("x[^1] y[^3]\n\n[^1]: one\n[^3]: three", "a[^1]", [one("1", "[^1]: uno")])).toEqual({
            body: "a[^2]",
            definitions: [one("2", "[^2]: uno")],
            added: 1,
            reused: 0,
            repointed: 0,
            renamed: 1,
            landsInProtectedText: false,
        });
    });

    it("renames a named collision to name-2, name-3, skipping names the destination already holds", () => {
        const destination = "a[^smith] b[^smith-2]\n\n[^smith]: old\n[^smith-2]: reserved";
        expect(planCarriedPaste(destination, "c[^smith]", [one("smith", "[^smith]: incoming")])).toMatchObject({
            body: "c[^smith-3]",
            definitions: [one("smith-3", "[^smith-3]: incoming")],
            renamed: 1,
        });
    });

    it("renames inside carried blocks too, so a definition citing another keeps pointing at the right one", () => {
        const destination = "d[^a] e[^b]\n\n[^a]: other a\n[^b]: other b";
        expect(planCarriedPaste(destination, "x[^a]", [one("a", "[^a]: see[^b]"), one("b", "[^b]: bee")])).toMatchObject({
            body: "x[^a-2]",
            definitions: [one("a-2", "[^a-2]: see[^b-2]"), one("b-2", "[^b-2]: bee")],
            renamed: 2,
        });
    });

    it("renames a quoted block's label and leaves references inside the body's protected text alone", () => {
        expect(planCarriedPaste("q[^q]\n\n[^q]: other", "`[^q]` a[^q]", [one("q", "> [^q]: quoted", "> more")])).toMatchObject({
            body: "`[^q]` a[^q-2]",
            definitions: [one("q-2", "> [^q-2]: quoted", "> more")],
        });
    });

    it("treats a name only referenced in the destination as taken", () => {
        expect(planCarriedPaste("orphan[^1]", "a[^1]", [one("1", "[^1]: uno")])).toMatchObject({
            body: "a[^2]",
            renamed: 1,
        });
    });
});

// The clipboard text itself, which copy and cut always write (the
// definitions ride after the selection, so a paste outside Obsidian keeps
// them; Jason, 2026-09-22), and the reading the paste fallback gives any
// clipboard that ends in definition lines, wherever it came from: a manual
// copy, or Copy with Footnotes.
describe("the clipboard text with definitions in it", () => {
    it("appends the carried blocks after one blank line, and splits them back off", () => {
        const text = withCarriedText("a[^1] b", [{ name: "1", lines: ["[^1]: one", "    more"] }]);
        expect(text).toBe("a[^1] b\n\n[^1]: one\n    more");
        expect(splitCarriedText(text)).toEqual({ body: "a[^1] b", carried: [{ name: "1", lines: ["[^1]: one", "    more"] }] });
    });

    it("keeps the body's own trailing newline count sensible and adds nothing when there is nothing to carry", () => {
        expect(withCarriedText("a[^1]\n", [{ name: "1", lines: ["[^1]: one"] }])).toBe("a[^1]\n\n[^1]: one");
        expect(withCarriedText("plain", [])).toBe("plain");
    });

    it("splits only a trailing run of definitions; a definition in the middle stays in the body", () => {
        expect(splitCarriedText("a[^1]\n\n[^1]: one\n\nmore prose[^2]\n\n[^2]: two")).toEqual({
            body: "a[^1]\n\n[^1]: one\n\nmore prose[^2]",
            carried: [{ name: "2", lines: ["[^2]: two"] }],
        });
        expect(splitCarriedText("no footnotes here")).toEqual({ body: "no footnotes here", carried: [] });
    });

    it("never reads a definition-shaped line inside a code fence as one", () => {
        const text = "a\n```\n[^1]: fake\n```";
        expect(splitCarriedText(text)).toEqual({ body: text, carried: [] });
    });
});

// Cut: the selection leaves the note with the carried definitions that
// nothing else uses once it is gone, chains included, and nothing that
// was already an orphan, that the clipboard does not carry, or that the
// deletion did not leave whole (hunt 2026-10-02: the cut used to decide
// what it deleted with a reader of its own, which disagreed with the
// clipboard's; the pins in test/hunt/bug-carry-cut-*.test.ts hold the
// shapes where that lost text). These tests were the old
// definitionsOrphanedByCut's, restated as the note the cut leaves.
describe("planCut", () => {
    const cutNames = (plan: { carried: { name: string }[] }) => plan.carried.map((block) => block.name);

    it("takes the carried blocks the deletion orphans and leaves the still-used ones, whose copy still travels", () => {
        const plan = planCut("a[^1] b[^2] c[^2]\n\n[^1]: one\n[^2]: two", { line: 0, ch: 0 }, { line: 0, ch: 12 });
        expect(cutNames(plan)).toEqual(["1", "2"]);
        expect(plan.text).toBe("c[^2]\n\n[^2]: two");
        expect(plan.removed).toBe(1);
    });

    it("follows a chain, and leaves a definition that was an orphan before the cut", () => {
        const plan = planCut("a[^a] keep\n\n[^a]: see[^b]\n[^b]: bee\n[^old]: already an orphan", { line: 0, ch: 0 }, { line: 0, ch: 5 });
        expect(plan.text).toBe(" keep\n\n[^old]: already an orphan");
        expect(plan.removed).toBe(2);
    });

    it("takes nothing when the selection holds no reference, or holds the definition itself", () => {
        const note = "plain[^1]\n\n[^1]: one";
        expect(planCut(note, { line: 0, ch: 0 }, { line: 0, ch: 5 })).toMatchObject({ carried: [], removed: 0 });
        expect(planCut(note, { line: 0, ch: 0 }, { line: 2, ch: 9 })).toMatchObject({ carried: [], removed: 0, text: "" });
    });
});
