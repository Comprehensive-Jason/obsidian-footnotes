// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTIONS, not confirmed bugs: shapes where micromark (CommonMark
// 0.31) and the plugin's scanner disagree about whether text is dead, and
// the manual sheets do not record what Obsidian's Reading view does. Each
// needs a live check before it can be called a bug.
//
// (1) An HTML block of type 1, 3, 4, 5, or 6 INSIDE a container. Cycle 1
// probed those types at the DOCUMENT level in Reading view (dead text,
// pinned). Inside a blockquote or a list item the plugin's check is
// skipped ("Document level only", markdown-scan.ts), so a "[^x]:" label
// behind the tag is a lazy label with a live reference. CommonMark (via
// micromark) reads the tag's block INSIDE the container and the label is
// raw HTML. The comment type (type 2) IS handled inside quotes by the
// same scanner, which makes the omission look accidental rather than
// chosen.
//
// What the user would see if Reading view matches micromark: the
// lazy-definition alert advises a blank line above a label that is raw
// HTML inside the tag (the advice happens to heal it, by ending the
// tag's block - but for the wrong reason), and the missing-definition
// alert is avoided only by the lazy-label exemption's accident.
//
// (2) An HTML block of TYPE 7 at all: a complete open or closing tag
// alone on its line that is not in CommonMark's type-6 tag list
// ("<custom-el>"). micromark reads it as an HTML block (it cannot
// interrupt a paragraph, so at a block boundary it opens); the plugin
// has no type-7 handling at all, so the label behind it is a lazy label
// with a live reference. Cycle 1 explicitly scoped types 1,3,4,5,6 and
// left type 7 unprobed.
//
// Source of truth (if a live check confirms them): CommonMark 0.31's
// HTML-block rules via micromark, as run for this hunt.
//
// Settings involved: `Delete orphaned references`, `Fix definitions
// hidden by a missing blank line` and the two alerts.

describe("spec question: a type-6 HTML block inside a blockquote", () => {
    const doc = "> <div>\n> [^1]: x\n\nuse[^1]";

    it("needs a live check: is the quoted <div> dead text to Obsidian?", () => {
        // micromark: blockquote > html, the [^1] inside is dead; the
        // plugin reads the label as a lazy label whose [^1] is a live
        // reference, so the [^1] line is NOT protected
        expect(readNote(doc.split("\n")).protectedLines[1]).toBe(true);
    });

    it("the reference is a true orphan now: its only definition is raw HTML, so the rule may delete it", () => {
        // RESOLVED 2026-09-16: the quoted <div> is dead text in Reading
        // view (probed), so "[^1]" has no definition and is deleted like
        // any other orphaned reference when the toggle is on
        expect(removeOrphanedFootnoteReferences(doc)).toBe("> <div>\n> [^1]: x\n\nuse");
    });

    it("control: at the DOCUMENT level the same <div> is already dead (cycle-1 pin)", () => {
        expect(readNote("<div>\n[^1]: x\n\nuse[^1]".split("\n")).protectedLines[1]).toBe(true);
    });
});

describe("spec question: a type-6 HTML block inside a list item", () => {
    it("needs a live check: is the listed <div> dead text to Obsidian?", () => {
        expect(readNote("- <div>\n  [^1]: x\n\nuse[^1]".split("\n")).protectedLines[1]).toBe(true);
    });
});

describe("spec question: a type-7 HTML block (<custom-el>)", () => {
    it("needs a live check: is the label under <custom-el> dead text to Obsidian?", () => {
        // micromark: html block, dead; plugin: lazy label, live reference
        expect(readNote("<custom-el>\n[^1]: x\n\nuse[^1]".split("\n")).protectedLines[1]).toBe(true);
    });
});
