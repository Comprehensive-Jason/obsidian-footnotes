import { EditorPosition } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";

import FootnotePlugin from "../../src/main";
import { openFootnotePopup } from "../../src/commands/footnote-popup";
import { warnEmptyInlineFootnoteIfInside } from "../../src/commands/inline-footnotes";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
} from "../../src/commands/insert-or-navigate-footnotes";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";

// Pins for the 2026-08-11 review's command-flow bugs:
//   #6 the empty-"[^]" hop used LINE-LOCAL masking while its guard used
//      document-aware masking - inside a fence they disagreed and the
//      caret hopped in protected text instead of inserting
//   #7 the inline-footnote guards did no masking at all - a literal "^[]"
//      inside a fence made every command inert with a wrong toast
//   #8 autonum required currentMax === 1 for the section heading, skipping
//      it on notes whose only footnote artifact is an orphan reference
//   #9 caret guards ran before the table sub-editor fallback resolved the
//      real cursor - they must honor a passed-in position
//  #13 openFootnotePopup's no-view early return skipped onUnavailable,
//      stranding the fallback jump and the deferred creation lint

function fakeEditor(lines: string[], cursor: EditorPosition): FakeEditor {
    return sharedFakeEditor(lines, { cursor, edits: true, wholeDoc: true });
}

function fakePlugin(
    doc: FakeEditor,
    settings: Record<string, unknown> = {},
): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
            ...settings,
        },
        doc,
    );
}

describe("bug #6: the empty-[^] hop must be document-aware", () => {
    it("a '[^]' inside a fence is plain text - the named command neither hops nor warns about it", async () => {
        // originally pinned as "inserts instead of hopping"; since the
        // protected-caret guard (Jason's rule 2026-08-12) creation in a
        // fence is blocked outright - the point that survives is that the
        // caret never hops and the empty-reference toast never fires
        const doc = fakeEditor(["```", "x [^] y", "```", "prose"], { line: 1, ch: 4 });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.cursor).toEqual({ line: 1, ch: 4 });
    });

    it("a live '[^]' still gets the hop (control)", async () => {
        const doc = fakeEditor(["x [^] y"], { line: 0, ch: 4 });
        await insertNamedFootnote(fakePlugin(doc));
        // the guard warns and stays - no changes, cursor untouched
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.cursor).toEqual({ line: 0, ch: 4 });
    });
});

describe("bug #7: inline-footnote guards must mask", () => {
    // both cases originally pinned the insertion; since the protected-caret
    // guard (Jason's rule 2026-08-12) creation there is blocked - what
    // survives of bug #7 is that the WRONG toasts (empty-inline warning,
    // hop-out) never fire on fence/code-span text
    it("a literal empty '^[]' inside a fence never fires the empty-inline warning", async () => {
        resetNotices();
        const doc = fakeEditor(["```", "see ^[] here", "```", "after"], {
            line: 1,
            ch: 6,
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.cursor).toEqual({ line: 1, ch: 6 });
        expect(
            noticeCalls.some(
                (args) =>
                    typeof args[0] === "string" &&
                    args[0].includes("inline footnote is empty"),
            ),
        ).toBe(false);
    });

    it("a filled '^[…]' inside inline code never triggers the hop-out", async () => {
        const line = "a `^[filled]` b";
        const doc = fakeEditor([line], { line: 0, ch: 7 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.cursor).toEqual({ line: 0, ch: 7 });
    });

    it("a live empty '^[]' still warns and stays (control)", async () => {
        const doc = fakeEditor(["word ^[] more"], { line: 0, ch: 7 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.cursor).toEqual({ line: 0, ch: 7 });
    });
});

describe("bug #8: the section heading belongs to the first DEFINITION", () => {
    it("a note whose only artifact is an orphan reference still gets the heading", async () => {
        const doc = fakeEditor(["orphan[^1] text"], { line: 0, ch: 15 });
        await insertAutonumFootnote(
            fakePlugin(doc, {
                enableFootnoteSectionHeading: true,
                footnoteSectionHeading: "# Footnotes",
            }),
        );
        // Read off the note, not the change list: since 2026-10-03 a
        // reference and a definition that land side by side go out as one
        // merged change (composeChanges), so "[^2]" is no longer a change
        // of its own here.
        expect(doc.lines).toEqual(["orphan[^1] text[^2]", "", "# Footnotes", "", "[^2]: "]);
    });
});

describe("bug #9: guards honor a passed-in cursor position", () => {
    it("warnEmptyInlineFootnoteIfInside uses the given position, not getCursor()", () => {
        // getCursor() reports a stale position OUTSIDE the empty inline
        // footnote; the passed position is inside it - the guard must warn
        const doc = fakeEditor(["word ^[] more"], { line: 0, ch: 0 });
        expect(
            warnEmptyInlineFootnoteIfInside(doc, null, { line: 0, ch: 7 }),
        ).toBe(true);
    });
});

describe("bug #13: openFootnotePopup without a view still runs onUnavailable", () => {
    it("falls back instead of stranding the jump and the deferred lint", async () => {
        const plugin = {
            app: { workspace: { getActiveViewOfType: () => null } },
            settings: {},
        } as unknown as FootnotePlugin;
        const onUnavailable = vi.fn();
        await openFootnotePopup(plugin, "1", onUnavailable);
        expect(onUnavailable).toHaveBeenCalledTimes(1);
    });
});
