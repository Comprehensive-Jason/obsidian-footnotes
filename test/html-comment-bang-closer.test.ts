import { describe, expect, it } from "vitest";

import { readNote } from "../src/parsing/note-reading";

/**
 * CHARACTERIZATION TESTS. These pin behaviour exactly as it already is, so
 * that a later change cannot quietly alter it. Nothing here is a bug fix.
 *
 * Background, in plain terms. An HTML comment normally ends with "-->".
 * The HTML5 standard also allows a rarer second spelling, "--!>". Obsidian
 * does not accept that second spelling, because it follows CommonMark
 * section 6.6, which says the closer is "-->" and nothing else. So in
 * Obsidian a comment written with "--!>" is still open, and whatever comes
 * after it is swallowed as hidden comment text.
 *
 * Probed in Obsidian 2026-10-02 through metadataCache sections, which is
 * this repo's ground truth for how Obsidian classifies a block:
 *
 *     "<!-- x -->"  then "MARK"   gives   html 0-0, paragraph 1-1
 *     "<!-- x --!>" then "MARK"   gives   html 0-1
 *     "<!-- x"      then "MARK"   gives   html 0-1
 *
 * The second and third lines up: a "--!>" behaves exactly like a missing
 * closer. The scanner already agrees with Obsidian on all three, and these
 * tests record that agreement.
 *
 * Why it is worth pinning. CodeQL's js/bad-tag-filter rule reads the
 * scanner's "-->" check as a defect and wants "--!>" accepted too (alert
 * #11, dismissed as "won't fix" on 2026-10-02). Accepting it would make the
 * plugin treat a line as live that Obsidian renders as hidden, across the
 * ten "-->" sites in markdown-scan.ts. If one of these tests fails because
 * someone followed that advice, the test is right and the change is wrong.
 */
describe("a comment is not closed by a bang closer (characterization)", () => {
    // The masked twin of a dead line is the same length, with every
    // character replaced by a NUL, so this builds what to expect.
    const dead = (line: string) => "\0".repeat(line.length);

    it("closes the comment on a plain closer, leaving the next line live", () => {
        const lines = ["<!-- hidden -->", "[^1]: a definition"];
        const scan = readNote(lines);
        const reading = readNote(lines);
        expect(lines.map((_, i) => reading.regionOpenAt(i))).toEqual([false, false]);
        expect(scan.protectedLines).toEqual([true, false]);
        // The definition is readable, so the plugin can act on it.
        expect(readNote(lines).maskedLine(1)).toBe("[^1]: a definition");
    });

    it("leaves the comment open on a bang closer, so the next line is dead", () => {
        const lines = ["<!-- hidden --!>", "[^1]: a definition"];
        const scan = readNote(lines);
        const reading = readNote(lines);
        expect(lines.map((_, i) => reading.regionOpenAt(i))).toEqual([false, true]);
        expect(scan.protectedLines).toEqual([true, true]);
        // Obsidian hides this line, so the plugin must not see a definition.
        expect(readNote(lines).maskedLine(1)).toBe(dead(lines[1]));
    });

    it("treats a bang closer the same as no closer at all", () => {
        const bang = ["<!-- hidden --!>", "MARK [^1]"];
        const none = ["<!-- hidden", "MARK [^1]"];
        const withBang = readNote(bang);
        const withNone = readNote(none);
        expect([readNote(bang).regionOpenAt(1)]).toEqual([readNote(none).regionOpenAt(1)]);
        expect(withBang.protectedLines).toEqual(withNone.protectedLines);
        expect(readNote(bang).maskedLine(1)).toBe(readNote(none).maskedLine(1));
        // Both swallow the reference on the second line.
        expect(readNote(bang).maskedLine(1)).toBe(dead("MARK [^1]"));
    });
});
