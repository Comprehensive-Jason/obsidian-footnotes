import { App, EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noticeCalls } from "./mocks/obsidian";
import { noticed, resetNotices } from "./helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

import FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import {
    convertCellSelectionToNamed,
    InlineSelectionNotice,
    ProtectedSelectionNotice,
    convertSelectionToNamed,
    registerActiveNameModal,
    selectionPressHandled,
    submitActiveNameModal,
    SelectionChangedNotice,
    SelectionCommandNotice,
    SelectionSpanNotice,
    TableSelectionNotice,
    absorbLeadingSpace,
} from "../src/commands/selection-footnote";
import { commandHotkeys } from "../src/editor/obsidian-internals";
import { NestedFootnoteNotice } from "../src/editor/notice";
import { TableCellEditor } from "../src/editor/table-cursor";
import { readNote } from "../src/parsing/note-reading";

// Turning a selection into a footnote (issue #35, Jason's calls 2026-08-12:
// overload the existing hotkeys, always on; single-line selections only;
// named/paste redirect instead of converting). The numbered key moves
// the selected text into a new definition's body; the inline key wraps it
// as "^[…]" in place. The generative twin lives in
// command-properties.test.ts - these pin the concrete contracts.

// with `selection` undefined, the shared fake's listSelections falls back
// to a live collapsed range at the current cursor - the same behavior the
// old local fake's `selection ? [selection] : [...cursor...]` gave.
function fakeEditor(
    lines: string[],
    cursor: EditorPosition,
    selection?: { anchor: EditorPosition; head: EditorPosition },
): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor,
        selection,
        edits: true,
        wholeDoc: true,
    });
}

function fakePlugin(
    doc: FakeEditor,
    overrides: Partial<FootnotePlugin["settings"]> = {},
): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
            ...overrides,
        },
        doc,
    );
}

