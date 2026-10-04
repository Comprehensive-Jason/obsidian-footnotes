// The footnote facts of a note, read off the tree that obsidian-markdown.ts
// builds the way Obsidian reads the note: which labels are definitions and
// where each one ends, which references are live, and which stretches of
// text are protected (code, math, comments, frontmatter, and the like,
// where footnote syntax is plain text).
//
// Lines and columns count from 0 here, as everywhere else in the plugin;
// offsets are character indices into the note with its line breaks
// normalized to "\n". The note reading (note-reading.ts) reads these facts
// for the plugin's commands, part by part (partFacts); the oracle and the
// referee suite read them for the whole note at once
// (scripts/oracle/reader-facts.ts, test/obsidian-referee.test.ts).

import { MarkdownNode, normalizeLineBreaks, parseObsidianMarkdown } from "./obsidian-markdown";

/**
 * What holds a definition, counted from the outside in: how many quotes or
 * callouts, how many list items, and how many other footnotes' definitions
 * it sits inside. All three are 0 for a definition at the top level of the
 * note.
 */
interface DefinitionContainer {
    quotes: number;
    listItems: number;
    footnotes: number;
}

/**
 * A definition: its name as written, the line of its label and the last
 * line of its body, where its label sits on its line, and what holds it.
 */
export interface DefinitionFact {
    name: string;
    /** The line of the label. */
    start: number;
    /** The last line of the definition's body, its continuation lines included. */
    end: number;
    /** The column of the label's "[". */
    labelStart: number;
    /** The column just past the label's ":". */
    labelEnd: number;
    container: DefinitionContainer;
    /**
     * Whether the lines start to end belong to this definition alone, so a
     * rule may move them or cut them out whole: the definition sits at the
     * top level of the note, and nothing but indentation comes before its
     * label. A definition in a quote, a list item, or another footnote stays
     * where its container put it, and so does one whose label follows other
     * text on its line, such as the "%%" that closes a comment, since moving
     * that line would take the other text with it (Jason's ruling 1, option
     * a, 2026-10-03).
     */
    movable: boolean;
    /**
     * Whether the lines start to end can be cut out whole without touching
     * anything but this definition and the markers of its own quote or list
     * item: nothing but indentation, quote markers, and list markers comes
     * before its label. False for a label on a callout's title line or after
     * a "%%" closer, where cutting the line would take the title or the
     * comment's end with it.
     */
    removable: boolean;
}

/** A reference "[^name]": where it sits (end is exclusive) and whether it is live. */
interface ReferenceFact {
    name: string;
    line: number;
    start: number;
    end: number;
    /** False inside an inline footnote "^[...]", where Obsidian reads no reference (rule E3). */
    live: boolean;
}

type ProtectedKind =
    | "code"
    | "math"
    | "html"
    | "htmlComment"
    | "percentComment"
    | "frontmatter"
    | "wikilink"
    | "linkDestination"
    | "inlineCode"
    | "inlineMath";

/**
 * A stretch of protected text, from offset `from` up to (not including)
 * `to`, on lines startLine to endLine. `block` is true for a whole block
 * (a code block, a display math block, an HTML block, a "%%" block comment,
 * the frontmatter) and false for a span inside a line of text.
 */
interface ProtectedSpan {
    kind: ProtectedKind;
    block: boolean;
    from: number;
    to: number;
    startLine: number;
    endLine: number;
}

export interface FootnoteFacts {
    definitions: DefinitionFact[];
    references: ReferenceFact[];
    protectedSpans: ProtectedSpan[];
}

/** Node types that hold blocks; a child of one of these is a block itself, anything deeper is inline. */
const BlockContainers = new Set(["root", "blockquote", "list", "listItem", "footnoteDefinition", "calloutTitle"]);

/**
 * What may come before a label on its line for the line to be cut out with
 * the definition: indentation, quote markers ">", and list markers ("-",
 * "*", "+", "1.", "1)", each followed by a space or a tab) with a task box
 * "[ ]" or "[x]" after one. So "---" (a frontmatter closer) and "%%" do not
 * qualify.
 */
const ContainerMarkersOnly = /^(?:[ \t]*(?:>|(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?=[ \t])))*[ \t]*$/;

/** The 0-based last line a node covers: an end at the very start of a later line stops on the line before. */
function lastLineOf(node: MarkdownNode): number {
    const { start, end } = node.position;
    return end.column === 1 && end.line > start.line ? end.line - 2 : end.line - 1;
}

/**
 * Where the bracketed label that starts at the first "[" at or after `from`
 * ends: the offset just after its closing "]". Brackets nest and a backslash
 * escapes the next character, as in remark-parse's link reader (where, in
 * GFM mode, brackets inside a code span count too). Used where mdast gives
 * no position for a part of a node: a link's destination and a link
 * definition's URL.
 */
function afterLabel(doc: string, from: number, end: number): number {
    let i = doc.indexOf("[", from);
    let depth = 0;
    while (i !== -1 && i < end) {
        const c = doc[i];
        if (c === "\\") {
            i += 2;
            continue;
        }
        if (c === "[") depth++;
        else if (c === "]" && --depth === 0) return i + 1;
        i++;
    }
    return end;
}

