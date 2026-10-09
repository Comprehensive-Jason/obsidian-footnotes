// BUG (wrong output): Convert normal footnotes to inline refuses the whole
// note when a footnote cited twice holds a link, a web address, a
// wikilink, inline code, or inline math.
//
// What the user would see: "See this[^1] and that[^1]." with "[^1]:
// [Smith 2020](https://doi.org/10.1/x), p. 4." They run Convert normal
// footnotes to inline. Nothing is converted: "Nothing was converted.
// Converting would change how Obsidian reads the text around a footnote.
// Convert it by hand." Every other footnote in the note is left too. The
// same footnote cited once converts, and plain text cited twice becomes two
// copies, as the command promises.
//
// Hunt 2026-10-09, cycle 8. Cluster V11, lens the gate.
// Source of truth: the README and the command's contract (a definition used
// more than once becomes that many copies); test/convert-footnotes.test.ts
// "copies a definition used more than once to every reference and counts
// the duplication".
// Origin: a regression from 728d226 (2026-10-08, the result gate deciding
// for both conversions), missed by cycles 6 and 7: green at 728d226's
// parent, red at 728d226, 34d5377, and 3a47f7a. The gate counts the second
// copy's link or code as new, since the conversion does not say it copies
// the footnote's text. Whether a refusal should take the whole note or skip
// one footnote is the open spec question L6
// (spec-convert-to-inline-refusal-between-lists).
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change (ADR 0003).

import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

// probe: Convert normal footnotes to inline on a footnote cited
// twice whose text holds a link, a wikilink, code, or math. The command's
// contract (its doc comment, and test/convert-footnotes.test.ts "copies a
// definition used more than once to every reference and counts the
// duplication") is that a shared definition becomes one identical inline
// copy per reference.
const convert = (lines: string[]) => convertNormalFootnotesToInline(lines.join("\n"));

describe("Convert normal footnotes to inline: a footnote cited twice whose text holds a link or code", () => {
    it("control: plain text cited twice converts to two copies", () => {
        const result = convert(["See this[^1] and that[^1].", "", "[^1]: Smith 2020, p. 4."]);
        expect(result.refused).toBeUndefined();
        expect(result.markdown).toBe("See this^[Smith 2020, p. 4.] and that^[Smith 2020, p. 4.].");
    });
    it("control: a link cited once converts", () => {
        expect(convert(["See this[^1].", "", "[^1]: [Smith 2020](https://doi.org/10.1/x), p. 4."]).refused).toBeUndefined();
    });
    const bodies: [string, string][] = [
        ["a markdown link", "[Smith 2020](https://doi.org/10.1/x), p. 4."],
        ["a bare web address", "https://example.org/paper, p. 4."],
        ["a wikilink", "See [[Smith 2020]], p. 4."],
        ["inline code", "Run `make test` first."],
        ["inline math", "Where $x = 2$ holds."],
    ];
    for (const [what, body] of bodies) {
        it(`a footnote cited twice whose text holds ${what} converts to two copies`, () => {
            const result = convert(["See this[^1] and that[^1].", "", `[^1]: ${body}`]);
            expect(result.refused).toBeUndefined();
            expect(result.markdown).toBe(`See this^[${body}] and that^[${body}].`);
        });
    }
});
