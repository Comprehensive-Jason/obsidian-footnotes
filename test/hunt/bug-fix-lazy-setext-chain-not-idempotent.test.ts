import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { lazyDefinitionLabelLines, underlinedDefinitionLabelLines } from "../../src/parsing/label-shapes";

// REVISED 2026-09-16 (Kimi hunt cycle 3, probed in Reading view): Obsidian
// turns a setext underline into a heading only under a ONE-line paragraph.
// "para" / "[^1]: a" / "===" / "[^2]: b" renders as a single paragraph
// with a literal "===", so BOTH labels are plain text there, not just the
// first. The first label has the underline right under it, which a blank
// line above would turn into a heading ("[^1]: a" / "===" renders as an H1
// reading "1: a"), so it is not a lazy label the fix can help; the
// underlined-label alert names it. The second is an ordinary lazy label.
// The scenario below is kept as written on 2026-09-13; the premise test
// now states the Reading-view reading.

// Scenario: a note holding "para" / "[^1]: a" / "===" / "[^2]: b", where the
// "===" line sits between two labels. Fixing the first lazy label changes
// what the "===" line means, which turns the second label lazy, and the
// rule stops before fixing that one.
//
// What the user would see: they run the lint, it reports that it linted,
// and the note still has a "[^2]: b" line showing as plain text instead of
// a footnote. They run it again and the note changes again, and the
// footnote numbers swap around on the way: the first run leaves
// "x[^2] y[^1]" and the second turns it into "x[^1] y[^2]". Only the third
// run says "No linting needed." If they have lint on save turned on, two
// saves in a row rewrite the note twice, which also means two separate
// steps to undo.
//
// Hunt: 2026-09-13
// Lens: the fix-lazy-definitions rule (idempotence and the rules it feeds).
//
// Source of truth: the rule's own invariant, asserted in
// test/fix-lazy-definitions.test.ts ("never leaves a lazy label behind" -
// its generator emits no "===" line, which is why the property never
// reached this shape); the loop comment in
// src/linting/rules/fix-lazy-definitions.ts ("Each time round, at least the
// label being aimed at becomes a definition, so this always finishes. The
// loop count is only a safety net, not what actually stops it.");
// src/linting/linter.ts's statement that the rule order is chosen so "one
// lint settles the note; the other order would need a second pass"; manual
// sheet 14 line 74 ("Lint again without undoing: 'No linting needed.'");
// the attack-surface reference's fix-lazy row, which names this exact
// attack ("a lazy label whose 'fix' changes what the line above means
// (setext heading, table, list)").
//
// Why it happens: before the fix, the "===" line closes the paragraph above
// it, so the label under the "===" starts a definition and only the first
// label is lazy. The rule counts the lazy labels once, at the start, and
// uses that count as its loop limit. After it gives the first label its
// blank line, the "===" has no paragraph left to close, so it becomes an
// ordinary line of text, and the label under it turns lazy. The loop limit
// was one, so the rule hands the note back with a lazy label still in it.
//
// How the shape gets into a note: hand-typed only. No plugin command
// produces a label directly above a "===" line.

const lazyIn = (doc: string): number[] => {
    const lines = doc.split("\n");
    return lazyDefinitionLabelLines(lines);
};

const SETEXT = ["para", "[^1]: a", "===", "[^2]: b", "", "x[^1] y[^2]"].join("\n");
const CHAIN = ["para", "[^1]: a", "===", "[^2]: b", "===", "[^3]: c", "", "x[^1] y[^2] z[^3]"].join("\n");

describe("fixing a lazy label above a setext underline makes the next label lazy", () => {
    it("before the fix, the second label is the lazy one and the first is underlined (Reading view, 2026-09-16)", () => {
        // the "===" under a two-line paragraph is literal text, so
        // "[^2]: b" under it is lazy; "[^1]: a" has the underline right
        // under it and belongs to the underlined-label alert instead
        expect(lazyIn(SETEXT)).toEqual([3]);
        const lines = SETEXT.split("\n");
        expect(underlinedDefinitionLabelLines(lines)).toEqual([1]);
    });

    it("the rule leaves no lazy label behind", () => {
        // it leaves line 4, "[^2]: b", which the fix itself turned lazy
        expect(lazyIn(fixLazyDefinitions(SETEXT))).toEqual([]);
    });

    it("the rule is idempotent: fixing twice is the same as fixing once", () => {
        const once = fixLazyDefinitions(SETEXT);
        expect(fixLazyDefinitions(once)).toBe(once);
    });

    it("a longer chain of underlines is fixed in one go too", () => {
        // two lazy labels counted at the start, three needed: "[^3]: c" is
        // still lazy when the rule gives up
        expect(lazyIn(fixLazyDefinitions(CHAIN))).toEqual([]);
    });
});

describe("the lint does not settle in one run on this shape", () => {
    it("a second lint says 'No linting needed' (sheet 14)", () => {
        const once = lintFootnotes(SETEXT);
        expect(lintFootnotes(once)).toBe(once);
    });

    it("the footnote numbers do not change between the first and second lint", () => {
        // run one hands back "x[^2] y[^1]" and run two turns it into
        // "x[^1] y[^2]", so the reference the user reads as footnote 1
        // changes under them when they lint again
        const first = lintFootnotes(SETEXT);
        const second = lintFootnotes(first);
        expect(second).toBe(first);
        expect(first).toContain("x[^1] y[^2]");
    });

    it("the longer chain settles in one run as well", () => {
        const once = lintFootnotes(CHAIN);
        expect(lintFootnotes(once)).toBe(once);
    });

    it("lint on save does not rewrite the note on the second save (former sheet 21)", () => {
        const saves = [SETEXT];
        for (let i = 0; i < 3; i++) saves.push(lintFootnotes(saves[saves.length - 1]));
        // it takes three lints to reach a note the fourth leaves alone
        expect(saves[1]).toBe(saves[2]);
    });
});

describe("the boundary: an ordinary lazy label is fixed and stays fixed", () => {
    const PLAIN = ["para", "[^1]: a", "", "x[^1]"].join("\n");

    it("a label under a plain paragraph line gets its blank line", () => {
        expect(fixLazyDefinitions(PLAIN)).toBe("para\n\n[^1]: a\n\nx[^1]");
        expect(lazyIn(fixLazyDefinitions(PLAIN))).toEqual([]);
    });

    it("and the lint settles in one run", () => {
        const once = lintFootnotes(PLAIN);
        expect(once).toBe("para\n\nx[^1]\n\n[^1]: a");
        expect(lintFootnotes(once)).toBe(once);
    });
});
