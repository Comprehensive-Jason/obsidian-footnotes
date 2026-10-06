import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// Settled behaviour: when Delete footnote everywhere refuses because the
// definition holds others inside it (indented definitions under it, "held"
// definitions), the refusal names every held definition, each name once.
//
// The note is "Text[^c].", then "[^a]: outer" holding "    [^b]: bee" and
// "    [^c]: cee". Deleting a is refused with: Nothing was deleted: the
// "[^b]:" and "[^c]:" definitions sit inside the "[^a]:" definition, which
// cutting it would take too. Move them out, or delete them by hand.
//
// This started as an open spec question from the hunt (2026-10-05, round
// 2, lens lint, cluster L10): the refusal named only the FIRST held
// definition ([^b], which nothing references), so a user who deleted it by
// hand and tried again was refused a second time, now naming [^c]. Jason's
// triage decision Q6 (2026-10-05) settled it: name them all, so one fix by
// hand is enough.
//
// Source of truth: Jason's triage decision Q6, 2026-10-05; the refusal's
// own comment in delete-footnote.ts ("Cutting the outer block would cut
// the inner definition too"; fc3957c); ADR 0001 (hand-typed nesting is
// reported, never destroyed).

describe("the nested refusal names the held definitions", () => {
    it("names both [^b]: and [^c]:", () => {
        const note = ["Text[^c].", "", "[^a]: outer", "", "    [^b]: bee", "", "    [^c]: cee"].join("\n");
        const plan = deleteFootnoteEverywhere(note, "a");
        expect(plan.kind).toBe("refused");
        const reason = plan.kind === "refused" ? plan.reason : "";
        expect(reason).toContain('"[^b]:"');
        expect(reason).toContain('"[^c]:"');
        expect(reason).toBe(
            'Nothing was deleted: the "[^b]:" and "[^c]:" definitions sit inside the "[^a]:" definition, which cutting it would take too. Move them out, or delete them by hand.',
        );
    });

    it("three held definitions are named with commas, each name once", () => {
        const note = ["Text[^c].", "", "[^a]: outer", "", "    [^b]: bee", "", "    [^c]: cee", "", "    [^d]: dee", "", "    [^B]: bee again"].join("\n");
        const plan = deleteFootnoteEverywhere(note, "a");
        const reason = plan.kind === "refused" ? plan.reason : "";
        expect(reason).toContain('the "[^b]:", "[^c]:", and "[^d]:" definitions sit inside the "[^a]:" definition');
    });

    it("one held definition keeps the singular sentence", () => {
        const note = ["Text[^b].", "", "[^a]: outer", "", "    [^b]: bee"].join("\n");
        const plan = deleteFootnoteEverywhere(note, "a");
        const reason = plan.kind === "refused" ? plan.reason : "";
        expect(reason).toBe(
            'Nothing was deleted: the "[^b]:" definition sits inside the "[^a]:" definition, which cutting it would take too. Move it out, or delete it by hand.',
        );
    });
});
