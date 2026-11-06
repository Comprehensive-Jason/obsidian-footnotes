import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import {
    convertInlineFootnotesToNormal,
    convertInlineToNormalCommand,
    convertNormalFootnotesToInline,
    convertNormalToInlineCommand,
} from "../src/commands/convert-footnotes";
import { nameForBody } from "../src/parsing/footnote-grammar";

// Converting a note's footnotes between the two styles (T6 of the 2026-09
// feature round; Jason's rulings 2026-09-19 to 21). Normal to inline is a
// pure transform over the whole note: every single-line definition becomes
// an "^[body]" at each of its references and its block is cut. A
// definition the inline form cannot hold is skipped and named: more than
// one line (the refuse-do-not-flatten ruling of 2026-08-20), an empty
// body, a body holding a footnote (no nesting, ADR 1), a reference inside
// another definition's body (the same), a quoted, in-item or closer-line
// definition, an orphan, a name defined twice. A definition used more than
// once becomes that many identical copies, and the result says so.

function convert(lines: string[]) {
    return convertNormalFootnotesToInline(lines.join("\n"));
}

describe("convertNormalFootnotesToInline", () => {
    it("turns a single-line definition into an inline footnote at its reference and cuts the block", () => {
        expect(convert(["text[^1] more", "", "[^1]: the note"])).toMatchObject({
            markdown: "text^[the note] more",
            converted: 1,
            references: 1,
            duplicated: 0,
            skipped: [],
        });
    });

    it("skips a definition of more than one line, by name and reason, and converts the rest", () => {
        expect(convert(["a[^1] b[^2]", "", "[^1]: one", "[^2]: first", "    second"])).toMatchObject({
            markdown: "a^[one] b[^2]\n\n[^2]: first\n    second",
            converted: 1,
            skipped: [{ name: "2", reason: "more than one line" }],
        });
    });

    it("copies a definition used more than once to every reference and counts the duplication", () => {
        expect(convert(["a[^n] b[^n]", "", "[^n]: shared"])).toMatchObject({
            markdown: "a^[shared] b^[shared]",
            converted: 1,
            references: 2,
            duplicated: 1,
        });
    });

    it("never nests: a body holding a footnote is skipped, and so is a name referenced from inside another definition's body", () => {
        const lines = ["a[^1]", "", "[^1]: see[^2]", "[^2]: two"];
        expect(convert(lines)).toMatchObject({
            markdown: lines.join("\n"),
            converted: 0,
            skipped: [
                { name: "1", reason: "its text holds a footnote" },
                { name: "2", reason: "referenced from inside another footnote" },
            ],
        });
    });

    it("skips an empty body, a quoted definition, one inside a list item, an orphan and a name defined twice", () => {
        expect(convert(["a[^e]", "", "[^e]:"]).skipped).toEqual([{ name: "e", reason: "empty" }]);
        expect(convert(["a[^q]", "", "> [^q]: quoted"]).skipped).toEqual([{ name: "q", reason: "in a quote" }]);
        expect(convert(["- a[^i]", "- [^i]: in the item"]).skipped).toEqual([{ name: "i", reason: "in a list item" }]);
        expect(convert(["text", "", "[^o]: orphan"]).skipped).toEqual([{ name: "o", reason: "not referenced" }]);
        expect(convert(["a[^d]", "", "[^d]: one", "", "[^d]: two"]).skipped).toEqual([{ name: "d", reason: "defined more than once" }]);
    });

    it("escapes a bracket that would end the inline footnote early", () => {
        expect(convert(["a[^1]", "", "[^1]: see [note"]).markdown).toBe("a^[see \\[note]");
    });

    it("escapes a pipe when the reference sits in a table row", () => {
        expect(convert(["| a[^1] |", "| - |", "", "[^1]: x | y"]).markdown).toBe("| a^[x \\| y] |\n| - |");
    });

    it("leaves a reference inside protected text alone and converts the live one", () => {
        expect(convert(["real[^1] `x[^1]`", "", "[^1]: n"]).markdown).toBe("real^[n] `x[^1]`");
    });

    it("keeps Windows line endings", () => {
        expect(convertNormalFootnotesToInline("a[^1]\r\nb\r\n\r\n[^1]: n").markdown).toBe("a^[n]\r\nb");
    });

    it("has nothing to do on a note with a lazy label only, or on its own output", () => {
        const lazy = ["prose[^l]", "[^l]: lazy"];
        expect(convert(lazy)).toMatchObject({ markdown: lazy.join("\n"), converted: 0, skipped: [] });
        const once = convert(["a[^1] b[^2]", "", "[^1]: one", "[^2]: two"]);
        expect(convertNormalFootnotesToInline(once.markdown)).toMatchObject({ markdown: once.markdown, converted: 0 });
    });
});

