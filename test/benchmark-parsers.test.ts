import { describe, expect, it } from "vitest";

import { timeParsers } from "../src/commands/benchmark-parsers";

// The dev-only benchmark command (removed before 0.3.0 stable unless Jason
// says otherwise): its timing runs both readers on the note and counts the
// note's lines as the plugin does, Windows line breaks included.

describe("timeParsers", () => {
    it("counts the note's lines and times both readers", () => {
        const t = timeParsers("a[^1]\r\nb\r\n\r\n[^1]: def\r\n");
        expect(t.lines).toBe(5);
        expect(t.scannerMs).toBeGreaterThanOrEqual(0);
        expect(t.readerMs).toBeGreaterThanOrEqual(0);
    });
});
