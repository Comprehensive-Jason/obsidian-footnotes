import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";
import { carriedInputHandler, handleCopy, handlePaste, resetCarryRegister } from "../src/commands/carry-footnotes-hooks";
import { splitCarriedText, withCarriedText } from "../src/commands/carry-footnotes";

// A copy taken whole lines at a time (a selection that ends in a line
// break, as Shift+Down makes) is marked the way plain editors mark a
// whole-line copy: the clipboard text ends in a line break, after the
// carried definitions. A paste reads it back that way, and only that way:
// blank lines between two trailing definitions are spacing, never the
// selection's line break (Jason's ruling Q16, 2026-10-07, after he found
// that Gboard's clipboard history keeps a trailing line break; it replaces
// d77449d's reading, where a second blank line between two definitions
// meant the text ended in a line break). The plugin's own copy (the
// register), a clipboard from another app, and a phone keyboard's
// clipboard history must all paste the same note.

type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clip(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                event.written[t] = v;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

function ed(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
const settings = { carryFootnotesOnCopy: true };

/** Copies from..to of `source`, then pastes into `dest` at `at` by the register, as a clipboard from another app, and by the input method. */
function threeRoutes(source: string[], from: Pos, to: Pos, dest: string[], at: Pos) {
    resetCarryRegister();
    const src = ed(source, from, to);
    const ev = clip();
    handleCopy(fakePlugin(settings, src), ev as never);
    // the editor's own copy, when the plugin leaves it: the selected text
    const selected = [source[from.line].slice(from.ch), ...source.slice(from.line + 1, to.line + 1)];
    if (to.line > from.line) selected[selected.length - 1] = source[to.line].slice(0, to.ch);
    else selected[0] = source[from.line].slice(from.ch, to.ch);
    const text = ev.written["text/plain"] ?? selected.join("\n");
    const d1 = ed(dest, at);
    handlePaste(fakePlugin(settings, d1), clip(text) as never, d1);
    resetCarryRegister();
    const d2 = ed(dest, at);
    handlePaste(fakePlugin(settings, d2), clip(text) as never, d2);
    const d3 = ed(dest, at);
    const off = d3.posToOffset(at);
    carriedInputHandler(fakePlugin(settings, d3), () => d3)({} as never, off, off, text);
    return { text, register: d1.lines, foreign: d2.lines, ime: d3.lines };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a whole-line copy ends its clipboard text in a line break", () => {
    it("a line-wise selection: the text ends in a line break, after the carried definition", () => {
        expect(withCarriedText("Para[^1].\n", [{ name: "1", lines: ["[^1]: one"] }])).toBe("Para[^1].\n\n[^1]: one\n");
        expect(withCarriedText("Para[^1].", [{ name: "1", lines: ["[^1]: one"] }])).toBe("Para[^1].\n\n[^1]: one");
    });

    it("read back, the body ends in its line break, and the definition is carried", () => {
        expect(splitCarriedText("Para[^1].\n\n[^1]: one\n")).toEqual({ body: "Para[^1].\n", carried: [{ name: "1", lines: ["[^1]: one"] }] });
    });

    it("pasted at the start of a line by every route, it ends its own line", () => {
        const r = threeRoutes(["Para[^1].", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 1, ch: 0 }, ["Intro.", "Next."], { line: 1, ch: 0 });
        expect(r.text).toBe("Para[^1].\n\n[^1]: one\n");
        expect(r.register).toEqual(["Intro.", "Para[^1].", "Next.", "", "[^1]: one"]);
        expect(r.foreign).toEqual(r.register);
        expect(r.ime).toEqual(r.register);
    });

    it("a selection that ends inside a line has no line break at the end, and every route pastes it inside the line", () => {
        const r = threeRoutes(["Para[^1]. more", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 9 }, ["dest abc def"], { line: 0, ch: 8 });
        expect(r.text).toBe("Para[^1].\n\n[^1]: one");
        expect(r.register[0]).toBe("dest abcPara[^1]. def");
        expect(r.foreign).toEqual(r.register);
        expect(r.ime).toEqual(r.register);
    });

    it("a selection ending in its own definitions, spaced by two blank lines, pastes inside the line by every route", () => {
        const note = ["See[^1] and[^2].", "", "[^1]: one", "", "", "[^2]: two", "", "dest abc def"];
        const r = threeRoutes(note, { line: 0, ch: 0 }, { line: 5, ch: 9 }, ["dest abc def"], { line: 0, ch: 8 });
        expect(r.register[0]).toBe("dest abcSee[^1] and[^2]. def");
        expect(r.foreign).toEqual(r.register);
        expect(r.ime).toEqual(r.register);
    });

    it("a line-wise selection ending in its own definition, with one carried from outside it, ends its own line by every route", () => {
        const source = ["a[^1] b[^2]", "", "[^1]: one", "", "[^2]: two"];
        const r = threeRoutes(source, { line: 0, ch: 0 }, { line: 3, ch: 0 }, ["Intro.", "Next."], { line: 1, ch: 0 });
        expect(r.text).toBe("a[^1] b[^2]\n\n[^1]: one\n\n[^2]: two\n");
        expect(r.register).toContain("Next.");
        expect(r.register[1]).toBe("a[^1] b[^2]");
        expect(r.foreign).toEqual(r.register);
        expect(r.ime).toEqual(r.register);
    });
});
