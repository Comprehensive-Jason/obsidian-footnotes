import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import {
    carriedInputHandler,
    carryRegister,
    handleCopy,
    handleCut,
    handlePaste,
    resetCarryRegister,
} from "../src/commands/carry-footnotes-hooks";

// The editor side of carrying footnotes (issue #59): the copy, cut, and
// paste hooks over the pure seams, driven here with a fake clipboard
// event. Copy and cut always write the definitions into the clipboard
// text after the selection (Jason, 2026-09-22: otherwise a cut pasted
// outside Obsidian loses them, which reads as data loss; and a clipboard
// that carries them has no downside inside Obsidian, since paste strips
// them back off), and remember the same in a plugin-side register. Cut
// takes the event over only when the deletion orphans a definition, and
// then deletes the selection together with those definitions in one
// transaction. Paste takes the event over when the text matches the
// register or ends in definition lines, and lands body plus definitions in
// one transaction.

interface FakeClipboardEvent {
    clipboardData: { getData(type: string): string; setData(type: string, value: string): void; types: string[] };
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
    written: Record<string, string>;
}

function clipboardEvent(text = "", types = ["text/plain"]): FakeClipboardEvent {
    const event: FakeClipboardEvent = {
        written: {},
        defaultPrevented: false,
        clipboardData: {
            types,
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, {
        wholeDoc: true,
        edits: true,
        cursor: from,
        selection: { anchor: from, head: to },
    });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("copy", () => {
    it("writes the selection plus the definitions it needs into the clipboard text, and remembers both", () => {
        const doc = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        const event = clipboardEvent();
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        expect(event.written["text/plain"]).toBe("a[^1] b\n\n[^1]: one");
        expect(event.defaultPrevented).toBe(true);
        expect(carryRegister()).toEqual({
            text: "a[^1] b\n\n[^1]: one",
            body: "a[^1] b",
            carried: [{ name: "1", lines: ["[^1]: one"] }],
            missing: [],
        });
    });

    it("leaves the clipboard to the editor when the selection needs no definition", () => {
        const doc = editor(["plain text"], { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const event = clipboardEvent();
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        expect(event.defaultPrevented).toBe(false);
        expect(event.written).toEqual({});
        expect(carryRegister()).toMatchObject({ text: "plain", body: "plain", carried: [] });
    });

    it("does nothing while the feature is off, or with nothing selected", () => {
        const off = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        handleCopy(fakePlugin({ carryFootnotesOnCopy: false }, off), clipboardEvent() as never);
        expect(carryRegister()).toBeNull();
        const collapsed = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 2 });
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, collapsed), clipboardEvent() as never);
        expect(carryRegister()).toBeNull();
    });
});

describe("paste", () => {
    it("takes the paste over when the text matches the register: body and definitions land in ONE transaction, renamed to fit", () => {
        const source = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, source), clipboardEvent() as never);
        const destination = editor(["x[^1]", "", "[^1]: uno"], { line: 0, ch: 5 });
        const event = clipboardEvent("a[^1] b\n\n[^1]: one");
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, destination), event as never, destination);
        expect(event.defaultPrevented).toBe(true);
        expect(destination.lines).toEqual(["x[^1]a[^2] b", "", "[^1]: uno", "[^2]: one"]);
        expect(destination.transactions).toBe(1);
        // zero counts are left out of the toast (Jason's pick A, 2026-09-25)
        expect(messages()).toContain("Pasted with 1 footnote definition: 1 added, 1 renamed.");
    });

    it("reads definition lines off a clipboard from anywhere when the register does not match", () => {
        const destination = editor(["p"], { line: 0, ch: 1 });
        const event = clipboardEvent("c[^7]\n\n[^7]: seven");
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, destination), event as never, destination);
        expect(event.defaultPrevented).toBe(true);
        expect(destination.lines).toEqual(["pc[^7]", "", "[^7]: seven"]);
    });

    it("says when a definition was reused under a name the note already had", () => {
        const destination = editor(["s[^own-2]", "", "[^own-2]: the body"], { line: 0, ch: 9 });
        const event = clipboardEvent("a[^own]\n\n[^own]: the body");
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, destination), event as never, destination);
        expect(destination.lines).toEqual(["s[^own-2]a[^own-2]", "", "[^own-2]: the body"]);
        // a definition the note already had under another name is "matched", its own count, in Jason's words (2026-09-25)
        expect(messages()).toContain("Pasted with 1 footnote definition: 1 matched an existing footnote (same definition, different name).");
    });

    it("leaves a plain paste, a paste while the feature is off, and one another plugin already handled, to the editor", () => {
        const plain = editor(["p"], { line: 0, ch: 1 });
        const event = clipboardEvent("just text");
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, plain), event as never, plain);
        expect(event.defaultPrevented).toBe(false);
        expect(plain.lines).toEqual(["p"]);
        const off = editor(["p"], { line: 0, ch: 1 });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: false }, off), clipboardEvent("c[^7]\n\n[^7]: seven") as never, off);
        expect(off.lines).toEqual(["p"]);
        const handled = clipboardEvent("c[^7]\n\n[^7]: seven");
        handled.defaultPrevented = true;
        const taken = editor(["p"], { line: 0, ch: 1 });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, taken), handled as never, taken);
        expect(taken.lines).toEqual(["p"]);
    });

    it("a paste on the empty line between two definitions stays its own paragraph and leaves both definitions live", () => {
        // Below the paste, "[^2]: two" directly under the pasted line
        // would read as more of its paragraph (a lazy label), so [^2]
        // would lose its definition; above it, the pasted line directly
        // under "[^1]: one" would read as footnote 1's text. The pasted
        // text gets a blank line on each side (2026-10-03, the neighbour of
        // the hunt pin bug-carry-paste-below-last-definition-lazy).
        const destination = editor(["x[^1][^2]", "", "[^1]: one", "", "[^2]: two"], { line: 3, ch: 0 });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, destination), clipboardEvent("b[^n] para\n\n[^n]: en") as never, destination);
        expect(destination.lines).toEqual(["x[^1][^2]", "", "[^1]: one", "", "b[^n] para", "", "[^2]: two", "[^n]: en"]);
        // the caret sits right after the pasted text
        expect(destination.cursor).toEqual({ line: 4, ch: "b[^n] para".length });
    });

    it("says which references travelled without a definition", () => {
        const source = editor(["a[^gone]"], { line: 0, ch: 0 }, { line: 0, ch: 8 });
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, source), clipboardEvent() as never);
        const destination = editor(["p"], { line: 0, ch: 1 });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, destination), clipboardEvent("a[^gone]") as never, destination);
        expect(messages().some((m) => m.includes('"[^gone]"') && m.includes("no definition"))).toBe(true);
    });
});

