import { describe, expect, it } from "vitest";

import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: with Apply the note's footnote prefix off and the naming
// style on Numbered, should prefixed footnotes keep their names?
//
// What it does now: the note's prefix is "2-" and it holds "[^2-1]" and
// "[^x]". With Apply prefix off and Preferred footnote naming style on
// Numbered, the lint renumbers both: "a[^2-1] b[^x]" becomes "a[^1] b[^2]".
// What a user might expect: the Apply prefix setting says "While off,
// prefixed footnotes are treated as named and keep their names."
// Why it is a question and not a bug: under Numbered, named footnotes are
// renumbered on purpose, so "treated as named" is honoured; only "keep
// their names" is not. The sentence was written before the dropdown had a
// Numbered value. Either the setting text changes, or prefixed footnotes
// are exempt from Numbered; that is Jason's call.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR4.
//
// Source of truth: the Apply the note's footnote prefix description in
// src/settings.ts, quoted above.

describe("spec question: Numbered with Apply prefix off", () => {
    it.fails("prefixed footnotes keep their names", () => {
        const plugin = fakePlugin({ ...DEFAULT_SETTINGS, footnoteNaming: "numbered", enableFootnotePrefix: true, lintApplyPrefix: false });
        const md = ["---", "footnote-prefix: 2-", "---", "a[^2-1] b[^x]", "", "[^2-1]: one", "[^x]: ex"].join("\n");
        const out = lintFootnotes(md, lintOptionsFromSettings(plugin, "", md)).split("\n");
        // Today: "a[^1] b[^2]".
        expect(out[3]).toContain("[^2-1]");
    });
});
