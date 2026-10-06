import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { parseObsidianNote, MarkdownNode } from "../../src/parsing/obsidian-markdown";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): carrying a footnote defined twice, once held inside
// another definition and once on its own, changes which copy is shown.
//
// What the user would see: the note defines [^b] twice: once inside the
// definition of [^a] (indented under it, a "held" definition), and once
// more at the bottom, "[^b]: last". Obsidian shows the last copy, so the
// text's [^b] reads "last". The user copies text citing [^b] and then
// [^a], and pastes it. The pasted note has "[^b]: last" first and the
// held copy inside [^a] after it, so the pasted [^b] now reads the held
// copy's text instead of "last".
//
// Hunt 2026-10-05, round 2, lens carry. Cluster C3.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: for
// "Text[^b].", "", "[^b]: top copy", "", "[^a]: outer", "", "    [^b]:
// inner copy", Reading view draws b as "inner copy". A copy held inside
// another definition counts when Obsidian picks the last copy of a name.
// The round-2 hunt brief's rule: a rewrite never changes which copy of a
// duplicated footnote shows.
//
// Cause: the carry writes the carried definitions in the order the
// copied text cites them, outermost blocks only. A held copy travels
// inside its outer block, so the order of the copies changes; nothing
// checks which copy of a duplicated name ends up last.

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

/** A footnote definition's content as the reader's tree holds it: every leaf's depth, type, and value. */
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

/** Live references with no definition. */
function soundness(lines: string[]) {
    const r = readNote(lines);
    const defined = new Set(r.definitions.map((d) => d.name.toLowerCase()));
    const problems: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const ref of r.referencesOn(i)) {
            if (!defined.has(ref.name.toLowerCase())) problems.push(`orphan ${ref.name} on line ${i}`);
        }
    }
    return problems;
}

// Outermost-only carried blocks, with a name defined twice: once held in
// another carried footnote's body, once on its own. Obsidian draws the
// last copy of a name; the paste must draw the same text.
const cases: [string, string[]][] = [
    ["cites b then a; b's held copy first, top-level copy last", ["See[^b] and[^a].", "", "[^a]: outer", "", "    [^b]: inner first", "", "[^b]: last"]],
    ["in a list item: a holds a copy of b; b also top-level last", ["See[^b] and[^a].", "", "- [^a]: outer", "", "      [^b]: nested", "", "[^b]: last"]],
];

describe("duplicate definitions, one held, keep the copy Obsidian draws", () => {
    for (const [name, source] of cases) {
        it(name, () => {
            const want = defContents(source);
            const text = copyText(source, { line: 0, ch: 0 }, { line: 0, ch: source[0].length });
            expect(text).not.toBeNull();
            const dest = pasteInto(text as string, [""], { line: 0, ch: 0 });
            resetCarryRegister();
            const foreign = pasteInto(text as string, [""], { line: 0, ch: 0 });
            // Today the clipboard text and both pastes write "[^b]: last" before
            // "[^a]: outer" and its held "[^b]", so b shows the held copy.
            expect(
                { clip: defContents((text as string).split("\n")), dest: defContents(dest), foreign: defContents(foreign), problems: soundness(dest) },
                JSON.stringify({ text, dest, foreign }),
            ).toEqual({ clip: want, dest: want, foreign: want, problems: [] });
        });
    }
});
