import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";

import { planFootnoteRename } from "../../src/commands/rename-footnote";
import { simulateChanges } from "../../src/editor/insertion-liveness";

// BUG: with a footnote prefix armed, renaming a footnote to exactly the
// prefix is accepted, which turns the footnote's references and its
// definition into bare-prefix placeholders.
//
// What the user would see: the note's prefix is "3=" and the footnote is
// "[^3=1]". They open Rename footnote, and the modal preselects only the
// part after the prefix, so pressing Delete and then Enter submits the
// bare "3=". The rename goes through with no complaint, and every
// "[^3=1]" in the note plus its definition become "[^3=]": a shape the
// plugin treats as an unfinished footnote the user is still typing, not
// as a footnote. Two keystrokes, and the note is left full of
// placeholders.
//
// Hunt: 2026-09-13. Lens: the rename command under a prefix.
//
// Source of truth:
//  - GLOSSARY.md, "Placeholder": an empty reference ("[^]", or bare-prefix
//    "[^2.]") mid-naming is "an in-progress footnote owned by the user's
//    typing", not a footnote.
//  - manual sheet 08: a press inside an untouched "[^P-]" refuses with
//    "This footnote reference has only the prefix. Type a name after it."
//  - the press guards, the lint alerts, and remove-orphaned-references all
//    special-case the bare prefix, so every other part of the plugin
//    already agrees a bare-prefix reference is not a finished footnote.
//
// Separators are varied per the standing convention: "3=" here rather
// than the friendly "2.".

const doc = (lines: string[]) => fakeEditor(lines, { wholeDoc: true });

function prefixedDoc(prefix: string, name: string): string[] {
    return [
        "---",
        `footnote-prefix: ${prefix}`,
        "---",
        `text[^${name}] here`,
        "",
        `[^${name}]: body`,
    ];
}

describe("renaming to the bare prefix", () => {
    it("is refused as an invalid name", () => {
        const lines = prefixedDoc("3=", "3=1");
        expect(
            planFootnoteRename(doc(lines), "3=1", "3=", undefined, { sweepPrefix: "3=" }),
        ).toMatchObject({ kind: "invalid" });
    });

    it("leaves the reference and the definition alone", () => {
        const lines = prefixedDoc("3=", "3=1");
        const plan = planFootnoteRename(doc(lines), "3=1", "3=", undefined, {
            sweepPrefix: "3=",
        });
        const after = plan.kind === "renamed" ? simulateChanges(lines, plan.changes) : lines;
        expect(after[3]).toBe("text[^3=1] here");
        expect(after[5]).toBe("[^3=1]: body");
    });

    // The controls: a real name under the same prefix renames normally,
    // and so does a name typed without the prefix, which the armed rule
    // puts back on.
    it("a real name under the prefix still renames (control)", () => {
        const lines = prefixedDoc("3=", "3=1");
        expect(
            planFootnoteRename(doc(lines), "3=1", "3=7", undefined, { sweepPrefix: "3=" }),
        ).toMatchObject({ kind: "renamed", newName: "3=7", prefixAdded: false });
    });

    it("a bare name still gets the prefix put back on (control)", () => {
        const lines = prefixedDoc("3=", "3=1");
        expect(
            planFootnoteRename(doc(lines), "3=1", "7", undefined, { sweepPrefix: "3=" }),
        ).toMatchObject({ kind: "renamed", newName: "3=7", prefixAdded: true });
    });
});
