import { beforeEach, describe, expect, it } from "vitest";

import { convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): with Lint on footnote creation on, the Skipped sentence of
// Convert normal to inline named a footnote by the name it had before the lint.
//
// What the user would see: 'Skipped: "[^2]" (in a quote).' over a note where that
// footnote is now [^1], so the toast names something the note no longer holds. A
// footnote the lint then deleted as an orphan was called skipped too. Now the
// sentence names what the note holds once the command has finished, and leaves
// out what the lint deleted.
//
// Hunt 2026-11-06, cycle 9, finding H26. Severity: annoyance. Origin: regression
// from 2dc5233, which added the lint after this conversion. Source of truth: the
// triage's choice, for Jason's objection, and his ruling of 2026-11-06 (38073fb)
// that the toast names what was skipped.

const LintOn = { ...DEFAULT_SETTINGS, lintOnFootnoteCreation: true };

async function toInline(note: string, settings: Record<string, unknown> = LintOn) {
    const doc = fakeEditor(note.split("\n"), { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } } });
    await convertNormalToInlineCommand(fakePlugin(settings, doc));
    return doc.lines.join("\n");
}

beforeEach(resetNotices);

describe("the Skipped sentence names what the note holds after the lint", () => {
    it("a number the lint moves, in a quote", async () => {
        expect(await toInline("a[^1] b[^2]\n\n[^1]: one\n\n> [^2]: quoted")).toBe("a^[one] b[^1]\n\n> [^1]: quoted");
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (in a quote).');
    });

    it("a two-line definition, the shape of the ruling's own pin", async () => {
        expect(await toInline("a[^1] b[^2]\n\n[^1]: one\n[^2]: first\n    second")).toBe("a^[one] b[^1]\n\n[^1]: first\n    second");
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (more than one line).');
    });

    it("a name the Numbered style turns into a number", async () => {
        await toInline("b[^b] a[^a]\n\n[^a]: one\n> [^b]: q", { ...LintOn, footnoteNaming: "numbered" });
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (in a quote).');
    });

    it("two definitions that swap numbers keep their own reasons", async () => {
        expect(await toInline("x[^3] b[^2] a[^1]\n\n[^1]: first\n    second\n> [^2]: quoted\n\n[^3]: one")).toBe("x^[one] b[^1] a[^2]\n\n> [^1]: quoted\n\n[^2]: first\n    second");
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^2]" (more than one line) and "[^1]" (in a quote).');
    });

    it("a definition the lint goes on to delete is not called skipped", async () => {
        expect(await toInline("a[^1]\n\n[^1]: one\n\n[^o]: orphan", { ...LintOn, lintDeleteOrphanedDefinitions: true })).toBe("a^[one]");
        expect(messages()[0]).toBe("Converted 1 footnote into an inline footnote at 1 reference.");
    });

    it("one deleted and one renamed: only the renamed one is named", async () => {
        await toInline("a[^1] b[^2]\n\n[^1]: one\n> [^2]: q\n\n[^o]: orphan", { ...LintOn, lintDeleteOrphanedDefinitions: true });
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (in a quote).');
    });

    it("control: with the lint off, the name stays", async () => {
        await toInline("a[^1] b[^2]\n\n[^1]: one\n\n> [^2]: quoted", { ...DEFAULT_SETTINGS });
        expect(messages()[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^2]" (in a quote).');
    });

    it("control: every footnote skipped runs no lint, so the name stays", async () => {
        await toInline("b[^2]\n\n> [^2]: quoted");
        expect(messages()[0]).toContain('Every footnote was skipped: "[^2]" (in a quote).');
    });
});
