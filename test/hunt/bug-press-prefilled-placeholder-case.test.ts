import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { PrefixOnlyNotice, warnPrefilledReferenceIfInside } from "../../src/commands/press-guards";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong output): under a "p." footnote prefix, a numbered press
// inside the placeholder typed with a capital letter, "[^P.]", creates a
// definition named after the bare prefix.
//
// What the user would see: the note's prefix is "p." and the text holds
// "[^P.]", the in-progress placeholder typed with a capital P. A press
// inside it should stay put and show the prefix-only toast, as it does for
// "[^p.]". Instead it adds an empty "[^P.]: " definition at the bottom of
// the note.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G4. The press-side twin
// of bug-lint-placeholder-case-silent.
//
// Source of truth: Obsidian folds footnote names case-insensitively, so
// "[^P.]" IS the placeholder, and every other prefix comparison in the
// plugin folds case (the orphan-reference rule's exemption, reindex's
// prefixFolded). The guard's own docstring: "a press inside it must never
// create a footnote named after the bare prefix".
//
// Cause: warnPrefilledReferenceIfInside in src/commands/press-guards.ts
// builds the needle "[^p.]" from the prefix and finds it with
// emptyReferenceStart, an exact-case search, so "[^P.]" is never found.

/** A note whose frontmatter sets the footnote prefix "p.", with `body` on line 3. */
const note = (body: string) => ["---", 'footnote-prefix: "p."', "---", body];

describe("the prefilled-placeholder guard folds case", () => {
    beforeEach(resetNotices);

    it.fails("warns inside '[^P.]' under the prefix 'p.'", () => {
        const doc = fakeEditor(note("see [^P.] here"));
        // Today: false, and no toast
        expect(
            warnPrefilledReferenceIfInside(fakePlugin({ enableFootnotePrefix: true }), doc, null, { line: 3, ch: 6 }),
        ).toBe(true);
        expect(messages()).toEqual([PrefixOnlyNotice]);
    });

    it.fails("a numbered press inside '[^P.]' creates no definition named after the bare prefix", async () => {
        const lines = note("see [^P.] here");
        const doc = fakeEditor(lines, { cursor: { line: 3, ch: 6 }, edits: true, wholeDoc: true });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    enableFootnotePrefix: true,
                    insertAtEndOfWord: false,
                    enablePopupEditor: false,
                    enableFootnoteSectionHeading: false,
                    footnoteSectionHeading: "",
                    enableRemoveBlankLastLines: true,
                    lintOnFootnoteCreation: false,
                },
                doc,
            ),
        );
        // Today: the note gains "" and "[^P.]: " at the bottom
        expect(doc.lines).toEqual(lines);
    });
});
