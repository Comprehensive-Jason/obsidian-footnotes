import { beforeEach, describe, expect, it } from "vitest";

import { convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { PREFIXES } from "../helpers/prefixes";

// Jason's ruling, 2026-11-05: Convert normal footnotes to inline footnotes
// runs the lint afterwards when Lint on footnote creation is on, as Convert
// inline footnotes to normal footnotes does. The setting's description says
// "including when the convert commands or a paste create them", and "the
// convert commands" means both.
//
// The case: the note has [^1] (one line) and [^2] (two lines, so it cannot
// become inline). The conversion turns [^1] into "^[one]" and leaves "[^2]".
// The lint then numbers the footnote left behind [^1], because it is now the
// first numbered footnote in the note. Before the ruling, nothing linted, and
// it kept its number 2 until the next lint.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR8.

/** A fake editor holding `lines`, caret at the start. */
function doc(lines: string[]) {
    return fakeEditor(lines, {
        wholeDoc: true,
        edits: true,
        cursor: { line: 0, ch: 0 },
        selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
    });
}

beforeEach(resetNotices);

describe("Lint on footnote creation after Convert normal footnotes to inline footnotes (ruling 2026-11-05)", () => {
    it("lints straight after, so the footnote left behind is renumbered", async () => {
        const d = doc(["a[^1] b[^2]", "", "[^1]: one", "[^2]: first", "    second"]);
        await convertNormalToInlineCommand(fakePlugin({ ...DEFAULT_SETTINGS, lintOnFootnoteCreation: true }, d));
        expect(d.lines).toEqual(["a^[one] b[^1]", "", "[^1]: first", "    second"]);
        expect(messages()).toContain("Footnotes linted.");
    });

    for (const prefix of PREFIXES) {
        it(`renumbers inside the note's prefix too (${prefix})`, async () => {
            const d = doc(["---", `footnote-prefix: ${prefix}`, "---", `a[^${prefix}1] b[^${prefix}2]`, "", `[^${prefix}1]: one`, `[^${prefix}2]: first`, "    second"]);
            await convertNormalToInlineCommand(fakePlugin({ ...DEFAULT_SETTINGS, lintOnFootnoteCreation: true, enableFootnotePrefix: true }, d));
            expect(d.lines.slice(3)).toEqual([`a^[one] b[^${prefix}1]`, "", `[^${prefix}1]: first`, "    second"]);
        });
    }

    it("control: with the setting off, the footnote left behind keeps its number until the next lint", async () => {
        const d = doc(["a[^1] b[^2]", "", "[^1]: one", "[^2]: first", "    second"]);
        await convertNormalToInlineCommand(fakePlugin({ ...DEFAULT_SETTINGS, lintOnFootnoteCreation: false }, d));
        expect(d.lines).toEqual(["a^[one] b[^2]", "", "[^2]: first", "    second"]);
        expect(messages()).not.toContain("Footnotes linted.");
    });

    it("says so when a bad prefix stops the lint, since nothing else in this conversion reads the prefix", async () => {
        const d = doc(["---", "footnote-prefix: 2", "---", "a[^1] b[^2]", "", "[^1]: one", "[^2]: first", "    second"]);
        await convertNormalToInlineCommand(fakePlugin({ ...DEFAULT_SETTINGS, lintOnFootnoteCreation: true, enableFootnotePrefix: true }, d));
        expect(d.lines).toEqual(["---", "footnote-prefix: 2", "---", "a^[one] b[^2]", "", "[^2]: first", "    second"]);
        expect(messages().some((message) => message.startsWith("Linting canceled: this note's footnote-prefix (\"2\") is invalid."))).toBe(true);
    });
});
