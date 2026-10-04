import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// Sol re-review bug #1 (2026-08-10): a fence opened on a list-item line
// ("10. ```", "  - ```") closes with a fence indented to the ITEM'S
// content column - but the closer test only accepted 0-3 absolute spaces,
// so the fence ran to EOF: every reference and definition below the list
// went invisible (duplicate autonumbers, reindex severing pairs). The
// fence now records its container's content indent and accepts closers
// indented up to that + 3 - the same one-level-deeper class as the
// bug-list-item-fence fix.

describe("fences in list items accept content-indented closers", () => {
    it("a double-digit ordered item's fence closes at its content column", () => {
        const doc = "10. ```\n    fake[^1]\n    ```\n\nafter[^2]\n\n[^2]: def";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            true,
            true,
            true,
            false,
            false,
            false,
            false,
        ]);
    });

    it("a nested bullet's fence closes at its content column", () => {
        const doc = "- outer\n  - ```\n    fake[^1]\n    ```\n\nafter[^2]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            false,
            true,
            true,
            true,
            false,
            false,
        ]);
    });

    it("a plain fence still requires a closer within 3 spaces", () => {
        const doc = "```\ncode\n    ```\nstill code\n```\nafter";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            true,
            true,
            true,
            true,
            true,
            false,
        ]);
    });

    it("an unclosed list fence dies with its item (ruling A3, 2026-09-15; it used to protect to the end of the note)", () => {
        // "swallowed" sits at column 0, outside the item whose content
        // column is 4, so the item and its fence are over. Obsidian renders
        // "swallowed" as prose. The blank line before it belongs to nothing
        // (the note reading, runtime swap step 2, 2026-10-03; the scanner
        // kept it inside the fence).
        const doc = "10. ```\n    code\n\nswallowed";
        const reading = readNote(doc.split("\n"));
        expect(reading.protectedLines).toEqual([true, true, false, false]);
        expect(reading.openRegionFrom !== -1).toBe(false);
    });
});
