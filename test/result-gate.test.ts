import { readdirSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { docArb } from "./arbitraries";
import { CreatedFootnote, EditIntent, GateReason, judgeEdit, NotePosition, NoteRange } from "../src/editor/result-gate";

// The result gate (src/editor/result-gate.ts, ADR 0003): a note compared
// with itself always passes, and each of the six checks has a refusing and
// a passing example. Where an example comes from a pin, the pin is named.

/** The gate's verdict on `before` turned into `after` by an action meaning `intent`. */
function judged(before: string[], after: string[], intent: EditIntent = {}) {
    return judgeEdit(before, after, intent);
}

/** The reason the gate gives, or "pass". */
function reasonOf(before: string[], after: string[], intent: EditIntent = {}): GateReason | "pass" {
    const verdict = judged(before, after, intent);
    return verdict.pass ? "pass" : verdict.reason;
}

/** A numbered press: footnote `name` with its reference at `line`, `ch` and an empty definition on `defLine`. */
function press(name: string, line: number, ch: number, defLine: number): EditIntent {
    const at: NotePosition = { line, ch };
    const footnote: CreatedFootnote = { kind: "footnote", name, references: [at], definition: { line: defLine, lines: 1 } };
    return { created: [footnote] };
}

describe("a note compared with itself", () => {
    it("passes for every note saved with Obsidian's answers", () => {
        const dir = new URL("./obsidian-answers/", import.meta.url);
        let notes = 0;
        for (const file of readdirSync(dir)) {
            if (!file.endsWith(".json")) continue;
            const answers = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as { id: string; text: string }[];
            for (const { id, text } of answers) {
                const lines = text.split("\n");
                const verdict = judgeEdit(lines, [...lines], {});
                if (!verdict.pass) expect.fail(`${id}: ${JSON.stringify(verdict)}`);
                notes++;
            }
        }
        expect(notes).toBeGreaterThan(1000);
        // about 6,000 notes, each read once: a few seconds on a busy machine
    }, 60_000);

    it("passes for every note the property generator makes", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const lines = doc.split("\n");
                expect(judgeEdit(lines, [...lines], {})).toEqual({ pass: true });
            }),
            { numRuns: 300 },
        );
    });
});

describe("check 6: what the action meant to create is live", () => {
    it("passes a numbered press at the end of a sentence", () => {
        expect(reasonOf(["Some text."], ["Some text.[^1]", "", "[^1]: "], press("1", 0, 10, 2))).toBe("pass");
    });

    it("refuses a reference a line-initial colon turns into a lazy label (pin bug-colon-line-start-label)", () => {
        expect(reasonOf(["para", ":smile: done"], ["para", "[^1]:smile: done", "", "[^1]: "], press("1", 1, 0, 3))).toBe("formatting");
    });

    it("refuses a placeholder that a name would turn into a label (pin bug-colon-line-start-label)", () => {
        expect(reasonOf([":smile: done"], ["[^]:smile: done"], { created: [{ kind: "placeholder", text: "[^]", at: [{ line: 0, ch: 0 }] }] })).toBe("formatting");
        expect(reasonOf(["Some text"], ["Some text[^]"], { created: [{ kind: "placeholder", text: "[^]", at: [{ line: 0, ch: 9 }] }] })).toBe("pass");
    });

    it("refuses a reference that fills the blank line under a definition (pin bug-press-blank-line-under-definition-nests)", () => {
        const before = ["Text[^a]", "", "[^a]: alpha", ""];
        const after = ["Text[^a]", "", "[^a]: alpha", "[^1]", "", "[^1]: "];
        expect(reasonOf(before, after, press("1", 3, 0, 5))).toBe("nested");
    });

    it("refuses a reference Obsidian reads as part of a link (Jason's ruling on the link notice, 2026-10-04)", () => {
        expect(reasonOf(["See [sic] here"], ["See [sic][^1] here", "", "[^1]: "], press("1", 0, 9, 2))).toBe("link");
    });

    it("refuses a definition appended into a code fence that never closes", () => {
        expect(reasonOf(["text", "```"], ["text[^1]", "```", "", "[^1]: "], press("1", 0, 4, 3))).toBe("protected");
    });

    it("passes an inline footnote and refuses one that lands inside code", () => {
        const inline = (line: number, ch: number): EditIntent => ({ created: [{ kind: "inline", text: "^[]", at: [{ line, ch }] }] });
        expect(reasonOf(["Some text"], ["Some text^[]"], inline(0, 9))).toBe("pass");
        expect(reasonOf(["Some `code` here"], ["Some `co^[]de` here"], inline(0, 8))).toBe("protected");
    });
});

describe("check 2: no footnote inside a footnote that was not there before (ADR 0001)", () => {
    it("refuses an edit that pulls a reference into the definition above it", () => {
        const before = ["Text[^1]", "", "[^1]: one", "", "More[^2]", "", "[^2]: two"];
        const after = ["Text[^1]", "", "[^1]: one", "More[^2]", "", "[^2]: two"];
        expect(reasonOf(before, after)).toBe("nested");
    });

    it("passes an edit elsewhere in a note that already holds a footnote inside a footnote", () => {
        const before = ["Text[^1]", "", "[^1]: one[^2]", "[^2]: two", "", "tail"];
        const after = ["Text[^1]", "", "[^1]: one[^2]", "[^2]: two", "", "tail!"];
        expect(reasonOf(before, after)).toBe("pass");
    });
});

