import { afterEach, describe, expect, it, vi } from "vitest";

import { lintFootnotes } from "../src/linting/linter";
import { footnoteRules } from "../src/linting/rules";

// The catalogue in src/linting/rules/index.ts lists the rules in the order
// the lint runs them, but lintFootnotes does not read the catalogue: its
// order is hand-written, with a reason at each step. This test is what keeps
// the two honest (Jason, 2026-09-09). It watches each rule's apply (the seam
// the pipeline calls through), runs a note that makes every rule act, and
// checks that the first time each rule fires matches the catalogue order.
//
// Spies on the shared rule objects work under the shared-worker vitest
// config where a module mock would not; they are restored after each test
// so later specs see the real apply.

afterEach(() => {
    vi.restoreAllMocks();
});

// A note with a job for every rule: a valid prefix to apply, a lazy label
// to fix, a duplicate definition to merge, an orphaned definition and an
// orphaned reference to delete, a reference before punctuation, definitions
// above prose that the move gathers, and numbering out of order.
const messy = [
    "---",
    "footnote-prefix: p-",
    "---",
    "",
    "[^3]: an early definition, above the prose",
    "",
    "Prose with a reference[^3]. Another[^1], and a lazy one[^2]",
    "[^2]: lazy label directly under the prose",
    "",
    "Punctuation first[^1]. Orphaned[^9] reference.",
    "",
    "[^1]: one",
    "[^1]: a duplicate of one",
    "[^7]: nobody points here",
    "",
].join("\n");

describe("the lint pipeline order", () => {
    it("runs the rules in the order the catalogue lists them", () => {
        const spies = footnoteRules.map((rule) => ({ id: rule.id, spy: vi.spyOn(rule, "apply") }));
        lintFootnotes(messy, {
            mergeDuplicateDefinitions: true,
            removeOrphanedDefinitions: true,
            removeOrphanedReferences: true,
            applyNotePrefix: true,
        });
        // every rule must have fired, or the order below proves nothing
        for (const { id, spy } of spies) {
            expect(spy.mock.invocationCallOrder.length, id).toBeGreaterThan(0);
        }
        const firstFiring = spies
            .map(({ id, spy }) => ({ id, at: spy.mock.invocationCallOrder[0] }))
            .sort((a, b) => a.at - b.at)
            .map(({ id }) => id);
        expect(firstFiring).toEqual(footnoteRules.map((rule) => rule.id));
    });

    it("runs move-to-bottom a second time after deleting orphaned references changed the note", () => {
        const moveRule = footnoteRules.find((rule) => rule.id === "move-footnotes-to-the-bottom");
        if (!moveRule) throw new Error("move-to-bottom is missing from the catalogue");
        const move = vi.spyOn(moveRule, "apply");
        lintFootnotes(messy, { removeOrphanedReferences: true });
        // the third call is the lint's last look, after reindex, at whether
        // the move would still change the note (hunt 2026-10-06, cycle 5,
        // pin bug-move-refused-then-reindex-reorders); here it would not.
        // The rules run twice, three calls each time: once with every change
        // passed, and again with each change judged, because the orphan rule
        // took a footnote out (wholeJudgmentSound in rule-gate.ts; hunt
        // 2026-10-08, cycle 6, pin bug-whole-lint-glues-reference-to-bracket).
        expect(move).toHaveBeenCalledTimes(6);
    });
});
