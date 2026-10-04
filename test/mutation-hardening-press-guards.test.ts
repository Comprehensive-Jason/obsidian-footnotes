import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { noticeCalls } from "./mocks/obsidian";
import { messages, resetNotices } from "./helpers/notices";

import FootnotePlugin from "../src/main";
import {
    caretGuardsHandled,
    PrefixOnlyNotice,
    warnPrefilledReferenceIfInside,
    warnProtectedCaretIfInside,
} from "../src/commands/press-guards";
import { docContext } from "../src/editor/doc-context";
import { ProtectedCreationNotice } from "../src/editor/insertion-liveness";
import { TableCellEditor } from "../src/editor/table-cursor";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

// Mutation hardening for the press guards (Stryker re-baseline 2026-08-12:
// press-guards scored 60%). The guards are driven DIRECTLY here, not through
// the command entry points: the commands wrap them in simulate-and-verify
// defense in depth that reaches the same refusal by another route, so a
// command-level test passes even with a guard's condition broken - which is
// why the edge conditions below survived. Each test pins one decision the
// guard alone owns.

function fakeEditor(lines: string[], cursor: EditorPosition = { line: 0, ch: 0 }): FakeEditor {
    return sharedFakeEditor(lines, { cursor, wholeDoc: true });
}

function fakePlugin(settings: Partial<FootnotePlugin["settings"]> = {}): FootnotePlugin {
    return sharedFakePlugin({
        enableFootnotePrefix: false,
        enablePopupEditor: false,
        ...settings,
    });
}

function fakeCell(text: string, head: number): TableCellEditor {
    return {
        state: {
            doc: { toString: () => text },
            selection: { main: { head, anchor: head } },
        },
        dispatch() {},
    };
}

beforeEach(() => {
    resetNotices();
});

