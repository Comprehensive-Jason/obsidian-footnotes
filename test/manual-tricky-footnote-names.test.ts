import { beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../src/main";
import { convertSelectionToNamed } from "../src/commands/selection-footnote";
import {
    insertAutonumFootnote,
    insertNamedFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { planFootnoteRename } from "../src/commands/rename-footnote";
import { PopupWaitingNotice } from "../src/commands/popup-retry";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import { messages, noticed, resetNotices } from "./helpers/notices";

// The retired manual sheet "Tricky footnote names" (2026-08-10), moved down into
// units on 2026-09-20. It replaces all seven of the sheet's checks:
// backticked names, dollar names, the case pair, names holding "#"
// (pressed, renamed, and named through the selection modal), the popup's
// refusal to bind a "#" id, and a CJK name.
//
// Nothing on that sheet turned out to need a human in the real app: every
// check is a toast, a caret landing, or a line of text, and the fake
// editor sees all three.

// the sheet's fixture line, with its definitions underneath
const FIXTURE = "a backticked name [^ba`ck], dollar names pay[^a$1] and[^b$2] now, a case pair case[^Note], a hashed reference[^#y], a hashed reference with a definition[^#x], and a CJK name[^注].";
const NOTE = [
    FIXTURE,
    "",
    "[^note]: lowercase definition for the uppercase reference",
    "[^#x]: a hashed definition the popup can never open",
    "[^注]: a CJK name",
];

/** the column just inside a reference's brackets, so a press lands on it */
function insideReference(name: string): { line: number; ch: number } {
    const start = FIXTURE.indexOf(`[^${name}]`);
    if (start < 0) throw new Error(`fixture has no [^${name}]`);
    return { line: 0, ch: start + 3 };
}

/** the column just past a reference's closing bracket */
function afterReference(name: string): { line: number; ch: number } {
    const start = FIXTURE.indexOf(`[^${name}]`);
    if (start < 0) throw new Error(`fixture has no [^${name}]`);
    return { line: 0, ch: start + `[^${name}]`.length };
}

function noteEditor(cursor: { line: number; ch: number }): FakeEditor {
    return sharedFakeEditor(NOTE, {
        cursor,
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

function pluginFor(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: true,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

/**
 * The same fake with the popup editor switched ON. `popupEditingAvailable`
 * asks Obsidian for its embed registry, so the fake app carries a stub one:
 * without it the popup would be "unavailable" for a reason that has
 * nothing to do with the name under test, and the check would prove
 * nothing.
 */
function popupPluginFor(doc: FakeEditor): FootnotePlugin {
    return {
        settings: {
            insertAtEndOfWord: true,
            enablePopupEditor: true,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
        },
        app: {
            workspace: { getActiveViewOfType: () => ({ editor: doc }) },
            vault: {},
            embedRegistry: { embedByExtension: { md: () => ({}) } },
        },
    } as unknown as FootnotePlugin;
}

describe("a backticked name", () => {
    beforeEach(resetNotices);

    it("a press inside it warns and creates nothing", async () => {
        const doc = noteEditor(insideReference("ba`ck"));
        await insertNamedFootnote(pluginFor(doc));
        expect(doc.lines).toEqual(NOTE);
        expect(
            noticed(
                '"[^ba`ck]" won\'t work as a footnote. Footnote names can\'t contain spaces, backticks, brackets, or "#".',
            ),
        ).toBe(true);
    });
});

describe("dollar names", () => {
    beforeEach(resetNotices);

    it("a press inside [^a$1] creates its definition normally", async () => {
        const doc = noteEditor(insideReference("a$1"));
        await insertNamedFootnote(pluginFor(doc));
        expect(doc.lines.at(-1)).toBe("[^a$1]: ");
        expect(messages()).toEqual([]);
    });

    it("the numbered hotkey right after [^b$2] inserts, and both dollar names survive", async () => {
        // the span between the two dollars is NOT math, so the
        // protected-text guard has nothing to refuse here
        const doc = noteEditor(afterReference("b$2"));
        await insertAutonumFootnote(pluginFor(doc));
        expect(doc.lines[0]).toContain("[^a$1]");
        expect(doc.lines[0]).toContain("[^b$2]");
        expect(doc.lines[0]).toContain("[^1]");
        expect(messages()).toEqual([]);
    });
});

describe("a case pair", () => {
    beforeEach(resetNotices);

    it("a press inside [^Note] jumps to the lowercase definition instead of making a second one", async () => {
        const doc = noteEditor(insideReference("Note"));
        await insertNamedFootnote(pluginFor(doc));
        expect(doc.lines).toEqual(NOTE);
        expect(doc.cursor).toEqual({
            line: 2,
            ch: "[^note]: lowercase definition for the uppercase reference".length,
        });
    });
});

describe('names holding "#" are refused everywhere', () => {
    beforeEach(resetNotices);

    it("a named press inside [^#y] warns and creates nothing", async () => {
        const doc = noteEditor(insideReference("#y"));
        await insertNamedFootnote(pluginFor(doc));
        expect(doc.lines).toEqual(NOTE);
        expect(
            noticed(
                '"[^#y]" won\'t work as a footnote. Footnote names can\'t contain spaces, backticks, brackets, or "#".',
            ),
        ).toBe(true);
    });

    it("the Rename modal refuses a#b with the reason", () => {
        const doc = sharedFakeEditor(["a[^x]", "", "[^x]: d"], { wholeDoc: true });
        expect(planFootnoteRename(doc, "x", "a#b")).toMatchObject({
            kind: "invalid",
            reason: 'Footnote names can\'t contain spaces, backticks, brackets, or "#".',
        });
    });

    it("the name-the-selection modal refuses a#b with the reason", () => {
        const doc = sharedFakeEditor(["alpha bravo"], { wholeDoc: true, edits: true });
        const selection = {
            from: { line: 0, ch: 0 },
            to: { line: 0, ch: 5 },
            lead: "",
            text: "alpha",
        };
        expect(
            convertSelectionToNamed(pluginFor(doc), doc, selection, "a#b"),
        ).toBe('Footnote names can\'t contain spaces, backticks, brackets, or "#".');
        expect(doc.lines).toEqual(["alpha bravo"]);
    });

    it("a press inside [^#x] jumps at once, with no popup and no waiting notice", async () => {
        // the popup builds its embed link out of a "#[^id]" subpath, so an
        // id carrying its own "#" can never resolve; the press goes
        // straight to the jump rather than waiting out the retries
        const doc = noteEditor(insideReference("#x"));
        await insertNamedFootnote(popupPluginFor(doc));
        expect(doc.lines).toEqual(NOTE);
        expect(doc.cursor).toEqual({
            line: 3,
            ch: "[^#x]: a hashed definition the popup can never open".length,
        });
        expect(noticed(PopupWaitingNotice)).toBe(false);
    });
});

describe("a CJK name", () => {
    beforeEach(resetNotices);

    it("a press inside [^注] navigates to its definition", async () => {
        const doc = noteEditor(insideReference("注"));
        await insertNamedFootnote(pluginFor(doc));
        expect(doc.lines).toEqual(NOTE);
        expect(doc.cursor).toEqual({ line: 4, ch: "[^注]: a CJK name".length });
    });
});
