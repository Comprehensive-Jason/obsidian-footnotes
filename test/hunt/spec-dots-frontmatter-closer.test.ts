// Imported from the opus-cycle-1 hunt of 2026-09-21 (OpenCode worktree); settled 2026-09-21.
// PROBED 2026-09-21: Obsidian does not take YAML's "..." as a frontmatter closer; the block never closes, the Properties panel shows nothing, and the three lines render as prose with the reference in the alias live. The scan and both prefix readers now close on "---" alone.
// Opus hunt cycle 1 of 2026-09-20 (worktree opus-cycle-1). 1 of 2 tests
// carries it.fails; the control does not.
import { describe, expect, it } from "vitest";

import { footnotePrefix } from "../../src/parsing/footnote-prefix";

import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: does Obsidian accept YAML's "..." end-of-document marker
// as a frontmatter closer?
//
//     ---
//     footnote-prefix: 2.
//     ...
//     body[^1]
//
// The plugin says yes, in three places that were written independently and
// agree: scanDocument's head-block loop (/^(---|\.\.\.)\s*$/), footnotePrefix's
// head walk, and footnotePrefixFromEditor's. So the plugin protects those
// three lines as frontmatter, reads the note's prefix out of them, and
// treats the first label below as a definition standing after a block.
//
// Nothing recorded settles whether Obsidian agrees. YAML 1.2 does end a
// document at "...", but Obsidian's frontmatter is not general YAML: it is
// the "---" block its own Properties panel writes, and every note Obsidian
// itself saves closes with "---". Two readings:
//
//   Reading one, Obsidian accepts it: the plugin's scan is right, and the
//   table reader (tableRowLinesOf), which has no scan and reads the "..."
//   line as prose, is the odd one out - the bug pinned in
//   bug-dots-frontmatter-closer-table-blind.
//
//   Reading two, Obsidian requires "---": then the block never closes, the
//   whole note is unclosed frontmatter to Obsidian, and the plugin is
//   protecting three lines Obsidian renders while reading a prefix property
//   the user cannot see. (The plugin already refuses to honor an UNCLOSED
//   block's prefix for exactly that reason - footnotePrefix's own comment,
//   2026-08-11 review, bug #11 - so it would be contradicting its own rule.)
//
// Either way a reader is wrong; which one is wrong depends on the answer.
//
// NEEDS A LIVE CHECK: write a note whose frontmatter closes with "...",
// open the Properties panel, and see whether Obsidian shows the property or
// shows nothing; then look at Reading view to see whether the three lines
// render as text.
//
// What hangs on the answer: under reading one the table reader gets the
// scan; under reading two the scan and both prefix readers drop "..." and
// the "..." pin's note becomes an ordinary unclosed-frontmatter note.
//
// Settings involved: the per-note prefix feature (the prefix half), and
// `Move definitions to the bottom` (the table half).
//
// The test below asserts reading TWO, so it fails today and flips only if
// the "..." closer is dropped. Its control pins what the plugin does now,
// so the pair reads as the open question rather than as a claim.

const DOTS = "---\nfootnote-prefix: 2.\n...\nbody[^1]\n\n[^1]: d";

describe("spec question: YAML's \"...\" as a frontmatter closer", () => {
    it("Obsidian needs \"---\": the block never closes, every line is prose, and there is no prefix", () => {
        expect(footnotePrefix(DOTS)).toBe("");
        expect(readNote(DOTS.split("\n")).protectedLines).toEqual([
            false, false, false, false, false, false,
        ]);
    });
});
