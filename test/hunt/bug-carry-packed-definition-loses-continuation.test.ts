import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss): copying or cutting text whose footnote runs on to a
// second paragraph strips that paragraph's indentation on the clipboard
// when the footnote's definition sits right under another definition.
//
// What the user would see: a note with "Oysters filter water[^2].", and at
// the bottom "[^1]: Smith, p. 4." with "[^2]: Jones, p. 9." on the line
// right under it, then a blank line and the indented paragraph "    A
// second paragraph of the note." that belongs to footnote 2. This packed
// shape, definitions with no blank line between them, is how the lint's
// move gathers them. They copy the sentence. The clipboard holds "A second
// paragraph of the note." with no indentation, so it is no longer part of
// the footnote. Pasted into another note, the paste is refused; pasted from
// another app, the paragraph lands as body text outside the footnote. A
// list or a quote inside the footnote loses its "- " or "> " as well.
// Worst of all, cutting the sentence to move it in the same note takes
// footnote 2 out of the note, and every paste elsewhere is refused, so only
// a paste straight back gets footnote 2 back.
//
// A "definition" is the "[^2]: ..." entry that holds a footnote's text, and
// its "label" is the "[^2]:" at its head. "Carrying" is the plugin's copy,
// cut, and paste: the definitions the text needs travel with it. A "lazy"
// line is one that carries on the paragraph above it without the
// indentation it would normally need.
//
// Hunt 2026-10-08, cycle 7. Cluster Y3.
//
// Origin: pre-existing at 97abeac; a regression from ccbd01d (2026-10-05,
// the fix for clusters C1 and C4 that made the clipboard's indentation
// follow the parser's count of containers). All eight tests here pass at
// ccbd01d~1.
//
// Source of truth: the README's carry promise (copy and cut take along the
// definitions the text needs, and paste lands both).
// docs/obsidian-reading-rules.md E2: after a blank line, four spaces or a
// tab continue a definition, so the same paragraph at column 0 is body
// text. The saved answer broad:20261004-2284 holds a packed definition
// whose second paragraph Obsidian reads as part of it, as the first
// control below does.
//
// Cause: liftedCuts in src/commands/carry-footnotes.ts works out how much
// indentation to take off each of a carried definition's lines. It reads
// a copy of the note with each carried label's colon turned into a space,
// so "[^2]: Jones" becomes "[^2] Jones". Right under "[^1]: Smith, p. 4."
// that line is now lazy text of footnote 1, and the indented paragraph
// after it reads as part of footnote 1. The four spaces of footnote 1's
// container are then counted as the line's container, and taken off. (A
// "container" is what holds a line: the note itself, a quote, a list item,
// or a footnote's definition.)

/** A stand-in for the browser's clipboard event: what was written, and whether the editor's own action was stopped. */
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
/** A plugin with carrying on, whose active note is `doc` at `path`. */
function pluginIn(doc: FakeEditor, path = "note.md"): FootnotePlugin {
    const plugin = fakePlugin({ carryFootnotesOnCopy: true, lintOnFootnoteCreation: false }, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path } }), getLeavesOfType: () => [] };
    return plugin;
}
/** What a copy of the text from `from` to `to` puts on the clipboard. */
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCopy(pluginIn(doc), event as never);
    return event.written["text/plain"] ?? "";
}
/** The note after a cut of the text from `from` to `to`, and what the cut put on the clipboard. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"] ?? "" };
}
/** The note after pasting `text` at `at`; when the plugin leaves the paste alone, the editor's own paste writes the text as it is. */
function paste(lines: string[], at: Pos, text: string, path = "other.md") {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const taken = handlePaste(pluginIn(doc, path), clipboardEvent(text) as never, doc);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines.slice();
}
/** The text of footnote `name` as the note reads it: its definition's lines, label taken off, each trimmed, joined with " / ". */
function footnoteText(lines: string[], name: string): string {
    const reading = readNote(lines);
    const definition = [...reading.definitions].reverse().find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (!definition) return "<none>";
    return lines
        .slice(definition.start, definition.end + 1)
        .map((line, i) => (i === 0 ? line.slice(definition.labelEnd) : line).trim())
        .filter((line) => line !== "")
        .join(" / ");
}

