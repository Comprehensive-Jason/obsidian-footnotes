import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): pasted text whose first line starts indented keeps
// its reference's old name while the definition it carries is renamed,
// so the reference silently points at the destination's own footnote.
//
// What the user would see: they copy a definition's continuation line
// ("    see[^1] more"), or a nested list item with its tab
// ("\t- nested[^1] point"), and paste it into a note that already has a
// different [^1]. The carried definition arrives renamed to [^2], as it
// should, but the pasted reference still reads [^1]. It now shows the
// destination's footnote text, and the [^2] definition that came along
// has nothing pointing at it.
//
// Hunt 2026-10-02, round 3, lens carry-model. Cluster M2.
//
// Source of truth: planCarriedPaste's docstring, "The renames are made in
// the body", and the README's Paste paragraph: a colliding name "is
// renamed ... so the pasted footnotes come out unique". Where the text
// lands it is live text, not code: CommonMark 4.4 (an indented code block
// cannot interrupt a paragraph) and 5.2 (a tab-indented "- " under a list
// item is a nested item).
//
// Cause: planCarriedPaste finds the references to rename by scanning the
// pasted body on its own. Read alone, a body whose first line is indented
// four columns is an indented code block, so its references are skipped.
// The carried definition is renamed regardless.

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text`, and records what the hook writes and whether the hook took the event over. */
function clip(text = "") {
    const e = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                e.written[t] = v;
            },
        },
        preventDefault() {
            e.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return e;
}

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
function ed(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

/** A plugin for `doc` with carrying on and every other setting at its default. */
const on = (doc: ReturnType<typeof ed>) => fakePlugin({ carryFootnotesOnCopy: true }, doc);

/** The clipboard text a copy of `from` to `to` in `lines` writes. */
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = ed(lines, from, to);
    const e = clip();
    handleCopy(on(doc), e as never);
    return e.written["text/plain"] ?? "";
}

/** A paste in the same window as the copy, so the plugin recognises its own last copy. */
function pasteRegister(lines: string[], at: Pos, text: string): string[] {
    const doc = ed(lines, at);
    const e = clip(text);
    if (!handlePaste(on(doc), e as never, doc)) throw new Error("paste not taken over");
    return doc.lines;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a pasted body that starts indented is renamed like any other", () => {
    it.fails("a definition's continuation line pasted mid-line keeps pointing at its own footnote", () => {
        const text = copy(["Text[^2] here", "", "[^2]: two", "    see[^1] more", "", "[^1]: one"], { line: 3, ch: 0 }, { line: 3, ch: 16 });
        expect(text).toBe("    see[^1] more\n\n[^1]: one");
        const lines = pasteRegister(["dest[^1] word", "", "[^1]: uno"], { line: 0, ch: 8 }, text);
        // Today: ["dest[^1]    see[^1] more word", "", "[^1]: uno", "[^2]: one"]
        expect(lines).toEqual(["dest[^1]    see[^2] more word", "", "[^1]: uno", "[^2]: one"]);
    });

    it.fails("a nested list item copied with its tab and pasted under another list item keeps its footnote", () => {
        const text = copy(["- top[^2]", "\t- nested[^1] point", "", "[^1]: one", "[^2]: two"], { line: 1, ch: 0 }, { line: 1, ch: 19 });
        expect(text).toBe("\t- nested[^1] point\n\n[^1]: one");
        const lines = pasteRegister(["- mine[^1]", "", "", "[^1]: uno"], { line: 1, ch: 0 }, text);
        // Today: "\t- nested[^1] point" beside "[^2]: one", so the nested item now cites "uno"
        expect(lines[1]).toBe("\t- nested[^2] point");
        expect(lines).toContain("[^2]: one");
    });
});