describe("the protected-caret guard inside a table cell", () => {
    // the main-editor line is deliberately plain in these: only the cell
    // branch can produce a refusal, so a mutant that falls through to the
    // document branch answers differently
    const plainDoc = () => fakeEditor(["plain row here"]);

    it("refuses a caret inside the cell's own inline code", () => {
        const doc = plainDoc();
        expect(
            warnProtectedCaretIfInside(
                doc,
                fakeCell("has `co de` x", 7),
                { line: 0, ch: 3 },
                docContext(doc),
            ),
        ).toBe(true);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });

    it("allows a caret at the cell's start, just before an opening code span", () => {
        // ch 0 has no left neighbor IN THE CELL, and a cell's text is one
        // line: nothing can be open across its start
        const doc = plainDoc();
        expect(
            warnProtectedCaretIfInside(
                doc,
                fakeCell("`code` x", 0),
                { line: 0, ch: 3 },
                docContext(doc),
            ),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("allows a caret at the cell's end, just after a closing code span", () => {
        const doc = plainDoc();
        expect(
            warnProtectedCaretIfInside(
                doc,
                fakeCell("x `code`", "x `code`".length),
                { line: 0, ch: 3 },
                docContext(doc),
            ),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });
});

describe("the protected-caret guard at a line's edges", () => {
    const guard = (lines: string[], cursor: EditorPosition) => {
        const doc = fakeEditor(lines, cursor);
        return warnProtectedCaretIfInside(doc, null, cursor, docContext(doc));
    };

    it("refuses ch 0 of a line a comment region is open across", () => {
        // "still --> tail" closes the region mid-line, so the line itself is
        // not wholly protected - ch 0 is inside only because the region
        // crosses the line START
        expect(
            guard(
                ["prose <!-- open", "hidden comment", "still --> tail", "plain"],
                { line: 2, ch: 0 },
            ),
        ).toBe(true);
    });

    it("allows ch 0 of a line whose own code span starts there", () => {
        // masked text says "protected" to the right of the caret, but no
        // region crosses the line start, so the insertion point is outside
        expect(guard(["`code` here", "plain"], { line: 0, ch: 0 })).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("refuses end of a line whose tail opens a comment the next line closes", () => {
        // an unclosed opener is literal text unless a later line of its paragraph closes it (Kimi hunt cycle 3, probed in Reading view 2026-09-16)
        expect(
            guard(["text <!-- open", "hidden -->"], { line: 0, ch: "text <!-- open".length }),
        ).toBe(true);
    });

    it("allows end of a line whose tail opens a comment nothing closes (literal text)", () => {
        expect(
            guard(["text <!-- open", "hidden"], { line: 0, ch: "text <!-- open".length }),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("refuses end of a line whose tail opens MATH the next line continues", () => {
        // A "$$" pair inside one paragraph is math, across its lines too
        // (rule M1, docs/obsidian-reading-rules.md). The old pin had the
        // closing "$$" on a line of its own, which Obsidian reads as the
        // start of a display block of its own (rule M2), leaving the
        // paragraph's "$$" literal text: the note reading follows
        // Obsidian there (runtime swap, step 2, 2026-10-03).
        expect(
            guard(["text $$", "E = mc^2 $$", "after"], {
                line: 0,
                ch: "text $$".length,
            }),
        ).toBe(true);
    });

    it("allows end of a line whose code span closes there", () => {
        expect(guard(["text `code`", "next"], { line: 0, ch: "text `code`".length })).toBe(
            false,
        );
        expect(noticeCalls).toEqual([]);
    });

    it("refuses end of the LAST line while a region reaches EOF", () => {
        // there is no next line to ask, so whether the note ends inside a
        // region that never closes stands in for the off-line neighbor.
        // A "$$" line opens display math only with a line after it (rule
        // M2), so the region needs a line of its own here; "$$ open" alone
        // is a paragraph, and a press after it is refused once the
        // definition appended under it would be born inside the math (the
        // born-dead check, runtime swap step 2, 2026-10-03)
        expect(guard(["$$", "open"], { line: 1, ch: "open".length })).toBe(true);
    });

    it("allows end of an earlier line when the region only opens BELOW it", () => {
        // endsProtected is true for this document, but it speaks for the
        // end of the DOCUMENT, not for the end of line 0
        expect(
            guard(["text `code`", "hidden <!-- open"], {
                line: 0,
                ch: "text `code`".length,
            }),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });
});

describe("the prefilled-reference guard", () => {
    const prefixNotice = PrefixOnlyNotice;
    const noteWith = (prefix: string, body: string) => [
        "---",
        `footnote-prefix: "${prefix}"`,
        "---",
        body,
    ];

    it("warns inside the untouched prefix placeholder", () => {
        const doc = fakeEditor(noteWith("7-", "see [^7-] here"));
        expect(
            warnPrefilledReferenceIfInside(
                fakePlugin({ enableFootnotePrefix: true }),
                doc,
                null,
                { line: 3, ch: 6 },
            ),
        ).toBe(true);
        expect(messages()).toEqual([prefixNotice]);
    });

    it("stays silent while the note's prefix is invalid", () => {
        // a trailing digit is invalid ("7" + autonumber "1" reads as 71), so
        // "[^7]" is a real footnote name here, not a bare-prefix placeholder
        const doc = fakeEditor(noteWith("7", "see [^7] here"));
        expect(
            warnPrefilledReferenceIfInside(
                fakePlugin({ enableFootnotePrefix: true }),
                doc,
                null,
                { line: 3, ch: 6 },
            ),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("stays silent when the note has no prefix property (the empty guard owns [^])", () => {
        const doc = fakeEditor(["see [^] here"]);
        expect(
            warnPrefilledReferenceIfInside(
                fakePlugin({ enableFootnotePrefix: true }),
                doc,
                null,
                { line: 0, ch: 5 },
            ),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("stays silent on a line with no reference bracket at all", () => {
        const doc = fakeEditor(noteWith("7-", "plain prose"));
        expect(
            warnPrefilledReferenceIfInside(
                fakePlugin({ enableFootnotePrefix: true }),
                doc,
                null,
                { line: 3, ch: 4 },
            ),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("stays silent while the prefix feature is off", () => {
        const doc = fakeEditor(noteWith("3~", "see [^3~] here"));
        expect(
            warnPrefilledReferenceIfInside(fakePlugin(), doc, null, { line: 3, ch: 6 }),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });
});

describe("the caret guard cascade", () => {
    it("hands an unclaimed press on to the prefilled-reference guard", () => {
        const doc = fakeEditor(["---", 'footnote-prefix: "7-"', "---", "see [^7-] here"]);
        expect(
            caretGuardsHandled(
                fakePlugin({ enableFootnotePrefix: true }),
                doc,
                null,
                { line: 3, ch: 6 },
            ),
        ).toBe(true);
        expect(messages()).toEqual([PrefixOnlyNotice]);
    });

    it("claims nothing on plain prose", () => {
        const doc = fakeEditor(["plain prose here"]);
        expect(caretGuardsHandled(fakePlugin(), doc, null, { line: 0, ch: 5 })).toBe(false);
        expect(noticeCalls).toEqual([]);
    });

    it("warns about a live [^] in a table cell, reading the CELL's text", () => {
        // the document caret is elsewhere in the row: only the cell's own
        // text and head can produce this warning
        const doc = fakeEditor(["| a [^] b |"]);
        expect(
            caretGuardsHandled(fakePlugin(), doc, fakeCell("a [^] b", 4), {
                line: 0,
                ch: 0,
            }),
        ).toBe(true);
        expect(messages()).toEqual([
            "This footnote reference is empty. Type a name between the brackets.",
        ]);
    });

    it("leaves a [^] inside the cell's inline code alone (#41)", () => {
        const doc = fakeEditor(["| a `[^]` b |"]);
        expect(
            caretGuardsHandled(fakePlugin(), doc, fakeCell("a `[^]` b", 5), {
                line: 0,
                ch: 0,
            }),
        ).toBe(false);
        expect(noticeCalls).toEqual([]);
    });
});
