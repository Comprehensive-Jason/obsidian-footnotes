import { describe, expect, it } from "vitest";

import FootnotePlugin from "../src/main";
import { lintFootnotes } from "../src/linting/linter";
import { nameAlreadyUsed } from "../src/editor/notice";
import {
    planFootnoteRename,
    renameTargetAtCursor,
    renameTargetInSelection,
} from "../src/commands/rename-footnote";
import { simulateChanges } from "../src/editor/insertion-liveness";

import { fakeEditor } from "./helpers/fake-editor";

// Checks lifted off manual sheet 07, "Rename footnote" (prune of
// 2026-09-20). The sheet's own note is the fixture below, so what these
// tests say and what Jason would have done by hand line up.
//
// Replaced here:
//   - "rename to gamma renames the reference AND the definition, and the
//     toast counts the places" (the text half; the modal's own look and
//     the toast on screen stay on the sheet)
//   - "Renaming alpha to Beta: ... is already used by another footnote."
//   - "In Reading view the command is absent from the palette"
//   - the rule-OFF tail of the prefix check: a bare rename stays bare and
//     a later lint does not put the prefix back
//   - "Right-click on the fenced decoy above: no item"
//
// Still on the sheet, because only a person in the real app can judge
// them: the modal's prefill and feel, the toast's wording, one undo
// reverting the whole rename, the popup settling first, and the menu
// item's pencil icon.

// The sheet's note, trimmed to the lines the checks actually touch. Line
// numbers matter below, so they are spelled out beside each one.
const NOTE = [
    /* 0 */ "---",
    /* 1 */ "footnote-prefix: p.",
    /* 2 */ "---",
    /* 3 */ "Two footnotes[^alpha] and[^Beta], a prefixed one[^p.1], a right-click fixture here[^menu].",
    /* 4 */ "",
    /* 5 */ "```",
    /* 6 */ "fake [^alpha] inside code, decoy [^menu] too",
    /* 7 */ "```",
    /* 8 */ "",
    /* 9 */ "[^alpha]: first definition",
    /* 10 */ "[^Beta]: second definition",
    /* 11 */ "[^p.1]: prefixed fixture definition",
    /* 12 */ "[^menu]: the definition to rename",
];

/** A reader-only editor over the sheet's note: the planners never write. */
function sheetDoc() {
    return fakeEditor(NOTE, { wholeDoc: true });
}

// Where things sit on line 3 of the note above.
const ALPHA_INSIDE = { line: 3, ch: 16 }; // inside "[^alpha]"
// ...and on line 6, the fenced decoy line.
const DECOY_MENU_START = 33; // "[^menu]" begins here
const DECOY_MENU_END = 40; // one past its "]"

describe("sheet 07: renaming the fixture footnote", () => {
    it("the caret inside [^alpha] names that footnote", () => {
        expect(renameTargetAtCursor(sheetDoc(), ALPHA_INSIDE)).toBe("alpha");
    });

    it("renaming alpha to gamma rewrites the reference and the definition, in two places", () => {
        const plan = planFootnoteRename(sheetDoc(), "alpha", "gamma");
        expect(plan).toMatchObject({ kind: "renamed", count: 2 });
        if (plan.kind !== "renamed") throw new Error("unreachable");
        const after = simulateChanges(NOTE, plan.changes);
        expect(after[3]).toContain("[^gamma]");
        expect(after[9]).toBe("[^gamma]: first definition");
        // the fenced copy and every other footnote are left exactly as they were
        expect(after[6]).toBe(NOTE[6]);
        expect(after[10]).toBe(NOTE[10]);
        expect(after[11]).toBe(NOTE[11]);
        expect(after[12]).toBe(NOTE[12]);
    });

    it("renaming alpha onto the live [^Beta] is a collision, worded as the modal shows it", () => {
        expect(planFootnoteRename(sheetDoc(), "alpha", "Beta")).toEqual({
            kind: "collision",
        });
        expect(nameAlreadyUsed("Beta")).toBe(
            '"[^Beta]" is already used by another footnote.',
        );
    });
});

