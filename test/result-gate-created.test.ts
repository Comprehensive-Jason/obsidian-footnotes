import { describe, expect, it } from "vitest";

import { EditIntent, GateReason, judgeEdit, NotePosition } from "../src/editor/result-gate";

// Check 6 of the result gate, what a press meant to create is live, on the
// notes that pinned the shared born-dead verdict it replaced
// (verifyLiveFootnoteInsertion, extracted 2026-08-25, deleted in stage 3 of
// the result gate design, 2026-10-08). Each refusal case killed a mutant the
// 2026-08-25 scoped Stryker run showed surviving when only the call sites
// were tested: the definition must start at EXACTLY the given label line
// AND take in every line written for it, and EVERY reference must read at
// EXACTLY its place under EXACTLY the given name. Those cases accept
// either "dead" or "protected": both refuse, and which one a shape gives
// only picks the notice (refusedCreation in create-footnote.ts; the two
// were the same notice until 2026-10-08).
//
// Each case spells out the note as the press leaves it: "alpha bravo", "",
// "tail" with "[^1]" written after "alpha" and "\n\n[^1]: " appended after
// "tail", the label on line 4.

const BEFORE = ["alpha bravo", "", "tail"];
const FINAL = ["alpha[^1] bravo", "", "tail", "", "[^1]: "];

/** A press of footnote `name` with references at `references` and a definition of `lines` lines on `line`. */
function created(name: string, references: NotePosition[], line: number, lines = 1): EditIntent {
    return { created: [{ kind: "footnote", name, references, definition: { line, lines } }] };
}

function reasonOf(before: string[], after: string[], intent: EditIntent): GateReason | "pass" {
    const verdict = judgeEdit(before, after, intent);
    return verdict.pass ? "pass" : verdict.reason;
}

const DEAD = ["dead", "protected"];

describe("check 6 on the born-dead verdict's notes", () => {
    it("a live reference with its live definition passes", () => {
        expect(reasonOf(BEFORE, FINAL, created("1", [{ line: 0, ch: 5 }], 4))).toBe("pass");
    });

    it("refuses when no definition starts at the given label line", () => {
        // the label really sits on line 4 - a block that merely ENDS past
        // line 3 must not count as starting there
        expect(DEAD).toContain(reasonOf(BEFORE, FINAL, created("1", [{ line: 0, ch: 5 }], 3)));
    });

    it("a written continuation line the definition takes in passes", () => {
        expect(reasonOf(BEFORE, ["alpha[^1] bravo", "", "tail", "", "[^1]: one", "    two"], created("1", [{ line: 0, ch: 5 }], 4, 2))).toBe("pass");
    });

    it("refuses when a written body line falls OUT of the definition", () => {
        // the second body line is a heading, which no definition can take
        // in - the definition ends on the label line
        expect(DEAD).toContain(reasonOf(BEFORE, ["alpha[^1] bravo", "", "tail", "", "[^1]: one", "# two"], created("1", [{ line: 0, ch: 5 }], 4, 2)));
    });

    it("refuses a reference landing inside inline code", () => {
        expect(DEAD).toContain(reasonOf(["alpha `code` bravo", "", "tail"], ["alpha `c[^1]ode` bravo", "", "tail", "", "[^1]: "], created("1", [{ line: 0, ch: 8 }], 4)));
    });

    it("one dead landing refuses the lot - EVERY reference must be live", () => {
        const before = ["alpha bravo", "`code x`", "tail"];
        const after = ["alpha[^1] bravo", "`co[^1]de x`", "tail", "", "[^1]: "];
        expect(DEAD).toContain(reasonOf(before, after, created("1", [{ line: 0, ch: 5 }, { line: 1, ch: 3 }], 4)));
    });

    it("refuses when the reference does not sit EXACTLY at its place", () => {
        // a leading space: the reference reads one column past where the
        // press said it wrote it, which is not the insertion promised
        expect(DEAD).toContain(reasonOf(BEFORE, ["alpha [^1] bravo", "", "tail", "", "[^1]: "], created("1", [{ line: 0, ch: 5 }], 4)));
    });

    it("refuses when the reference read there is not the promised name", () => {
        expect(DEAD).toContain(reasonOf(BEFORE, ["alpha[^2] bravo", "", "tail", "", "[^1]: "], created("1", [{ line: 0, ch: 5 }], 4)));
    });

    it("a live reference that landed inside another definition is nested (ADR 0001)", () => {
        // the empty line under "[^1]: one" was filled by the reference, so
        // it reads as footnote 1's lazy continuation, prose and all (hunt
        // 2026-10-02, pin bug-press-blank-line-under-definition-nests)
        const before = ["Text[^1] here.", "", "[^1]: one", "", "More prose."];
        const after = ["Text[^1] here.", "", "[^1]: one", "[^2]", "More prose.", "", "[^2]: "];
        expect(reasonOf(before, after, created("2", [{ line: 3, ch: 0 }], 6))).toBe("nested");
    });
});
