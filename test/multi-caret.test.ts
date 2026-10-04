import { EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { MultiCaretNestedNotice, NestedFootnoteNotice } from "../src/editor/notice";
import { PrefixOnlyNotice } from "../src/commands/press-guards";
import { ProtectedCreationNotice } from "../src/editor/insertion-liveness";

// Multiple Alt-clicked carets get the SAME footnote at every one
// (2026-08-22, Jason's ask - one source cited many times; always on, no
// toggle, atomic refusal, his calls). The autonum key mints one "[^N]"
// per caret and ONE definition; named/inline/paste drop their skeleton at
// each caret, with cursors left inside the brackets so typing fills all
// of them at once. These pin the transaction shapes; the live
// multi-cursor typing is smoke/manual territory.

function fakeEditor(lines: string[], carets: EditorPosition[]): FakeEditor {
    return sharedFakeEditor(lines, {
        carets,
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

type Settings = Partial<FootnotePlugin["settings"]>;

function fakePlugin(doc: FakeEditor, settings: Settings = {}): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
            ...settings,
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

describe("the numbered key at several carets", () => {
    it("inserts the SAME reference at every caret with ONE definition", async () => {
        const doc = fakeEditor(
            ["alpha bravo charlie", "delta echo"],
            [
                { line: 0, ch: 5 },
                { line: 0, ch: 11 },
                { line: 1, ch: 5 },
            ],
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "alpha[^1] bravo[^1] charlie",
            "delta[^1] echo",
            "",
            "[^1]: ",
        ]);
        // the caret jumps to the one definition, like a single-caret insert
        expect(doc.cursor).toEqual({ line: 3, ch: "[^1]: ".length });
        expect(doc.transactions).toBe(1);
    });

    it("numbers past existing footnotes, and carets can come UNSORTED", async () => {
        const doc = fakeEditor(
            ["word here more[^1]", "", "[^1]: a"],
            [
                { line: 0, ch: 9 },
                { line: 0, ch: 4 },
            ],
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "word[^2] here[^2] more[^1]",
            "",
            "[^1]: a",
            "[^2]: ",
        ]);
    });

    it("lint-on-footnote-creation fires after a multi-caret insert, like a single-caret one (parity, Jason's ask 2026-08-25)", async () => {
        const doc = fakeEditor(
            ["alpha[^5] bravo", "charlie", "", "[^5]: five"],
            [
                { line: 0, ch: 15 },
                { line: 1, ch: 7 },
            ],
        );
        await insertAutonumFootnote(
            fakePlugin(doc, {
                lintOnFootnoteCreation: true,
                lintReindex: true,
            }),
        );
        // the press minted [^6] at both carets with one definition; the
        // creation lint then renumbered 5→1, 6→2 - exactly what the same
        // press at a single caret produces
        expect(doc.lines).toEqual([
            "alpha[^1] bravo[^2]",
            "charlie[^2]",
            "",
            "[^1]: five",
            "[^2]: ",
        ]);
    });

    it("end-of-word hops every caret, and same-word carets collapse to ONE insert", async () => {
        const doc = fakeEditor(
            ["alpha bravo"],
            [
                { line: 0, ch: 1 },
                { line: 0, ch: 3 },
                { line: 0, ch: 8 },
            ],
        );
        await insertAutonumFootnote(
            fakePlugin(doc, { insertAtEndOfWord: true }),
        );
        expect(doc.lines).toEqual([
            "alpha[^1] bravo[^1]",
            "",
            "[^1]: ",
        ]);
    });
});

describe("the named and inline keys at several carets", () => {
    it("named drops [^] at each caret with a cursor inside EVERY bracket pair", async () => {
        const doc = fakeEditor(
            ["alpha bravo", "charlie"],
            [
                { line: 0, ch: 5 },
                { line: 1, ch: 7 },
            ],
        );
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["alpha[^] bravo", "charlie[^]"]);
        // typing now writes the same name into both
        expect(doc.selections).toEqual([
            { from: { line: 0, ch: 7 } },
            { from: { line: 1, ch: 9 } },
        ]);
    });

    it("named prefills the note's prefix in every skeleton", async () => {
        const doc = fakeEditor(
            ["---", "footnote-prefix: 2.", "---", "alpha bravo"],
            [
                { line: 3, ch: 5 },
                { line: 3, ch: 11 },
            ],
        );
        await insertNamedFootnote(
            fakePlugin(doc, { enableFootnotePrefix: true }),
        );
        expect(doc.lines[3]).toBe("alpha[^2.] bravo[^2.]");
        expect(doc.selections).toEqual([
            { from: { line: 3, ch: 5 + "[^2.".length } },
            { from: { line: 3, ch: 16 + "[^2.".length } },
        ]);
    });

    it("inline drops ^[] at each caret with a cursor inside every pair", async () => {
        const doc = fakeEditor(
            ["alpha bravo"],
            [
                { line: 0, ch: 5 },
                { line: 0, ch: 11 },
            ],
        );
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["alpha^[] bravo^[]"]);
        expect(doc.selections).toEqual([
            { from: { line: 0, ch: 7 } },
            { from: { line: 0, ch: 16 } },
        ]);
    });
});