describe("sheet 07: the note's prefix and the apply-prefix lint rule", () => {
    // The rule is ARMED when the prefix feature and the "Apply the note's
    // footnote prefix" lint rule are both on. Armed, a bare new name is
    // written behind the prefix, because the next lint would do that
    // anyway. The smoke suite drives that half through the real modal
    // ("rename under an armed apply-prefix sweep adds the note's prefix
    // and says so"); what is pinned here is the rule turned OFF.
    const ARMED = { sweepPrefix: "p.", placeholderPrefix: "p." };
    const UNARMED = { placeholderPrefix: "p." };

    it("armed: typing a bare 5 writes [^p.5] and reports that it added the prefix", () => {
        expect(
            planFootnoteRename(sheetDoc(), "p.1", "5", undefined, ARMED),
        ).toMatchObject({ kind: "renamed", newName: "p.5", prefixAdded: true });
    });

    it("armed: keeping the prefix and typing p.5 adds nothing", () => {
        expect(
            planFootnoteRename(sheetDoc(), "p.1", "p.5", undefined, ARMED),
        ).toMatchObject({ kind: "renamed", newName: "p.5", prefixAdded: false });
    });

    it("rule off: the bare 5 stays bare, and a later lint leaves it bare", () => {
        const plan = planFootnoteRename(sheetDoc(), "p.1", "5", undefined, UNARMED);
        expect(plan).toMatchObject({ kind: "renamed", newName: "5", prefixAdded: false });
        if (plan.kind !== "renamed") throw new Error("unreachable");
        const renamed = simulateChanges(NOTE, plan.changes).join("\n");
        expect(renamed).toContain("[^5]:");
        expect(renamed).not.toContain("[^p.5]");
        // the lint rule is off, so nothing hands the prefix back
        expect(lintFootnotes(renamed, { applyNotePrefix: false })).not.toContain("p.5");
        // and with the rule on it WOULD, which is the difference the sheet drew
        expect(lintFootnotes(renamed, { applyNotePrefix: true })).toContain("[^p.");
    });
});

describe("sheet 07: the right-click menu's own lookup", () => {
    // The menu asks renameTargetInSelection, exactly as the command does.
    // Code is not a footnote, so a click or a word selection on the fenced
    // decoy finds nothing and no menu item is added.
    it("finds nothing on the fenced decoy, clicked or word-selected", () => {
        const doc = sheetDoc();
        const caret = { line: 6, ch: DECOY_MENU_START + 3 };
        expect(renameTargetInSelection(doc, caret, caret)).toBeNull();
        expect(
            renameTargetInSelection(
                doc,
                { line: 6, ch: DECOY_MENU_START },
                { line: 6, ch: DECOY_MENU_END },
            ),
        ).toBeNull();
    });

    it("control: the same lookup does find the live [^menu] on the prose line", () => {
        const doc = sheetDoc();
        const menuStart = NOTE[3].indexOf("[^menu]");
        expect(
            renameTargetInSelection(
                doc,
                { line: 3, ch: menuStart },
                { line: 3, ch: menuStart + "[^menu]".length },
            ),
        ).toBe("menu");
    });
});

describe("sheet 07: the command's palette check in Reading view", () => {
    // The Rename footnote command is registered with
    // `checkCallback: checking => !!this.editableMarkdownView()`, so what
    // decides whether the palette lists it is that one method. In Reading
    // view it answers null and the palette leaves the command out.
    function pluginWithMode(mode: string): FootnotePlugin {
        const view = { getMode: () => mode };
        return {
            app: { workspace: { getActiveViewOfType: () => view } },
        } as unknown as FootnotePlugin;
    }

    it("answers null in Reading view", () => {
        expect(
            FootnotePlugin.prototype.editableMarkdownView.call(
                pluginWithMode("preview"),
            ),
        ).toBeNull();
    });

    it("answers the view while the note is editable", () => {
        expect(
            FootnotePlugin.prototype.editableMarkdownView.call(
                pluginWithMode("source"),
            ),
        ).not.toBeNull();
    });
});
