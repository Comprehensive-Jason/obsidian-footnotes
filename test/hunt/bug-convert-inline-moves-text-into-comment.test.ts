import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

// Bug: Convert normal to inline moved a footnote's text into a "%%"
// comment when every reference to it sat inside one, so the text went
// where Obsidian never shows it. A footnote also defined inside a "%%"
// comment was already left alone ("also defined inside a %% comment",
// finding H30); its reference-side twin had no such rule.
//
// The note:
//     Prose %%hidden [^a]%% more
//
//     [^a]: alpha
// "Convert normal footnotes to inline".
//
// Before: "Prose %%hidden ^[alpha]%% more", converted 1, skipped none.
// Now: the footnote is skipped with the reason "cited only inside a %%
// comment", and the note is unchanged.
//
// Found by the DeepSeek V4.1 Flash review (2026-11-11); Jason chose to fix it.

describe("Convert normal to inline and references inside a %% comment", () => {
    it("skips a footnote whose only reference sits inside an inline %% comment", () => {
        const note = ["Prose %%hidden [^a]%% more", "", "[^a]: alpha"].join("\n");
        const result = convertNormalFootnotesToInline(note);
        expect(result.markdown).toBe(note);
        expect(result.converted).toBe(0);
        expect(result.skipped.map(({ name, reason }) => ({ name, reason }))).toEqual([{ name: "a", reason: "cited only inside a %% comment" }]);
    });

    it("skips one whose only reference sits inside a %% block", () => {
        const note = ["Prose.", "", "%%", "hidden [^a]", "%%", "", "[^a]: alpha"].join("\n");
        const result = convertNormalFootnotesToInline(note);
        expect(result.converted).toBe(0);
        expect(result.skipped.map(({ reason }) => reason)).toEqual(["cited only inside a %% comment"]);
    });

    // Characterization: a footnote cited outside a comment as well converts,
    // at every reference, as before.
    it("converts one cited both inside and outside a comment (as before)", () => {
        const note = ["See[^a] and %%hidden [^a]%% more", "", "[^a]: alpha"].join("\n");
        const result = convertNormalFootnotesToInline(note);
        expect(result.converted).toBe(1);
        expect(result.markdown).toBe("See^[alpha] and %%hidden ^[alpha]%% more");
    });
});
