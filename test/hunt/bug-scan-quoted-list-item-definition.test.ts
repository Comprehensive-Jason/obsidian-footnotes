import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";

// BUG (data loss on default settings): a definition on a list item inside
// a blockquote, "> - [^a]: def", is not a definition to the plugin, so the
// default lint breaks its label and delete footnote leaves half of it.
//
// What the user would see: a blockquote or callout holds a list whose
// item is a definition, "> - [^a]: def.", and the note cites it with
// "x[^a]". Reading view shows it as footnote a. The default lint (the
// punctuation rule is on by default) rewrites the line to
// "> - :[^a] def.", so the definition is gone and its text is a stray
// line in the quote. The orphan-reference alert calls "[^a]" orphaned,
// and with Delete orphaned references on the lint cuts it. Delete footnote
// everywhere cuts only the label's brackets and leaves
// "> - : quoted item". "> 1. [^a]: def" behaves the same.
//
// Hunt 2026-10-02, round 2, lenses placement, context and delete.
// Cluster Q1.
//
// Source of truth: spec-label-after-list-marker (verified in Reading view
// 2026-09-16: "> - [^a]: def" renders as a definition, and micromark
// agrees) and Jason's ruling 1 of 2026-09-20 (list-item definitions are
// left as they are, never moved).
//
// Cause: inItemDefinitionLabels matches the list marker against the raw
// line, so a "> " in front hides it. The punctuation rule's colon guard
// only allows ">", "%", a NUL byte or whitespace in front of a label, not
// a list marker behind a quote.

describe("a list-item definition inside a blockquote", () => {
    it.fails("after (default): the punctuation rule leaves '> - [^a]: def.' its label", () => {
        const doc = "x[^a]\n\n> - [^a]: def.";
        // Today the last line becomes "> - :[^a] def.".
        expect(footnoteAfterPunctuation(doc, "after")).toBe(doc);
    });

    it.fails("'> - [^la]: text' is recognized like '- [^la]: text' (no orphan-reference alert for [^la])", () => {
        const doc = "> - [^la]: a quoted list-item definition\n\nuse[^la]";
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
    });

    it.fails("delete footnote everywhere removes the definition on a quoted list item, not just its label's brackets", () => {
        const plan = deleteFootnoteEverywhere("> - [^i]: quoted item\n\np[^i]", "i");
        // Today: "> - : quoted item\n\np".
        expect(plan.kind === "deleted" ? plan.markdown : plan.kind).not.toBe("> - : quoted item\n\np");
    });
});
