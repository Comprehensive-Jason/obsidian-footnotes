import { describe, expect, it } from "vitest";

import { scanDocument } from "../../src/parsing/markdown-scan";
import { readNote } from "../../src/parsing/note-reading";

// Review B2 (2026-09-09): when a note ends inside an unclosed fence,
// comment, or math block, buildDefinitionAppend walks up from EOF to find
// the last line a definition can live after - and it used to re-slice and
// re-scan the prefix once per line, quadratic on a long note with the
// opener near the top. scanDocument now records endsProtectedAt[i], the
// answer the prefix probe used to compute, during the one walk it already
// makes. The first spec is the equivalence proof against the old probe; the
// timing pin lives in test/perf/ends-protected-at.perf.test.ts (excluded
// from Stryker's instrumented dry run, which is several times slower).

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

describe("scanDocument.endsProtectedAt", () => {
    it("equals the old prefix probe on every line, except where a later line closes an opener", () => {
        // REVISED 2026-09-16 (Kimi hunt cycle 3): an opener nothing in its
        // paragraph closes is literal text, and the scan looks ahead to
        // know. The prefix probe cannot see the closer, so on a line whose
        // NEXT line still carries the region the two disagree by design:
        // the full note's answer is the one the append needs.
        for (const lines of DOCS) {
            const scan = scanDocument(lines);
            const reading = readNote(lines);
            for (let i = 0; i < lines.length; i++) {
                const nextCarriesRegion = i + 1 < lines.length && reading.regionOpenAt(i + 1);
                if (nextCarriesRegion) continue;
                expect(scan.endsProtectedAt[i], `${JSON.stringify(lines)} @${i}`).toBe(
                    scanDocument(lines.slice(0, i + 1)).endsProtected,
                );
            }
            expect(scan.endsProtectedAt[lines.length - 1]).toBe(scan.endsProtected);
        }
    });

    it("reads false inside a closed frontmatter block", () => {
        const scan = scanDocument(["---", "title: t", "---", "body", "```", "code"]);
        expect(scan.endsProtectedAt.slice(0, 3)).toEqual([false, false, false]);
        expect(scan.endsProtectedAt[3]).toBe(false);
        expect(scan.endsProtectedAt[4]).toBe(true);
        expect(scan.endsProtected).toBe(true);
    });
});
