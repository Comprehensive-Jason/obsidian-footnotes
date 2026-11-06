import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineToNormalCommand, convertNormalFootnotesToInline, convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// SPEC (annoyance): Convert normal to inline on a footnote that is also defined
// in a "%%" comment.
//
// What the user would see: a commented-out "[^1]: hidden" beside a real
// "[^1]: real" came out as "^[real]: hidden" inside the comment, with a toast
// that the definition was used more than once. Now the footnote is skipped and
// named, as a name defined twice is, since the comment holds a second definition
// the user wrote.
//
// Hunt 2026-11-06, cycle 9, finding H30. Severity: annoyance. Origin:
// pre-existing. Source of truth: the triage's choice, for Jason's objection, by
// analogy with his ruling of 2026-11-05 (74c3472), which leaves a definition
// hidden in a comment alone.

const editor = (note: string) =>
    fakeEditor(note.split("\n"), { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } } });

beforeEach(resetNotices);

describe("a footnote also defined inside a %% comment", () => {
    const note = "%%\n[^1]: hidden\n%%\n\na[^1]\n\n[^1]: real";

    it("is skipped and named, and every footnote skipped says so", async () => {
        const doc = editor(note);
        await convertNormalToInlineCommand(fakePlugin({}, doc));
        expect(doc.lines.join("\n")).toBe(note);
        expect(messages()[0]).toContain('Every footnote was skipped: "[^1]" (also defined inside a %% comment).');
    });

    it("the others still convert, and the Skipped sentence names it", async () => {
        const doc = editor("%%\n[^1]: hidden\n%%\n\na[^1] b[^2]\n\n[^1]: real\n[^2]: two");
        await convertNormalToInlineCommand(fakePlugin({}, doc));
        expect(doc.lines.join("\n")).toBe("%%\n[^1]: hidden\n%%\n\na[^1] b^[two]\n\n[^1]: real");
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (also defined inside a %% comment).');
    });

    it("names match without regard to case", () => {
        const result = convertNormalFootnotesToInline("%%\n[^Note]: hidden\n%%\n\na[^note]\n\n[^note]: real");
        expect(result.skipped).toEqual([{ name: "note", reason: "also defined inside a %% comment" }]);
    });

    it("control: a reference in a comment, with no label there, still converts (rule F)", () => {
        expect(convertNormalFootnotesToInline("%% see[^1] %% a[^1]\n\n[^1]: real").markdown).toBe("%% see^[real] %% a^[real]");
    });

    it("control: a label in an HTML comment is plain text, so the footnote converts and the comment stays", () => {
        expect(convertNormalFootnotesToInline("<!--\n[^1]: hidden\n-->\n\na[^1]\n\n[^1]: real").markdown).toBe("<!--\n[^1]: hidden\n-->\n\na^[real]");
    });

    it("control: a label in a comment with no real definition has nothing to convert", async () => {
        const doc = editor("%%\n[^1]: hidden\n%%\n\na[^1]");
        await convertNormalToInlineCommand(fakePlugin({}, doc));
        expect(doc.lines.join("\n")).toBe("%%\n[^1]: hidden\n%%\n\na[^1]");
    });

    it("control: converting inline to normal does not read the comment", async () => {
        const doc = editor("%%\n[^1]: hidden\n%%\n\na^[x]");
        await convertInlineToNormalCommand(fakePlugin({}, doc));
        expect(doc.lines.join("\n")).toContain("a[^2]");
    });
});
