import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { carriedInputHandler, handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { parseObsidianNote, MarkdownNode } from "../../src/parsing/obsidian-markdown";

// BUG (wrong output, near data loss): a carried definition whose label is
// indented loses its later paragraphs.
//
// What the user would see: a footnote definition has a second paragraph
// (or a quote, or a code block) under it. Its label sits 1 to 3 spaces in
// at the top of the note, or a little further in than its list item or
// quote needs. The user copies text that cites it and pastes it. In the
// pasted note the second paragraph is no longer part of the footnote: it
// lands as a loose paragraph after the definition, or a code block turns
// into plain text. A cut and a paste back does the same to the note the
// text came from, and so does pasting text from outside the app that ends
// in such a definition. A tab right after a quote's ">" is miscounted the
// same way.
//
// Hunt 2026-10-05, round 2, lens carry. Cluster C1.
//
// Source of truth: CommonMark measures a continuation line from where its
// container's content starts (the item's or quote's content column, or
// the margin), not from the label. Obsidian's saved answers agree:
// fuzz:20261003-747 ("  [^ch2*]: body text", "", "    continued": the
// 4-space line is in the definition), fuzz:20261003-1371 ("   [^note]:
// Definition", "", "    > quoted": in the definition), fuzz:20261003-55
// (">[^note]: ...", ">", ">\t# heading": in the definition). The test
// first checks that the plugin's reader reads each source note that way.
//
// Cause: liftedBlock in src/commands/carry-footnotes.ts strips every
// continuation line by the label's own column (everything in front of
// the label), not by the container's content column, so it takes 1 to 3
// columns too many. withoutContainer counts a tab right after ">" from
// the line's column 1, where remark-parse 8 keeps that tab whole as the
// content's indent. Likely a regression from f100ea9, which began lifting
// carried blocks to the top level.

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

const on = { carryFootnotesOnCopy: true };

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

function editor(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

/** Copy from..to of source; return the clipboard text (or null when the editor's own copy runs). */
function copyText(source: string[], from: Pos, to: Pos): string | null {
    const doc = editor(source, from, to);
    const ev = clipboardEvent();
    handleCopy(fakePlugin(on, doc), ev as never);
    return ev.written["text/plain"] ?? null;
}

/** Paste `text` into dest at `at` through the paste hook; returns dest lines (a plain insert when the hook declines). */
function pasteInto(text: string, dest: string[], at: Pos): string[] {
    const doc = editor(dest, at);
    const taken = handlePaste(fakePlugin(on, doc), clipboardEvent(text) as never, doc);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines;
}

/** The same text through the phone keyboard's input route. */
function inputInto(text: string, dest: string[], at: Pos): string[] {
    const doc = editor(dest, at);
    const offset = doc.posToOffset(at);
    const handler = carriedInputHandler(fakePlugin(on, doc), () => doc);
    const taken = handler({} as never, offset, offset, text);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines;
}

/** Cut from..to; returns the source lines after, and the clipboard text. */
function cut(source: string[], from: Pos, to: Pos): { lines: string[]; text: string | null } {
    const doc = editor(source, from, to);
    const ev = clipboardEvent();
    handleCut(fakePlugin(on, doc), ev as never);
    if (!ev.defaultPrevented) {
        // The editor's own cut.
        const joined = source.join("\n");
        const t = joined.slice(doc.posToOffset(from), doc.posToOffset(to));
        doc.transaction({ changes: [{ from, to, text: "" }] });
        return { lines: doc.lines, text: t };
    }
    return { lines: doc.lines, text: ev.written["text/plain"] ?? null };
}

/** A footnote definition's content as the reader's tree holds it: every leaf's depth, type, and value, so code, paragraph, and quote differ. */
function content(node: MarkdownNode): string[] {
    const out: string[] = [];
    const walk = (n: MarkdownNode, depth: number) => {
        if (n.type === "footnoteReference") out.push(`${depth}:ref:${n.label}`);
        else if (n.value !== undefined) out.push(`${depth}:${n.type}:${n.value.replace(/\s+/g, " ").trim()}`);
        else if (n.type !== "paragraph" && n.type !== "text") out.push(`${depth}:${n.type}${n.ordered ? ".o" : ""}`);
        for (const c of n.children ?? []) walk(c, depth + 1);
    };
    for (const c of node.children ?? []) walk(c, 0);
    return out;
}

/** Every footnote definition in the note by lower-cased name (the last one wins, as Obsidian draws it), with its content. */
function defContents(lines: string[]): Record<string, string[]> {
    const { tree } = parseObsidianNote(lines.join("\n"));
    const out: Record<string, string[]> = {};
    const walk = (n: MarkdownNode) => {
        if (n.type === "footnoteDefinition" && n.label) out[n.label.toLowerCase()] = content(n);
        for (const c of n.children ?? []) walk(c);
    };
    walk(tree);
    return out;
}

const T = "\t";

describe("a top-level definition whose label is indented keeps its later paragraphs when carried", () => {
    const cases: [string, string[], Record<string, string[]>][] = [
        ["label indented 2, second paragraph at 4", ["See[^a].", "", "  [^a]: first", "", "    second"], { a: ["1:text:first", "1:text:second"] }],
        ["label indented 1, second paragraph at 4", ["See[^a].", "", " [^a]: first", "", "    second"], { a: ["1:text:first", "1:text:second"] }],
        ["label indented 3, quote at 4", ["See[^a].", "", "   [^a]: first", "", "    > quoted"], { a: ["1:text:first", "0:blockquote", "2:text:quoted"] }],
        ["label indented 2, tab-indented paragraph", ["See[^a].", "", "  [^a]: first", "", T + "second"], { a: ["1:text:first", "1:text:second"] }],
        ["label indented 2, code at 8 stays code", ["See[^a].", "", "  [^a]: first", "", "        code"], { a: ["1:text:first", "0:code:code"] }],
    ];
    for (const [name, source, want] of cases) {
        it.fails(name, () => {
            expect(defContents(source)).toEqual(want);
            const text = copyText(source, { line: 0, ch: 0 }, { line: 0, ch: 8 }) as string;
            const dest = pasteInto(text, [""], { line: 0, ch: 0 });
            resetCarryRegister();
            const foreign = pasteInto(text, [""], { line: 0, ch: 0 });
            resetCarryRegister();
            const input = inputInto(text, [""], { line: 0, ch: 0 });
            expect({ clip: defContents(text.split("\n")), dest: defContents(dest), foreign: defContents(foreign), input: defContents(input) }, JSON.stringify({ text, dest })).toEqual({
                clip: want,
                dest: want,
                foreign: want,
                input: want,
            });
        });
    }

    it.fails("a cut of the only reference takes the whole definition out, and pasting it back keeps the second paragraph in the footnote", () => {
        const source = ["See[^a].", "", "  [^a]: first", "", "    second"];
        const c = cut(source, { line: 0, ch: 0 }, { line: 0, ch: 8 });
        // The cut removed the definition with its second paragraph.
        expect(c.lines.join("\n")).not.toContain("second");
        const back = pasteInto(c.text as string, c.lines, { line: 0, ch: 0 });
        expect(defContents(back), JSON.stringify(back)).toEqual({ a: ["1:text:first", "1:text:second"] });
    });

    it.fails("a clipboard from outside that ends in an indented definition: the paste keeps its second paragraph in the footnote", () => {
        // A plain paste of this text would keep the paragraph; the carry's split rewrites it.
        const text = "See[^a].\n\n  [^a]: first\n\n    second";
        expect(defContents(text.split("\n"))).toEqual({ a: ["1:text:first", "1:text:second"] });
        const dest = pasteInto(text, ["Dest.", ""], { line: 1, ch: 0 });
        expect(defContents(dest), JSON.stringify(dest)).toEqual({ a: ["1:text:first", "1:text:second"] });
    });
});

describe("a definition indented inside its list item or quote keeps its later paragraphs when carried", () => {
    const cases: [string, string[], Record<string, string[]>][] = [
        ["label at an item's margin + 2 (4 spaces), paragraph at 6", ["See[^a].", "", "- item", "", "    [^a]: first", "", "      second"], { a: ["1:text:first", "1:text:second"] }],
        ["label 1 space past the quote marker's space", ["See[^a].", "", "> quote", ">", ">  [^a]: first", ">", ">     second"], { a: ["1:text:first", "1:text:second"] }],
        ["label in an ordered item, indented 2 past its content column", ["See[^a].", "", "1. item", "", "     [^a]: first", "", "        second"], { a: ["1:text:first", "1:text:second"] }],
    ];
    for (const [name, source, want] of cases) {
        it.fails(name, () => {
            expect(defContents(source)).toEqual(want);
            const text = copyText(source, { line: 0, ch: 0 }, { line: 0, ch: 8 }) as string;
            const dest = pasteInto(text, [""], { line: 0, ch: 0 });
            expect({ clip: defContents(text.split("\n")), dest: defContents(dest) }, JSON.stringify({ text, dest })).toEqual({ clip: want, dest: want });
        });
    }
});

describe("a tab right after a quote marker is measured as the quote's content has it", () => {
    // remark-parse 8, the parser Obsidian uses, keeps a tab right after ">"
    // whole as the indent of the quote's content (Obsidian: fuzz:20261003-55,
    // ">[^note]: ...", ">", ">\t# heading" is in the definition;
    // broad:20261004-7166, ">\t[^1]:" is no definition, the tab makes it
    // code). liftedBlock counts the tab from the line's own column 1, so it
    // leaves 2 columns.
    const cases: [string, string[], Record<string, string[]>][] = [
        ["\">\\tsecond\" after a \"> [^a]\" label", ["See[^a].", "", "> [^a]: first", ">", ">" + T + "second"], { a: ["1:text:first", "1:text:second"] }],
        ["\">\\t\\tcode\" stays code", ["See[^a].", "", "> [^a]: first", ">", ">" + T + T + "code"], { a: ["1:text:first", "0:code:code"] }],
    ];
    for (const [name, source, want] of cases) {
        it.fails(name, () => {
            expect(defContents(source)).toEqual(want);
            const text = copyText(source, { line: 0, ch: 0 }, { line: 0, ch: 8 }) as string;
            const dest = pasteInto(text, [""], { line: 0, ch: 0 });
            expect({ clip: defContents(text.split("\n")), dest: defContents(dest) }, JSON.stringify({ text, dest })).toEqual({ clip: want, dest: want });
        });
    }
});
