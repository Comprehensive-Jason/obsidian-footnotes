import { describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";

// Review B2 (2026-09-09): when a note ends inside an unclosed fence,
// comment, or math block, buildDefinitionAppend walks up from EOF to find
// the last line a definition can live after - and it used to re-slice and
// re-scan the prefix once per line, quadratic on a long note with the
// opener near the top. The note reading answers it once for the whole note
// (NoteReading.openRegionFrom, the line the region that never closes starts
// on, since the runtime swap of 2026-10-03), and line i is inside it when
// i is at or after that line. The first spec is the equivalence proof
// against the old probe; the timing pin lives in
// test/perf/ends-protected-at.perf.test.ts (excluded from Stryker's
// instrumented dry run, which is several times slower).

/** Whether line `i` of `lines` lies in a region that never closes, from the line it opens on to the end of the note. */
function insideOpenRegion(lines: string[], i: number): boolean {
    const open = readNote(lines).openRegionFrom;
    return open !== -1 && i >= open;
}

/** Whether the note ends inside a region that never closes. */
const endsProtected = (lines: string[]): boolean => readNote(lines).openRegionFrom !== -1;

const DOCS = [
    ["prose[^9]?", "", "```", "code"],
    ["alpha[^1].", "", "text <!-- open", "hidden", "still hidden"],
    ["a[^1]!", "$$", "E=mc^2"],
    ["> ```", "> quoted fence stays quoted", "after the quote", "```", "doc fence", "```", "tail"],
    ["intro", "<!-- one -->", "live", "<!-- two", "-->", "after"],
    ["```", "opens on line 0", "```", "", "[^1]: def", "    $$", "    inside", "    $$", "tail"],
    ["- item", "  ```", "  listed fence", "  ```", "back"],
    ["x", "", "> [!note]", "> $$", "> quoted math", "plain after quote"],
];

describe("the line where a region that never closes starts (NoteReading.openRegionFrom)", () => {
    it("equals the old prefix probe on every line, except where a later line closes an opener", () => {
        // REVISED 2026-09-16 (Kimi hunt cycle 3): an opener nothing in its
        // paragraph closes is literal text, and the scan looks ahead to
        // know. The prefix probe cannot see the closer, so on a line whose
        // NEXT line still carries the region the two disagree by design:
        // the full note's answer is the one the append needs.
        for (const lines of DOCS) {
            const reading = readNote(lines);
            for (let i = 0; i < lines.length; i++) {
                const nextCarriesRegion = i + 1 < lines.length && reading.regionOpenAt(i + 1);
                if (nextCarriesRegion) continue;
                expect(insideOpenRegion(lines, i), `${JSON.stringify(lines)} @${i}`).toBe(endsProtected(lines.slice(0, i + 1)));
            }
            expect(insideOpenRegion(lines, lines.length - 1)).toBe(endsProtected(lines));
        }
    });

    it("reads false inside a closed frontmatter block", () => {
        const lines = ["---", "title: t", "---", "body", "```", "code"];
        expect([0, 1, 2].map((i) => insideOpenRegion(lines, i))).toEqual([false, false, false]);
        expect(insideOpenRegion(lines, 3)).toBe(false);
        expect(insideOpenRegion(lines, 4)).toBe(true);
        expect(endsProtected(lines)).toBe(true);
    });
});
