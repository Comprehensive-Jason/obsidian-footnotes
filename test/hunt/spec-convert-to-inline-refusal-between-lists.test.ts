import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

// spec question: should one definition whose cut would join two lists stop
// the whole conversion to inline footnotes, without saying which one?
//
// What it does now: "Intro[^2].", then "- a[^1]", a blank line, "[^1]:
// one", a blank line, "- b", and "[^2]: two" at the end. Cutting [^1]'s
// definition would join the two lists into one, so the whole conversion is
// refused: nothing is converted, and the toast says "Converting would
// change how Obsidian reads the text around a footnote. Convert it by
// hand." without naming the footnote.
// What a user might expect: [^2], which is harmless, converted, and [^1]
// skipped by name in the toast's list of skipped footnotes. Since Jason's
// decision Q2 (2026-10-05), the orphan rule and a cut already leave just
// the definition whose removal would change the reading, and take the rest.
// Why it is a question and not a bug: the conversion's comment says it is
// "refused whole rather than half done" on purpose.
//
// Options:
//   (a) skip [^1] by name, with the reason, and convert the rest
//       (recommended: it matches what the cut and the orphan rule do since
//       Q2, and the user learns which footnote to look at);
//   (b) keep refusing the whole conversion, but name the footnote in the
//       toast;
//   (c) leave it as it is.
// The test below takes option (a).
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L6.
//
// Origin: pre-existing (cec4352 refuses the same way).
//
// Source of truth: convertNormalFootnotesToInline in
// src/commands/convert-footnotes.ts ("refused whole rather than half
// done"); Jason's decision Q2 (2026-10-05) for the cut and the orphan rule.

describe("spec question: normal to inline with one definition between two lists", () => {
    // Now: refused, 0 converted.
    it.fails("converts the harmless footnote and skips the one between the lists, by name", () => {
        const doc = "Intro[^2].\n\n- a[^1]\n\n[^1]: one\n\n- b\n\n[^2]: two";
        const result = convertNormalFootnotesToInline(doc);
        expect(result.refused).toBeUndefined();
        expect(result.converted).toBe(1);
        expect(result.skipped.map((s) => s.name)).toEqual(["1"]);
    });
});