describe("check 3: protected text reads the same", () => {
    it("refuses an edit that leaves a code fence open over the rest of the note", () => {
        const before = ["```", "code", "```", "text[^1]", "", "[^1]: a"];
        const after = ["```", "code", "text[^1]", "", "[^1]: a"];
        expect(reasonOf(before, after)).toBe("protected");
    });

    it("refuses a merge whose \"$$\" line opens a math block over the lines after it (pin bug-end-dollar-line-swallows-definition)", () => {
        const before = ["A[^a] B[^b]", "", "[^a]: one", "", "[^b]: two", "    $$"];
        const after = ["A[^a] B[^b]", "", "[^b]: two", "    $$", "", "[^a]: one"];
        expect(reasonOf(before, after)).not.toBe("pass");
    });

    it("passes the lint's move of a definition that holds inline code", () => {
        const before = ["A[^1] B[^2]", "", "[^2]: `x`", "", "[^1]: y"];
        const after = ["A[^1] B[^2]", "", "[^1]: y", "[^2]: `x`"];
        expect(reasonOf(before, after)).toBe("pass");
    });

    it("does not count the blank lines a \"%%\" comment takes in (pin bug-protected-text-alike-blank-lines)", () => {
        const before = ["A[^1] B[^2]", "", "[^2]: two", "%%", "c", "%%", "", "[^1]: one"];
        const after = ["A[^1] B[^2]", "", "[^1]: one", "[^2]: two", "%%", "c", "%%", ""];
        expect(judged(before, after)).toEqual({ pass: true });
    });
});

describe("check 4: links are drawn as before", () => {
    it("refuses a press that cuts a bare address short (pin bug-press-cuts-bare-address)", () => {
        expect(reasonOf(["contact bob@example.com"], ["contact b[^1]ob@example.com", "", "[^1]: "], press("1", 0, 9, 2))).toBe("link");
    });

    it("refuses a press between an embed's \"!\" and its \"[[\" (pin bug-press-between-image-bang-and-bracket)", () => {
        expect(reasonOf(["see ![[pic.png]]"], ["see ![^1][[pic.png]]", "", "[^1]: "], press("1", 0, 5, 2))).not.toBe("pass");
    });

    it("passes a selection that moves a link whole into the footnote", () => {
        const before = ["See [the site](https://e.com) now."];
        const after = ["See[^1] now.", "", "[^1]: [the site](https://e.com)"];
        expect(reasonOf(before, after, press("1", 0, 3, 2))).toBe("pass");
    });
});

describe("check 5: block shape", () => {
    it("refuses a cut that joins two numbered lists (pin bug-definition-between-lists-joins-them)", () => {
        const before = ["1. one", "", "[^9]: stray", "", "3. three"];
        const after = ["1. one", "", "3. three"];
        expect(reasonOf(before, after, { removed: ["9"] })).toBe("formatting");
    });

    it("refuses a selection that takes a heading's \"# \" with it (design, cycle 3 Q3)", () => {
        const before = ["# Title words"];
        const after = ["[^1] words", "", "[^1]: # Title"];
        expect(reasonOf(before, after, press("1", 0, 0, 2))).toBe("formatting");
    });

    it("passes a press inside a quote", () => {
        expect(reasonOf(["> quoted text"], ["> quoted text[^1]", "", "[^1]: "], press("1", 0, 13, 2))).toBe("pass");
    });

    it("passes a cut across two list items, which joins what is left of them", () => {
        const before = ["- abc", "- def", "- ghi"];
        const after = ["- af", "- ghi"];
        const cut: NoteRange = { from: { line: 0, ch: 3 }, to: { line: 1, ch: 4 } };
        expect(reasonOf(before, after, { removedText: [cut] })).toBe("pass");
    });
});

describe("check 1: untouched footnotes read the same", () => {
    it("refuses an edit that makes a paragraph part of a definition", () => {
        const before = ["A[^1]", "", "[^1]: one", "", "tail"];
        const after = ["A[^1]", "", "[^1]: one", "tail"];
        expect(reasonOf(before, after)).toBe("other");
    });

    it("refuses an edit that takes a reference out unasked, and passes it when asked", () => {
        const before = ["A[^1] B[^2]", "", "[^1]: one"];
        const after = ["A[^1] B", "", "[^1]: one"];
        expect(reasonOf(before, after)).toBe("other");
        expect(reasonOf(before, after, { removed: ["2"] })).toBe("pass");
    });

    it("passes a renumbering that swaps two footnotes, and refuses one whose definitions were not swapped", () => {
        const before = ["A[^2] B[^1]", "", "[^2]: one", "[^1]: two"];
        const swapped = new Map([
            ["1", "2"],
            ["2", "1"],
        ]);
        expect(reasonOf(before, ["A[^1] B[^2]", "", "[^1]: one", "[^2]: two"], { renamed: swapped })).toBe("pass");
        expect(reasonOf(before, ["A[^1] B[^2]", "", "[^2]: one", "[^1]: two"], { renamed: swapped })).toBe("dead");
    });

    it("lets a lazy label become its definition when the action says so (fix-lazy)", () => {
        const before = ["Some prose[^1] here.", "[^1]: the definition"];
        const after = ["Some prose[^1] here.", "", "[^1]: the definition"];
        expect(reasonOf(before, after)).toBe("other");
        expect(reasonOf(before, after, { defined: ["1"] })).toBe("pass");
    });

    it("refuses a lazy label made a definition when a line of its paragraph becomes a heading (pin bug-fix-lazy-makes-heading-of-next-label)", () => {
        const before = ["Text[^1]", "[^1]: a", "[^2]: b", "==="];
        const after = ["Text[^1]", "", "[^1]: a", "[^2]: b", "==="];
        expect(reasonOf(before, after, { defined: ["1", "2"] })).not.toBe("pass");
    });
});
