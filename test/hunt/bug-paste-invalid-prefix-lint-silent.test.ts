import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): a paste that carries footnotes into a note with an
// invalid footnote prefix says nothing at all when Lint on footnote
// creation is on.
//
// What the user would see: the note's frontmatter sets
// "footnote-prefix: ch2", which the plugin cannot use, and the note cites
// "[^9]" with no definition. They paste text that carries a footnote. With
// Lint on footnote creation off, the paste speaks the lint's alerts, so
// they hear about the orphaned [^9]. With it on, the lint is cancelled by
// the bad prefix and nothing is said: no alert, and no word about the
// prefix either.
//
// Hunt 2026-10-02, round 2, lens interactions. Cluster I4.
//
// Source of truth: docs/adr/0002-never-silent-lint.md (lint is never silent about what it
// will not fix), and Lint on footnote creation's description (0be0563),
// which counts a paste as a creation.
//
// Cause: lintAfterFootnoteCreation says nothing when the prefix blocks the
// lint, because "the insert that just happened has already told the user
// about it" (linter.ts). A paste never reads the prefix, so nothing told
// the user anything.

const base = {
    carryFootnotesOnCopy: true,
    enablePopupEditor: false,
    insertAtEndOfWord: false,
    enableFootnotePrefix: true,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    enableRemoveBlankLastLines: true,
    removeEmptySectionHeading: false,
    footnotePlacement: "after",
    footnoteNaming: "keep",
    lintFixPunctuation: true,
    lintFixLazyDefinitions: true,
    lintMoveToBottom: true,
    lintReindex: true,
    lintApplyPrefix: true,
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
} as const;

// Pastes a carried footnote at the end of a note with an invalid prefix and returns every toast shown.
function pasteInto(lintOnFootnoteCreation: boolean): string[] {
    resetNotices();
    resetCarryRegister();
    const dest = ["---", "footnote-prefix: ch2", "---", "y[^9] z"];
    const at = { line: 3, ch: 7 };
    const doc = fakeEditor(dest, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    handlePaste(
        fakePlugin({ ...base, lintOnFootnoteCreation }, doc),
        {
            defaultPrevented: false,
            clipboardData: { types: ["text/plain"], getData: () => " a[^1] b\n\n[^1]: one", setData() {} },
            preventDefault() {},
            stopPropagation() {},
        } as never,
        doc,
    );
    return messages();
}

beforeEach(resetNotices);

describe("paste with an invalid note prefix", () => {
    it.fails("with lint on creation ON, the user still hears either the orphan alert or why the lint was cancelled", () => {
        const said = pasteInto(true);
        expect(said.some((m) => m.includes("[^9]") || m.includes("ch2"))).toBe(true);
    });
});