const source = ["Oysters filter water[^2].", "", "[^1]: Smith, p. 4.", "[^2]: Jones, p. 9.", "", "    A second paragraph of the note."];

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a carried footnote with a second paragraph, packed under another definition", () => {
    it("control: the source note reads the second paragraph as the footnote's", () => {
        expect(footnoteText(source, "2")).toBe("Jones, p. 9. / A second paragraph of the note.");
    });

    // The root pin. Now the clipboard is "Oysters filter water[^2].",
    // "", "[^2]: Jones, p. 9.", "", "A second paragraph of the note.".
    it("the clipboard keeps the second paragraph indented", () => {
        const clip = copy(source, { line: 0, ch: 0 }, { line: 0, ch: 25 });
        expect(clip).toContain("\n    A second paragraph of the note.");
    });

    it("control: the same footnote with a blank line above its label is carried whole", () => {
        const spaced = ["Oysters filter water[^2].", "", "[^1]: Smith, p. 4.", "", "[^2]: Jones, p. 9.", "", "    A second paragraph of the note."];
        expect(copy(spaced, { line: 0, ch: 0 }, { line: 0, ch: 25 })).toContain("\n    A second paragraph of the note.");
    });

    // Now the clipboard ends "first site", "second site": the list's
    // markers are gone as well as the indentation.
    it("the clipboard keeps the list markers of a list inside the footnote", () => {
        const withList = ["Oysters filter water[^2].", "", "[^1]: Smith, p. 4.", "[^2]: Jones, p. 9:", "", "    - first site", "    - second site"];
        const clip = copy(withList, { line: 0, ch: 0 }, { line: 0, ch: 25 });
        expect(clip, JSON.stringify(clip)).toContain("\n    - first site\n    - second site");
    });

    // Now the clipboard ends "The tide rose.", its "> " gone.
    it("the clipboard keeps the quote marker of a quote inside the footnote", () => {
        const withQuote = ["Oysters filter water[^2].", "", "[^1]: Smith, p. 4.", "[^2]: Jones, p. 9:", "", "    > The tide rose."];
        const clip = copy(withQuote, { line: 0, ch: 0 }, { line: 0, ch: 25 });
        expect(clip, JSON.stringify(clip)).toContain("\n    > The tide rose.");
    });

    // Now the paste is refused: "Nothing was pasted: it would change how
    // Obsidian reads the text around it."
    it("copied and pasted into another note, the footnote keeps its second paragraph", () => {
        const clip = copy(source, { line: 0, ch: 0 }, { line: 0, ch: 25 });
        const dest = paste(["Notes from the field.", ""], { line: 1, ch: 0 }, clip);
        expect(footnoteText(dest, "2"), JSON.stringify({ dest, notices: messages() })).toBe("Jones, p. 9. / A second paragraph of the note.");
    });

    // With the plugin's record of its own last copy cleared, the paste
    // reads as one from another app. Now the paragraph lands at column 0,
    // body text outside footnote 2.
    it("copied, then pasted from another app's clipboard, the footnote keeps its second paragraph", () => {
        const clip = copy(source, { line: 0, ch: 0 }, { line: 0, ch: 25 });
        resetCarryRegister();
        const dest = paste(["Notes from the field.", ""], { line: 1, ch: 0 }, clip);
        expect(footnoteText(dest, "2"), JSON.stringify({ dest, notices: messages() })).toBe("Jones, p. 9. / A second paragraph of the note.");
    });

    // The data-loss face. Now the cut takes footnote 2 and its second
    // paragraph out of the note, and the paste under "Tides rise[^1]." is
    // refused, so the note is left with no footnote 2 at all.
    it("cut and pasted elsewhere in the same note (moving the sentence), the footnote keeps its second paragraph", () => {
        const note = ["# Field notes", "", "Oysters filter water[^2].", "", "Tides rise[^1].", "", "[^1]: Smith, p. 4.", "[^2]: Jones, p. 9.", "", "    A second paragraph of the note."];
        const c = cut(note, { line: 2, ch: 0 }, { line: 3, ch: 0 });
        // Paste on the blank line under "Tides rise[^1].".
        const at = { line: c.lines.indexOf("Tides rise[^1].") + 1, ch: 0 };
        const moved = paste(c.lines, at, c.clip, "note.md");
        expect(footnoteText(moved, "2"), JSON.stringify({ cut: c.lines, clip: c.clip, moved, notices: messages() })).toBe("Jones, p. 9. / A second paragraph of the note.");
        expect(moved.filter((line) => line.trim() === "A second paragraph of the note.").length).toBe(1);
    });

    // Found while fixing, and failing on 34d5377 the same way: the packed
    // definitions in a quote, and a third definition packed under two with
    // a lazy line of its own. The fix reads every packed neighbour as plain
    // text, so neither can take the carried footnote's lines.
    it("packed in a quote, the carried footnote keeps its second paragraph", () => {
        const quoted = ["Water[^2].", "", "> [^1]: Smith.", "> [^2]: Jones.", ">", ">     Second para."];
        expect(copy(quoted, { line: 0, ch: 0 }, { line: 0, ch: 10 })).toContain("\n    Second para.");
    });

    it("the third of three packed definitions keeps its lazy line and its second paragraph", () => {
        const three = ["Water[^3].", "", "[^1]: Smith.", "[^2]: Jones.", "[^3]: Brown.", "more of three", "", "    Second para."];
        expect(copy(three, { line: 0, ch: 0 }, { line: 0, ch: 10 })).toContain("[^3]: Brown.\nmore of three\n\n    Second para.");
    });
});
