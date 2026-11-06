import { describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// Two questions about the orphaned-definition rule, one about what the alert
// promises and one about what the deletion leaves behind.
//
// Hunt: 2026-09-13
// Lens: the two orphan rules (the alert half, and the text they hand back).
//
// -------------------------------------------------------------------
// Question one, settled by Jason's ruling of 2026-11-05: the
// orphaned-definition alert names the definitions that would go down with the
// one it names.
//
// The shape: "[^a]: uses[^b]" and "[^b]: chained". Nothing in the note
// references "a", so "[^a]" is an orphaned definition. The only thing
// referencing "b" is the body of "[^a]", so once "[^a]" goes, "[^b]" is an
// orphan too, and the rule deletes chains in one pass: turning the setting on
// removes both. The alert used to name only "a", so the user lost "[^b]"
// without being told.
//
// "[^b]" does not join the list of definitions nothing references, because
// the body of "[^a]" does reference it. It gets its own clause instead, which
// keeps the first half of the sentence true.
//
// Entry 3 of the spec sort of 2026-11-05.
//
// Source of truth: Jason's ruling above, ADR-0002, and the rule's own one-pass
// chain deletion, shown in the control below.
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

const alertPlugin = (settings: Record<string, unknown> = {}) =>
    fakePlugin({
        lintDeleteOrphanedReferences: false,
        lintDeleteOrphanedDefinitions: false,
        lintMergeDuplicateDefinitions: false,
        enableFootnotePrefix: false,
        ...settings,
    });

const CHAIN = "text\n\n[^a]: uses[^b]\n[^b]: chained";

/** The alert about definitions nothing references, for `doc`. */
function orphanAlert(doc: string, settings: Record<string, unknown> = {}): string | undefined {
    resetNotices();
    noticeLintAlerts(alertPlugin(settings), doc, false);
    return messages().find((m) => m.includes("nothing references"));
}

describe("the orphaned-definition alert and the chain it stands in for (Jason's ruling, 2026-11-05)", () => {
    it("names the second definition the deletion would take as well", () => {
        expect(orphanAlert(CHAIN)).toBe(
            'This note has a footnote definition nothing references ("[^a]"), and deleting it also takes "[^b]", which only it cites. Add a "[^a]" reference in the text, or delete the definition.',
        );
    });

    it("lists every definition one orphan takes, however long the chain", () => {
        expect(orphanAlert("text\n\n[^a]: uses[^b]\n[^b]: uses[^c]\n[^c]: last")).toBe(
            'This note has a footnote definition nothing references ("[^a]"), and deleting it also takes "[^b]" and "[^c]", which only it cites. Add a "[^a]" reference in the text, or delete the definition.',
        );
    });

    it("speaks in the plural when several orphans take something", () => {
        expect(orphanAlert("text\n\n[^a]: uses[^b]\n[^b]: chained\n[^x]: uses[^y]\n[^y]: chained\n[^z]: alone")).toBe(
            'This note has 3 footnote definitions nothing references ("[^a]", "[^x]", "[^z]"), and deleting them also takes "[^b]" and "[^y]", which only they cite. Add their references in the text, or delete the definitions.',
        );
    });

    it("control: a definition something else cites is not named as taken", () => {
        expect(orphanAlert("text[^b]\n\n[^a]: uses[^b]\n[^b]: cited")).toBe(
            'This note has a footnote definition nothing references ("[^a]"). Add a "[^a]" reference in the text, or delete the definition.',
        );
    });

    it("control: two definitions that cite each other are not orphans, and something citing them takes neither", () => {
        expect(orphanAlert("text\n\n[^h]: uses[^a]\n[^a]: uses[^b]\n[^b]: uses[^a]")).toBe(
            'This note has a footnote definition nothing references ("[^h]"). Add a "[^h]" reference in the text, or delete the definition.',
        );
    });

    it("control: with the setting on, an orphan the lint could not cut takes nothing, so the alert names no chain", () => {
        // the definition keeps two lists apart, so the rule leaves it, and "[^b]" stays with it
        const doc = "text\n\n1. one\n\n[^a]: uses[^b]\n\n2. two\n\n[^b]: chained";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(doc);
        resetNotices();
        noticeLintAlerts(alertPlugin({ lintDeleteOrphanedDefinitions: true }), doc);
        expect(messages().find((m) => m.includes("nothing references"))).toBe(
            'This note has a footnote definition nothing references ("[^a]"). The lint left it as it is, because deleting it would change how Obsidian reads the text around it. Add a "[^a]" reference in the text, or delete the definition by hand.',
        );
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