beforeEach(() => {
    resetNotices();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the numbered key converts a selection", () => {
    it("moves the selected text into a new definition's body", async () => {
        const doc = fakeEditor(
            ["The quick fox jumps", "", "tail"],
            { line: 0, ch: 9 },
            { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 9 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        // the first footnote gets its usual blank separator line
        expect(doc.lines).toEqual([
            "The[^1] fox jumps",
            "",
            "tail",
            "",
            "[^1]: quick",
        ]);
        // the caret lands at the end of the pre-filled body, ready to edit
        expect(doc.cursor).toEqual({ line: 4, ch: "[^1]: quick".length });
    });

    it("numbers past existing footnotes and appends after the last block", async () => {
        const doc = fakeEditor(
            ["word here[^1]", "", "[^1]: a"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 4 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "[^2] here[^1]",
            "",
            "[^1]: a",
            "[^2]: word",
        ]);
    });

    it("sheds the selection's whitespace edges back into the prose", async () => {
        const doc = fakeEditor(
            ["The quick fox jumps"],
            { line: 0, ch: 3 },
            // " quick " selected, spaces included
            { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 10 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("The[^1] fox jumps");
    });

    it("a REVERSED (head-before-anchor) selection converts the same", async () => {
        const doc = fakeEditor(
            ["The quick fox jumps"],
            { line: 0, ch: 4 },
            { anchor: { line: 0, ch: 9 }, head: { line: 0, ch: 4 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("The[^1] fox jumps");
    });

    it("a full-line drag (ending at ch 0 of the next line) converts the line", async () => {
        const doc = fakeEditor(
            ["word", "next"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 0 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["[^1]", "next", "", "[^1]: word"]);
    });

    it("a whitespace-only selection falls through to a plain insert", async () => {
        const doc = fakeEditor(
            ["The quick fox"],
            { line: 0, ch: 4 },
            { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 4 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        // the ordinary caret cascade ran instead: reference at the caret,
        // empty definition appended
        expect(doc.lines).toEqual(["The [^1]quick fox", "", "[^1]: "]);
    });
});

describe("the inline key converts a selection", () => {
    it("wraps the selected text as ^[…] in place, caret after the bracket", async () => {
        const doc = fakeEditor(
            ["The quick fox jumps"],
            { line: 0, ch: 9 },
            { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 9 } },
        );
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["The^[quick] fox jumps"]);
        // the space before "quick" is absorbed, so the wrapper starts at 3
        expect(doc.cursor).toEqual({ line: 0, ch: 3 + "^[quick]".length });
    });

    it("escapes an unbalanced bracket so the wrapper can't end early", async () => {
        const doc = fakeEditor(
            ["pay a ] b now"],
            { line: 0, ch: 4 },
            // "a ] b" selected
            { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 9 } },
        );
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["pay^[a \\] b] now"]);
    });
});

describe("lint-on-footnote-creation covers selection conversions (parity, Jason's ask 2026-08-25)", () => {
    it("the autonum conversion lints the note after converting", async () => {
        const doc = fakeEditor(
            ["alpha[^5] quick fox", "", "[^5]: five"],
            { line: 0, ch: 15 },
            { anchor: { line: 0, ch: 10 }, head: { line: 0, ch: 15 } },
        );
        await insertAutonumFootnote(
            fakePlugin(doc, {
                lintOnFootnoteCreation: true,
                lintReindex: true,
            }),
        );
        // the conversion minted [^6] with a seeded definition; the creation
        // lint then renumbered 5→1, 6→2 - exactly what a plain caret
        // insert with the same settings produces
        expect(doc.lines).toEqual([
            "alpha[^1][^2] fox",
            "",
            "[^1]: five",
            "[^2]: quick",
        ]);
    });

    it("the named-modal conversion lints the note after converting", () => {
        const doc = fakeEditor(["alpha[^5] quick fox", "", "[^5]: five"], {
            line: 0,
            ch: 10,
        });
        const problem = convertSelectionToNamed(
            fakePlugin(doc, {
                lintOnFootnoteCreation: true,
                lintReindex: true,
            }),
            doc,
            {
                from: { line: 0, ch: 10 },
                to: { line: 0, ch: 15 },
                text: "quick",
                lead: "",
            },
            "note",
        );
        expect(problem).toBeNull();
        // reindex renumbers the numbered footnote; the named one keeps its
        // name (renumber-named is off)
        expect(doc.lines).toEqual([
            "alpha[^1] [^note] fox",
            "",
            "[^1]: five",
            "[^note]: quick",
        ]);
    });
});

describe("the creation lint relands the caret on the seeded definition (Jason's report, 2026-08-26)", () => {
    // Jason's manual pass: with lint-on-creation + reindex on (popup
    // off), converting a selection while [^5]/[^5]: five sit ABOVE the
    // paragraph left the caret on the WRONG footnote - the lint moves and
    // renumbers the seeded definition, and the empty-definition reland
    // can't find it (a conversion's definition is never empty), so the
    // caret was left wherever the lint's minimal replacement dropped it.
    const paragraph =
        "The paragraph wants to move this aside for later readers.";
    const before = [
        "alpha[^5]",
        "",
        "[^5]: five",
        "",
        paragraph,
        "",
        "tail text",
    ];
    const selected = {
        anchor: { line: 4, ch: paragraph.indexOf("move") },
        head: { line: 4, ch: paragraph.indexOf(" for later") },
    };
    const lintSettings = {
        lintOnFootnoteCreation: true,
        lintReindex: true,
        lintMoveToBottom: true,
    };

    it("the autonum conversion's caret follows the renumbered, moved definition", async () => {
        const doc = fakeEditor(before, selected.anchor, selected);
        await insertAutonumFootnote(fakePlugin(doc, lintSettings));
        // the conversion minted [^6]; the lint gathered both definitions
        // at the bottom and renumbered 5→1, 6→2
        const landing = doc.lines.indexOf("[^2]: move this aside");
        expect(landing).toBeGreaterThan(doc.lines.indexOf("tail text"));
        expect(doc.cursor).toEqual({
            line: landing,
            ch: "[^2]: move this aside".length,
        });
    });

    it("the named conversion's caret follows the moved definition", () => {
        const doc = fakeEditor(before, selected.anchor);
        const problem = convertSelectionToNamed(
            fakePlugin(doc, lintSettings),
            doc,
            {
                from: selected.anchor,
                to: selected.head,
                text: "move this aside",
                lead: "",
            },
            "note",
        );
        expect(problem).toBeNull();
        const landing = doc.lines.indexOf("[^note]: move this aside");
        expect(landing).toBeGreaterThan(doc.lines.indexOf("tail text"));
        expect(doc.cursor).toEqual({
            line: landing,
            ch: "[^note]: move this aside".length,
        });
    });

    it("a multi-line conversion's caret lands at the end of the moved body's last line", async () => {
        const doc = fakeEditor(
            [
                "alpha[^5]",
                "",
                "[^5]: five",
                "",
                "first paragraph",
                "",
                "second paragraph",
                "",
                "tail text",
            ],
            { line: 4, ch: 0 },
            { anchor: { line: 4, ch: 0 }, head: { line: 6, ch: "second paragraph".length } },
        );
        await insertAutonumFootnote(fakePlugin(doc, lintSettings));
        // the seeded multi-paragraph body travels with its label
        const landing = doc.lines.indexOf("[^2]: first paragraph");
        expect(landing).toBeGreaterThan(doc.lines.indexOf("tail text"));
        expect(doc.lines[landing + 1]).toBe("    ");
        expect(doc.lines[landing + 2]).toBe("    second paragraph");
        expect(doc.cursor).toEqual({
            line: landing + 2,
            ch: "    second paragraph".length,
        });
    });
});

describe("the named key converts a selection through its modal (2026-08-13)", () => {
    // the modal is thin wiring over convertSelectionToNamed - these drive
    // the exported conversion the way its submit does
    it("replaces the selection with [^name] and seeds the definition", () => {
        const doc = fakeEditor(["The quick fox jumps"], { line: 0, ch: 4 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            {
                from: { line: 0, ch: 4 },
                to: { line: 0, ch: 9 },
                text: "quick",
                lead: "",
            },
            "Speed2026",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual([
            "The [^Speed2026] fox jumps",
            "",
            "[^Speed2026]: quick",
        ]);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^Speed2026]: quick".length });
    });

    it("healing an orphan: a name only dangling references carry is welcome", () => {
        const doc = fakeEditor(["see [^lost] and quick brown"], { line: 0, ch: 16 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            {
                from: { line: 0, ch: 16 },
                to: { line: 0, ch: 21 },
                text: "quick",
                lead: "",
            },
            "lost",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual([
            "see [^lost] and [^lost] brown",
            "",
            "[^lost]: quick",
        ]);
    });

    it("refuses a name that is already DEFINED, inline", () => {
        const before = ["The quick fox", "", "[^taken]: existing"];
        const doc = fakeEditor(before, { line: 0, ch: 4 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            { from: { line: 0, ch: 4 }, to: { line: 0, ch: 9 }, text: "quick", lead: "" },
            "Taken",
        );
        expect(problem).toBe('"[^Taken]" is already used by another footnote.');
        expect(doc.lines).toEqual(before);
    });

    it("refuses invalid names with the reason, inline", () => {
        const doc = fakeEditor(["The quick fox"], { line: 0, ch: 4 });
        const selection = {
            from: { line: 0, ch: 4 },
            to: { line: 0, ch: 9 },
            text: "quick",
            lead: "",
        };
        expect(
            convertSelectionToNamed(fakePlugin(doc), doc, selection, "bad name"),
        ).toBe('Footnote names can\'t contain spaces, backticks, brackets, or "#".');
        expect(
            convertSelectionToNamed(fakePlugin(doc), doc, selection, "a[b"),
        ).toBe('Footnote names can\'t contain spaces, backticks, brackets, or "#".');
        // "#" names render but Obsidian's preview and sidebar can't find
        // them (2026-09-05)
        expect(
            convertSelectionToNamed(fakePlugin(doc), doc, selection, "a#b"),
        ).toBe('Footnote names can\'t contain spaces, backticks, brackets, or "#".');
        expect(doc.lines).toEqual(["The quick fox"]);
    });

    it("bails with a notice when the note changed under the open modal", () => {
        const doc = fakeEditor(["The rapid fox"], { line: 0, ch: 4 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            // captured before the note changed: the span no longer reads
            // "quick"
            { from: { line: 0, ch: 4 }, to: { line: 0, ch: 9 }, text: "quick", lead: "" },
            "fine",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual(["The rapid fox"]);
        expect(noticed(SelectionChangedNotice)).toBe(true);
    });

    it("refuses a born-dead conversion, in the selection's words", () => {
        // converting "or" leaves "$5 [^dead] $x": the reference sits in
        // an inline-math pair it completed (the old fixture, ">" of
        // "> $$", strands nothing now: an unclosed opener is literal text unless a later line of its paragraph closes it (Kimi hunt cycle 3, probed in Reading view 2026-09-16))
        const before = ["$5 or$x tail"];
        const doc = fakeEditor(before, { line: 0, ch: 3 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            { from: { line: 0, ch: 3 }, to: { line: 0, ch: 5 }, text: "or", lead: "" },
            "dead",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual(before);
        // the same refusal the numbered key makes, but worded for a
        // selection: what the user did was select (2026-09-16, B27)
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });
});

describe("a multi-line selection converts into a multi-paragraph definition (2026-08-19)", () => {
    it("indents continuation lines four spaces under the seeded label", async () => {
        const before = ["intro", "first para", "", "second para", "outro"];
        const doc = fakeEditor(before, { line: 1, ch: 0 }, {
            anchor: { line: 1, ch: 0 },
            head: { line: 3, ch: "second para".length },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "intro",
            "[^1]",
            "outro",
            "",
            "[^1]: first para",
            "    ",
            "    second para",
        ]);
        // the caret lands at the end of the LAST body line
        expect(doc.cursor).toEqual({ line: 6, ch: "    second para".length });
    });

    it("converts Jason's academic shape: paragraphs around a whole fenced code block", async () => {
        const before = [
            "This is a test.",
            "First paragraph of the note.",
            "",
            "```",
            "\tlorem ipsum dolor sit",
            "```",
            "",
            "Closing paragraph.",
        ];
        const doc = fakeEditor(before, { line: 1, ch: 0 }, {
            anchor: { line: 1, ch: 0 },
            head: { line: 7, ch: "Closing paragraph.".length },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "This is a test.",
            "[^1]",
            "",
            "[^1]: First paragraph of the note.",
            "    ",
            "    ```",
            "    \tlorem ipsum dolor sit",
            "    ```",
            "    ",
            "    Closing paragraph.",
        ]);
        expect(doc.cursor).toEqual({
            line: 9,
            ch: "    Closing paragraph.".length,
        });
    });

    it("stitches the unselected prefix and suffix onto one line", async () => {
        const doc = fakeEditor(
            ["keep this. move me", "and me. keep too"],
            { line: 0, ch: 11 },
            {
                anchor: { line: 0, ch: 11 },
                head: { line: 1, ch: 7 },
            },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "keep this.[^1] keep too",
            "",
            "[^1]: move me",
            "    and me.",
        ]);
    });

    it("sheds blank edge lines back into the prose", async () => {
        const doc = fakeEditor(
            ["", "the payload", "", "tail"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 2, ch: 0 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "",
            "[^1]",
            "",
            "tail",
            "",
            "[^1]: the payload",
        ]);
    });

    it("the inline key REFUSES a multi-line selection, pointing at the other keys", async () => {
        // flatten-like-paste was tried and reverted (Jason, 2026-08-20):
        // it basically never looked correct outside clean paragraphs
        const before = ["see first para", "", "second para here"];
        const doc = fakeEditor(before, { line: 0, ch: 4 }, {
            anchor: { line: 0, ch: 4 },
            head: { line: 2, ch: "second para".length },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(InlineSelectionNotice)).toBe(true);
    });

    it("a full-line drag still converts on the inline key (it normalizes to ONE line)", async () => {
        const doc = fakeEditor(
            ["wrap me", "next"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 0 } },
        );
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["^[wrap me]", "next"]);
    });

    it("the named modal converts a multi-line selection under the typed name", () => {
        const doc = fakeEditor(["para one", "para two"], { line: 0, ch: 0 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            {
                from: { line: 0, ch: 0 },
                to: { line: 1, ch: 8 },
                text: "para one\npara two",
                lead: "",
            },
            "Smith2019",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual([
            "[^Smith2019]",
            "",
            "[^Smith2019]: para one",
            "    para two",
        ]);
    });

    it("the named modal notices a multi-line selection gone stale", () => {
        const doc = fakeEditor(["para one", "para 2wo"], { line: 0, ch: 0 });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            {
                from: { line: 0, ch: 0 },
                to: { line: 1, ch: 8 },
                text: "para one\npara two",
                lead: "",
            },
            "fine",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual(["para one", "para 2wo"]);
        expect(noticed(SelectionChangedNotice)).toBe(true);
    });
});

describe("whole protected constructs travel INTO the footnote (2026-08-19)", () => {
    it("a selection containing a whole inline code span converts, span intact", async () => {
        const doc = fakeEditor(
            ["keep the `magic word` here"],
            { line: 0, ch: 5 },
            { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 21 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "keep[^1] here",
            "",
            "[^1]: the `magic word`",
        ]);
    });

    it("a selection containing a whole math span converts (inline key)", async () => {
        const doc = fakeEditor(["a $x$ b"], { line: 0, ch: 2 }, {
            anchor: { line: 0, ch: 2 },
            head: { line: 0, ch: 5 },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["a^[$x$] b"]);
    });

    it("a whole $$ display-math block rides into the definition body", async () => {
        const doc = fakeEditor(
            ["prose before", "$$", "E = mc^2", "$$", "prose after"],
            { line: 0, ch: 0 },
            {
                anchor: { line: 0, ch: 0 },
                head: { line: 4, ch: "prose after".length },
            },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "[^1]",
            "",
            "[^1]: prose before",
            "    $$",
            "    E = mc^2",
            "    $$",
            "    prose after",
        ]);
    });
});

describe("selections that refuse", () => {
    it("multiple selection ranges warn and edit nothing", async () => {
        const before = ["alpha beta gamma"];
        const doc = fakeEditor(before, { line: 0, ch: 0 });
        (doc as unknown as { listSelections: () => unknown }).listSelections =
            () => [
                { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } },
                { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 10 } },
            ];
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(SelectionSpanNotice)).toBe(true);
    });

    it("multiple ranges on the PASTE key get the paste redirect, not the one-stretch toast (Jason's report, 2026-09-08)", async () => {
        // the paste key never converts a selection, however many ranges
        // there are - its body is the clipboard - so the redirect to the
        // converting keys is the only message that helps
        vi.stubGlobal("navigator", {
            clipboard: { readText: () => Promise.resolve("clip") },
        });
        const before = ["alpha beta gamma"];
        const doc = fakeEditor(before, { line: 0, ch: 0 });
        (doc as unknown as { listSelections: () => unknown }).listSelections =
            () => [
                { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } },
                { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 10 } },
            ];
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(SelectionCommandNotice)).toBe(true);
        expect(noticed(SelectionSpanNotice)).toBe(false);
    });

    it("multiple CARETS now insert the SAME footnote at every one (2026-08-22)", async () => {
        // superseded behavior: extras used to be ignored (2026-08-21) -
        // Jason's ask upgraded this to same-reference-everywhere; the full
        // multi-caret contract lives in test/multi-caret.test.ts
        const doc = fakeEditor(["alpha bravo", "charlie delta"], {
            line: 0,
            ch: 5,
        });
        (doc as unknown as { listSelections: () => unknown }).listSelections =
            () => [
                { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 5 } },
                { anchor: { line: 1, ch: 7 }, head: { line: 1, ch: 7 } },
            ];
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "alpha[^1] bravo",
            "charlie[^1] delta",
            "",
            "[^1]: ",
        ]);
    });

    it("the named key claims the press for its name modal, editing nothing yet", async () => {
        // the modal itself is DOM territory (smoke suite); in units the
        // press must consume the selection silently and leave the document
        // to the modal's submit
        const before = ["The quick fox"];
        const doc = fakeEditor(before, { line: 0, ch: 4 }, {
            anchor: { line: 0, ch: 4 },
            head: { line: 0, ch: 9 },
        });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticeCalls).toEqual([]);
    });

    it("the paste key redirects WITHOUT touching the clipboard", async () => {
        const reads = { count: 0 };
        vi.stubGlobal("navigator", {
            clipboard: {
                readText: () => {
                    reads.count++;
                    return Promise.resolve("clip");
                },
            },
        });
        const before = ["The quick fox"];
        const doc = fakeEditor(before, { line: 0, ch: 4 }, {
            anchor: { line: 0, ch: 4 },
            head: { line: 0, ch: 9 },
        });
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(SelectionCommandNotice)).toBe(true);
        expect(reads.count).toBe(0);
    });

    it("a selection inside a fenced code block refuses (autonum)", async () => {
        const before = ["```", "code here", "```"];
        const doc = fakeEditor(before, { line: 1, ch: 0 }, {
            anchor: { line: 1, ch: 0 },
            head: { line: 1, ch: 4 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a selection inside a fenced code block refuses (inline)", async () => {
        const before = ["```", "code here", "```"];
        const doc = fakeEditor(before, { line: 1, ch: 0 }, {
            anchor: { line: 1, ch: 0 },
            head: { line: 1, ch: 4 },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("selecting part of a fence DELIMITER refuses (found by the conversion property)", async () => {
        // wrapping the opener's first backtick as "^[`]" would un-fence
        // everything below it - the simulated RESULT looks live precisely
        // because the construct got destroyed, so the up-front protected
        // check must own this, not the born-dead simulation
        const before = ["```", "fake[^1]", "```"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 0, ch: 1 },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("selecting inside an inline code span refuses", async () => {
        const before = ["a `co de` b"];
        const doc = fakeEditor(before, { line: 0, ch: 3 }, {
            anchor: { line: 0, ch: 3 },
            head: { line: 0, ch: 5 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a replacement that would demote a quote and strand its own definition refuses", async () => {
        // replacing the ">" leaves "$$" doc-level, swallowing everything
        // below - including the definition the same transaction appends
        // (the quote-demotion class the press property suite found)
        const before = ["> $$", "> quoted math[^75]"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 0, ch: 1 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a multi-line selection that CUTS a fence refuses (opener grabbed, closer left)", async () => {
        // taking the opener and interior without the closer would turn the
        // stranded "```" into an opener that swallows the rest of the note
        const before = ["prose", "```", "code", "```", "below[^1]", "", "[^1]: x"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 2, ch: 4 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a multi-line selection ending inside a fence refuses", async () => {
        const before = ["prose here", "```", "code", "```"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 2, ch: 2 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a full-line drag on a QUOTED fence's interior refuses (30k-soak find, 2026-08-20)", async () => {
        // the found counterexample: replacing the interior line (its "> "
        // marker included) demoted the quote, which killed the fence and
        // turned protected text into an inline footnote. Quoted fences are
        // invisible to endsProtected, so the edge check needs the
        // scanner's startsInFence flag.
        const before = [
            "---",
            "title: t",
            "---",
            "alpha[^1].",
            "",
            "[^1]: alpha",
            "",
            "> ```",
            "> fake[^1]",
            "> ```",
        ];
        for (const command of [insertInlineFootnote, insertAutonumFootnote]) {
            resetNotices();
            const doc = fakeEditor(before, { line: 8, ch: 0 }, {
                anchor: { line: 8, ch: 0 },
                head: { line: 9, ch: 0 },
            });
            await command(fakePlugin(doc));
            expect(doc.lines).toEqual(before);
            expect(noticed(ProtectedSelectionNotice)).toBe(true);
        }
    });

    it("selecting exactly a quoted fence's CLOSER line refuses", async () => {
        // the closer's protection also comes from above - consuming it
        // would leave the fence unclosed
        const before = ["> ```", "> code", "> ```"];
        const doc = fakeEditor(before, { line: 2, ch: 0 }, {
            anchor: { line: 2, ch: 0 },
            head: { line: 2, ch: 5 },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a WHOLE quoted fence still converts (containment unaffected)", async () => {
        const doc = fakeEditor(
            ["take this", "", "> ```", "> code", "> ```", "", "and this"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 6, ch: 8 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "[^1]",
            "",
            "[^1]: take this",
            "    ",
            "    > ```",
            "    > code",
            "    > ```",
            "    ",
            "    and this",
        ]);
    });

    it("a selection ending mid inline-code on its last line refuses", async () => {
        const before = ["take this", "and `co de` more"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 1, ch: 7 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a selection overlapping YAML frontmatter refuses", async () => {
        // properties are note metadata, not prose - even swallowed whole
        // they don't belong in a footnote body
        const before = ["---", "title: x", "---", "prose here"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 3, ch: 5 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("a multi-line selection lapping an existing definition refuses (no nesting)", async () => {
        const before = ["prose[^a] here", "", "[^a]: existing", "tail prose"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 2, ch: 6 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("a multi-line selection swallowing a whole definition refuses too", async () => {
        const before = ["prose[^a] here", "", "[^a]: existing", "", "tail prose"];
        const doc = fakeEditor(before, { line: 1, ch: 0 }, {
            anchor: { line: 1, ch: 0 },
            head: { line: 4, ch: 10 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });
});

describe("selections expand to whole words when the toggle is on (Jason's ask 2026-08-29)", () => {
    // The end-of-word insert's selection twin, default ON: cut-off words
    // at either end join the footnote whole, and the END normalizes to
    // word end + one trailing punctuation mark with FULL insert-key
    // parity (Jason's call: even an exact word-end selection gains the
    // mark). The start side has no punctuation analog - it only walks to
    // the word's start, and only when the selection begins mid-word.
    const sentence = "Bob loves Bill. Lorem ipsum dolor sit. Abbie likes Maddie.";

    it("includes the cut-off words at both ends, plus the trailing punctuation", async () => {
        // "rem ipsum dolor s" selected - Jason's example
        const doc = fakeEditor(
            [sentence],
            { line: 0, ch: 18 },
            { anchor: { line: 0, ch: 18 }, head: { line: 0, ch: 35 } },
        );
        await insertAutonumFootnote(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
        );
        expect(doc.lines).toEqual([
            "Bob loves Bill.[^1] Abbie likes Maddie.",
            "",
            "[^1]: Lorem ipsum dolor sit.",
        ]);
    });

    it("an exact word-end selection still takes the punctuation (insert-key parity)", async () => {
        // "dolor sit" selected exactly, "." right after
        const doc = fakeEditor(
            [sentence],
            { line: 0, ch: 28 },
            { anchor: { line: 0, ch: 28 }, head: { line: 0, ch: 37 } },
        );
        await insertAutonumFootnote(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
        );
        expect(doc.lines).toEqual([
            "Bob loves Bill. Lorem ipsum[^1] Abbie likes Maddie.",
            "",
            "[^1]: dolor sit.",
        ]);
    });

    it("a selection ending before a space stays as made (no punctuation there)", async () => {
        // "ipsum dolor" selected exactly, a space after
        const doc = fakeEditor(
            [sentence],
            { line: 0, ch: 22 },
            { anchor: { line: 0, ch: 22 }, head: { line: 0, ch: 33 } },
        );
        await insertAutonumFootnote(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
        );
        expect(doc.lines[0]).toBe(
            "Bob loves Bill. Lorem[^1] sit. Abbie likes Maddie.",
        );
        expect(doc.lines[2]).toBe("[^1]: ipsum dolor");
    });

    it("the inline key expands the same way", async () => {
        const doc = fakeEditor(
            [sentence],
            { line: 0, ch: 18 },
            { anchor: { line: 0, ch: 18 }, head: { line: 0, ch: 35 } },
        );
        await insertInlineFootnote(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
        );
        expect(doc.lines).toEqual([
            "Bob loves Bill.^[Lorem ipsum dolor sit.] Abbie likes Maddie.",
        ]);
    });

    it("multi-line selections expand at both outer ends", async () => {
        const doc = fakeEditor(
            ["alpha bravo", "charlie delta."],
            { line: 0, ch: 3 },
            { anchor: { line: 0, ch: 3 }, head: { line: 1, ch: 12 } },
        );
        await insertAutonumFootnote(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
        );
        expect(doc.lines.join("\n")).toContain(
            "[^1]: alpha bravo\n    charlie delta.",
        );
    });

    it("with the toggle off the selection converts exactly as made", async () => {
        const doc = fakeEditor(
            [sentence],
            { line: 0, ch: 18 },
            { anchor: { line: 0, ch: 18 }, head: { line: 0, ch: 35 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[2]).toBe("[^1]: rem ipsum dolor s");
    });

    it("cell selections expand too", () => {
        const dispatched: {
            changes?: { from: number; to?: number; insert: string };
        }[] = [];
        const cell: TableCellEditor = {
            state: {
                doc: { toString: () => "plain word here." },
                selection: { main: { anchor: 7, head: 13 } },
            },
            dispatch: (spec) => {
                dispatched.push(spec);
            },
        };
        const doc = fakeEditor(["| plain word here. |", "| --- |", "| x |"], {
            line: 0,
            ch: 8,
        });
        selectionPressHandled(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
            doc,
            cell,
            "autonum",
            { line: 0, ch: 8 },
        );
        // "ord her" expands to "word here." - words whole, punctuation taken
        expect(dispatched[0]?.changes).toEqual({
            from: 5,
            to: 16,
            insert: "[^1]",
        });
        expect(doc.lines[doc.lines.length - 1]).toBe("[^1]: word here.");
    });
});

describe("selections inside an actively edited table cell", () => {
    function fakeCell(text: string, anchor: number, head: number) {
        const dispatched: {
            changes?: { from: number; to?: number; insert: string };
            selection?: { anchor: number };
        }[] = [];
        const cell: TableCellEditor = {
            state: {
                doc: { toString: () => text },
                selection: { main: { head, anchor } },
            },
            dispatch: (spec) => {
                dispatched.push(spec);
            },
        };
        return { cell, dispatched };
    }

    it("the inline key wraps the cell selection through the cell's editor", () => {
        const { cell, dispatched } = fakeCell("plain word here", 6, 10);
        const doc = fakeEditor(
            ["| plain word here |", "| --- |", "| x |"],
            { line: 0, ch: 8 },
        );
        const handled = selectionPressHandled(fakePlugin(doc), doc, cell, "inline");
        expect(handled).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 5, to: 10, insert: "^[word]" },
                selection: { anchor: 5 + "^[word]".length },
            },
        ]);
    });

    it("the numbered key replaces in the cell and appends the seeded definition", () => {
        const { cell, dispatched } = fakeCell("plain word here", 6, 10);
        const doc = fakeEditor(
            ["| plain word here |", "| --- |", "| x |"],
            { line: 0, ch: 8 },
        );
        const handled = selectionPressHandled(
            fakePlugin(doc),
            doc,
            cell,
            "autonum",
            { line: 0, ch: 8 },
        );
        expect(handled).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 5, to: 10, insert: "[^1]" },
                selection: { anchor: 5 + "[^1]".length },
            },
        ]);
        expect(doc.lines[doc.lines.length - 1]).toBe("[^1]: word");
    });

    it("an empty cell selection is no claim - the caret cascade owns the press", () => {
        const { cell, dispatched } = fakeCell("plain word here", 7, 7);
        const doc = fakeEditor(["| plain word here |"], { line: 0, ch: 8 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(false);
        expect(dispatched).toEqual([]);
    });

    it("a cell selection inside the cell's inline code refuses", () => {
        const { cell, dispatched } = fakeCell("has `co de` x", 6, 8);
        const doc = fakeEditor(["| has `co de` x |"], { line: 0, ch: 7 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("the named key claims a cell selection for its modal, dispatching nothing yet", () => {
        const { cell, dispatched } = fakeCell("plain word here", 6, 10);
        const doc = fakeEditor(["| plain word here |"], { line: 0, ch: 8 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "named"),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticeCalls).toEqual([]);
    });

    it("the modal's submit converts the cell selection under the typed name", () => {
        const { cell, dispatched } = fakeCell("plain word here", 6, 10);
        const doc = fakeEditor(
            ["| plain word here |", "| --- |", "| x |"],
            { line: 0, ch: 8 },
        );
        const problem = convertCellSelectionToNamed(
            fakePlugin(doc),
            doc,
            cell,
            { from: 6, to: 10, text: "word", lead: "" },
            "src",
            { line: 0, ch: 8 },
        );
        expect(problem).toBeNull();
        expect(dispatched).toEqual([
            {
                changes: { from: 6, to: 10, insert: "[^src]" },
                selection: { anchor: 6 + "[^src]".length },
            },
        ]);
        expect(doc.lines[doc.lines.length - 1]).toBe("[^src]: word");
    });
});

// ---------------------------------------------------------------------------
// the block zoo (2026-08-19): every block construct Obsidian speaks, selected
// WHOLE inside a conversion - these pin the exact seeded definition so the
// manual block-zoo sheet (sheet 05) can promise what the note will hold.
// Rendering inside the footnote/popup is sheet 05's eyeball territory; the text shape is
// pinned here.
// ---------------------------------------------------------------------------

describe("the block zoo converts (2026-08-19)", () => {
    /** Convert `middle` (with a prose line above and below it riding along) via autonum and return the resulting lines. */
    async function convertBlock(middle: string[]): Promise<string[]> {
        const lines = ["above prose", ...middle, "below prose", "tail stays"];
        const lastSelected = lines.length - 2;
        const doc = fakeEditor(lines, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: lastSelected, ch: lines[lastSelected].length },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        return doc.lines;
    }

    const indented = (middle: string[]) => [
        "[^1]",
        "tail stays",
        "",
        "[^1]: above prose",
        ...middle.map((l) => (l.trim() === "" ? "    " : `    ${l}`)),
        "    below prose",
    ];

    // fixtures are BLANK-PADDED like sheet 05 (Jason's fix,
    // 2026-08-20): in Live Preview most blocks only render correctly with
    // a blank line between them and surrounding text, so that's the
    // realistic selection shape
    it("a bulleted list (nested item included)", async () => {
        const middle = ["", "- alpha", "    - nested", "- beta", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a numbered list and a task item", async () => {
        const middle = ["", "1. first", "2. second", "- [ ] task", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a blockquote", async () => {
        const middle = ["", "> quoted line", "> second quoted", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a callout", async () => {
        const middle = ["", "> [!note] Heads up", "> callout body", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a horizontal rule", async () => {
        const middle = ["", "---", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a heading", async () => {
        const middle = ["", "## Section title", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("image links, markdown and wikilink embed flavors", async () => {
        const middle = ["![alt text](https://example.org/pic.png)", "![[vault image.png]]"];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a table", async () => {
        const middle = ["", "| a | b |", "| --- | --- |", "| 1 | 2 |", ""];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("a fence, a $$ block, and inline math together (sheet 05's fixture)", async () => {
        const middle = [
            "```",
            "fenced code here",
            "```",
            "$$",
            "E = mc^2",
            "$$",
            "inline math before $1+1\\neq3$ and after",
        ];
        expect(await convertBlock(middle)).toEqual(indented(middle));
    });

    it("the inline key flattens a SINGLE-line image link without escaping its brackets", async () => {
        // balanced brackets pass the sanitizer untouched - the embed keeps
        // working inside the inline footnote
        const doc = fakeEditor(
            ["see ![alt](https://x.org/p.png) here"],
            { line: 0, ch: 4 },
            { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 31 } },
        );
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "see^[![alt](https://x.org/p.png)] here",
        ]);
    });

    it("the inline key refuses the zoo's multi-line fixtures like any other", async () => {
        const before = ["see ![alt](https://x.org/p.png)", "and more here"];
        const doc = fakeEditor(before, { line: 0, ch: 4 }, {
            anchor: { line: 0, ch: 4 },
            head: { line: 1, ch: 8 },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(InlineSelectionNotice)).toBe(true);
    });

    it("the named modal takes a block-zoo selection too", () => {
        const doc = fakeEditor(
            ["pick > quoted", "- listed end"],
            { line: 0, ch: 5 },
        );
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            {
                from: { line: 0, ch: 5 },
                to: { line: 1, ch: 8 },
                text: "> quoted\n- listed",
                lead: "",
            },
            "zoo",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual([
            "pick [^zoo] end",
            "",
            "[^zoo]: > quoted",
            "    - listed",
        ]);
    });
});

describe("quote-relative indented code refuses at the edges (second 30k-soak find, 2026-08-20)", () => {
    it("a full-line drag on a quoted code line refuses (its '>' sits at ch 0)", async () => {
        // the found counterexample, minimized: quote-relative indented
        // code is protected but carries no region flag, and its quote
        // marker at ch 0 is where the whitespace trim can't shield the
        // edge - converting it consumed protected text
        const before = ["", ">     > gap code[^88]", "", "alpha[^1]."];
        for (const command of [insertInlineFootnote, insertAutonumFootnote]) {
            resetNotices();
            const doc = fakeEditor(before, { line: 1, ch: 0 }, {
                anchor: { line: 0, ch: 0 },
                head: { line: 2, ch: 0 },
            });
            await command(fakePlugin(doc));
            expect(doc.lines).toEqual(before);
            expect(noticed(ProtectedSelectionNotice)).toBe(true);
        }
    });

    it("a doc-level indented chunk at the selection TAIL still travels (containment)", async () => {
        const doc = fakeEditor(
            ["take this", "", "    chunk line one", "    chunk line two"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 3, ch: 18 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "[^1]",
            "",
            "[^1]: take this",
            "    ",
            "        chunk line one",
            "        chunk line two",
        ]);
    });
});

describe("a footnote command submits the open name modal (2026-08-22)", () => {
    // the modal itself is DOM/smoke territory; these drive the exported
    // registry the way onOpen/onClose do
    afterEach(() => {
        registerActiveNameModal(null);
    });

    it("any creation command submits the registered modal and edits nothing itself", async () => {
        const submissions: string[] = [];
        registerActiveNameModal({ submit: () => submissions.push("submit") });
        const before = ["alpha bravo", "charlie"];
        const doc = fakeEditor(before, { line: 0, ch: 3 });
        await insertAutonumFootnote(fakePlugin(doc));
        await insertInlineFootnote(fakePlugin(doc));
        expect(submissions).toEqual(["submit", "submit"]);
        expect(doc.lines).toEqual(before);
    });

    it("with no modal registered, commands run normally", async () => {
        registerActiveNameModal(null);
        const doc = fakeEditor(["alpha bravo"], { line: 0, ch: 5 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["alpha[^1] bravo", "", "[^1]: "]);
    });

    it("submitActiveNameModal reports whether a modal claimed the press", () => {
        expect(submitActiveNameModal()).toBe(false);
        let submitted = 0;
        registerActiveNameModal({ submit: () => submitted++ });
        expect(submitActiveNameModal()).toBe(true);
        expect(submitted).toBe(1);
        registerActiveNameModal(null);
        expect(submitActiveNameModal()).toBe(false);
        expect(submitted).toBe(1);
    });
});

describe("commandHotkeys reads the hotkey registry defensively (2026-08-22)", () => {
    it("custom assignment wins, defaults fall back, absent manager degrades to none", () => {
        const app = (hm: unknown) => ({ hotkeyManager: hm }) as unknown as App;
        const custom = [{ modifiers: ["Alt"], key: "0" }];
        const defaults = [{ modifiers: ["Mod"], key: "9" }];
        expect(
            commandHotkeys(
                app({ getHotkeys: () => custom, getDefaultHotkeys: () => defaults }),
                "x:y",
            ),
        ).toEqual(custom);
        expect(
            commandHotkeys(
                app({ getHotkeys: () => null, getDefaultHotkeys: () => defaults }),
                "x:y",
            ),
        ).toEqual(defaults);
        expect(
            commandHotkeys(
                app({ getHotkeys: () => null, getDefaultHotkeys: () => null }),
                "x:y",
            ),
        ).toEqual([]);
        expect(commandHotkeys(app(undefined), "x:y")).toEqual([]);
    });
});

describe("nested footnotes are prevented in selections (2026-08-24)", () => {
    // Jason's ruling after the Obsidian Academia Discord confirmed nobody
    // nests footnotes: a selection touching a LIVE reference, "[^]"
    // placeholder, or inline footnote refuses - full containment would
    // nest it, partial overlap would corrupt it
    it("a selection CONTAINING a reference refuses, note untouched", async () => {
        const before = ["alpha cite[^1] omega", "", "[^1]: one"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 0, ch: 20 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("a selection CUTTING a reference in half refuses (corruption guard)", async () => {
        const before = ["alpha cite[^1] omega", "", "[^1]: one"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            // "alpha cite[^" - grabs the opening of the reference only
            anchor: { line: 0, ch: 0 },
            head: { line: 0, ch: 12 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("a selection containing an INLINE footnote or a [^] placeholder refuses", async () => {
        for (const line of ["keep ^[inline note] here", "keep [^] here"]) {
            resetNotices();
            const before = [line];
            const doc = fakeEditor(before, { line: 0, ch: 0 }, {
                anchor: { line: 0, ch: 0 },
                head: { line: 0, ch: line.length },
            });
            await insertAutonumFootnote(fakePlugin(doc));
            expect(doc.lines).toEqual(before);
            expect(noticed(NestedFootnoteNotice)).toBe(true);
        }
    });

    it("a DEAD reference-shaped fake inside a contained code span still converts", async () => {
        const doc = fakeEditor(
            ["take `fake [^9] code` along", "", "tail"],
            { line: 0, ch: 0 },
            { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 27 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "[^1]",
            "",
            "tail",
            "",
            "[^1]: take `fake [^9] code` along",
        ]);
    });

    it("the cell path refuses a selection containing a reference too", () => {
        const dispatched: unknown[] = [];
        const cell = {
            state: {
                doc: { toString: () => "cell cite[^1] end" },
                selection: { main: { anchor: 0, head: 13 } },
            },
            dispatch: (spec: unknown) => {
                dispatched.push(spec);
            },
        } as unknown as TableCellEditor;
        const doc = fakeEditor(["| a |", "", "[^1]: one"], { line: 0, ch: 2 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("a multi-line selection with the reference on its SECOND line refuses", async () => {
        const before = ["first line", "second cite[^1] line", "", "[^1]: one"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 1, ch: 20 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// tables are protected against PARTIAL conversion (Jason's ruling 2026-09-04
// from his manual pass): moving a cell, a few cells, or a row into a footnote
// shreds the table left behind and yields a body that renders as nothing
// sensible. Two shapes stay allowed - text INSIDE one cell (source mode
// here; the cell sub-editor branch can't cross cells by construction), and
// the whole table travelling with the prose around it (the block zoo above).
// ---------------------------------------------------------------------------

describe("partial-table selections refuse (Jason's ruling 2026-09-04)", () => {
    const table = [
        "before the table",
        "",
        "| a | b |",
        "| --- | --- |",
        "| one | two |",
        "",
        "after the table",
    ];

    async function refused(
        anchor: EditorPosition,
        head: EditorPosition,
        command: (plugin: FootnotePlugin) => Promise<void> | void = insertAutonumFootnote,
        lines: string[] = table,
    ): Promise<void> {
        const doc = fakeEditor(lines, anchor, { anchor, head });
        await command(fakePlugin(doc));
        expect(doc.lines).toEqual(lines);
        expect(noticed(TableSelectionNotice)).toBe(true);
    }

    it("the header row alone (prose above through the header)", () =>
        refused({ line: 0, ch: 0 }, { line: 2, ch: 9 }));

    it("a cell's text through to the prose below", () =>
        refused({ line: 4, ch: 2 }, { line: 6, ch: 5 }));

    it("two cells of one row across their pipe", () =>
        refused({ line: 4, ch: 2 }, { line: 4, ch: 11 }));

    it("one cell WITH its pipes", () =>
        refused({ line: 4, ch: 0 }, { line: 4, ch: 7 }));

    it("the table exactly, without the prose around it, CONVERTS (Jason's ruling 2026-09-09; Obsidian renders a table that starts on the label line)", async () => {
        const doc = fakeEditor(table, { line: 2, ch: 0 }, { anchor: { line: 2, ch: 0 }, head: { line: 4, ch: 13 } });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines).toEqual([
            "before the table",
            "",
            "[^1]",
            "",
            "after the table",
            "",
            "[^1]: | a | b |",
            "    | --- | --- |",
            "    | one | two |",
        ]);
    });

    it("the inline key refuses the same shapes", () =>
        refused({ line: 4, ch: 2 }, { line: 4, ch: 11 }, insertInlineFootnote));

    it("the named key refuses before any modal opens", () =>
        refused({ line: 0, ch: 0 }, { line: 2, ch: 9 }, insertNamedFootnote));

    it("a quoted table refuses too", () =>
        refused(
            { line: 0, ch: 0 },
            { line: 2, ch: 11 },
            insertAutonumFootnote,
            // the blank quote line keeps the rows a table (a table cannot
            // interrupt a paragraph, quoted or not; probed 2026-09-16)
            ["> intro", ">", "> | a | b |", "> | --- | --- |", "> | 1 | 2 |"],
        ));

    it("text inside ONE cell still converts in source mode", async () => {
        const doc = fakeEditor(table, { line: 4, ch: 2 }, {
            anchor: { line: 4, ch: 2 },
            head: { line: 4, ch: 5 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[4]).toBe("| [^1] | two |");
        expect(doc.lines[doc.lines.length - 1]).toBe("[^1]: one");
        expect(noticed(TableSelectionNotice)).toBe(false);
    });

    it("whole-word expansion stops at the cell's edge, not the pipe", async () => {
        const doc = fakeEditor(table, { line: 4, ch: 3 }, {
            anchor: { line: 4, ch: 3 },
            head: { line: 4, ch: 4 },
        });
        await insertAutonumFootnote(
            fakePlugin(doc, { expandSelectionToWholeWords: true }),
        );
        expect(doc.lines[4]).toBe("| [^1] | two |");
    });

    it("the inline key wraps text inside one cell", async () => {
        const doc = fakeEditor(table, { line: 4, ch: 8 }, {
            anchor: { line: 4, ch: 8 },
            head: { line: 4, ch: 11 },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines[4]).toBe("| one | ^[two] |");
    });

    it("a pipe in prose without a delimiter row is not a table", async () => {
        const doc = fakeEditor(["pick a | b here"], { line: 0, ch: 5 }, {
            anchor: { line: 0, ch: 5 },
            head: { line: 0, ch: 10 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("pick[^1] here");
        expect(noticed(TableSelectionNotice)).toBe(false);
    });

    it("the whole table with its surrounding prose still converts (the block zoo contract)", async () => {
        const doc = fakeEditor(table, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 6, ch: 15 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("[^1]");
        expect(doc.lines).toContain("    | one | two |");
        expect(noticed(TableSelectionNotice)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// the reference attaches to the text before the selection (Jason's
// formatting ruling 2026-09-08, from the hero GIF: converting the second of
// two sentences left "range. [^2]"). The whitespace run in front of the
// selected text is replaced along with it; the body never carries it.
// ---------------------------------------------------------------------------

describe("the reference attaches to the preceding text (2026-09-08)", () => {
    it("a whole trailing sentence: the reference lands right after the previous period", async () => {
        const line = "Temperatures stayed in range. The buoy log confirms this independently.";
        const from = line.indexOf("The buoy");
        const doc = fakeEditor([line], { line: 0, ch: from }, {
            anchor: { line: 0, ch: from },
            head: { line: 0, ch: line.length },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "Temperatures stayed in range.[^1]",
            "",
            "[^1]: The buoy log confirms this independently.",
        ]);
    });

    it("mid-sentence: the reference attaches to the word before, the text after keeps its space", async () => {
        const line = "The survey counted 412 colonies along the transect.";
        const from = line.indexOf("412");
        const to = line.indexOf(" along");
        const doc = fakeEditor([line], { line: 0, ch: from }, {
            anchor: { line: 0, ch: from },
            head: { line: 0, ch: to },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("The survey counted[^1] along the transect.");
        expect(doc.lines[2]).toBe("[^1]: 412 colonies");
    });

    it("the inline key attaches the same way", async () => {
        const line = "Temperatures stayed in range. The buoy log confirms this.";
        const from = line.indexOf("The buoy");
        const doc = fakeEditor([line], { line: 0, ch: from }, {
            anchor: { line: 0, ch: from },
            head: { line: 0, ch: line.length },
        });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["Temperatures stayed in range.^[The buoy log confirms this.]"]);
    });

    it("the named modal path replaces the absorbed space too, and its note-changed guard understands that", () => {
        const line = "Temperatures stayed in range. The buoy log confirms this.";
        const from = line.indexOf("The buoy");
        const doc = fakeEditor([line], { line: 0, ch: from });
        const problem = convertSelectionToNamed(
            fakePlugin(doc),
            doc,
            { from: { line: 0, ch: from - 1 }, to: { line: 0, ch: line.length }, text: "The buoy log confirms this.", lead: " " },
            "buoy",
        );
        expect(problem).toBeNull();
        expect(doc.lines).toEqual([
            "Temperatures stayed in range.[^buoy]",
            "",
            "[^buoy]: The buoy log confirms this.",
        ]);
    });

    it("a selection with spaces on both sides: the leading one is absorbed, the trailing one stays with the prose", async () => {
        const line = "The paragraph wants to move this aside for later readers.";
        const from = line.indexOf(" move");
        const to = line.indexOf("aside");
        const doc = fakeEditor([line], { line: 0, ch: from }, {
            anchor: { line: 0, ch: from },
            head: { line: 0, ch: to },
        });
        await insertAutonumFootnote(fakePlugin(doc, { expandSelectionToWholeWords: false }));
        expect(doc.lines[0]).toBe("The paragraph wants to[^1] aside for later readers.");
        expect(doc.lines[2]).toBe("[^1]: move this");
    });

    /** absorbLeadingSpace with the block syntax of `line` read as a note of one line. */
    const absorb = (line: string, ch: number) => absorbLeadingSpace(line, ch, readNote([line]).blockSyntaxEnd(0));

    it("structure in front stays put: list, task, quote, heading markers and a table pipe", () => {
        expect(absorb("- item text", 2)).toBe(2);
        expect(absorb("1. item text", 3)).toBe(3);
        expect(absorb("- [ ] task text", 6)).toBe(6);
        expect(absorb("> quoted text", 2)).toBe(2);
        expect(absorb("## Heading text", 3)).toBe(3);
        expect(absorb("> [!note]- Title", 11)).toBe(11);
        expect(absorb("- [/] task", 6)).toBe(6);
        expect(absorb("| a | b |", 6)).toBe(6);
        expect(absorb("    indented", 4)).toBe(4);
        expect(absorb("word here", 0)).toBe(0);
    });

    it("prose in front is absorbed, tabs included, inside a quote or list item too", () => {
        expect(absorb("range. The buoy", 7)).toBe(6);
        expect(absorb("range.\t\tThe buoy", 8)).toBe(6);
        expect(absorb("> quoted prose here", 15)).toBe(14);
        expect(absorb("- item prose here", 13)).toBe(12);
    });

    it("a multi-line selection starting mid-line attaches its first line the same way", async () => {
        const doc = fakeEditor(["Intro sentence. First moved line", "second moved line"], { line: 0, ch: 16 }, {
            anchor: { line: 0, ch: 16 },
            head: { line: 1, ch: 17 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("Intro sentence.[^1]");
    });
});

