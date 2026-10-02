import { describe, expect, it } from "vitest";

import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: should Delete orphaned references leave alone a reference
// whose definition the user wrote but hid in a %% comment?
//
// What it does now: the note has "text[^k] here" and a %% block comment
// holding "[^k]: hidden". With Delete orphaned references on, the lint
// deletes the "[^k]" in the prose AND cuts "[^k]" out of the hidden label,
// leaving ": hidden" inside the comment. The alert that would say "Move it
// out of the comment" never speaks, because the label is gone. With the
// toggle off, the same note gets two alerts with opposite advice for one
// footnote ("Write its definition or delete the reference" and "Move it
// out of the comment").
// What a user might expect: the lazy-label precedent. A reference pointing
// at a definition the user wrote but misplaced "is not an orphan to
// delete ... deleting the reference would throw the user's work away".
// Both the prose reference and the hidden label stay, and the
// commented-definition alert speaks.
// Why it is a question and not a bug: ruling A1 (2026-09-15) made a
// commented label's "[^k]" a live reference that counts for orphans, so
// the deletion follows the rules as written. Whether a commented label
// joins the lazy label's exemption is Jason's call.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A9.
//
// Source of truth: ruling A1; the lazy-label comment in
// remove-orphaned-references.ts, quoted above (2026-09-09); ADR 0002.

/** Lint `doc` with the default settings plus `extra`. */
function lint(doc: string, extra: Record<string, unknown>): string {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, ...extra });
    return lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc));
}

describe("spec question: a definition misplaced in a %% comment and orphan deletion", () => {
    it.fails("Delete orphaned references keeps the commented label and the reference it would serve", () => {
        const after = lint("text[^k] here\n\n%%\n[^k]: hidden\n%%\n", { lintDeleteOrphanedReferences: true });
        // Today: "text here\n\n%%\n: hidden\n%%\n".
        expect(after).toContain("[^k]: hidden");
        expect(after).toContain("text[^k] here");
    });
});