describe("the paste key at several carets", () => {
    it("wraps the SAME clipboard text at every caret, ONE cursor after the FIRST wrapper", async () => {
        // Jason's consistency ruling (2026-08-29, extended to paste
        // 2026-09-04): every multi-caret insertion ends with a single
        // caret after the FIRST reference. The named/inline skeletons keep
        // a cursor in every bracket pair because the user still has to
        // type into them; a pasted body is complete, so leaving a cursor
        // after every wrapper only forced a mouse click to get back to
        // one caret.
        vi.stubGlobal("navigator", {
            clipboard: { readText: () => Promise.resolve("same source") },
        });
        const doc = fakeEditor(
            ["alpha bravo"],
            [
                { line: 0, ch: 11 },
                { line: 0, ch: 5 },
            ],
        );
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["alpha^[same source] bravo^[same source]"]);
        expect(doc.selections).toEqual([
            { from: { line: 0, ch: 5 + "^[same source]".length } },
        ]);
    });

    it("an empty clipboard toasts and edits nothing", async () => {
        vi.stubGlobal("navigator", {
            clipboard: { readText: () => Promise.resolve("   ") },
        });
        const before = ["alpha bravo"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 5 },
            { line: 0, ch: 11 },
        ]);
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(
            noticed(
                "The clipboard is empty, so there is nothing to put in an inline footnote.",
            ),
        ).toBe(true);
    });
});

describe("atomic refusals - one bad caret refuses the whole press", () => {
    it("a caret inside inline code refuses everything with the protected toast", async () => {
        const before = ["alpha `code` bravo"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 5 },
            { line: 0, ch: 9 },
        ]);
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    it("a caret inside an existing reference refuses with its own toast", async () => {
        const before = ["alpha[^1] bravo", "", "[^1]: x"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 7 },
            { line: 0, ch: 15 },
        ]);
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(MultiCaretNestedNotice)).toBe(true);
    });

    it("a caret inside a definition body refuses with the definition toast", async () => {
        const before = ["alpha", "", "[^1]: definition body"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 5 },
            { line: 2, ch: 12 },
        ]);
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("a caret inside an inline footnote refuses (mixed meanings, no hop)", async () => {
        const before = ["alpha ^[note] bravo"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 10 },
            { line: 0, ch: 19 },
        ]);
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(MultiCaretNestedNotice)).toBe(true);
    });
});

