import { describe, expect, it } from "vitest";

import { judgeEdit } from "../../src/editor/result-gate";
import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a lazy label that fix-lazy must leave alone is held
// by the first lint and fixed by the second, so linting twice changes the
// note twice, and the second change pulls the lines under the label into
// the footnote.
//
// What the user would see: "Text[^1] here.", "[^1]: note" straight under
// it, then a code block indented under the label, then "More text[^2]."
// and its definition. The first Ctrl+S only moves [^2] past its full stop.
// The second Ctrl+S puts a blank line above "[^1]: note" and moves it to
// the bottom with the code block, so the code block leaves the body and
// becomes part of footnote 1. With "    ===" under the label instead,
// footnote 1 turns into a level 1 heading "note"; with the label under
// "2. Second point" and an indented bullet list after it, the bullets leave
// the numbered list for footnote 1.
//
// A "label" is the "[^1]:" head of a definition. A "lazy" label is one
// typed straight under a paragraph's text, which Obsidian reads as more of
// that paragraph; the lint's fix-lazy rule adds the blank line above it
// that makes it a definition.
//
// Hunt 2026-10-08, cycle 6. Cluster Z3. It shares a root with Z2
// (bug-whole-lint-loosens-list-around-lazy-label): fix-lazy and the move to
// the bottom are judged only as one net change.
//
// Origin: regression from 7790b9f (the lint's one judgment of the whole
// lint, with 87e0b19's check 5) for the code-block and list shapes, which
// lint idempotently at 7790b9f~1; the heading shape pre-existing in
// another form (X38, spec-fix-lazy-heading-inside-definition).
//
// Source of truth: Jason's ruling B6 in the result gate's stage 3 report
// (fix-lazy where the blank line would make a heading in the new footnote
// is left lazy, and the lazy-label alert names it); Jason's triage
// decision Q7 (2026-10-05, a fix-lazy that changes how the lines after the
// label read is skipped); the lint's idempotence (linter.ts: linting the
// lint's own result changes nothing, and lintNote's memo depends on it);
// the gate's own refusal of the same fix made in place (the control). Live
// Obsidian 1.14.4 (cycle 5): "[^1]: def" over "    ===" renders footnote 1
// as a level 1 heading.
//
// Cause: the lint first runs every rule with every change passed and asks
// the result gate once about the whole lint (gatedLint in
// src/linting/rule-gate.ts). In the first lint the punctuation move makes
// that one judgment refuse, so every change is judged on its own and
// fix-lazy is held. In the second lint only fix-lazy and the move are
// left, and the gate compares the note before with the note after. The
// label's lines have left the body, so check 5 (the lines around the edit
// keep their block shape) finds nothing to pair them with: in
// blockShapeVerdict's lineUp, the stretch they left behind has no lines on
// the new side, so it pairs none (pairs = min(1, was, 0) = 0). The whole
// lint passes, and fix-lazy is never judged alone.

const Heading = "Text[^1] here.\n[^1]: note\n    ===\n\nMore text[^2].\n\n[^2]: other";
const NestedList = "1. First point[^1]\n2. Second point\n[^1]: my note\n\n    - sub one\n    - sub two\n\nMore text[^2].\n\n[^2]: other";
const Code = "Text[^1] here.\n[^1]: note\n\n    ```\n    code\n    ```\n\nMore text[^2].\n\n[^2]: other";

/** Whether some line of the note starts a heading inside a footnote definition (lineBlocks: the blocks each line belongs to, a "^" marking where one starts). */
const headingInFootnote = (text: string) => readNote(text.split("\n")).lineBlocks.some((blocks) => /footnoteDefinition.*\^heading\d/.test(blocks));

describe("a lazy label fix-lazy must hold, on the second lint", () => {
    it("control: the first lint holds the label (no heading in a footnote)", () => {
        expect(headingInFootnote(lintFootnotes(Heading))).toBe(false);
    });

    it("control: the gate refuses fix-lazy's blank line in place", () => {
        const second = lintFootnotes(Heading);
        const fixed = second.replace("here.\n[^1]", "here.\n\n[^1]");
        expect(headingInFootnote(fixed)).toBe(true);
        expect(judgeEdit(second.split("\n"), fixed.split("\n"), { defined: ["1"] }).pass).toBe(false);
    });

    // Now: "Text[^1] here.\n\nMore text.[^2]\n\n[^1]: note\n    ===\n[^2]: other",
    // where "note" over "    ===" is a heading inside footnote 1.
    it("the heading shape: the second lint holds it too (ruling B6), so linting twice changes nothing", () => {
        const first = lintFootnotes(Heading);
        const second = lintFootnotes(first);
        expect(headingInFootnote(second), JSON.stringify(second)).toBe(false);
        expect(second).toBe(first);
    });

    // Now: the second lint gives "Text[^1] here.\n\nMore text.[^2]\n\n[^1]: note\n\n    ```\n    code\n    ```\n[^2]: other".
    it("the code-block shape: linting twice changes nothing", () => {
        const first = lintFootnotes(Code);
        expect(lintFootnotes(first)).toBe(first);
    });

    // Now: the second lint gives "1. First point[^1]\n2. Second point\n\nMore text.[^2]\n\n[^1]: my note\n\n    - sub one\n    - sub two\n[^2]: other":
    // the bullets under item 2 leave the numbered list for footnote 1.
    it("a lazy label under a numbered item with a list under it: linting twice changes nothing", () => {
        const first = lintFootnotes(NestedList);
        expect(lintFootnotes(first)).toBe(first);
    });

    // The same shape with ".[^2]" already in place, so a single lint has
    // only fix-lazy and the move to do. It needs no second lint to go wrong:
    // the first one takes the bullets. Suggested by the skeptic; the
    // first-lint face of the same root. Now: as the second lint above.
    it("one lint of the nested-list shape with the punctuation already right leaves the note unchanged", () => {
        const note = "1. First point[^1]\n2. Second point\n[^1]: my note\n\n    - sub one\n    - sub two\n\nMore text.[^2]\n\n[^2]: other";
        expect(lintFootnotes(note)).toBe(note);
    });
});
