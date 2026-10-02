import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: should whitespace inside a fenced code block (a block of
// code between ``` lines) count when the paste decides two definitions
// hold the same text?
//
// What it does now: before comparing, the paste collapses every run of
// whitespace in a definition's text to one space, code blocks included. A
// carried footnote whose code reads "a b" is merged into a destination
// footnote whose code reads "a  b" (two spaces), and the pasted reference
// now shows the destination's code.
// What a user might expect: inside code, spacing is part of the content,
// so the two footnotes differ and the carried one lands as its own
// definition.
// Why it is a question and not a bug: the merge rule says "whitespace
// collapsed" on purpose, so that a re-wrapped or re-indented definition
// still counts as the same one. Whether code blocks are an exception is a
// product decision for Jason.
//
// Hunt 2026-10-02, round 1, lens carry-plan. Cluster C25.
//
// Source of truth: planCarriedPaste's docstring, "a definition whose body,
// whitespace collapsed, equals an existing definition's is merged into
// it", and CommonMark, where the text of a code block is kept exactly as
// written.

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("spec question: whitespace inside a fenced code block in a definition", () => {
    it.fails("is significant, so bodies differing only there are not merged", () => {
        const destination = "c[^c]\n\n[^c]: code\n    ```\n    a  b\n    ```";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "    ```", "    a b", "    ```")]);
        expect(plan.body).toBe("x[^k]");
    });
});
