import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

import { planFootnoteRename } from "../../src/commands/rename-footnote";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import { simulateChanges } from "../../src/editor/insertion-liveness";
import { NestedFootnoteNotice } from "../helpers/toasts";

// BUG (second review, 2026-09-09): a blockquoted or callout definition
// ("> [^note]: ...") is a live definition to the scanner, the definition
// list, navigation, and the orphan rules, but it is never a definition
// BLOCK - and two guards asked ctx.blocks() when they meant "every live
// definition". Rename rewrote the reference and left "> [^note]:" behind,
// orphaning both halves (and its collision check missed a quoted name);
// the selection converter let the body of a quoted definition line be
// selected and converted, nesting the new footnote into the old one.

describe("a blockquoted definition and the rename command", () => {
    it("renames the quoted label together with the reference", () => {
        const lines = ["Body text[^note] here.", "", "> [^note]: The quoted definition."];
        const plan = planFootnoteRename(fakeEditor(lines, { wholeDoc: true }), "note", "renamed");
        expect(plan).toMatchObject({ kind: "renamed", count: 2 });
        if (plan.kind !== "renamed") throw new Error("unreachable");
        expect(simulateChanges(lines, plan.changes)).toEqual([
            "Body text[^renamed] here.",
            "",
            "> [^renamed]: The quoted definition.",
        ]);
    });

    it("refuses a new name a quoted definition already carries", () => {
        const lines = ["a[^a]", "", "> [^b]: quoted"];
        expect(planFootnoteRename(fakeEditor(lines, { wholeDoc: true }), "a", "b")).toEqual({
            kind: "collision",
        });
    });

    it("still renames a callout definition under its title line", () => {
        const lines = ["see[^x]", "", "> [!note]", "> [^x]: in a callout"];
        const plan = planFootnoteRename(fakeEditor(lines, { wholeDoc: true }), "x", "y");
        expect(plan).toMatchObject({ kind: "renamed", count: 2 });
    });
});

describe("a blockquoted definition and selection conversion", () => {
    beforeEach(resetNotices);

    it("refuses to convert text inside a quoted definition line", () => {
        const lines = ["Body text[^1] here.", "", "> [^1]: The quoted definition."];
        const doc = fakeEditor(lines, {
            cursor: { line: 2, ch: 10 },
            selection: { anchor: { line: 2, ch: 10 }, head: { line: 2, ch: lines[2].length } },
            edits: true,
            wholeDoc: true,
        });
        const handled = selectionPressHandled(fakePlugin({}, doc), doc, null, "autonum");
        expect(handled).toBe(true);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
        expect(doc.lines).toEqual(lines);
    });

    it("refuses a selection that swallows the quoted definition whole", () => {
        const lines = ["Body text[^1] here.", "", "> [^1]: The quoted definition.", "tail"];
        const doc = fakeEditor(lines, {
            cursor: { line: 1, ch: 0 },
            selection: { anchor: { line: 1, ch: 0 }, head: { line: 3, ch: 4 } },
            edits: true,
            wholeDoc: true,
        });
        expect(selectionPressHandled(fakePlugin({}, doc), doc, null, "autonum")).toBe(true);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
        expect(doc.lines).toEqual(lines);
    });
});
