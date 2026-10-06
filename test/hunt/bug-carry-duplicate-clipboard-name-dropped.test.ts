import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// BUG (wrong output): a clipboard holding two definitions of one name,
// where the first matches text the destination already has, lands with no
// definition at all for the pasted reference.
//
// What the user would see: they paste text from another app that reads
// "a[^1]" followed by "[^1]: one" and "[^1]: two". Obsidian would show
// "two" for [^1] (the last definition of a name wins). The destination
// already has a footnote [^z] whose text is "one". After the paste, the
// pasted [^1] has no definition in the note, and "two" is not in the note
// at all. This only happens with a clipboard from outside the plugin,
// since the plugin's own copy never carries a name twice.
//
// Hunt 2026-10-02, round 1, lens carry-plan. Cluster C18.
//
// Source of truth: planCarriedPaste's own comment, "the last block of a
// name winning as it does in Obsidian", and the README's Paste paragraph,
// which promises the pasted footnotes land with their definitions.
//
// Cause: planCarriedPaste merges the first "[^1]" into [^z] and notes the
// name "1" as reused. The second "[^1]: two" then keeps the name "1",
// which undoes the pointing at [^z]. When it builds the list of
// definitions to append, it drops every carried definition whose name is
// in the reused list, so "[^1]: two" is dropped too, though it was never
// merged.

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("two clipboard definitions of one name, the first matching an existing body", () => {
    it("keeps a definition for the pasted reference", () => {
        // The source renders [^1] as "two" (the last wins); "one" already
        // exists in the destination as [^z].
        const plan = planCarriedPaste("z[^z]\n\n[^z]: one", "a[^1]", [one("1", "[^1]: one"), one("1", "[^1]: two")]);
        // The pasted [^1] must resolve to a definition the paste adds, the
        // one holding "two".
        const defined = plan.definitions.map((d) => d.name.toLowerCase());
        const target = /\[\^([^\]]+)\]/.exec(plan.body)?.[1] ?? "";
        expect(target === "z" ? "one" : defined.includes(target.toLowerCase()) ? "defined" : "ORPHAN").toBe("defined");
    });
});
