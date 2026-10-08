import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../src/linting/rules/move-footnotes-to-the-bottom";

// The move puts a blank line between two definitions it gathers when the
// first is too long for the second's label to end it. Obsidian looks for
// what ends a definition only within its first 1,024 characters, so a label
// packed right under a longer one reads as more of its text
// (docs/obsidian-reading-rules.md E4). Before, the gate refused the move,
// and the definitions stayed where they were (found while fixing hunt
// 2026-10-08, cycle 6, cluster Z8; the append's side is pinned by
// bug-press-after-long-footnote-refused).

const sentence =
    "Marx develops this point at length in the third volume, where the falling rate of profit is treated not as a law that acts directly but as a tendency, checked by counteracting causes such as the cheapening of the elements of constant capital, the relative surplus population, and foreign trade. ";
// Four sentences: about 1,170 characters on the label line.
const longBody = sentence.repeat(4).trim();

describe("the move after a definition longer than 1,024 characters", () => {
    it("gathers the next definition under it with a blank line between", () => {
        const note = `One[^1] and two[^2].\n\n[^1]: ${longBody}\n\nMore text.\n\n[^2]: Capital, vol. 3.`;
        expect(moveFootnoteDefinitionsToBottom(note)).toBe(`One[^1] and two[^2].\n\nMore text.\n\n[^1]: ${longBody}\n\n[^2]: Capital, vol. 3.`);
    });

    it("leaves a note it gathered that way as it is", () => {
        const note = `One[^1] and two[^2].\n\nMore text.\n\n[^1]: ${longBody}\n\n[^2]: Capital, vol. 3.`;
        expect(moveFootnoteDefinitionsToBottom(note)).toBe(note);
    });

    it("control: packs a short definition label to label", () => {
        const note = "One[^1] and two[^2].\n\n[^1]: Heinrich 2013.\n\nMore text.\n\n[^2]: Capital, vol. 3.";
        expect(moveFootnoteDefinitionsToBottom(note)).toBe("One[^1] and two[^2].\n\nMore text.\n\n[^1]: Heinrich 2013.\n[^2]: Capital, vol. 3.");
    });
});
