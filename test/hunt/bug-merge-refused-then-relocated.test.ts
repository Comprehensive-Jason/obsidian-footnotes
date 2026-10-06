import { describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes } from "../../src/linting/linter";
import { duplicateFootnoteDefinitionNames, mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): with Merge duplicate definitions on, the merge refuses a
// copy that sits between two lists, reindex then carries that copy to the
// end of the note, and only the NEXT lint merges it.
//
// What the user would see: a note defines [^a] twice, and the second copy
// sits between two bullet lists. Ctrl+S renumbers and reorders the
// definitions but leaves both copies of [^a], and no alert says so. A
// second Ctrl+S with nothing edited then merges them. Worse, the lint memo
// (which remembers a note it just linted and answers "No linting needed."
// to the next save of the same text) can hold that second lint back until
// the user edits the note.
//
// "Idempotent" means that running the lint a second time changes nothing:
// lint(lint(note)) equals lint(note).
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X27.
//
// Origin: pre-existing.
//
// Source of truth: the idempotence property of the lint pipeline
// (attack-surface.md, properties: f(f(doc)) === f(doc)); ADR 0002, the lint
// is never silent about what it leaves.
//
// Cause: lintFootnotes in src/linting/linter.ts runs the duplicate merge
// first and never again. The merge rightly refuses to cut a copy between
// two lists, since the lists would join. Reindex (or the move to the
// bottom) then puts that copy at the end of the note, where cutting it is
// clean, but the merge has already run. The duplicate alert, for its part,
// asks whether the merge would still refuse on the linted note; it would
// not, so the alert stays quiet.

describe("merge refused between two lists, then reindex moves the copies", () => {
    // [^9] is cited first, so reindex puts [^9]'s definition in the first
    // slot and moves both [^a] copies down one slot each. That leaves the
    // second copy at the end of the note.
    const doc = "x[^9]\n\n[^a]: one\n\n- x\n\n[^a]: two\n\n- y\n\n[^9]: nine";
    const options = { mergeDuplicateDefinitions: true };

    it("control: the merge alone refuses the cut between the lists", () => {
        expect(mergeDuplicateFootnoteDefinitions(doc)).toBe(doc);
        expect(duplicateFootnoteDefinitionNames(doc)).toEqual(["a"]);
    });

    // Now: once = "x[^1]\n\n[^1]: nine\n\n- x\n\n[^a]: one\n\n- y\n\n[^a]: two",
    // twice = "x[^1]\n\n[^1]: nine\n\n- x\n\n[^a]: one\n    two\n\n- y".
    it("the lint with Merge duplicate definitions on is idempotent", () => {
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    // Now: no alert at all after the first lint, though [^a] is still
    // defined twice.
    it("the duplicate alert after one lint names [^a] (never silent)", () => {
        resetNotices();
        const once = lintFootnotes(doc, options);
        noticeLintAlerts(fakePlugin({ lintMergeDuplicateDefinitions: true }), once);
        // When the first lint did merge the copies, there is nothing to say.
        if (duplicateFootnoteDefinitionNames(once).length === 0) return;
        expect(messages().some((m) => m.includes("more than once") && m.includes('"[^a]"'))).toBe(true);
    });

    // The same shape with named footnotes only, so reindex swaps the slots
    // without renumbering anything.
    // Now: once = "Text[^b]\n\n[^b]: three\n\n- x\n\n[^a]: one\n\n- y\n\n[^a]: two",
    // and the second lint merges the copies. (Fixed by leaving both copies
    // in their slots, so the test name says what it checks: one lint
    // settles the note.)
    it("named footnotes: a copy between two lists, which reindex used to swap to the end, is settled by the first lint", () => {
        const note = "Text[^b]\n\n[^a]: one\n\n- x\n\n[^a]: two\n\n- y\n\n[^b]: three";
        const once = lintFootnotes(note, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });
});
