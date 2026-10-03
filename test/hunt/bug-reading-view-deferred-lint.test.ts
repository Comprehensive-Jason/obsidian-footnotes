import { EditorPosition } from "obsidian";
import { describe, expect, it } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";

import FootnotePlugin from "../../src/main";
import { lintAfterFootnoteCreation } from "../../src/linting/linter";

// The popup-deferred lint-on-creation fires after a user-driven delay, and a Reading-view flip mid-popup (no active-leaf-change fires) leaves every internal gate untripped, so the deferred lint edits the hidden buffer.
// Hunt: 2026-08-09. Lens: interactions.
// Root cause: commit a30761f guarded the lint COMMANDS with readingViewActive but not lintAfterFootnoteCreation, whose gates (file path, popup busy, table focus) all stay untripped by a Reading-view flip.
// Since 2026-08-27 the popup path lints synchronously BEFORE the popup opens (no deferral left), so this guard is defense-in-depth against programmatic callers - still pinned.

function fakeEditor(lines: string[], cursor: EditorPosition): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor,
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

// the mdView shape (file, getMode) is richer than the shared fakePlugin's
// editor-only support, so this double stays local
function pluginFor(
    doc: FakeEditor,
    overrides: Record<string, boolean | string> = {},
    mode: "source" | "preview" = "source",
): FootnotePlugin {
    return {
        app: {
            workspace: {
                getActiveViewOfType: () => ({
                    editor: doc,
                    file: { path: "note.md" },
                    getMode: () => mode,
                }),
            },
            vault: {},
        },
        settings: {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "# Footnotes",
            enableRemoveBlankLastLines: true,
            renumberNamedFootnotes: false,
            lintDeleteOrphanedReferences: false,
            lintDeleteOrphanedDefinitions: false,
            lintFixPunctuation: true,
            lintMoveToBottom: true,
            lintReindex: true,
            lintApplyPrefix: true,
            lintOnFootnoteCreation: false,
            ...overrides,
        },
    } as unknown as FootnotePlugin;
}

describe("popup-deferred lint-on-creation vs Reading view (fixed 2026-08-10)", () => {
    it("deferred lint-on-creation is inert if the note is now in Reading view", () => {
        const lines = ["Alpha[^2], bravo", "", "[^2]: "];
        const doc = fakeEditor(lines, { line: 2, ch: lines[2].length });
        const plugin = pluginFor(
            doc,
            { lintOnFootnoteCreation: true },
            "preview",
        );
        lintAfterFootnoteCreation(plugin, doc, true);
        expect(doc.lines).toEqual(lines);
        expect(doc.cursor).toEqual({ line: 2, ch: lines[2].length });
    });

    it("the same lint still runs when the note stayed in editing view", () => {
        // guards the fix against over-gating: identical setup, source mode -
        // the punctuation rule has real work ("Alpha[^2]," → "Alpha,[^2]")
        const lines = ["Alpha[^2], bravo", "", "[^2]: "];
        const doc = fakeEditor(lines, { line: 2, ch: lines[2].length });
        const plugin = pluginFor(
            doc,
            { lintOnFootnoteCreation: true },
            "source",
        );
        lintAfterFootnoteCreation(plugin, doc, true);
        expect(doc.transactions).toBeGreaterThan(0);
    });
});