// Inline to normal runs editor-side, so it can reuse the definition-append
// decision tree (last block, section heading slot, end of note) instead of
// copying it in text form. Every "^[body]" becomes "[^N]" and its
// definition is appended; identical bodies merge into one definition with
// several references, always, with the count in the toast (Jason,
// 2026-09-21). All in one transaction.
describe("convertInlineFootnotesToNormal", () => {
    beforeEach(resetNotices);

    function run(lines: string[], settings: Record<string, unknown> = {}) {
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        const plugin = fakePlugin(settings, doc);
        const result = convertInlineFootnotesToNormal(plugin, doc);
        return { doc, result };
    }

    it("turns every inline footnote into a numbered one with its definition appended, in one transaction", () => {
        const { doc, result } = run(["a^[one] b^[two]"]);
        expect(doc.lines).toEqual(["a[^1] b[^2]", "", "[^1]: one", "[^2]: two"]);
        expect(doc.transactions).toBe(1);
        expect(result).toMatchObject({ converted: 2, definitions: 2, merged: 0 });
    });

    it("merges identical bodies into one definition with several references and counts the merge", () => {
        const { doc, result } = run(["a^[same] b^[same] c^[other]"]);
        expect(doc.lines).toEqual(["a[^1] b[^1] c[^2]", "", "[^1]: same", "[^2]: other"]);
        expect(result).toMatchObject({ converted: 3, definitions: 2, merged: 1 });
    });

    it("numbers past the existing footnotes and appends after the last definition block", () => {
        const { doc } = run(["x[^1] y^[new]", "", "[^1]: one"]);
        expect(doc.lines).toEqual(["x[^1] y[^2]", "", "[^1]: one", "[^2]: new"]);
    });

    it("carries the note's footnote prefix when that feature is on", () => {
        const { doc } = run(["---", "footnote-prefix: 2-", "---", "a^[one]"], { enableFootnotePrefix: true });
        expect(doc.lines).toEqual(["---", "footnote-prefix: 2-", "---", "a[^2-1]", "", "[^2-1]: one"]);
    });

    it("leaves an inline footnote inside a definition's body (no nesting) and an empty one alone, and says so", () => {
        const { doc, result } = run(["a^[ok] b^[ ]", "", "[^1]: body ^[nested]"]);
        expect(doc.lines).toEqual(["a[^2] b^[ ]", "", "[^1]: body ^[nested]", "[^2]: ok"]);
        expect(result).toMatchObject({
            converted: 1,
            skipped: [
                { reason: "empty", count: 1 },
                { reason: "inside another footnote", count: 1 },
            ],
        });
    });

    it("does nothing, and says so, when the note has no inline footnote outside protected text", () => {
        const { doc, result } = run(["plain `^[code]` here"]);
        expect(doc.lines).toEqual(["plain `^[code]` here"]);
        expect(doc.transactions).toBe(0);
        expect(result).toMatchObject({ converted: 0 });
        expect(messages()).toContain("This note has no inline footnotes to convert.");
    });

    it("tells the user what happened, merges included", () => {
        run(["a^[same] b^[same] c^[other]"]);
        expect(messages()).toContain(
            "Converted 3 inline footnotes into 2 normal footnotes (1 identical body merged).",
        );
    });

    // Jason, 2026-09-22: an option to name the converted footnotes after
    // the first meaningful word of the body ("same", "different", never
    // "the") instead of numbering them
    it("names the converted footnotes after the first meaningful word of each body when that setting says so", () => {
        const { doc } = run(["a^[the same note] b^[A different note] c^[the same note]"], { footnoteNaming: "named" });
        expect(doc.lines).toEqual(["a[^same] b[^different] c[^same]", "", "[^same]: the same note", "[^different]: A different note"]);
    });

    it("keeps generated names unique against the note and each other, carries the prefix, and falls back to a number when no word will do", () => {
        const { doc } = run(["x[^same] y^[the same again] z^[of the]", "", "[^same]: taken"], { footnoteNaming: "named" });
        expect(doc.lines).toEqual(["x[^same] y[^same-2] z[^1]", "", "[^same]: taken", "[^same-2]: the same again", "[^1]: of the"]);
        const prefixed = run(["---", "footnote-prefix: 2-", "---", "a^[the Smith paper]"], { footnoteNaming: "named", enableFootnotePrefix: true });
        expect(prefixed.doc.lines).toEqual(["---", "footnote-prefix: 2-", "---", "a[^2-Smith]", "", "[^2-Smith]: the Smith paper"]);
    });
});

describe("nameForBody", () => {
    it("takes the first word that is not a stop word, keeps its spelling, and skips one-letter words when longer ones exist", () => {
        expect(nameForBody("the same note", new Set())).toBe("same");
        expect(nameForBody("See p. 5 of Smith", new Set())).toBe("Smith");
        expect(nameForBody("引用来源。", new Set())).toBe("引用来源");
    });

    it("returns null when only stop words remain, and adds a suffix when the name is taken", () => {
        expect(nameForBody("of the and", new Set())).toBeNull();
        expect(nameForBody("the same note", new Set(["same"]))).toBe("same-2");
        expect(nameForBody("the same note", new Set(["same", "same-2"]))).toBe("same-3");
    });
});

describe("the two command entries", () => {
    beforeEach(resetNotices);

    it("normal to inline writes the transform back in one transaction and names what it skipped", async () => {
        const doc = fakeEditor(["a[^1] b[^n] c[^n]", "", "[^1]: one", "[^n]: shared", "[^long]: first", "    second"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 0 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
        });
        await convertNormalToInlineCommand(fakePlugin({}, doc));
        expect(doc.lines).toEqual(["a^[one] b^[shared] c^[shared]", "", "[^long]: first", "    second"]);
        expect(doc.transactions).toBe(1);
        expect(messages()).toContain(
            'Converted 2 footnotes into inline footnotes at 3 references (1 definition used more than once became copies). Skipped: "[^long]" (more than one line).',
        );
    });

    it("normal to inline says so when there is nothing it can convert", async () => {
        const doc = fakeEditor(["a[^m]", "", "[^m]: first", "    second"], {
            wholeDoc: true,
            cursor: { line: 0, ch: 0 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
        });
        await convertNormalToInlineCommand(fakePlugin({}, doc));
        expect(messages()).toContain('Nothing was converted. Every footnote was skipped: "[^m]" (more than one line).');
    });

    it("inline to normal runs through the command entry", async () => {
        const doc = fakeEditor(["a^[one]"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 0 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
        });
        await convertInlineToNormalCommand(fakePlugin({}, doc));
        expect(doc.lines).toEqual(["a[^1]", "", "[^1]: one"]);
    });
});
