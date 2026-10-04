import { describe, expect, it } from "vitest";

import { maskProtectedLines, maskedLineAt } from "../src/parsing/markdown-scan";
import { readNote } from "../src/parsing/note-reading";

// Perf helper (2026-08-07): the per-keypress paths need exactly ONE line of
// the document's masked twin; maskedLineAt must agree with the full
// maskProtectedLines on every line, while only paying inline-masking cost
// for the line asked about.

describe("maskedLineAt", () => {
    const cases: string[][] = [
        ["plain text [^1] here", "more `code [^2]` text"],
        ["```", "fenced [^3] fake", "```", "after"],
        ["---", "footnote-prefix: 2.", "---", "body [^4]"],
        ["a <!-- [^5] --> b", "> quoted ```", "> still [^6] fenced"],
        // multi-line comment BOUNDARY lines: live before the opener and
        // after the closer, masked in between (fixed 2026-08-10)
        ["live[^7] <!-- open", "interior [^8]", "--> tail[^9]"],
        // escape, code-span, and short-form openers never start comments
        ["\\<!-- literal", "x `<!--` y", "short <!--> form", "live[^10]"],
    ];

    it("matches maskProtectedLines line by line", () => {
        for (const lines of cases) {
            const full = maskProtectedLines(lines);
            for (let i = 0; i < lines.length; i++) {
                expect(maskedLineAt(lines, i)).toBe(full[i]);
            }
        }
    });

    it("returns an empty string for an out-of-range index", () => {
        expect(maskedLineAt(["only line"], 5)).toBe("");
        expect(maskedLineAt([], 0)).toBe("");
    });
});

// What the masked twin blots on a line, now read off the note reading
// (runtime swap, step 2, 2026-10-03; the one-line masker these tests used
// to drive is gone): code spans and comments claim content leftmost-first,
// as CommonMark and Obsidian read them, and a comment may run on into the
// lines of its paragraph.
describe("the masked twin of a line", () => {
    const NUL = (n: number) => "\0".repeat(n);

    it("masks a comment from its opener to the end of the line when a later line of the paragraph closes it", () => {
        const lines = ["ab <!-- open", "gone --> live"];
        expect(maskedLineAt(lines, 0)).toBe("ab " + NUL("<!-- open".length));
        expect(readNote(lines).regionOpenAt(1)).toBe(true);
        // the line the comment closes on is masked up to its closer
        expect(maskedLineAt(lines, 1)).toBe(NUL("gone -->".length) + " live");
    });

    it("a comment claims backticks inside it; code claims openers inside it", () => {
        // comment first: its closer inside the backticks still closes it
        expect(maskedLineAt(["x <!-- a `--> ` b"], 0)).toBe("x " + NUL("<!-- a `-->".length) + " ` b");
        // code first: the opener inside the span never starts a comment
        expect(readNote(["`<!--` b", "after -->"]).regionOpenAt(1)).toBe(false);
    });

    it("escaped openers of both kinds are literal", () => {
        expect(maskedLineAt(["\\<!-- x"], 0)).toBe("\\<!-- x");
        expect(maskedLineAt(["\\`not code` x"], 0)).toBe("\\`not code` x");
    });

    it("a comment opener nothing in its paragraph closes is literal text", () => {
        expect(maskedLineAt(["a <!-- b", "c"], 0)).toBe("a <!-- b");
        expect(readNote(["a <!--> b", "c"]).regionOpenAt(1)).toBe(false);
        expect(readNote(["a <!---> b", "c"]).regionOpenAt(1)).toBe(false);
    });
});

// REVERSED 2026-08-10: Jason verified live that "$" inside a footnote
// reference is id text, not math - nearby dollar-signed ids never pair
describe("dollars inside references vs math", () => {
    it("two dollar-signed ids on one line never pair into math", () => {
        const line = "b[^a$9] a[^a$4] end";
        expect(maskedLineAt([line], 0)).toBe(line);
    });

    it("a reference BETWEEN two dollars is still math content", () => {
        const masked = maskedLineAt(["cost $[^7]$ real[^1]"], 0);
        expect(masked).toBe("cost " + "\0".repeat("$[^7]$".length) + " real[^1]");
    });
});
