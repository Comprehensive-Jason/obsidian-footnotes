// Imported from the opus-cycle-1 hunt of 2026-09-21 (OpenCode worktree); all pins flipped green 2026-09-21 after the fix.
// RESOLVED 2026-09-21 (probed: Obsidian reads the frontmatter behind a byte order mark, the Properties panel shows the properties). The scan and both prefix readers accept the mark in front of the opener.
// Opus hunt cycle 1 of 2026-09-20 (worktree opus-cycle-1). 3 of 4 tests
// carry it.fails; the control does not.
import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { footnotePrefix } from "../../src/parsing/footnote-prefix";

import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION, and the sharpest consequence yet of the one already filed
// in spec-bom-before-line-zero-label.test.ts: when a note starts with a
// UTF-8 byte order mark, the plugin sees NO FRONTMATTER AT ALL.
//
// scanDocument opens its head block only on `src[0] === "---"`, and
// footnotePrefix only on a first line that is exactly "---". A byte order
// mark sits in front of that "---", so both readers fall through, the whole
// frontmatter block is unprotected text, and every reference-shaped string
// inside a property value becomes a live footnote reference.
//
// What the user would see, with `Delete orphaned references` on:
//
//     <BOM>---                      <BOM>---
//     alias: see[^1] here     ->    alias: see here
//     ---                           ---
//
//     body[^2].                     body.[^1]
//
//     [^2]: d                       [^1]: d
//
// The lint has edited the note's METADATA: a property value the user sees
// in Obsidian's Properties panel lost text, because the plugin judged
// "[^1]" inside it to be an orphaned reference. Even with every deletion
// off, the same blindness shifts reindex: the frontmatter "[^1]" is counted
// as occurrence one, so "[^2]" in the body keeps its number instead of
// becoming "[^1]".
//
// This is the same unknown the earlier BOM pin turns on - whether Obsidian
// strips a leading byte order mark before parsing - but the blast radius is
// larger, so it is worth stating on its own. If Obsidian strips it (as
// every CommonMark implementation does), the frontmatter is real, the
// plugin is editing protected text, and the never-destroy policy (ADR 0002)
// is broken. If Obsidian does not strip it, Obsidian shows no properties
// either, the "---" lines are thematic breaks, and the lint is right.
//
// NEEDS A LIVE CHECK: save a note with a byte order mark in front of its
// frontmatter and see whether the Properties panel shows the properties.
// The same probe settles spec-bom-before-line-zero-label.
//
// Settings involved: `Delete orphaned references` for the metadata edit,
// `Reindex` for the numbering shift, and the per-note prefix feature (a
// "footnote-prefix" property behind a byte order mark is not read either).
//
// The tests below assert the strip-the-mark reading, so they fail today.

const BOM = "﻿";
const NOTE = `${BOM}---\nalias: see[^1] here\n---\n\nbody[^2].\n\n[^2]: d`;
const PLAIN = "---\nalias: see[^1] here\n---\n\nbody[^2].\n\n[^2]: d";

describe("spec question: a byte order mark in front of a note's frontmatter", () => {
    it("the frontmatter block is still protected text", () => {
        expect(readNote(NOTE.split("\n")).protectedLines.slice(0, 3)).toEqual([
            true, true, true,
        ]);
    });

    it("a lint never edits a property value", () => {
        expect(
            lintFootnotes(NOTE, {
                fixPunctuation: true,
                moveDefinitionsToBottom: true,
                reindex: true,
                removeOrphanedReferences: true,
                removeOrphanedDefinitions: true,
            }),
        ).toContain("alias: see[^1] here");
    });

    it("a \"footnote-prefix\" property behind the mark is still the note's prefix", () => {
        expect(footnotePrefix(`${BOM}---\nfootnote-prefix: 2.\n---\n\nbody`)).toBe("2.");
    });

    it("control: without the mark the frontmatter is protected and survives the lint whole", () => {
        expect(readNote(PLAIN.split("\n")).protectedLines.slice(0, 3)).toEqual([
            true, true, true,
        ]);
        expect(
            lintFootnotes(PLAIN, {
                fixPunctuation: true,
                moveDefinitionsToBottom: true,
                reindex: true,
                removeOrphanedReferences: true,
                removeOrphanedDefinitions: true,
            }),
        ).toContain("alias: see[^1] here");
        expect(footnotePrefix("---\nfootnote-prefix: 2.\n---\n\nbody")).toBe("2.");
    });
});
