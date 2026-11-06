import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineToNormalCommand, convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): Convert inline to normal merges two inline footnotes only
// when they are written the same, so two whose definitions would read the same
// come out as two definitions.
//
// What the user would see, two ways. A footnote with a pipe, cited from prose
// and from a table, goes inline as ^[x | y] and ^[x \| y], since a pipe in a
// table cell needs its backslash, and comes back as "[^1]: x | y" and
// "[^2]: x \| y". A footnote that starts with a number, ^[2\. Aufl.] from an
// earlier round trip beside a freshly typed ^[2. Aufl.], comes back as two
// definitions that are byte for byte the same.
//
// Hunt 2026-11-06, cycle 9, findings H28 and H33. Severity: annoyance. Origin:
// pre-existing as two definitions; H33's byte-identical pair is new with
// 33351c0. Source of truth: the README ("Convert to inline before embedding and
// back afterwards, and a shared definition comes back shared") and the triage's
// choice for H33. The live answers H24a to H24c say which backslashes matter:
// in a code span Obsidian draws it, in the cell and in the definition alike, and
// a wikilink reads the same with it or without it, so neither changes.

const editor = (note: string) =>
    fakeEditor(note.split("\n"), { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } } });

async function toNormal(note: string) {
    const doc = editor(note);
    await convertInlineToNormalCommand(fakePlugin({}, doc));
    return doc.lines.join("\n");
}
async function toInline(note: string) {
    const doc = editor(note);
    await convertNormalToInlineCommand(fakePlugin({}, doc));
    return doc.lines.join("\n");
}

beforeEach(resetNotices);

describe("H28: a pipe's round trip", () => {
    it("a definition with a pipe, cited from prose and a table, comes back as it was", async () => {
        const start = "a[^1]\n\n| b[^1] | c |\n| - | - |\n\n[^1]: x | y";
        const inline = await toInline(start);
        expect(inline).toBe("a^[x | y]\n\n| b^[x \\| y] | c |\n| - | - |");
        expect(await toNormal(inline)).toBe(start);
    });

    it("cited only from a table, its definition comes back without the table's backslash", async () => {
        expect(await toNormal("| b^[x \\| y] | c |\n| - | - |")).toBe("| b[^1] | c |\n| - | - |\n\n[^1]: x | y");
    });

    it("the toast counts the merge", async () => {
        await toNormal("a^[x | y]\n\n| b^[x \\| y] | c |\n| - | - |");
        expect(messages()).toContain("Converted 2 inline footnotes into 1 normal footnote (1 identical body merged).");
    });

    it("a pipe escaped outside a table is the user's own, and stays as written", async () => {
        expect(await toNormal("x^[a\\|b] c")).toBe("x[^1] c\n\n[^1]: a\\|b");
    });

    it("characterization: a code span from a table cell keeps its backslash, which Obsidian draws in both places (live answers H24a and H24c)", async () => {
        expect(await toNormal("| x^[`a\\|b`] | c |\n| - | - |")).toBe("| x[^1] | c |\n| - | - |\n\n[^1]: `a\\|b`");
    });

    it("characterization: a wikilink from a table cell keeps it, which reads the same either way (live answer H24b)", async () => {
        expect(await toNormal("| x^[see [[Page\\|alias]]] | c |\n| - | - |")).toBe("| x[^1] | c |\n| - | - |\n\n[^1]: see [[Page\\|alias]]");
    });

    it("characterization: math from a table cell keeps it, where \\| is a double bar", async () => {
        expect(await toNormal("| x^[$a\\|b$] | c |\n| - | - |")).toBe("| x[^1] | c |\n| - | - |\n\n[^1]: $a\\|b$");
    });

    it("a doubled backslash before a pipe is no escaped pipe", async () => {
        const written = await toNormal("| x^[a\\\\\\|b] | c |\n| - | - |");
        expect(written).toBe("| x[^1] | c |\n| - | - |\n\n[^1]: a\\\\|b");
    });
});

describe("H33: inline footnotes whose definitions would be identical", () => {
    it("share one definition", async () => {
        expect(await toNormal("a^[2\\. Aufl.] b^[2. Aufl.]")).toBe("a[^1] b[^1]\n\n[^1]: 2\\. Aufl.");
    });

    it("in the other order too", async () => {
        expect(await toNormal("a^[2. Aufl.] b^[2\\. Aufl.]")).toBe("a[^1] b[^1]\n\n[^1]: 2\\. Aufl.");
    });

    it("control: different text stays two definitions", async () => {
        expect(await toNormal("a^[2. Aufl.] b^[3. Aufl.]")).toBe("a[^1] b[^2]\n\n[^1]: 2\\. Aufl.\n[^2]: 3\\. Aufl.");
    });
});
