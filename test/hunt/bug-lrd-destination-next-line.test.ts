// Imported from the GLM 5.3 Flash cycle 6 hunt of 2026-09-16 (OpenCode worktree); 4 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (GLM hunt, cycle after 9, 2026-09-16): CommonMark 4.7 lets a link
// reference definition's DESTINATION sit on the line after the label:
// "[foo]:" then "/url" is one definition block (the repo's micromark
// oracle parses it as definition(foo) with url "/url", exactly like the
// one-line form). A footnote label directly under that two-line block
// starts a definition, as it does under the one-line form - pinned by
// test/hunt/bug-label-after-prose-line-is-prose.test.ts for the single-line
// form, and by test/hunt/bug-label-under-multiline-lrd.test.ts for the
// TITLE-on-next-line form.
//
// The plugin's LinkReferenceDefinition regex insists the destination share
// the label's line, so "[foo]:" alone reads as paragraph text. "/url" is
// then a lazy paragraph continuation, and "[^1]: x" under it is judged
// LAZY - one blank line short of a definition - when Reading view (which
// followed micromark on the one-line and title-on-next-line probes)
// already renders it as a definition.
//
// What the user sees: the footnote works in Reading view, but the
// lazy-definition alert claims it is "shown as plain text" (a false
// report, against the never-silent policy's spirit), and with the fix
// enabled the lint inserts a blank line the note never needed.
//
// Source of truth: CommonMark 4.7 (the destination may follow on the next
// line) + micromark oracle output (definition:foo, footnoteDefinition:1)
// + the cycle-1/5 Reading view probes for the one-line and title-on-
// next-line forms of the same construct. A live probe of this exact
// two-line form would settle any residual doubt.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (wrong as a fix, wrong as an alert).

const doc = "[foo]:\n/url\n[^1]: x";

describe("a footnote label under a link reference definition whose destination follows on the next line", () => {
    it("starts a definition, as under the one-line and title-on-next-line forms", () => {
        const lines = doc.split("\n");
        // today: all false - the label reads lazy
        expect(readNote(lines).labelLines).toEqual([
            false,
            false,
            true,
        ]);
    });

    it("is not named by the lazy-definition alert", () => {
        const lines = doc.split("\n");
        expect(lazyDefinitionLabelNames(lines)).toEqual([]);
    });

    it("fix-lazy leaves the note alone", () => {
        expect(fixLazyDefinitions(doc)).toBe(doc);
    });

    it("the same for the three-line form (destination, then title on the next line)", () => {
        const lines = "[foo]:\n/url\n   \"t\"\n[^1]: x".split("\n");
        // today: the label reads lazy under the destination line
        expect(readNote(lines).labelLines).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });
});
