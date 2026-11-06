import { describe, expect, it } from "vitest";

import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";

// A label something references, stacked over a label nothing references that has
// lines of its own under it: "Para[^1] text.", "[^1]: first", "[^2]: second",
// "    more of two".
//
// What the user sees: on default settings the blank line goes in above the first
// label, so "[^1]" is a real footnote. For a time both labels stayed lazy, so the
// footnote stayed undefined, all because of the unreferenced label under it.
//
// Hunt 2026-11-06, cycle 10, on the back-out of cycle 9's H13 (3a4529d); the lint
// hunter's finding 1. Source of truth: commit 3a4529d's own words ("a label something
// references still takes the rest of its paragraph as its text") and the code at
// 0fb8ac3, where each row here passes. Severity: wrong output. Origin: regression
// from 3a4529d.

const definedNames = (note: string) => readNote(note.split("\n")).definitions.map((definition) => definition.name);
const lint = (note: string, extra: Partial<typeof DEFAULT_SETTINGS> = {}) => {
    const settings = { ...DEFAULT_SETTINGS, ...extra };
    return lintFootnotes(note, lintOptionsFromSettings(fakePlugin(settings), "", note));
};

describe("a referenced label stacked over an unreferenced one with lines under it", () => {
    it.each([
        ["indented text under the second", "Para[^1] text.\n[^1]: first\n[^2]: second\n    more of two", "1"],
        ["a plain line under the second", "Para[^1] text.\n[^1]: first\n[^2]: second\nmore of two", "1"],
        ["both with text", "Para[^1] text.\n[^1]: first\n    more of one\n[^2]: second\n    more of two", "1"],
        ["named", "Para[^a] text.\n[^a]: first\n[^b]: second\n    more", "a"],
        ["in a quote", "> Quote[^1] text.\n> [^1]: one\n> [^2]: two\n>     more", "1"],
        ["in a list item", "- Item[^1] text.\n\n  body\n  [^1]: one\n  [^2]: two\n      more", "1"],
    ])("%s: the referenced label becomes a definition", (_label, note, name) => {
        expect(definedNames(lint(note))).toContain(name);
    });

    it("two referenced labels over an unreferenced third both become definitions", () => {
        const note = "Para[^1] text[^2] end\n[^1]: first\n[^2]: second\n    more\n[^3]: third\n    more of three";
        expect(definedNames(lint(note))).toEqual(expect.arrayContaining(["1", "2"]));
    });

    it.each(["2-", "2~", "3=", "4_", "ch2*", "a$", "2."])("with the prefix %s", (prefix) => {
        const note = `---\nfootnote-prefix: ${prefix}\n---\nPara[^${prefix}1] text.\n[^${prefix}1]: first\n[^${prefix}2]: second\n    more of two`;
        expect(definedNames(lint(note, { enableFootnotePrefix: true }))).toContain(`${prefix}1`);
    });
});