describe("a second press with EVERY caret inside the same footnote continues it (Jason's report, 2026-08-27)", () => {
    // Jason's report: the named multi-caret flow (skeletons, type the name
    // once) DEAD-ENDED - the second press refused with the atomic toast,
    // and the filled inline flow could never hop back out. When every
    // caret sits inside the SAME artifact the press is unambiguous, so it
    // gets the single-caret continuation, aimed at the LAST artifact in
    // document order. Mixed carets keep the atomic refusal above.
    it("named second press creates the single shared definition", async () => {
        const doc = fakeEditor(
            ["alpha b[^cite] c[^cite] end"],
            [
                { line: 0, ch: 10 },
                { line: 0, ch: 20 },
            ],
        );
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "alpha b[^cite] c[^cite] end",
            "",
            "[^cite]: ",
        ]);
        // the multi-cursor collapsed onto the FIRST reference before the
        // definition was created (that collapse is what the popup arm
        // hands back on close - Jason's consistency ask 2026-08-29)
        expect(doc.moves[0]).toEqual({ line: 0, ch: 10 });
        // ... and on the jump arm the caret then sits on the definition
        expect(doc.cursor).toEqual({ line: 2, ch: "[^cite]: ".length });
        expect(noticed(MultiCaretNestedNotice)).toBe(false);
    });

    it('a "#" name at every caret warns and creates nothing (2026-09-05)', async () => {
        const before = ["alpha b[^#x] c[^#x] end"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 10 },
            { line: 0, ch: 18 },
        ]);
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(
            noticed(
                '"[^#x]" won\'t work as a footnote. Footnote names can\'t contain spaces, backticks, brackets, or "#".',
            ),
        ).toBe(true);
    });

    it("the numbered key continues the same way (single-caret parity)", async () => {
        const doc = fakeEditor(
            ["alpha b[^cite] c[^cite] end"],
            [
                { line: 0, ch: 10 },
                { line: 0, ch: 20 },
            ],
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "alpha b[^cite] c[^cite] end",
            "",
            "[^cite]: ",
        ]);
    });

    it("filled inline footnotes: the press hops ONE cursor out after the FIRST span", async () => {
        // the multi-cursor collapses onto the FIRST footnote in document
        // order, matching where every other multi-caret flow ends up
        // (Jason's consistency ask 2026-08-29; carets given unsorted)
        const before = ["x^[note] y^[note] z"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 14 },
            { line: 0, ch: 5 },
        ]);
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(doc.cursor).toEqual({ line: 0, ch: "x^[note]".length });
        expect(noticed(MultiCaretNestedNotice)).toBe(false);
    });

    it("EMPTY inline footnotes warn and stay, so typing keeps filling all of them", async () => {
        const before = ["x^[] y^[]"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 3 },
            { line: 0, ch: 8 },
        ]);
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(doc.cursor).toEqual({ line: 0, ch: 3 });
        expect(
            noticed(
                "This inline footnote is empty. Type its text between the brackets.",
            ),
        ).toBe(true);
    });

    it("EMPTY [^] references warn and stay, like the single-caret guard", async () => {
        const before = ["x[^] y[^]"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 3 },
            { line: 0, ch: 8 },
        ]);
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(
            noticed(
                "This footnote reference is empty. Type a name between the brackets.",
            ),
        ).toBe(true);
    });

    it("untouched prefix placeholders ask for a suffix, like the single-caret guard", async () => {
        const before = [
            "---",
            'footnote-prefix: "2."',
            "---",
            "x[^2.] y[^2.]",
        ];
        const doc = fakeEditor(before, [
            { line: 3, ch: 5 },
            { line: 3, ch: 12 },
        ]);
        await insertNamedFootnote(
            fakePlugin(doc, { enableFootnotePrefix: true }),
        );
        expect(doc.lines).toEqual(before);
        expect(noticed(PrefixOnlyNotice)).toBe(
            true,
        );
    });

    it("carets inside DIFFERENTLY named references keep the atomic refusal", async () => {
        const before = ["a[^one] b[^two] end"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 4 },
            { line: 0, ch: 12 },
        ]);
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(MultiCaretNestedNotice)).toBe(true);
    });

    it("carets inside an already-DEFINED reference keep the atomic refusal", async () => {
        const before = ["a[^1] b[^1]", "", "[^1]: done"];
        const doc = fakeEditor(before, [
            { line: 0, ch: 3 },
            { line: 0, ch: 9 },
        ]);
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(noticed(MultiCaretNestedNotice)).toBe(true);
    });
});
