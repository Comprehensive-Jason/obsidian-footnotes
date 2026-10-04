import { EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noticed, resetNotices } from "./helpers/notices";
import FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { renameFootnote, RenameTargetNotice } from "../src/commands/rename-footnote";
import { ProtectedCreationNotice } from "../src/editor/insertion-liveness";
import { propertiesWidgetOwnsFocus } from "../src/editor/obsidian-internals";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";

// BUG (Jason's manual pass, 2026-09-04): in Live Preview the frontmatter is
// the Properties widget, which lives OUTSIDE CodeMirror's contentDOM in
// the sizer - so while the user types in a property field, the main
// editor's caret is wherever they last clicked in the prose. A footnote
// hotkey pressed there found no protected caret (the stale one sits in
// live text) and minted a footnote at that old spot, far from where the
// user was looking. Source mode refuses the same press because the caret
// is genuinely on a protected frontmatter line; Live Preview must match:
// focus inside the Properties widget refuses with the same toast.

function fakeEditor(lines: string[], cursor: EditorPosition): FakeEditor {
    return sharedFakeEditor(lines, { cursor, edits: true, wholeDoc: true });
}

/** A view whose document's active element sits (or not) inside `.metadata-container`. */
function pluginWithFocus(doc: FakeEditor, insideProperties: boolean): FootnotePlugin {
    const activeElement = {
        closest: (selector: string) =>
            insideProperties && selector === ".metadata-container" ? {} : null,
    };
    return {
        app: {
            workspace: {
                getActiveViewOfType: () => ({
                    editor: doc,
                    containerEl: { ownerDocument: { activeElement } },
                }),
            },
            vault: {},
        },
        settings: {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
        },
    } as unknown as FootnotePlugin;
}

beforeEach(() => {
    resetNotices();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// the stale main-editor caret: mid-prose, where a footnote WOULD be minted
const STALE = { line: 3, ch: 5 };
const NOTE = ["---", "title: fixture", "---", "alpha bravo charlie"];

describe("footnote commands while the Properties widget owns focus", () => {
    it("the numbered command changes nothing and toasts the protected-text notice", async () => {
        const doc = fakeEditor([...NOTE], { ...STALE });
        await insertAutonumFootnote(pluginWithFocus(doc, true));
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.lines).toEqual(NOTE);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    it("the named command changes nothing", async () => {
        const doc = fakeEditor([...NOTE], { ...STALE });
        await insertNamedFootnote(pluginWithFocus(doc, true));
        expect(doc.appliedChanges).toEqual([]);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    it("the inline command changes nothing", async () => {
        const doc = fakeEditor([...NOTE], { ...STALE });
        await insertInlineFootnote(pluginWithFocus(doc, true));
        expect(doc.appliedChanges).toEqual([]);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    it("the paste command changes nothing and never reads the clipboard", async () => {
        const readText = vi.fn(() => Promise.resolve("clip"));
        vi.stubGlobal("navigator", { clipboard: { readText } });
        const doc = fakeEditor([...NOTE], { ...STALE });
        await pasteInlineFootnote(pluginWithFocus(doc, true));
        expect(doc.appliedChanges).toEqual([]);
        expect(readText).not.toHaveBeenCalled();
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    it("the rename command toasts its own no-target notice instead of renaming at the stale caret", async () => {
        const doc = fakeEditor(["---", "title: fixture", "---", "alpha[^1] bravo", "", "[^1]: one"], {
            line: 3,
            ch: 7,
        });
        await renameFootnote(pluginWithFocus(doc, true));
        expect(doc.appliedChanges).toEqual([]);
        expect(noticed(RenameTargetNotice)).toBe(true);
        expect(noticed(ProtectedCreationNotice)).toBe(false);
    });

    it("with focus anywhere else the same press inserts normally (control)", async () => {
        const doc = fakeEditor([...NOTE], { ...STALE });
        await insertAutonumFootnote(pluginWithFocus(doc, false));
        expect(doc.lines[3]).toBe("alpha[^1] bravo charlie");
        expect(noticed(ProtectedCreationNotice)).toBe(false);
    });
});

describe("propertiesWidgetOwnsFocus", () => {
    const view = (
        activeElement: { closest(selector: string): unknown } | null,
    ) => ({
        containerEl: { ownerDocument: { activeElement } },
    });

    it("is true when the active element sits inside .metadata-container", () => {
        expect(
            propertiesWidgetOwnsFocus(
                view({ closest: (s: string) => (s === ".metadata-container" ? {} : null) }),
            ),
        ).toBe(true);
    });

    it("is false for an active element outside it, no active element, or a bare test fake", () => {
        expect(propertiesWidgetOwnsFocus(view({ closest: () => null }))).toBe(false);
        expect(propertiesWidgetOwnsFocus(view(null))).toBe(false);
        expect(propertiesWidgetOwnsFocus({})).toBe(false);
    });
});
