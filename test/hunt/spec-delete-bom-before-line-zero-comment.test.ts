import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

// spec question: when a note starts with a byte order mark, does a "%%"
// comment opener or a code fence opener on line 0 still open its region?
//
// A byte order mark is an invisible character that some editors put at the
// very start of a file. It sits in front of line 0, so a construct that has
// to start that line is, to the plugin's scanner, no longer at its start.
//
// What it does now: the scanner misses the opener on line 0 and takes the
// CLOSER two lines down for an opener, so the region runs on to the end of
// the note and swallows the real prose and footnotes below it. With a
// label inside the comment and Delete orphaned definitions on, the lint
// deletes everything after line 0. The same mistake shows on other faces:
// with a fence, Delete orphaned references erases the "[^1]" inside the
// code block, and the orphan alert names it; with a "%%" comment, the
// commented-definition alert calls the live [^2] below commented out.
//
// What a user might expect: the note reads as if the mark were not there.
// Obsidian reads the frontmatter behind a byte order mark (probed for
// spec-bom-hides-the-frontmatter-block, resolved 2026-09-21, fixed in
// bca376c), and CommonMark parsers strip a leading mark before parsing.
//
// Why it is a question and not a bug: the fix of bca376c covers the "---"
// frontmatter opener only, and the open spec question
// spec-bom-before-line-zero-label asks the same thing for a definition
// label on line 0. Whether Obsidian's own "%%" syntax is read through the
// mark has not been probed. This pin is that question's data-loss face; it
// is settled together with spec-bom-before-line-zero-label.
//
// Needs a Reading-view check: a note starting with a byte order mark then
// "%%", "[^1]: x", "%%", and prose below.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E3.
//
// Source of truth: the recorded Reading-view fact that Obsidian reads the
// frontmatter through a leading byte order mark, CommonMark's leading-BOM
// handling, and the plugin's own policy that a lint never destroys what the
// user wrote (ADR-0002, never-silent).

// "\ufeff" is the byte order mark
const BOM = "\ufeff";

describe("spec question: a byte order mark in front of a line-0 %% comment opener", () => {
    it("Delete orphaned definitions never deletes the prose below the comment", () => {
        const withLabel = [BOM + "%%", "[^1]: x", "%%", "", "Real prose here[^2] that matters.", "", "[^2]: two"].join("\n");
        // Today: the whole note after line 0 is deleted, leaving only the
        // byte order mark and "%%".
        expect(lintFootnotes(withLabel, { removeOrphanedDefinitions: true })).toContain("Real prose here");
    });

    it("control: without the mark the same note lints cleanly", () => {
        const plain = ["%%", "[^1]: x", "%%", "", "Real prose here[^2] that matters.", "", "[^2]: two"].join("\n");
        expect(lintFootnotes(plain, { removeOrphanedDefinitions: true })).toContain("Real prose here");
    });
});
