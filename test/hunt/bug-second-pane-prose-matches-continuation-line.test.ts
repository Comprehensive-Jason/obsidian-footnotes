import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// Scenario: the note's last prose line reads the same as the last
// continuation line of a definition the lint gathers to the bottom ("Para
// two." under a definition that ends in "    Para two."), and the note is
// open in a second pane with its caret on that prose line.
//
// What the user saw: the lint in the first pane put the second pane's caret
// inside the footnote, on its continuation line at the bottom, so the next
// keystroke in that pane went into the footnote. The same shape mid-note
// mapped right.
//
// Cause: alignRun lines up the matching lines at the end of a stretch
// before the prose-first pairing runs, by text without footnotes and with
// the indentation dropped, so the prose line was taken as the same line
// as the indented continuation line. A line is now the same line only
// when it is also the same kind (prose, citation, or other).
//
// Hunt 2026-11-06, cycle 9, finding H34. Source of truth: lineMapper's
// contract (a line rewritten or shifted is still the same line) and the
// second-pane restore of 2026-09-24. Severity: annoyance. Origin:
// pre-existing (red on 5bd0908 too).

function mapper(before: string) {
    const after = lintFootnotes(before, {});
    return { after: after.split("\n"), map: lineMapper(lineDiffChanges(before, after), before) };
}

describe("a second pane's caret on a prose line that reads like a continuation line", () => {
    it("the note's last prose line equals the moved definition's last continuation line: it keeps its own line", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    Para two.\n\nPara two.";
        const { after, map } = mapper(before);
        expect(after).toEqual(["Para one.[^1]", "", "Para two.", "", "[^1]: my note", "    Para two."]);
        expect(after[map(5)]).toBe("Para two.");
        expect(after[map(3)]).toBe("    Para two.");
    });

    it("with a blank last line after the prose line", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    Para two.\n\nPara two.\n";
        const { after, map } = mapper(before);
        expect(after[map(5)]).toBe("Para two.");
    });

    it("a list item at the note's end equal to a list item inside the definition", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    - item\n\n- item";
        const { after, map } = mapper(before);
        expect(after[map(5)]).toBe("- item");
    });

    it("a fenced block at the note's end equal to a fenced block inside the definition", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    ```\n    code\n    ```\n\n```\ncode\n```";
        const { after, map } = mapper(before);
        expect(after).toEqual(["Para one.[^1]", "", "```", "code", "```", "", "[^1]: my note", "    ```", "    code", "    ```"]);
        expect([7, 8, 9].map(map).map((line) => after[line])).toEqual(["```", "code", "```"]);
    });

    it("control: the same shape mid-note maps the prose line to itself", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    Para two.\n\nPara two.\n\nPara three.";
        const { after, map } = mapper(before);
        expect(after[map(5)]).toBe("Para two.");
    });
});
