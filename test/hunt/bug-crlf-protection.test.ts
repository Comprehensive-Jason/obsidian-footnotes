import { describe, expect, it } from "vitest";


import { footnotePrefix } from "../../src/parsing/footnote-prefix";
import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { readNote } from "../../src/parsing/note-reading";

// BUG: CRLF line endings defeat frontmatter protection AND the footnote-prefix
// feature. `protectedLines` and `footnotePrefix` both gate on the exact string
// `lines[0] === "---"`, but a CRLF document split on "\n" leaves "---\r" on
// line 0, so the check silently fails. On any Windows/synced (CRLF) note the
// frontmatter is treated as live text - references inside it are counted and get
// rewritten by reindex/lint/move - and the documented footnote-prefix property
// (issue #31) is ignored entirely.
// Hunt: 2026-07-17. Lenses: contexts / interactions / regressions. Severity: data-loss.
// fixed 2026-07-17: protectedLines/footnotePrefix strip a trailing "\r"; the
// whole-document transforms normalize CRLF->LF on entry and restore on exit.

describe("bug: CRLF defeats frontmatter protection and footnote-prefix", () => {
    it("protectedLines marks CRLF frontmatter lines as protected", () => {
        const flags = readNote(["---\r", "a: b\r", "---\r", "x[^1]\r"]).protectedLines;
        expect(flags).toEqual([true, true, true, false]);
    });

    it("a reference inside CRLF frontmatter does not reserve a number", () => {
        expect(
            computeNextFootnoteNumber("---\r\nnum: [^9]\r\n---\r\nreal[^1]"),
        ).toBe(2);
    });

    it("footnote-prefix is read from a CRLF frontmatter note", () => {
        expect(
            footnotePrefix("---\r\nfootnote-prefix: 2.\r\n---\r\nbody"),
        ).toBe("2.");
    });
});
