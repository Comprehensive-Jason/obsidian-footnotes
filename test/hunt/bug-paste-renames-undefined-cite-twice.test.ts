import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { planCarriedPaste } from "../../src/commands/carry-footnotes";
import { carriedInputHandler, handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a pasted text that cites a footnote twice without
// carrying its definition has that footnote renamed, though the
// destination does not define it.
//
// What the user would see: pasting " a[^2] b[^1] c[^2]" and "[^1]: one"
// from another app at the end of "Dest." writes "Dest. a[^3] b[^1] c[^3]"
// and says '"[^3]" has no definition to carry.' The user pasted [^2] and
// got [^3]. Worse while drafting: in a note that cites [^x] before its
// definition is written ("Intro A[^x]."), cutting "Move me[^x] and[^1]
// and again[^x]." and pasting it elsewhere in the note gives
// "Move me[^x-2] and[^1] and again[^x-2].", so the moved paragraph no
// longer cites the same footnote as the paragraph left behind. Cited once,
// the name is kept, as it should be.
//
// A "carried" definition is one the plugin's copy or cut puts on the
// clipboard under the text, for the paste to add to the destination.
//
// Hunt 2026-10-08, cycle 6. Cluster Z15.
//
// Origin: regression from bb15044 (the X10 rename).
//
// Source of truth: Jason's ruling X10 (2026-10-07): a reference that
// travelled without its definition is renamed only when the destination
// defines its name. The README's Paste paragraph says the same ("such a
// reference is renamed too when the destination defines its name"), and
// so does planCarriedPaste's docstring in src/commands/carry-footnotes.ts.
//
// Cause: planCarriedPaste's loop over the names the paste cites without
// defining them (carry-footnotes.ts, the "cites" loop) marks a name as
// taken the first time it sees it, so the destination's later names avoid
// it. The second time it sees the same name, it finds it taken and treats
// it as a name the destination defines, so it renames it.

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clipboardEvent(text = "") {
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
type Pos = { line: number; ch: number };
/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: Pos, to = from): FakeEditor {
    return fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
/** A fake plugin whose active note is `doc`, saved at `path`. */
function pluginIn(doc: FakeEditor, path = "note.md"): FootnotePlugin {
    const plugin = fakePlugin({ carryFootnotesOnCopy: true, lintOnFootnoteCreation: false }, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path } }) };
    return plugin;
}
/** A carried definition of one line. */
const one = (name: string, line: string) => ({ name, lines: [line] });

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a pasted reference cited twice, whose name the destination does not define", () => {
    it("control: the planner keeps [^9] when the text cites it once", () => {
        expect(planCarriedPaste("Dest.", "a[^9] b[^1]", [one("1", "[^1]: one")])).toMatchObject({ body: "a[^9] b[^1]", renamedCites: new Map() });
    });

    // Now: "a[^2] b[^1] c[^2]".
    it("the planner keeps [^9] when the text cites it twice", () => {
        expect(planCarriedPaste("Dest.", "a[^9] b[^1] c[^9]", [one("1", "[^1]: one")])).toMatchObject({ body: "a[^9] b[^1] c[^9]", renamedCites: new Map() });
    });

    // Now: "a[^2] b[^1]", and the carried definition cites [^2].
    it("the planner keeps [^9] when the text cites it once and a carried definition cites it once", () => {
        expect(planCarriedPaste("Dest.", "a[^9] b[^1]", [one("1", "[^1]: see [^9]")])).toMatchObject({ body: "a[^9] b[^1]", renamedCites: new Map() });
    });

    // Now: "Dest.Smith says[^smith-2] and[^1] again[^smith-2].", and the
    // toast names "[^smith-2]".
    it("the plugin's copy pasted into another note: the text arrives as copied and the toast names [^smith]", () => {
        // [^smith]'s label has no blank line above it, so it carries on the
        // paragraph and defines nothing, and the copy carries no definition for it
        const src = ["Smith says[^smith] and[^1] again[^smith].", "", "[^1]: one", "", "A paragraph.", "[^smith]: lazy under the paragraph above"];
        const ev = clipboardEvent();
        const sdoc = editor(src, { line: 0, ch: 0 }, { line: 0, ch: src[0].length });
        handleCopy(pluginIn(sdoc, "a.md"), ev as never);
        const text = ev.written["text/plain"];
        expect(text).toBe("Smith says[^smith] and[^1] again[^smith].\n\n[^1]: one");
        const doc = editor(["Dest."], { line: 0, ch: 5 });
        handlePaste(pluginIn(doc, "b.md"), clipboardEvent(text) as never, doc);
        expect(doc.lines[0], JSON.stringify({ lines: doc.lines, m: messages() })).toBe("Dest.Smith says[^smith] and[^1] again[^smith].");
        expect(messages().find((m) => m.startsWith("Pasted"))).toContain('"[^smith]" has no definition to carry.');
    });

    // Now: "Dest. a[^3] b[^1] c[^3]".
    it("a clipboard from another app citing [^2] twice and defining [^1]", () => {
        const doc = editor(["Dest."], { line: 0, ch: 5 });
        handlePaste(pluginIn(doc), clipboardEvent(" a[^2] b[^1] c[^2]\n\n[^1]: one") as never, doc);
        expect(doc.lines[0], JSON.stringify({ lines: doc.lines, m: messages() })).toBe("Dest. a[^2] b[^1] c[^2]");
    });

    // Now: "Dest. a[^3] b[^1] c[^3]".
    it("the same text from the phone keyboard's clipboard history", () => {
        const doc = editor(["Dest."], { line: 0, ch: 5 });
        const off = doc.posToOffset({ line: 0, ch: 5 });
        carriedInputHandler(pluginIn(doc), () => doc)({} as never, off, off, " a[^2] b[^1] c[^2]\n\n[^1]: one");
        expect(doc.lines[0], JSON.stringify({ lines: doc.lines, m: messages() })).toBe("Dest. a[^2] b[^1] c[^2]");
    });

    // Now: "End.Move me[^x-2] and[^1] and again[^x-2].", while
    // "Intro A[^x]." still cites [^x].
    it("drafting: a paragraph citing a not-yet-defined [^x] twice, cut and pasted elsewhere in its note, still cites the same [^x] as the paragraph left behind", () => {
        const note = ["Intro A[^x].", "", "Move me[^x] and[^1] and again[^x].", "", "[^1]: one", "", "End."];
        const doc = editor(note, { line: 2, ch: 0 }, { line: 2, ch: note[2].length });
        const ev = clipboardEvent();
        handleCut(pluginIn(doc), ev as never);
        expect(ev.defaultPrevented).toBe(true);
        const after = doc.lines.slice();
        const endLine = after.indexOf("End.");
        const d2 = editor(after, { line: endLine, ch: 4 });
        handlePaste(pluginIn(d2), clipboardEvent(ev.written["text/plain"]) as never, d2);
        expect(d2.lines.join("\n"), JSON.stringify({ lines: d2.lines, m: messages() })).toContain("End.Move me[^x] and[^1] and again[^x].");
    });
});