/** Reads the facts off a parsed tree of `doc` (the normalized note). */
function factsOfTree(doc: string, tree: MarkdownNode): FootnoteFacts {
    const definitions: DefinitionFact[] = [];
    const references: ReferenceFact[] = [];
    const protectedSpans: ProtectedSpan[] = [];

    // the offset where each line starts, to turn an offset into a line
    const lineStarts = [0];
    for (let i = doc.indexOf("\n"); i !== -1; i = doc.indexOf("\n", i + 1)) lineStarts.push(i + 1);
    const lineAt = (offset: number): number => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return low;
    };
    const protect = (kind: ProtectedKind, block: boolean, from: number, to: number) => {
        protectedSpans.push({ kind, block, from, to, startLine: lineAt(from), endLine: lineAt(to) });
    };

    const walk = (node: MarkdownNode, parentType: string, inInlineNote: boolean, container: DefinitionContainer): void => {
        const block = BlockContainers.has(parentType);
        const from = node.position.start.offset;
        const to = node.position.end.offset;
        switch (node.type) {
            case "footnoteDefinition": {
                // the node starts at the line's indentation; the label's "[" comes after it
                let label = from;
                while (doc[label] === " " || doc[label] === "\t") label++;
                const name = node.label ?? "";
                const labelStart = node.position.start.column - 1 + (label - from);
                const before = doc.slice(lineStarts[lineAt(label)], label);
                const topLevel = container.quotes === 0 && container.listItems === 0 && container.footnotes === 0;
                definitions.push({
                    name,
                    start: node.position.start.line - 1,
                    end: lastLineOf(node),
                    labelStart,
                    // "[^", the name, "]:"
                    labelEnd: labelStart + name.length + 4,
                    container: { ...container },
                    movable: topLevel && /^[ \t]*$/.test(before),
                    removable: ContainerMarkersOnly.test(before),
                });
                break;
            }
            case "footnoteReference":
                references.push({ name: node.label ?? "", line: node.position.start.line - 1, start: node.position.start.column - 1, end: node.position.end.column - 1, live: !inInlineNote });
                break;
            case "code":
                protect("code", true, from, to);
                break;
            case "math":
                protect("math", true, from, to);
                break;
            case "yaml":
                protect("frontmatter", true, from, to);
                break;
            case "html":
                // an HTML block protects its lines; inside a line only a comment hides text
                if (block) protect("html", true, from, to);
                else if (node.value?.startsWith("<!--")) protect("htmlComment", false, from, to);
                break;
            case "percentComment":
                // protected, though a reference inside still counts as live (Jason's ruling, 2026-10-03)
                protect("percentComment", node.block === true, from, to);
                break;
            case "inlineCode":
                protect("inlineCode", false, from, to);
                break;
            case "inlineMath":
                protect("inlineMath", false, from, to);
                break;
            case "wikiLink": {
                const open = doc[from] === "!" ? 3 : 2;
                protect("wikilink", false, from + open, to - 2);
                break;
            }
            case "link":
            case "image":
                // "[text](destination)": the part after the label; an autolink "<...>" or a bare URL is all destination
                protect("linkDestination", false, doc[from] === "[" || doc[from] === "!" ? afterLabel(doc, from, to) : from, to);
                break;
            case "definition":
                // a link definition "[label]: url": the part after the label
                protect("linkDestination", false, afterLabel(doc, from, to), to);
                break;
        }
        // what holds this node's children: one more quote, list item, or footnote when the node is one
        const inner =
            node.type === "blockquote"
                ? { ...container, quotes: container.quotes + 1 }
                : node.type === "listItem"
                  ? { ...container, listItems: container.listItems + 1 }
                  : node.type === "footnoteDefinition"
                    ? { ...container, footnotes: container.footnotes + 1 }
                    : container;
        for (const child of node.children ?? []) walk(child, node.type, inInlineNote || node.type === "footnote", inner);
    };
    walk(tree, "", false, { quotes: 0, listItems: 0, footnotes: 0 });
    return { definitions, references, protectedSpans };
}

/** The footnote facts of a note, as Obsidian reads it. */
export function footnoteFacts(text: string): FootnoteFacts {
    const doc = normalizeLineBreaks(text);
    return factsOfTree(doc, parseObsidianMarkdown(doc));
}

/**
 * The footnote facts of one part of a note, read on its own, for the note
 * reading, which parses a long note in parts (see note-reading.ts). `doc`
 * is the part's text with its line breaks normalized, and its lines and
 * offsets count from the part's own start.
 *
 * `startsNote` says whether the part is the start of the note: only there
 * may frontmatter be read. `borrowsLine` says whether the part's last line
 * is borrowed: not its own, but the first line of the part after it, added
 * to show where this part ends. The part ends cleanly when the borrowed
 * line starts a block of its own at the top level, the way it does in the
 * whole note: then the facts of the lines before it are the whole note's
 * facts for those lines, and they are returned. When the borrowed line is
 * taken into something above it (a paragraph's lazy line, a list's next
 * item, a code block or comment still open), the part does not end there,
 * and the result is null.
 */
export function partFacts(doc: string, startsNote: boolean, borrowsLine: boolean): FootnoteFacts | null {
    const tree = parseObsidianMarkdown(doc, startsNote);
    const facts = factsOfTree(doc, tree);
    if (!borrowsLine) return facts;
    // where the borrowed line starts, as an offset and as a line
    const last = doc.lastIndexOf("\n") + 1;
    let lastLine = 0;
    for (let i = doc.indexOf("\n"); i !== -1; i = doc.indexOf("\n", i + 1)) lastLine++;
    if (!(tree.children ?? []).some((block) => block.position.start.offset === last)) return null;
    return {
        definitions: facts.definitions.filter((definition) => definition.start < lastLine),
        references: facts.references.filter((reference) => reference.line < lastLine),
        protectedSpans: facts.protectedSpans.filter((span) => span.startLine < lastLine),
    };
}
