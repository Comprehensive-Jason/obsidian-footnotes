import { readdirSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { docArb } from "./arbitraries";
import { CreatedFootnote, EditIntent, GateReason, judgeEdit, NotePosition, NoteRange, useEditWindows } from "../src/editor/result-gate";

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

    it("passes a selection of a whole table or heading, whose reference stands where the block was (Jason's ruling, sheet 05, 2026-09-09; pin bug-block-first-line-on-label)", () => {
        const table = ["Before.", "", "| a | b |", "| --- | --- |", "| c | d |", "", "After."];
        const converted = ["Before.", "", "[^1]", "", "After.", "", "[^1]: | a | b |", "    | --- | --- |", "    | c | d |"];
        expect(reasonOf(table, converted, { created: [{ kind: "footnote", name: "1", references: [{ line: 2, ch: 0 }], definition: { line: 6, lines: 3 } }] })).toBe("pass");
        expect(reasonOf(["# Heading", "", "text"], ["[^1]", "", "text", "", "[^1]: # Heading"], press("1", 0, 0, 4))).toBe("pass");
    });

    it("refuses a selection that takes a table's last row with the text under it (Jason's ruling, 2026-09-04; the manual table tests)", () => {
        const before = ["", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "after the table"];
        const after = ["", "| a | b |", "| --- | --- |", "[^1]", "", "[^1]: | 1 | 2 |", "    ", "    after the table"];
        expect(reasonOf(before, after, { created: [{ kind: "footnote", name: "1", references: [{ line: 3, ch: 0 }], definition: { line: 5, lines: 3 } }] })).toBe("formatting");
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

describe("what each kind of action may change", () => {
    it("a merge folds a copy into the first (merged), but not one whose table would turn into text (pin bug-merge-duplicate-flattens-table)", () => {
        const before = ["use[^1]", "", "[^1]: first", "", "tail", "", "[^1]: second"];
        expect(reasonOf(before, ["use[^1]", "", "[^1]: first", "    second", "", "tail"], { merged: ["1"] })).toBe("pass");
        const table = ["use[^1]", "", "[^1]: first", "", "tail", "", "[^1]: | a | b |", "| --- |", "| x | y |"];
        const flattened = ["use[^1]", "", "[^1]: first", "    | a | b |", "| --- |", "| x | y |", "", "tail"];
        expect(reasonOf(table, flattened, { merged: ["1"] })).toBe("formatting");
    });

    it("Convert normal to inline turns a definition into an inline footnote where its reference was (inlined)", () => {
        const before = ["Text[^1] and `code`.", "", "[^1]: see `x` here"];
        expect(reasonOf(before, ["Text^[see `x` here] and `code`."], { inlined: ["1"], inlineCreated: 1 })).toBe("pass");
    });

    it("the punctuation rule moves a footnote inside a definition past its full stop (footnotesMoved)", () => {
        expect(reasonOf(["A[^1]", "", "[^1]: word[^2].", "[^2]: two"], ["A[^1]", "", "[^1]: word.[^2]", "[^2]: two"])).toBe("other");
        expect(reasonOf(["A[^1]", "", "[^1]: word[^2].", "[^2]: two"], ["A[^1]", "", "[^1]: word.[^2]", "[^2]: two"], { footnotesMoved: true })).toBe("pass");
    });

    it("a selection that moves an empty placeholder into the new definition nests it (pin selection-to-footnote, placeholders)", () => {
        expect(reasonOf(["keep [^] here"], ["[^1]", "", "[^1]: keep [^] here"], press("1", 0, 0, 2))).toBe("nested");
    });

    it("a table row keeps its cells (Jason's ruling on partial-table selections, 2026-09-04)", () => {
        const before = ["| a | b |", "| --- | --- |", "| one | two |"];
        expect(reasonOf(before, ["| a | b |", "| --- | --- |", "| [^1] |", "", "[^1]: one | two"], press("1", 2, 2, 4))).toBe("formatting");
        expect(reasonOf(before, ["| a | b |", "| --- | --- |", "| one[^1] | two |", "", "[^1]: "], press("1", 2, 5, 4))).toBe("pass");
    });

    it("an edit that leaves a lazy label behind changes the note on the next lint (pin bug-lint-orphan-cut-leaves-lazy-label)", () => {
        const before = ["a[^8]", "", "prose", "[^8][^9]: x", "", "[^8]: d"];
        expect(reasonOf(before, ["a[^8]", "", "prose", "[^8]: x", "", "[^8]: d"], { removed: ["9"] })).toBe("formatting");
    });

    it("a paste's text may join the paragraph next to it", () => {
        const pasted: NoteRange = { from: { line: 2, ch: 0 }, to: { line: 2, ch: 7 } };
        expect(reasonOf(["Para one.", "", "Para two."], ["Para one.", "", "a[^1] b", "Para two.", "", "[^1]: one"], {
            insertedText: [pasted],
            created: [{ kind: "footnote", name: "1", references: [], definition: { line: 5, lines: 1 } }],
        })).toBe("pass");
    });

    it("a press on a blank line above a definition would hide the definition", () => {
        expect(reasonOf(["text[^1]", "", "[^1]: d"], ["text[^1]", "[^]", "[^1]: d"], { created: [{ kind: "placeholder", text: "[^]", at: [{ line: 1, ch: 0 }] }] })).toBe("formatting");
    });

    it("the paste key's clipboard text is the action's own; a selection's text is not", () => {
        const inline = (text: string, fromOutside: boolean): EditIntent => ({ created: [{ kind: "inline", text, at: [{ line: 0, ch: 9 }], fromOutside }] });
        expect(reasonOf(["Some text after."], ["Some text^[see https://example.com/page] after."], inline("^[see https://example.com/page]", true))).toBe("pass");
        expect(reasonOf(["a $x$ b"], ["a^[$x$] b"], { created: [{ kind: "inline", text: "^[$x$]", at: [{ line: 0, ch: 1 }] }] })).toBe("pass");
    });
});

// Jason's ruling B1 (2026-10-08): a press on an empty line may join the
// paragraph next to it; it is refused only when another line changes what
// kind of block it is in. The five notes are the ones he checked in
// Reading view, each with the empty line holding the new reference
// (docs/obsidian-reading-rules.md G1; saved answers gs3:b1-*).
describe("a press on an empty line (Jason's ruling B1)", () => {
    it("joins the paragraph above a horizontal rule: one paragraph, then the rule", () => {
        expect(reasonOf(["Results were mixed.", "", "---"], ["Results were mixed.", "[^1]", "---", "", "[^1]: "], press("1", 1, 0, 4))).toBe("pass");
    });

    it("joins two paragraphs into one", () => {
        expect(reasonOf(["The tide rose.", "", "Oysters closed."], ["The tide rose.", "[^1]", "Oysters closed.", "", "[^1]: "], press("1", 1, 0, 4))).toBe("pass");
    });

    it("is refused over a table, whose rows would become paragraph text", () => {
        const table = ["Some text.", "", "| a | b |", "| --- | --- |", "| c | d |"];
        expect(reasonOf(table, ["Some text.", "[^1]", "| a | b |", "| --- | --- |", "| c | d |", "", "[^1]: "], press("1", 1, 0, 6))).toBe("formatting");
    });

    it("is refused over a definition, which would become a lazy label", () => {
        const before = ["text[^1] and[^2]", "", "[^1]: d"];
        expect(reasonOf(before, ["text[^1] and[^2]", "[^2]", "[^1]: d"], { created: [{ kind: "footnote", name: "2", references: [{ line: 1, ch: 0 }] }] })).not.toBe("pass");
        expect(reasonOf(before, ["text[^1] and[^2]", "[^]", "[^1]: d"], { created: [{ kind: "placeholder", text: "[^]", at: [{ line: 1, ch: 0 }] }] })).toBe("formatting");
    });

    it("is refused over indented code, which would become paragraph text", () => {
        expect(reasonOf(["Para.", "", "    code line"], ["Para.", "[^1]", "    code line", "", "[^1]: "], press("1", 1, 0, 4))).toBe("protected");
    });

    it("is refused where the next line would join a list item above, not a paragraph", () => {
        expect(reasonOf(["- item", "", "Para two."], ["- item", "[^1]", "Para two.", "", "[^1]: "], press("1", 1, 0, 4))).toBe("formatting");
    });
});

describe("what a reason says", () => {
    it("a dead reference that comes alive inside a footnote is a footnote inside a footnote (Jason's ruling B12; pin spec-convert-inline-body-holds-reference)", () => {
        const before = ["x[^1] a^[see [^1]]", "", "[^1]: one"];
        const after = ["x[^1] a[^2]", "", "[^1]: one", "[^2]: see [^1]"];
        const intent: EditIntent = { created: [{ kind: "footnote", name: "2", references: [{ line: 0, ch: 7 }], definition: { line: 3, lines: 1 } }], inlineRemoved: 1 };
        expect(reasonOf(before, after, intent)).toBe("nested");
    });
});

describe("renames", () => {
    it("look at the lines the renamed footnotes are on, not the whole note", () => {
        const before = ["a[^x] b", "", ...Array.from({ length: 50 }, (_, i) => `line ${String(i)}`), "", "[^x]: one"];
        const after = before.map((line) => line.replace("[^x]", "[^y]"));
        expect(reasonOf(before, after, { renamed: new Map([["x", "y"]]) })).toBe("pass");
    });

    it("never join a footnote to one that keeps the name, wherever that one sits", () => {
        const before = ["a[^x] b", "", ...Array.from({ length: 50 }, (_, i) => `line ${String(i)}`), "c[^y]", "", "[^x]: one", "[^y]: two"];
        const after = ["a[^y] b", ...before.slice(1, -2), "[^y]: one", "[^y]: two"];
        expect(reasonOf(before, after, { renamed: new Map([["x", "y"]]) })).toBe("other");
    });

    it("tell a footnote taken out apart from one renamed to its name (the lint deletes an orphaned [^3] and renumbers [^4] to [^3])", () => {
        const before = ["a[^3] b[^4]", "", "[^4]: four"];
        const after = ["a b[^3]", "", "[^3]: four"];
        expect(reasonOf(before, after, { removed: ["3"], renamed: new Map([["4", "3"]]) })).toBe("pass");
        // the renamed footnote losing its definition is still seen
        expect(reasonOf(before, ["a b[^3]", "", "four"], { removed: ["3"], renamed: new Map([["4", "3"]]) })).not.toBe("pass");
    });
});

describe("the stretches the gate looks at", () => {
    it("never change a verdict but check 5's: the gate looking at the stretches an edit can have changed says what it says looking at the whole note", () => {
        const lineArb = fc.constantFrom("", "text", "more text[^1]", "[^1]: def", "    indented", "> quote", "- item", "# Heading", "===", "---", "$$", "```", "| a | b |", "| --- | --- |", "%%", "[^2]: two", "[ref]: http://u", "see [x][ref]", "[^]", "^[inline]");
        const editArb = fc.record({ at: fc.nat(), kind: fc.constantFrom("replace", "insert", "delete", "press"), line: lineArb });
        fc.assert(
            fc.property(docArb, fc.array(editArb, { minLength: 1, maxLength: 3 }), (doc, edits) => {
                const before = doc.split("\n");
                const after = [...before];
                let intent: EditIntent = {};
                for (const edit of edits) {
                    const at = edit.at % (after.length + 1);
                    if (edit.kind === "replace" && at < after.length) after[at] = edit.line;
                    else if (edit.kind === "insert") after.splice(at, 0, edit.line);
                    else if (edit.kind === "delete" && at < after.length) after.splice(at, 1);
                    else if (edit.kind === "press" && at < after.length) {
                        const ch = after[at].length;
                        after[at] += "[^99]";
                        after.push("", "[^99]: ");
                        intent = press("99", at, ch, after.length - 1);
                    }
                }
                const windowed = judgeEdit(before, after, intent);
                useEditWindows(false);
                const whole = judgeEdit(before, after, intent);
                useEditWindows(true);
                // Check 5 lines up the lines that changed, and an edit can
                // often be lined up more than one way: the whole note's
                // line-up can pair a deleted line with an added one that the
                // stretches pair with nothing. So a verdict of check 5 may
                // differ; every other check must agree.
                const byLineUp = (verdict: typeof whole) => !verdict.pass && verdict.check === 5;
                if (windowed.pass !== whole.pass && !byLineUp(windowed) && !byLineUp(whole)) expect.fail(JSON.stringify({ before, after, intent, windowed, whole }));
            }),
            { numRuns: 1000 },
        );
    }, 120_000);
});
