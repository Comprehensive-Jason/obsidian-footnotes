// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// A quoted definition owns its lazy continuation lines and, after a run of
// empty quote lines, an indented quoted line (quotedDefinitionEnd's own
// contract, verified in Reading view 2026-09-16). Inside such a chunk the
// footnote carries on: micromark parses "> [^1]: body", "> cont", ">",
// ">     chunk[^73]" as one footnoteDefinition holding two paragraphs -
// "body cont" and "chunk[^73]" - so the reference in the chunk is LIVE.
// The column-0 twin ("[^1]: body", "cont", blank, "    chunk[^73]") reads
// exactly the same way, and the plugin gets THAT one right.
//
// The blockquote half of the indent tracker does not: quote.inDefinition
// is set afresh on every quoted line and is true only on LABEL lines, so
// the lazy continuation "> cont" resets it to false. A blank quote line
// later, the chunk reads as quoted indented CODE (quote.boundary &&
// !quote.inDefinition), and the reference inside it dies.
//
// What the user sees: they write a quoted footnote with a second
// paragraph in it, and the "[^73]" they cite there is live in Reading
// view but invisible to the plugin: reindex skips it, the orphan alert
// never names it, the numbered command hands its number out again, and a
// press on it falls through to inserting a new footnote into what the
// plugin thinks is code.
//
// Source of truth: micromark oracle (one footnoteDefinition, two
// paragraphs) + the plugin's own quotedDefinitionEnd, which owns the
// chunk - the two readers in markdown-scan.ts disagree about the same
// lines.
//
// Settings involved: none (the scan itself).

describe("a quoted definition's indented chunk after a blank quote line is live footnote text", () => {
    it("the chunk after a lazy continuation is not protected", () => {
        const lines = ["> [^1]: body", "> cont", ">", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false]);
    });

    it("the reference in the chunk is live", () => {
        const lines = ["> [^1]: body", "> cont", ">", ">     chunk[^73]"];
        expect(readNote(lines).referencesOn(3).map((o) => o.name)).toEqual(["73"]);
    });

    it("control: directly after the label line it is already live", () => {
        const lines = ["> [^1]: body", ">", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false]);
    });

    it("control: after a plain quoted paragraph it is quoted code", () => {
        const lines = ["> para", ">", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true]);
    });
});
