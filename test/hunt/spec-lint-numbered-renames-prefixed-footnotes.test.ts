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
// Characterization tests (behaviour pinned as they are, 2026-11-05, when the
// spec pins were sorted under Jason's scope rule of 2026-10-07): a prefix with
// Apply prefix off and Numbered on is a rare combination, and every footnote
// keeps its text. It was one it.fails test until then. The setting's sentence
// still says "keep their names", which is a wording question in the report.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR4.
//
// Source of truth: the Apply the note's footnote prefix description in
// src/settings.ts, quoted above.

describe("Numbered with Apply prefix off", () => {
    // The prefixes vary their separator, as every prefix test does (Jason's
    // ruling, 2026-08-08).
    for (const prefix of ["2-", "2~", "3=", "4_", "ch2*", "a$", "2."]) {
        it(`characterization: prefixed footnotes are renumbered like any other (${prefix})`, () => {
            const plugin = fakePlugin({ ...DEFAULT_SETTINGS, footnoteNaming: "numbered", enableFootnotePrefix: true, lintApplyPrefix: false });
            const md = ["---", `footnote-prefix: ${prefix}`, "---", `a[^${prefix}1] b[^x]`, "", `[^${prefix}1]: one`, "[^x]: ex"].join("\n");
            const out = lintFootnotes(md, lintOptionsFromSettings(plugin, "", md)).split("\n");
            expect(out[3]).toBe("a[^1] b[^2]");
        });
    }
});
