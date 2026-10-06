import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: when Delete footnote everywhere refuses because the
// definition holds others inside it (indented definitions under it, "held"
// definitions), should the refusal name every held definition, or only
// the first?
//
// What it does now: the refusal names the FIRST definition held inside
// [^a], whether or not anything references it. Here nothing references
// [^b], and the text references [^c], the definition the refusal exists
// to protect. A user who deletes [^b] by hand and tries again is refused
// a second time, now naming [^c].
// What a user might expect: one refusal that names both "[^b]:" and
// "[^c]:", so one fix by hand is enough.
// Why it is a question and not a bug: the refusal is right to refuse, and
// what it names is UI text. Whether to name every held definition, or
// only the ones the text still references, is Jason's call.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L10.
//
// Source of truth: the refusal's own comment in delete-footnote.ts
// ("Cutting the outer block would cut the inner definition too, and the
// text citing it would be left with nothing"; fc3957c); Jason's decision
// (2026-10-05): Delete footnote everywhere refuses on an outer definition
// that holds another.
//
// Cause, for whoever takes it up: the refusal takes the first held
// definition (definitionsHeldBy(...).find) and names that one alone.

describe("the nested refusal names the held definitions", () => {
    it.fails("names both [^b]: and [^c]:", () => {
        const note = ["Text[^c].", "", "[^a]: outer", "", "    [^b]: bee", "", "    [^c]: cee"].join("\n");
        const plan = deleteFootnoteEverywhere(note, "a");
        expect(plan.kind).toBe("refused");
        // Today: 'Nothing was deleted: the "[^b]:" definition sits inside the "[^a]:" definition, ...'.
        const reason = plan.kind === "refused" ? plan.reason : "";
        expect(reason).toContain('"[^b]:"');
        expect(reason).toContain('"[^c]:"');
    });
});
