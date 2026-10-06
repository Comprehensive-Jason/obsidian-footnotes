import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { parseObsidianNote, MarkdownNode } from "../../src/parsing/obsidian-markdown";

// BUG (wrong output, rare): a definition at the start of an ordered list
// item loses a second paragraph indented far in when it is carried.
//
// What the user would see: the note has "1. [^a]: first", a blank line,
// and "second" indented 11 spaces. Obsidian shows one footnote whose text
// is "first" and then "second". The user copies text that cites [^a] and
// pastes it. In the pasted note "second" sits 8 spaces in under a
// top-level "[^a]: first", which is a code block: the footnote now shows
// "second" as code.
//
// Hunt 2026-10-05, round 2, lens carry. Cluster C4.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05:
// "See[^a].", "", "1. [^a]: first", "", 11 spaces "second" is one
// definition over lines 2 to 4, drawn as "first   second", a paragraph
// and not code. The plugin's reader agrees (the first check below).
//
// Cause: liftedBlock in src/commands/carry-footnotes.ts strips the
// continuation lines by the label's column, 3 for "1. ", which leaves 8
// spaces, a code block at the top level. remark-parse 8, the parser
// Obsidian uses, strips 4 columns for "1. " here, not 3, so a fix that
// strips by the item's content column alone still leaves 8 spaces, still
// code: the lifted line has to be measured the way the reader measured
// it (the skeptic's note).

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

/** A footnote definition's content as the reader's tree holds it: every leaf's depth, type, and value, so code and paragraph differ. */
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

describe("an ordered item's continuation column", () => {
    it.fails("\"1. [^a]: first\", blank, 11 spaces \"second\": the pasted footnote keeps \"second\" as a paragraph", () => {
        const source = ["See[^a].", "", "1. [^a]: first", "", "           second"];
        const want = { a: ["1:text:first", "1:text:second"] };
        // The reader reads the source as Obsidian does.
        expect(defContents(source)).toEqual(want);
        const text = copyText(source, { line: 0, ch: 0 }, { line: 0, ch: 8 }) as string;
        const dest = pasteInto(text, [""], { line: 0, ch: 0 });
        // Today the clipboard text ends "[^a]: first", "", 8 spaces "second": code.
        expect(defContents(dest), JSON.stringify({ text })).toEqual(want);
    });
});
