import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when a pasted reference had no definition where it was
// copied, and the destination defines the same name, should it keep
// pointing at nothing, or take up the destination's footnote?
//
// What it does now: the copy carries "a[^9] b[^1]" with [^1]'s definition;
// [^9] had none, so the toast names it as having "no definition to
// carry". The paste never renames such a name. The destination note has
// its own, unrelated [^9], so the pasted [^9] now shows that footnote's
// text, with nothing to say it changed meaning.
// What a user might expect: the pasted [^9] stays an orphan, renamed out
// of the way the way a colliding carried name is, so it does not quietly
// cite someone else's footnote.
// Why it is a question and not a bug: a plain paste with the feature off
// does exactly the same thing, and the toast does warn that [^9] came
// without a definition. Whether a paste the plugin takes over should go
// further and protect the orphan is a product decision for Jason.
//
// Hunt 2026-10-02, round 3, lens carry-model. Cluster M3.
//
// Source of truth: the README's Paste paragraph, "a name the destination
// already uses for something else is renamed ... so the pasted footnotes
// come out unique with no setup", and "names any reference that
// travelled without a definition".

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

describe("spec question: a reference that had no definition does not adopt the destination's", () => {
    it.fails("pasted [^9] (undefined at the source) does not resolve to the destination's [^9]", () => {
        const text = copy(["a[^9] b[^1]", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 11 });
        expect(text).toBe("a[^9] b[^1]\n\n[^1]: one");
        const lines = pasteRegister(["x[^9]", "", "[^9]: theirs"], { line: 0, ch: 5 }, text);
        // Today: ["x[^9]a[^9] b[^1]", "", "[^9]: theirs", "[^1]: one"]
        expect(lines[0]).not.toBe("x[^9]a[^9] b[^1]");
    });
});
