import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: Delete footnote everywhere on an underlined label that
// sits on a list item's bullet line: should the bullet stay, as it does
// for a plain definition in a list item?
//
// What it does now: a list reads "- a", "- [^1]: def", "  ---", "- c",
// and a paragraph cites [^1]. The "  ---" right under the label makes
// "[^1]: def" a heading inside the second item (an underlined label), not
// a definition. Delete footnote everywhere deletes the label's line and
// its underline whole, bullet and all: the list goes from three items to
// two ("- a", "- c").
// What a user might expect: the bullet stays as an empty item, "- ", as
// it does for "- [^1]: def" with no underline (ruling 1, 2026-10-03; the
// README: "its bullet stays as an empty item, exactly as Obsidian's own
// delete leaves it"), or a refusal.
// Why it is a question and not a bug: an underlined label is not a
// definition to Obsidian, so ruling 1 does not cover it as written, and
// whether the command should treat it as the definition the user meant is
// Jason's call. The test below accepts either an empty item left behind
// or a refusal.
//
// Hunt 2026-10-06, cycle 4, lens labels. Cluster B4.
//
// Origin: pre-existing.
//
// Source of truth: ruling 1 (2026-10-03) and the README's Delete
// footnote everywhere paragraph, quoted above.

describe("spec question: an underlined label on a list item's marker line", () => {
    it("control: a plain in-item definition keeps its bullet", () => {
        const plan = deleteFootnoteEverywhere(["- a", "- [^1]: def", "- c", "", "Use[^1]"].join("\n"), "1") as { kind: string; markdown?: string };
        expect(plan.markdown?.split("\n")).toContain("- ");
    });

    it.fails("the underlined one keeps its bullet too", () => {
        const plan = deleteFootnoteEverywhere(["- a", "- [^1]: def", "  ---", "- c", "", "Use[^1]"].join("\n"), "1") as { kind: string; markdown?: string };
        // Today the plan deletes, and its note reads "- a", "- c", "", "Use".
        expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes("- ")).toBe(true);
    });
});
