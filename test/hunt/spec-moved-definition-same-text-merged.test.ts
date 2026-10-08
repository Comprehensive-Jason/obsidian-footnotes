import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: two footnotes cite the same page with the same text. When
// the user moves the second one's definition within the note, should the
// paste keep it under its own name, or reuse the first one?
//
// What it does now: the note reads "One[^1]. Two[^2].", then
// "[^1]: Smith 2020, p. 4." and "[^2]: Smith 2020, p. 4.". The user cuts
// [^2]'s definition line (Shift+Down, then Ctrl+X) and pastes it at the
// end of the note. The paste finds [^1] with the same text and reuses it,
// so nothing is added. The toast says "Pasted with 1 footnote definition:
// 1 matched an existing footnote (same definition, different name).", and
// the alert says "This note has a footnote reference with no definition
// ("[^2]")". Two[^2] now cites nothing, and footnote 2 is gone from
// Reading view. Its text survives only in [^1] and on the clipboard. A
// definition line copied from another note into a note that cites [^2]
// with no definition, and whose [^1] has the same text, does the same.
// What a user might expect: "[^2]: Smith 2020, p. 4." pasted where they
// put it, serving Two[^2] again.
//
// The options, the recommended one first:
// (a) Reuse a same-text footnote under another name only when the pasted
//     name is already taken in the destination (a definition there has
//     that name). Otherwise keep the pasted definition under its own name.
//     This is the open Q13's option (a). Recommended: it is the only
//     reading under which the moved definition keeps serving Two[^2].
// (b) Keep reusing, and change the README's second sentence quoted below.
// The tests below assert (a) for both cases.
//
// Why it is a question and not a bug: two sentences in the README's Paste
// paragraph disagree here. The older one says "A definition the
// destination already has (same text, whatever its name) is reused", and
// the paste does that. The one added in bb15044 says "A definition pasted
// where its name is cited but not defined keeps its name and fills that
// gap, so a definition moved within its note keeps serving its
// reference", and the paste breaks that. Which sentence wins is Jason's
// call.
//
// Hunt 2026-10-08, cycle 6. Cluster Z14, triage question Q29.
//
// Origin: pre-existing (the reuse); the README sentence it contradicts
// came with bb15044.
//
// Source of truth: the README's Paste paragraph (both sentences quoted
// above); Jason's ruling C27 (2026-10-07), which bb15044 built; the open
// spec pin spec-paste-back-repoints-same-text-footnote (cluster RT3,
// question Q13), whose paste back is answered and whose wider question,
// reuse under another name, is this one.

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
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
type Pos = { line: number; ch: number };
/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: Pos, to = from): FakeEditor {
    return fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
const on = { carryFootnotesOnCopy: true, lintOnFootnoteCreation: false };
/** A fake plugin whose active note is `doc`, saved at `path`. */
function pluginIn(doc: FakeEditor, path = "note.md"): FootnotePlugin {
    const plugin = fakePlugin(on, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path } }) };
    return plugin;
}
/** The text from `from` to `to`, as the editor's own copy would take it. */
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}
/**
 * Cuts `from` to `to`. When the plugin leaves the cut to the editor (as it
 * does for these definition lines), the note and clipboard are worked out
 * as the editor's own cut would leave them.
 */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    const taken = event.defaultPrevented;
    const after = taken ? doc.lines.slice() : [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch) + lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)];
    return { lines: after, clip: taken ? event.written["text/plain"] : sliceText(lines, from, to), taken };
}
/** Copies `from` to `to` in the note at `path`; returns the clipboard text. */
function copy(lines: string[], from: Pos, to: Pos, path: string) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCopy(pluginIn(doc, path), event as never);
    return event.written["text/plain"] ?? sliceText(lines, from, to);
}
/** Pastes `clip` at `at` into the note at `path`; returns the editor. */
function paste(lines: string[], at: Pos, clip: string, path = "note.md") {
    const doc = editor(lines, at);
    handlePaste(pluginIn(doc, path), clipboardEvent(clip) as never, doc);
    return doc;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a definition moved within its note, whose text another definition shares", () => {
    // Now: nothing is pasted in, and Two[^2] cites nothing.
    it.fails("cut with Shift+Down and pasted at the end of the note, it keeps serving Two[^2]", () => {
        const note = ["One[^1]. Two[^2].", "", "[^1]: Smith 2020, p. 4.", "[^2]: Smith 2020, p. 4.", "", "Last.", ""];
        const c = cut(note, { line: 3, ch: 0 }, { line: 4, ch: 0 });
        const back = paste(c.lines, { line: c.lines.length - 1, ch: 0 }, c.clip);
        expect(back.lines.join("\n"), JSON.stringify({ c, lines: back.lines, m: messages() })).toMatch(/^\[\^2\]: Smith 2020, p\. 4\.$/m);
    });

    // Now: the same, in a note that never had [^2]'s definition.
    it.fails("a definition line copied from another note into one citing [^2] with no definition, whose [^1] has the same text, fills the gap", () => {
        const text = copy(["Elsewhere[^2].", "", "[^2]: Smith 2020, p. 4."], { line: 2, ch: 0 }, { line: 2, ch: 23 }, "a.md");
        const back = paste(["One[^1]. Two[^2].", "", "[^1]: Smith 2020, p. 4.", ""], { line: 3, ch: 0 }, text, "b.md");
        expect(back.lines.join("\n"), JSON.stringify({ lines: back.lines, m: messages() })).toMatch(/^\[\^2\]: Smith 2020, p\. 4\.$/m);
    });

    it("control: with different texts the moved definition keeps its name and serves Two[^2]", () => {
        const note = ["One[^1]. Two[^2].", "", "[^1]: Smith 2020, p. 4.", "[^2]: Jones 2019.", "", "Last.", ""];
        const c = cut(note, { line: 3, ch: 0 }, { line: 4, ch: 0 });
        const back = paste(c.lines, { line: c.lines.length - 1, ch: 0 }, c.clip);
        expect(back.lines.join("\n")).toMatch(/^\[\^2\]: Jones 2019\.$/m);
    });
});
