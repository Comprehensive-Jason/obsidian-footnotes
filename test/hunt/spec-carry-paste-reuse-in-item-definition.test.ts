// RULED 2026-10-03 by Jason's ruling 1, option a (a definition inside a list item is modelled everywhere, like any other; the runtime swap, step 1): a paste reuses a matching definition the destination holds in a list item. The question below is kept as it was asked.
import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: should a carried paste reuse a matching definition that
// the destination holds inside a list item?
//
// What it does now: the destination note defines "[^q]: same" inside a
// list item ("- [^q]: same"). A paste carries "a[^1]" with "[^1]: same",
// the same text. The paste does not see the list-item definition, so it
// adds a second definition with the same text instead of pointing the
// pasted reference at [^q]. The same definition inside a blockquote is
// reused.
// What a user might expect: the README promises "A definition the
// destination already has (same text, whatever its name) is reused".
// Why it is a question and not a bug: Jason's ruling 1 (2026-09-20, commit
// f098798) recognised in-item definitions in a chosen list of readers, and
// copy and paste (issue #59, 0.3.0) came later and is not on it. This is
// the destination side of round 3's E7
// (spec-lint-in-item-definitions-alerts-and-carry), which asks the same of
// the copy side.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR5.
//
// Source of truth: the README's Paste paragraph, quoted above, and ruling
// 1.

describe("spec question: a paste whose definition the destination holds in a list item", () => {
    it("a body the destination holds in an in-item definition is reused", () => {
        const plan = planCarriedPaste("t[^q]\n\n- [^q]: same", "a[^1]", [{ name: "1", lines: ["[^1]: same"] }]);
        // Today: body "a[^1]", added 1, reused 0.
        expect(plan).toMatchObject({ body: "a[^q]", reused: 1, added: 0 });
    });
});
