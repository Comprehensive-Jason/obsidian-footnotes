import { describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// Two spec questions about the orphaned-definition rule, one about what the
// alert promises and one about what the deletion leaves behind. Both
// assertions are written for the reading that is red today.
//
// Hunt: 2026-09-13
// Lens: the two orphan rules (the alert half, and the text they hand back).
//
// -------------------------------------------------------------------
// Question one: should the orphaned-definition alert name the definitions
// that would go down with the one it names?
//
// The shape: "[^a]: uses[^b]" and "[^b]: chained". Nothing in the note
// references "a", so "[^a]" is an orphaned definition. The only thing
// referencing "b" is the body of "[^a]", so once "[^a]" goes, "[^b]" is an
// orphan too, and the rule deletes chains in one pass: turning the toggle
// on removes both. The alert the user reads before deciding names only "a".
//
// Reading one (leave the alert as it is): the alert answers the question
// "which definitions does nothing reference?", and the honest answer is
// "a". Listing "b" would make its own sentence false, because something
// does reference "b": the body of "[^a]". The doc comment on
// orphanedFootnoteDefinitionNames calls the chain-blind list deliberate
// for that reason.
//
// Reading two (name the whole chain): ADR-0002 promises "Every alert names
// the footnotes involved and the reason, so the user can fix by hand or
// opt into the destructive rule". A user weighing the toggle is deciding
// what they are about to lose, and "[^b]: chained" is part of that. The
// open question is wording, not principle: a clause like "and any
// definitions only it references" would say the true thing without making
// the first half false.
//
// Source of truth: ADR-0002 and the rule's own one-pass chain deletion,
// shown in the control below.
//
// -------------------------------------------------------------------
// Question two: should deleting the last block of a note leave the blank
// separator line behind?
//
// The shape: a note ending "[^1]: one" / blank / "[^orphan]: stray", with
// no newline at the end. Deleting the last definition block takes the label
// line but leaves the blank line that separated it, so the note comes back
// one line longer at the bottom than the user typed.
//
// Reading one (trim it): merge-duplicate-definitions, which shares
// removeLineRanges with this rule, has the opposite contract spelled out in
// its own comment: "Never hand back more blank lines at the end than the
// note started with". Two rules that share machinery should not disagree
// about the end of the note, and a line the user did not type is a line
// they did not type.
//
// Reading two (leave it): it is cosmetic and it is stable, so a second lint
// changes nothing and no text is lost. Trimming the end of a note is itself
// an edit the user did not ask for, and some people keep a trailing blank
// line on purpose.
//
// Source of truth: the merge rule's stated contract, pinned as a control
// below.

const alertPlugin = () =>
    fakePlugin({
        lintDeleteOrphanedReferences: false,
        lintDeleteOrphanedDefinitions: false,
        lintMergeDuplicateDefinitions: false,
        enableFootnotePrefix: false,
    });

const CHAIN = "text\n\n[^a]: uses[^b]\n[^b]: chained";

describe("the orphaned-definition alert and the chain it stands in for", () => {
    it.fails("names the second definition the deletion would take as well", () => {
        resetNotices();
        noticeLintAlerts(alertPlugin(), CHAIN);
        // the orphaned-definition alert itself: since 2026-10-22 the nested
        // alert names "[^b]" too, as the footnote inside "[^a]", which does
        // not answer the question
        expect(messages().some((m) => m.includes("nothing references") && m.includes("[^b]"))).toBe(true);
    });

    it("the alert does name the head of the chain", () => {
        resetNotices();
        noticeLintAlerts(alertPlugin(), CHAIN);
        expect(messages().some((m) => m.includes("[^a]"))).toBe(true);
    });

    it("turning the toggle on really does delete both", () => {
        expect(removeOrphanedFootnoteDefinitions(CHAIN)).toBe("text");
    });
});

describe("deleting the last definition block of a note", () => {
    it("leaves the end of the note where it was", () => {
        // today it comes back as "a[^1]\n\n[^1]: one\n", one line longer at
        // the bottom than it went in
        const doc = "a[^1]\n\n[^1]: one\n\n[^orphan]: stray";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("a[^1]\n\n[^1]: one");
    });

    it("the residue is at least stable: a second run changes nothing", () => {
        const once = removeOrphanedFootnoteDefinitions("a[^1]\n\n[^1]: one\n\n[^orphan]: stray");
        expect(removeOrphanedFootnoteDefinitions(once)).toBe(once);
    });

    it("the merge rule, which shares the same machinery, holds the opposite line", () => {
        // "Never hand back more blank lines at the end than the note
        // started with"
        expect(mergeDuplicateFootnoteDefinitions("a[^1]\n\n[^1]: one\n\n[^1]: dup")).toBe(
            "a[^1]\n\n[^1]: one\n    dup",
        );
    });
});
