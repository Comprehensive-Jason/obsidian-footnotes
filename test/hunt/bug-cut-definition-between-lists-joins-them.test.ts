import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { planCut } from "../../src/commands/carry-footnotes";
import { parseObsidianNote, MarkdownNode } from "../../src/parsing/obsidian-markdown";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): cutting the only reference of a definition that sits
// between two lists joins the lists.
//
// What the user would see: their note has a list, then a footnote
// definition, then a second list (or an indented paragraph). They cut the
// sentence that cites the footnote, and the plugin takes the definition
// out with it, since nothing references this footnote any more. With only
// blank lines left between them, the two lists become one: a second
// numbered list now continues the first one's numbering, two tight lists
// turn into one loose list, and an indented paragraph after the list
// becomes part of its last item. Pasting the text back puts the
// definition at the bottom, so the lists stay joined.
//
// Hunt 2026-10-05, round 2, lens carry. Cluster C2.
//
// Source of truth: remark-parse 8, the parser Obsidian uses, joins two
// lists that only blank lines separate (the plugin's reader shows it).
// The round-2 hunt brief's rule: a rewrite that takes a definition out
// does not join what was around it (move to bottom, orphan deletion,
// and Delete footnote everywhere already check this, pin
// bug-definition-between-lists-joins-them). The remedy may differ here:
// Jason may prefer that the cut leave the definition behind, as the
// orphan rule does, rather than refuse the cut.
//
// Cause: planCut in src/commands/carry-footnotes.ts finds the definitions
// the cut leaves without a reference (orphanedDefinitionBlocks) and takes
// their lines out with no check that the lines around them still read
// the same, the check cutDefinitionsIfClean and linesReadDifferently in
// src/linting/rules/remove-orphaned-definitions.ts make for the orphan
// rule.

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

/** Paste `text` into dest at `at` through the paste hook; returns dest lines (a plain insert when the hook declines). */
function pasteInto(text: string, dest: string[], at: Pos): string[] {
    const doc = editor(dest, at);
    const taken = handlePaste(fakePlugin(on, doc), clipboardEvent(text) as never, doc);
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

/** The note's structure with footnote definitions left out: block types, list kinds, starts, and looseness, and the text. */
function skeleton(lines: string[]): string[] {
    const { tree } = parseObsidianNote(lines.join("\n"));
    const out: string[] = [];
    const walk = (n: MarkdownNode, depth: number) => {
        if (n.type === "footnoteDefinition") return;
        const extra = n as unknown as { start?: number; spread?: boolean; checked?: boolean | null };
        if (n.value !== undefined) out.push(`${depth}:${n.type}:${n.value.replace(/\s+/g, " ").trim()}`);
        else if (n.type !== "root" && n.type !== "text") out.push(`${depth}:${n.type}${n.ordered ? `.o${extra.start}` : ""}${extra.spread ? ".loose" : ""}`);
        for (const c of n.children ?? []) walk(c, depth + 1);
    };
    walk(tree, 0);
    return out;
}

// The citing text is on line 0; cutting it carries the definitions it
// cites. The note left must read as before minus line 0 (no other text
// reads differently), and pasting the clipboard back at line 0 must give
// every footnote its content again.
const cases: [string, string[]][] = [
    ["definition between two ordered lists", ["See[^a].", "", "1. one", "2. two", "", "[^a]: first", "", "1. again"]],
    ["definition between two tight lists, 2-line", ["See[^a].", "", "- one", "- one b", "", "[^a]: first", "    more", "", "- two", "- two b"]],
];

describe("cut then paste back", () => {
    for (const [name, source] of cases) {
        it.fails(name, () => {
            const wantDefs = defContents(source);
            const wantRest = skeleton(source.slice(1));
            const c = cut(source, { line: 0, ch: 0 }, { line: 0, ch: source[0].length });
            expect(c.text).not.toBeNull();
            const afterCut = c.lines;
            // What the cut leaves, definitions aside, reads as the rest of the note did.
            const restAfterCut = skeleton(afterCut.slice(1));
            const back = pasteInto(c.text as string, afterCut, { line: 0, ch: 0 });
            expect({ restAfterCut, defsBack: defContents(back) }, JSON.stringify({ afterCut, back })).toEqual({
                restAfterCut: wantRest,
                defsBack: wantDefs,
            });
        });
    }
});

describe("cut and list joining, the planned text", () => {
    it.fails("cutting the only reference of a definition between a list and an indented paragraph", () => {
        const note = "x[^a] here\n\n- one\n\n[^a]: def\n\n  indented";
        const plan = planCut(note, { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const before = readNote(note.split("\n"));
        const after = readNote(plan.text.split("\n"));
        // The indented line stays a paragraph of its own, not a part of the list item "one".
        const iBefore = before.lineBlocks[note.split("\n").indexOf("  indented")];
        const iAfter = after.lineBlocks[plan.text.split("\n").indexOf("  indented")];
        expect(iAfter).toBe(iBefore);
    });
});
