import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FootnotePlugin from "../src/main";
import { planFootnoteRename, renameFootnote } from "../src/commands/rename-footnote";
import { SetFootnotePrefixModal } from "../src/commands/set-footnote-prefix";
import { undoOrphanMessage } from "../src/editor/undo-orphan-notice";
import { Modal } from "./mocks/obsidian";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The smaller toast fixes of the shared vocabulary (Jason's choice,
// 2026-10-22, run toast-consolidate, point 5): the undo notice's plural,
// no toast for removing a prefix the note never had, and a rename refusal
// that names the text around the reference instead of blaming the name.
// Written out in full.

beforeEach(resetNotices);
afterEach(() => {
    vi.restoreAllMocks();
});

describe("the undo notice", () => {
    it("singular: one definition, one reference", () => {
        expect(undoOrphanMessage(["a"], '"[^a]"')).toBe('The undo removed the footnote definition, but the footnote reference "[^a]" is still in the note.');
    });
    it("plural: definitions and their references", () => {
        expect(undoOrphanMessage(["a", "b"], '"[^a]", "[^b]"')).toBe('The undo removed footnote definitions, but their references "[^a]", "[^b]" are still in the note.');
    });
});

describe("Set footnote prefix with an empty box", () => {
    /** The dialog opened on a note whose prefix is `current`, saved with an empty box; the toasts it raised. */
    async function saveEmpty(current: string): Promise<string[]> {
        const plugin = {
            settings: { enableFootnotePrefix: true },
            app: {
                workspace: { getActiveViewOfType: () => null },
                fileManager: { processFrontMatter: () => Promise.resolve() },
            },
        } as unknown as FootnotePlugin;
        const modal = new SetFootnotePrefixModal(plugin, new TFile(), current);
        Object.assign(modal, { showProblem: () => {}, close: () => {} });
        const submittable = modal as unknown as { value: string; submit(): Promise<void> };
        submittable.value = "";
        await submittable.submit();
        return messages();
    }

    it("over a prefix: says it was removed", async () => {
        expect(await saveEmpty("2.")).toEqual(["Footnote prefix removed."]);
    });
    it("over no prefix: says nothing, since nothing was removed", async () => {
        expect(await saveEmpty("")).toEqual([]);
    });
});

describe("the rename refusal for a name that would change the text around a reference", () => {
    const note = ["Cost $5 [^x] here", "", "[^x]: n"];

    it("control: the plan refuses the name as dead", () => {
        expect(planFootnoteRename(fakeEditor(note, { wholeDoc: true }), "x", "a$").kind).toBe("dead");
    });

    it("the dialog's error line says what the name would do", async () => {
        // the command opens the Rename footnote dialog; its instance is
        // caught as it opens, then submitted with the new name
        const opened: { value: string; submit(): void }[] = [];
        vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: { value: string; submit(): void }) {
            opened.push(this);
        });
        const doc = fakeEditor(note, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 10 } });
        await renameFootnote(fakePlugin({}, doc));
        expect(opened).toHaveLength(1);
        const problems: (string | null)[] = [];
        const modal = opened[0];
        Object.assign(modal, { showProblem: (problem: string | null) => problems.push(problem), close: () => {} });
        modal.value = "a$";
        modal.submit();
        expect(problems).toEqual(["This name would change how Obsidian reads the text around one of its references. Try a different name."]);
    });
});
