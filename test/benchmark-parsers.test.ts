import { describe, expect, it } from "vitest";

import { timeReading } from "../src/commands/benchmark-parsers";
import { readNote } from "../src/parsing/note-reading";

// The dev-only benchmark command (removed before 0.3.0 stable unless Jason
// says otherwise): its timing reads the note cold and after a
// one-character edit, and counts the note's lines as the plugin does,
// Windows line breaks included.

describe("timeReading", () => {
    it("counts the note's lines and times a cold read and a read after an edit", () => {
        const t = timeReading("a[^1]\r\nb\r\n\r\n[^1]: def\r\n");
        expect(t.lines).toBe(5);
        expect(t.coldMs).toBeGreaterThanOrEqual(0);
        expect(t.warmMs).toBeGreaterThanOrEqual(0);
    });

    it("leaves the reading of the note as it was, only forgotten and read again", () => {
        const lines = ["a[^1]", "", "[^1]: def"];
        const before = readNote(lines).definitions;
        timeReading(lines.join("\n"));
        expect(readNote(lines).definitions).toEqual(before);
    });
});
