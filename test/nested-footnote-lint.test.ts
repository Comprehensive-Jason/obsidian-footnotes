import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../src/linting/linter";

// Regression guards for HAND-TYPED footnotes nested inside definitions
// (Jason's manual-testing report, 2026-08-13): the plugin refuses to
// CREATE them - at the caret (definition-caret-guard) and since
// 2026-08-24 in selections too (NestedFootnoteNotice; Discord-confirmed
// nobody wants nesting) - but users can still type them, and the linter
// must keep working on such notes without mangling or deleting content:
// prevention is creation-side, plus an ALERT (nested-footnote-alert
// tests), never a destructive rewrite. Nested content travels WITH its
// definition and every lint stays idempotent.

const base: LintOptions = {
    fixPunctuation: true,
    moveDefinitionsToBottom: true,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: false,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
};
const allOn: LintOptions = {
    ...base,
    removeOrphanedReferences: true,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: true,
};

function stable(doc: string, options: LintOptions): string {
    const once = lintFootnotes(doc, options);
    expect(lintFootnotes(once, options)).toBe(once);
    return once;
}

describe("lint survives footnotes nested inside definitions", () => {
    it("an inline footnote in a definition rides the reindex and move", () => {
        expect(
            stable(
                "alpha[^2] bravo[^1].\n\n[^1]: body with ^[an inline note] tail\n[^2]: two",
                base,
            ),
        ).toBe(
            "alpha[^1] bravo.[^2]\n\n[^1]: two\n[^2]: body with ^[an inline note] tail",
        );
    });

    it("an inline footnote on a CONTINUATION line stays with its block", () => {
        expect(
            stable(
                "alpha[^1].\n\n[^1]: first line\n    continued with ^[inline] here",
                base,
            ),
        ).toBe("alpha.[^1]\n\n[^1]: first line\n    continued with ^[inline] here");
    });

    it("a nested reference with its own definition keeps resolving", () => {
        expect(
            stable(
                "alpha[^2] bravo[^1].\n\n[^1]: body with [^3] nested\n[^2]: two\n\n[^3]: three",
                base,
            ),
        ).toBe(
            "alpha[^1] bravo.[^2]\n\n[^1]: two\n[^2]: body with [^3] nested\n[^3]: three",
        );
    });

    it("orphan deletion prunes a nested dead reference without touching the block", () => {
        expect(
            stable("alpha[^1].\n\n[^1]: body with [^9] nested", allOn),
        ).toBe("alpha.[^1]\n\n[^1]: body with nested");
    });

    it("a self-referencing definition neither loops nor loses itself", () => {
        expect(
            stable("alpha[^1].\n\n[^1]: body with [^1] itself", allOn),
        ).toBe("alpha.[^1]\n\n[^1]: body with [^1] itself");
    });

    it("a mid-document nested definition still gathers to the bottom", () => {
        expect(
            stable(
                "alpha[^1].\n\n[^1]: has ^[note] here\n\nprose after the definition[^2].\n\n[^2]: two",
                base,
            ),
        ).toBe(
            "alpha.[^1]\n\nprose after the definition.[^2]\n\n[^1]: has ^[note] here\n[^2]: two",
        );
    });
});
