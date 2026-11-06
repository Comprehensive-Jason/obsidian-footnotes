import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// SPEC (annoyance): cutting a reference that a closing bracket or quote follows.
//
// What the user would see: deleting the footnote from "foo (see [^1]) bar" left
// "foo (see ) bar", with a stray space inside the bracket. The spaces typed in
// front of a reference belong to it, as they do when punctuation follows it
// (Jason's ruling Q35, 2026-10-09). Emphasis closers stay as they are:
// "**foo [^1]** bar" gives "**foo ** bar", since Obsidian still draws that bold
// (live answer H32).
//
// Delete footnote everywhere and the lint's orphan cut share cutOne, so both are
// tested here.
//
// Hunt 2026-11-06, cycle 9, finding H32. Severity: annoyance. Origin:
// pre-existing. Source of truth: the triage's choice, for Jason's objection,
// extending ruling Q35; the live answers H32 and H32b.

const deleted = (note: string) => {
    const plan = deleteFootnoteEverywhere(note, "1");
    return plan.kind === "deleted" ? plan.markdown : plan.kind;
};

describe("the spaces in front of a reference go when a closing bracket or quote follows", () => {
    const rows: [string, string][] = [
        ["foo (see [^1]) bar", "foo (see) bar"],
        ["foo [see [^1]] bar", "foo [see] bar"],
        ["foo {see [^1]} bar", "foo {see} bar"],
        ['he said "foo [^1]" then', 'he said "foo" then'],
        ["he said 'foo [^1]' then", "he said 'foo' then"],
        ["he said “foo [^1]” then", "he said “foo” then"],
        ["他说（来源 [^1]）然后", "他说（来源）然后"],
        ["(see  [^1]) bar", "(see) bar"],
        ["(see, [^1]) bar", "(see,) bar"],
    ];
    for (const [before, after] of rows) {
        it(`Delete: ${before}`, () => {
            expect(deleted(`${before}\n\n[^1]: x`)).toBe(after);
        });
        it(`the lint's orphan cut: ${before}`, () => {
            expect(removeOrphanedFootnoteReferences(before)).toBe(after);
        });
    }
});

describe("what stays", () => {
    const rows: [string, string][] = [
        // Emphasis closers: Obsidian still draws these (live answer H32).
        ["**foo [^1]** bar", "**foo ** bar"],
        ["*foo [^1]* bar", "*foo * bar"],
        ["==foo [^1]== bar", "==foo == bar"],
        ["~~foo [^1]~~ bar", "~~foo ~~ bar"],
        // A quote glued to the next word opens rather than closes.
        ['say [^1]"quoted" text', 'say "quoted" text'],
        ["say [^1]'quoted' text", "say 'quoted' text"],
        // A space between the reference and the closer is the user's own.
        ["foo (see [^1] ) bar", "foo (see ) bar"],
    ];
    for (const [before, after] of rows) {
        it(`characterization: ${before}`, () => {
            expect(deleted(`${before}\n\n[^1]: x`)).toBe(after);
        });
    }

    it("control: the same with punctuation, ruling Q35", () => {
        expect(deleted("foo [^1]. bar\n\n[^1]: x")).toBe("foo. bar");
    });
});
