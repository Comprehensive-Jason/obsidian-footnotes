// Imported from the GLM 5.3 Flash cycle 6 hunt of 2026-09-16 (OpenCode worktree); 1 of 1 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (GLM hunt cycle 6, probed in Reading view): "para", "===" + tab renders as one paragraph with a literal "===" and the label under it as prose; the plugin's space-only underline patterns match Obsidian.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// SPEC QUESTION (GLM hunt, cycle after 9, 2026-09-16): a setext underline
// may be followed by tabs as well as spaces in CommonMark 0.31 (4.3: the
// underline is "optionally followed by spaces or tabs"). The repo's
// micromark oracle parses "para\n===\t" as a heading, and "[^1]: x" right
// under it starts a definition.
//
// The plugin's underline patterns all end in " *$" (blockEnder, the
// one-line-paragraph walk, setextUnderlineUnder, the underlined-label
// alert, lazyContinuation), so an underline with a trailing TAB is not an
// underline to the plugin: "para\n===\t\n[^1]: x" reads as one open
// paragraph and the label as lazy prose. If Reading view follows
// micromark here (as it did for every other setext shape the manual
// sheets record), the lint misreports a rendering definition and
// fix-lazy inserts a blank line the note never needed.
//
// Jason decides: probe Reading view with
//
//     para
//     ===	(tab here)
//
//     [^1]: x
//
// If the label renders as a definition, the underline patterns must
// accept trailing tabs ("[ \t]*$"); if it renders as prose, this pin is
// the wrong reading and should be deleted.
//
// Source of truth: CommonMark 0.31 §4.3 via the micromark oracle. Not
// probed in Reading view this cycle - the live app was out of scope.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (the alert/fix pair).

const doc = "para\n===\t\n[^1]: x\n\ntext[^1]";

describe("spec: does a trailing tab after a setext underline still make the heading?", () => {
    it("REFUTED: a trailing tab breaks the underline in Obsidian, so the paragraph goes on and the label is lazy", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).labelLines).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });
});
