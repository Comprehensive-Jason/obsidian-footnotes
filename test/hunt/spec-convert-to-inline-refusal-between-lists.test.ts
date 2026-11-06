import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

// Should one definition whose cut would join two lists stop the whole
// conversion to inline footnotes, without saying which one?
//
// Jason's ruling (2026-11-06): no. Convert skips just the footnote the result
// gate refuses, and the rest convert. The toast names what was skipped, with
// the same Skipped sentence the other skips use. The result gate is the one
// check every edit passes before it is written (ADR 0003). The note below is
// "Intro[^2].", then "- a[^1]", a blank line, "[^1]: one", a blank line,
// "- b", and "[^2]: two" at the end. Cutting [^1]'s definition would join the
// two lists into one, so [^1] stays, and [^2], which is harmless, converts.
//
// This test pinned the old behaviour as a characterization test until then:
// the whole conversion refused, and a toast that named nothing. The cut and
// the orphan rule already left just the definition whose removal would change
// the reading (Jason's decision Q2, 2026-10-05).
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L6.
//
// Source of truth: Jason's ruling of 2026-11-06, taking option (a) of this
// question, and the gate's design (Q4).

const Reason = "would change how Obsidian reads the text around it";

describe("normal to inline with one definition between two lists", () => {
    it("skips that footnote by name and converts the rest", () => {
        const result = convertNormalFootnotesToInline("Intro[^2].\n\n- a[^1]\n\n[^1]: one\n\n- b\n\n[^2]: two");
        expect(result.markdown).toBe("Intro^[two].\n\n- a[^1]\n\n[^1]: one\n\n- b");
        expect(result.converted).toBe(1);
        expect(result.references).toBe(1);
        expect(result.skipped).toEqual([{ name: "1", reason: Reason }]);
    });

    it("skips a footnote whole: none of its references change, however many it has", () => {
        const result = convertNormalFootnotesToInline("- a[^1]\n\n[^1]: one\n\n- b[^1]\n\nc[^2]\n\n[^2]: two");
        expect(result.markdown).toBe("- a[^1]\n\n[^1]: one\n\n- b[^1]\n\nc^[two]");
        expect(result.skipped).toEqual([{ name: "1", reason: Reason }]);
    });

    it("every footnote refused: the note stays as it was", () => {
        const doc = "- a[^1]\n\n[^1]: one\n\n- b";
        const result = convertNormalFootnotesToInline(doc);
        expect(result.markdown).toBe(doc);
        expect(result.converted).toBe(0);
        expect(result.skipped).toEqual([{ name: "1", reason: Reason }]);
    });

    // Either definition can go alone, because the other still stands between
    // the lists. Trying each one alone and keeping those that pass would take
    // both, and the note would come out with its lists joined.
    it("two footnotes that each pass alone but not together: the second is skipped", () => {
        const note = "- a\n\n[^1]: one\n\n[^2]: two\n\n- b\n\nc[^1] d[^2]";
        const result = convertNormalFootnotesToInline(note);
        expect(result.markdown).toBe("- a\n\n[^2]: two\n\n- b\n\nc^[one] d[^2]");
        expect(result.skipped).toEqual([{ name: "2", reason: Reason }]);
    });

    it("the skipped list stays in the note's order, with the other reasons", () => {
        const result = convertNormalFootnotesToInline("- a[^2]\n\n[^o]: orphan\n\n- b\n\n[^2]: two\n\nc[^3]\n\n[^3]: three\n\n[^q]: unused too");
        expect(result.skipped).toEqual([
            { name: "o", reason: "not referenced" },
            { name: "q", reason: "not referenced" },
        ]);
        expect(result.converted).toBe(2);
    });

    it("keeps the note's line endings", () => {
        const result = convertNormalFootnotesToInline("Intro[^2].\r\n\r\n- a[^1]\r\n\r\n[^1]: one\r\n\r\n- b\r\n\r\n[^2]: two");
        expect(result.markdown).toBe("Intro^[two].\r\n\r\n- a[^1]\r\n\r\n[^1]: one\r\n\r\n- b");
    });

    it("control: a note the gate passes converts whole, with nothing skipped", () => {
        const result = convertNormalFootnotesToInline("See[^1] and[^2].\n\n[^1]: one\n[^2]: two");
        expect(result.markdown).toBe("See^[one] and^[two].");
        expect(result.skipped).toEqual([]);
    });
});
