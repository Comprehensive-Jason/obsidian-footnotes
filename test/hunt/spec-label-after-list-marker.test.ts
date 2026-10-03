// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 2 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-20 by Jason's ruling 1 (option b): a label right after a list marker is a definition to the orphan-reference alert and the hotkey (Reading view renders it, probed 2026-09-16).
// VERIFIED IN READING VIEW 2026-09-16, NOT YET FIXED: "- [^a]: def", "1. [^a]: def", and "> - [^a]: def" all render as definitions; a lazy line under the marker line joins the footnote, a following "- item" does not, and a continuation indented to the item's content column plus four does. Same scope question as bug-list-item-label-margin: waits for Jason's ruling.
import { describe, expect, it } from "vitest";

import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";
import {
    definitionStartLines,
    maskProtectedLines,
    scanDocument,
} from "../../src/parsing/markdown-scan";

// SPEC QUESTION: "- [^a]: def" - a footnote label written directly after
// a list item's marker, on the marker's own line. A definition, or a list
// item holding a live "[^a]" reference?
//
// micromark parses a footnoteDefinition inside the listItem (GFM:
// footnote definitions can occur anywhere block-level content is allowed,
// and a list item's content is block-level; the label starts the item's
// content, it does not interrupt anything). The plugin's label reader
// never strips a list marker, so the line reads as an ordinary item whose
// "[^a]" is a live reference pointing at nothing: the missing-definition
// alert nags, and the hotkey on it APPENDS a second "[^a]:" definition at
// the bottom (Obsidian then renders only the last, if it saw the first at
// all).
//
// Why this is a spec question and not a bug pin: sheet 14's rule (the
// Obsidian-specific one) covers labels UNDER prose lines, and its
// definition-start allowance list does not mention a list marker's line;
// the marker-line shape is unprobed in Reading view. The after-blank
// in-item twin (bug-list-item-label-margin) IS pinned as a bug because
// sheet 14 explicitly allows a label after a blank line and the only
// thing in the way there is the indent margin.
//
// NEEDS A LIVE CHECK: in Reading view, does "- [^a]: def" render as a
// footnote definition (superscript on "use[^a]" and an entry at the
// bottom), or as a list item whose text reads "[^a]: def"?
//
// Source of truth if Reading view agrees with micromark: the label after
// a list marker must count as a definition start, the reference must
// bind, and no rule may treat the line as plain item text. Settings
// involved: every definition-driven rule; the creation press inherits it
// through listExistingFootnoteDefinitions.

describe("spec: a footnote label directly after a list marker", () => {
    it("micromark's reading: the label on the marker line starts a definition", () => {
        const lines = "- [^a]: def\n\nuse[^a]".split("\n");
        const scan = scanDocument(lines);
        const masked = maskProtectedLines(lines, scan);
        expect(definitionStartLines(lines, scan, (i) => masked[i])[0]).toBe(true);
    });

    it("micromark's reading: \"use[^a]\" is not an orphaned reference", () => {
        expect(orphanedFootnoteReferenceNames("- [^a]: def\n\nuse[^a]")).toEqual([]);
    });

    it("control: a label directly UNDER a list item is lazy (sheet 14, settled)", () => {
        const lines = "- item\n[^a]: def".split("\n");
        const scan = scanDocument(lines);
        const masked = maskProtectedLines(lines, scan);
        expect(definitionStartLines(lines, scan, (i) => masked[i])[1]).toBe(false);
    });
});