describe("text that arrives through the input method (a phone keyboard's clipboard history)", () => {
    // Jason's phone pass, 2026-09-25: copying a footnote, copying something
    // else, then pasting the footnote from the Android keyboard's clipboard
    // history landed it as plain text, definitions after the text. Such a
    // paste is committed through the input method, so no paste event fires;
    // CodeMirror reports it to input handlers instead, and this one lands
    // it the way a paste would.
    it("lands carried text inserted by the input method as a paste would", () => {
        const doc = editor(["Existing[^1] text.", "", "[^1]: an existing one"], { line: 0, ch: "Existing[^1] text.".length });
        const handle = carriedInputHandler(fakePlugin({ carryFootnotesOnCopy: true }, doc), () => doc);
        const at = doc.posToOffset({ line: 0, ch: "Existing[^1] text.".length });
        expect(handle({} as never, at, at, " more[^own] here\n\n[^own]: carried")).toBe(true);
        expect(doc.lines).toEqual(["Existing[^1] text. more[^own] here", "", "[^1]: an existing one", "[^own]: carried"]);
        expect(messages()).toContain("Pasted with 1 footnote definition: 1 added.");
    });

    it("leaves ordinary typing, and inserted text without definition lines, to the editor", () => {
        const doc = editor(["a"], { line: 0, ch: 1 });
        const handle = carriedInputHandler(fakePlugin({ carryFootnotesOnCopy: true }, doc), () => doc);
        expect(handle({} as never, 1, 1, "b")).toBe(false);
        expect(handle({} as never, 1, 1, "two\nlines")).toBe(false);
        expect(doc.lines).toEqual(["a"]);
    });

    it("stays out while carrying is off", () => {
        const doc = editor(["a"], { line: 0, ch: 1 });
        const handle = carriedInputHandler(fakePlugin({ carryFootnotesOnCopy: false }, doc), () => doc);
        expect(handle({} as never, 1, 1, "x[^n]\n\n[^n]: n")).toBe(false);
        expect(doc.lines).toEqual(["a"]);
    });
});

describe("cut", () => {
    it("takes the cut over: the clipboard gets the selection with its definitions, and the note loses the selection and what it orphaned in ONE transaction", () => {
        const doc = editor(["a[^1] b[^2]", "", "[^1]: one", "[^2]: two"], { line: 0, ch: 0 }, { line: 0, ch: 6 });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        expect(event.written["text/plain"]).toBe("a[^1] \n\n[^1]: one");
        expect(event.defaultPrevented).toBe(true);
        expect(doc.lines).toEqual(["b[^2]", "", "[^2]: two"]);
        expect(doc.transactions).toBe(1);
        expect(carryRegister()).toMatchObject({ body: "a[^1] ", carried: [{ name: "1", lines: ["[^1]: one"] }] });
    });

    it("takes a cut that orphans nothing over as well, so the definitions still reach the clipboard text", () => {
        const doc = editor(["a[^1] b[^1]", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 6 });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        expect(event.written["text/plain"]).toBe("a[^1] \n\n[^1]: one");
        expect(event.defaultPrevented).toBe(true);
        expect(doc.lines).toEqual(["b[^1]", "", "[^1]: one"]);
    });

    // Jason, 2026-09-25: a cut that takes the last definition with it
    // empties the section like a conversion does, so the Remove empty
    // section heading setting applies here too
    it("takes the empty section heading with the last definition when the setting is on, and leaves it by default", () => {
        const on = editor(["a[^1] b", "", "# Footnotes", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 6 });
        handleCut(fakePlugin({ carryFootnotesOnCopy: true, enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: true }, on), clipboardEvent() as never);
        expect(on.lines).toEqual(["b"]);
        expect(on.transactions).toBe(1);
        const off = editor(["a[^1] b", "", "# Footnotes", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 6 });
        handleCut(fakePlugin({ carryFootnotesOnCopy: true, enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes" }, off), clipboardEvent() as never);
        expect(off.lines).toEqual(["b", "", "# Footnotes"]);
    });

    it("leaves a cut that needs no definition to the editor", () => {
        const doc = editor(["plain text"], { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        expect(event.defaultPrevented).toBe(false);
        expect(doc.lines).toEqual(["plain text"]);
    });
});
