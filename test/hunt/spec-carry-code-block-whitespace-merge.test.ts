import { describe, expect, it } from "vitest";

import { carriedDefinitions, planCarriedPaste } from "../../src/commands/carry-footnotes";

// Ruling (Jason, 2026-11-05, entry 1 of the spec sort): when a paste decides
// whether two definitions hold the same text, the lines of a code block are
// compared exactly, and whitespace is collapsed only everywhere else.
//
// Before, the paste collapsed every run of whitespace in a definition's text,
// code blocks included. A carried footnote whose code read "a b" was merged
// into a destination footnote whose code read "a  b" (two spaces). The pasted
// reference then showed the destination's code, and the pasted code was gone.
// Spacing is content in code: indentation that differed in Python merged too.
//
// Collapsing stays for ordinary text, so that a re-wrapped or re-indented
// definition still counts as the same one (the controls below).
//
// Hunt 2026-10-02, round 1, lens carry-plan. Cluster C25.

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("Jason's ruling 2026-11-05: code block lines are compared exactly when a paste looks for a matching definition", () => {
    it("spacing inside a line of code keeps the pasted footnote apart", () => {
        const destination = "c[^c]\n\n[^c]: code\n    ```\n    a  b\n    ```";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "    ```", "    a b", "    ```")]);
        expect(plan.body).toBe("x[^k]");
        expect(plan.reused).toBe(0);
    });

    it("indentation inside the code keeps the pasted footnote apart", () => {
        const destination = "c[^c]\n\n[^c]: code\n    ```\n    if x:\n        y\n    ```";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "    ```", "    if x:", "    y", "    ```")]);
        expect(plan.body).toBe("x[^k]");
    });

    it("a blank line inside the code keeps the pasted footnote apart", () => {
        const destination = "c[^c]\n\n[^c]: code\n    ```\n    a\n\n    b\n    ```";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "    ```", "    a", "    b", "    ```")]);
        expect(plan.body).toBe("x[^k]");
    });

    it("a line break inside the code keeps the pasted footnote apart", () => {
        const destination = "c[^c]\n\n[^c]: code\n    ```\n    a b\n    ```";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "    ```", "    a", "    b", "    ```")]);
        expect(plan.body).toBe("x[^k]");
    });

    it("a code block indented under the label counts as a code block too", () => {
        const destination = "c[^c]\n\n[^c]: code\n\n        a  b";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "", "        a b")]);
        expect(plan.body).toBe("x[^k]");
    });

    it("the same code written the same way is still reused", () => {
        const destination = "c[^c]\n\n[^c]: code\n    ```\n    a  b\n\n    c\n    ```";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: code", "    ```", "    a  b", "", "    c", "    ```")]);
        expect(plan.body).toBe("x[^c]");
        expect(plan.reused).toBe(1);
    });

    it("spacing in the ordinary text around the code still does not count", () => {
        const destination = "c[^c]\n\n[^c]: some   code\n    here\n    ```\n    a  b\n    ```\n    after  it";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: some code here", "    ```", "    a  b", "    ```", "    after it")]);
        expect(plan.body).toBe("x[^c]");
        expect(plan.reused).toBe(1);
    });

    // A copy pasted back into its own note matches the definition it was copied
    // from, wherever that sits. Its code lines come out with no container in
    // front of them, so the note's copy is compared the same way.
    it.each([
        ["at the top level", "[^k]: code\n    ```\n    a  b\n        c\n    ```"],
        ["with a tab for its indentation", "[^k]: code\n\t```\n\ta  b\n\t```"],
        ["with its fence right after the label", "[^k]: ```\n    a  b\n    ```"],
        ["with nothing on the label's line", "[^k]:\n    ```\n    a  b\n    ```"],
        ["in a quote", "> [^k]: code\n>     ```\n>     a  b\n>     ```"],
        ["in a list item", "- [^k]: code\n      ```\n      a  b\n      ```"],
    ])("a footnote whose code sits in a definition %s is reused by its own copy", (_where, definition) => {
        const note = `a[^k] b\n\n${definition}`;
        const { carried } = carriedDefinitions(note, { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const plan = planCarriedPaste(note, "a[^k]", carried, { line: 0, ch: 7 });
        expect(plan.body).toBe("a[^k]");
        expect(plan.reused).toBe(1);
    });

    it("spacing in a definition with no code still does not count", () => {
        const destination = "c[^c]\n\n[^c]: some   text\n    over two lines";
        const plan = planCarriedPaste(destination, "x[^k]", [one("k", "[^k]: some text over", "    two  lines")]);
        expect(plan.body).toBe("x[^c]");
    });
});
