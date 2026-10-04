// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 3 of 4 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// A quoted heading or thematic break cannot be lazily continued, so an
// indented chunk right after it (quoted or not) is indented code per
// CommonMark - but the scanner treats it as live lazy text, so lint
// renumbers and orphan-deletes the fake references inside the code.

describe("indented code after a quoted heading or thematic break", () => {
    it("a document-level chunk after a quoted heading is code", () => {
        const reading = readNote(["> # h", "    code[^9]", "", "[^9]: nine"]);
        expect(reading.protectedLines).toEqual([false, true, false, false]);
    });

    it("a document-level chunk after a quoted thematic break is code", () => {
        const reading = readNote(["> ***", "    code[^9]", "", "[^9]: nine"]);
        expect(reading.protectedLines).toEqual([false, true, false, false]);
    });

    it("a quoted chunk after a quoted heading is code inside the quote", () => {
        const reading = readNote(["> # h", ">     code[^9]", "", "[^9]: nine"]);
        expect(reading.protectedLines).toEqual([false, true, false, false]);
    });

    it("a quoted paragraph's indented lazy continuation stays live (control)", () => {
        const reading = readNote(["> para", ">     cont[^9]", "", "[^9]: nine"]);
        expect(reading.protectedLines).toEqual([false, false, false, false]);
    });
});
