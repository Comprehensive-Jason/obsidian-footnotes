// Reads a note the way Obsidian's Reading view and metadata cache read it.
//
// The parser is @quartz-community/remark-obsidian, in its "legacy" preset,
// a package shared between plugins that holds remark-parse 8 (the parser
// Obsidian itself forks) with Obsidian's own rules added. This file is the
// adapter between that package and the plugin: it asks the package for a
// tree, and then puts back the few things the plugin reads that the
// package's tree leaves out or holds in another shape. The rules themselves
// are written up in docs/obsidian-reading-rules.md, and
// test/obsidian-referee.test.ts checks the reading against Obsidian's saved
// answers.
//
// Terms used below:
// - A "node" is one piece of the parsed tree (mdast): a paragraph, a list
//   item, a footnote reference, and so on, with its position in the note.
// - An "offset" is a character index into the note's text, counted from 0.

import remarkObsidian from "@quartz-community/remark-obsidian";
import { unified } from "unified";

/** A place in the note as the parser reports it: line and column count from 1, the offset from 0. */
interface Point {
    line: number;
    column: number;
    offset: number;
}

/** One node of the parsed tree, with the fields this plugin reads. */
export interface MarkdownNode {
    type: string;
    position: { start: Point; end: Point };
    children?: MarkdownNode[];
    /** A footnote definition's or reference's name, as written. */
    label?: string;
    /** For a reference link, a reference image, or a link reference definition: its label in lower case, with runs of spaces as one, so a link and its definition match. */
    identifier?: string;
    /** For a reference link or image: "full" for "[text][label]", "collapsed" for "[text][]", and "shortcut" for "[text]". */
    referenceType?: string;
    /** The text of a leaf node (code, math, HTML, plain text). */
    value?: string;
    /** For a heading: its level, 1 to 6. */
    depth?: number;
    /** For a list: whether it is numbered. */
    ordered?: boolean;
}

/** What the package adds on the root node: the column table (see parseObsidianNote). */
type RootNode = MarkdownNode & { data?: { lineOffsets?: Record<number, number> } };

/** The parser for a whole note, built once. Freezing it stops anyone changing its settings later. */
const wholeNoteParser = unified().use(remarkObsidian).freeze();

/** The parser for a later part of a note: frontmatter can only open the note itself. */
const laterPartParser = unified().use(remarkObsidian, { frontmatter: false }).freeze();

/** A point further along the note, walking its text from a point before it. */
function pointAt(doc: string, from: Point, offset: number): Point {
    let { line, column } = from;
    for (let i = from.offset; i < offset; i++) {
        if (doc[i] === "\n") {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { line, column, offset };
}

/** A piece of plain text, from offset `from` up to offset `to`, cut out of the text node `text`. */
function textPiece(doc: string, text: MarkdownNode, from: number, to: number): MarkdownNode {
    return {
        type: "text",
        value: doc.slice(from, to),
        position: { start: pointAt(doc, text.position.start, from), end: pointAt(doc, text.position.start, to) },
    };
}

/** The offset where the line holding `from` ends (its "\n", or the end of the text). */
function lineEnd(value: string, from: number): number {
    const end = value.indexOf("\n", from);
    return end === -1 ? value.length : end;
}

/**
 * Moves every position one character on, for a note that starts with a byte
 * order mark. The package drops the mark before it reads, so its offsets
 * count from the character after it, while the plugin's offsets count the
 * note as it holds it, the mark included. Only the first line's columns move.
 */
function shiftPastByteOrderMark(node: MarkdownNode): void {
    for (const point of [node.position.start, node.position.end]) {
        point.offset++;
        if (point.line === 1) point.column++;
    }
    for (const child of node.children ?? []) shiftPastByteOrderMark(child);
}

/**
 * Turns a callout back into the shape the plugin reads: a quote whose first
 * child is a "calloutTitle" holding the blocks on the title's line. The
 * package's "callout" node holds its title's text directly, or an empty
 * title with the title line's blocks moved out among the body. The title
 * runs from the marker "[!note]" to the end of the line (rules A1 to A5).
 */
function calloutAsQuote(callout: MarkdownNode, doc: string): void {
    const kids = callout.children ?? [];
    const start = callout.position.start;
    let marker = start.offset;
    while (doc[marker] === " " || doc[marker] === "\t") marker++;
    if (doc[marker] === ">") marker++;
    if (doc[marker] === " ") marker++;
    const title: MarkdownNode = {
        type: "calloutTitle",
        position: { start: pointAt(doc, start, marker), end: pointAt(doc, start, lineEnd(doc, marker)) },
        children: [],
    };
    let body = kids;
    if (kids[0]?.type === "calloutTitle") {
        body = kids.slice(1);
        // a title with text holds that text directly; the plugin reads it as one paragraph
        if ((kids[0].children ?? []).length > 0) title.children = [{ type: "paragraph", position: kids[0].position, children: kids[0].children }];
    }
    // a block on the title's own line (A4, "> [!note] [^1]: def") belongs to the title
    const onTitleLine = body.filter((block) => block.position.start.line === start.line);
    title.children = [...(title.children ?? []), ...onTitleLine];
    callout.type = "blockquote";
    callout.children = [title, ...body.slice(onTitleLine.length)];
}

/** A label in the form a link and its definition are matched by: runs of spaces as one, and case folded as Obsidian folds it. */
function foldedLabel(label: string): string {
    return label.replace(/\n[ \t>]*/g, " ").replace(/[\t ]+/g, " ").toLowerCase().toUpperCase().toLowerCase();
}

/**
 * A reference link's lookup, or a link definition's label, with the spaces
 * at its ends kept. Obsidian does not trim a label, so "[ a ]" is not "[a]"
 * (rule 18a in the package's notes), while the package's `identifier` trims.
 */
function untrimmedIdentifier(node: MarkdownNode): string {
    const label = node.label ?? "";
    return `${/^[\t\n ]/.test(label) ? " " : ""}${node.identifier ?? ""}${/[\t\n ]$/.test(label) ? " " : ""}`;
}

/** A stretch of bracketed text found in a node's text children: where it starts and ends, and the children it covers. */
interface BracketedText {
    from: number;
    to: number;
    close: number;
    first: number;
    last: number;
    image: boolean;
}

/** The first "[" or "]" at or after `from`, before `end`, skipping what a backslash escapes, or -1. */
function nextBracket(doc: string, from: number, end: number): number {
    for (let i = from; i < end; i++) {
        if (doc[i] === "\\") i++;
        else if (doc[i] === "[" || doc[i] === "]") return i;
    }
    return -1;
}

/**
 * Finds the bracketed text the package turned into plain text among `kids`:
 * "[word]", "[word][]", "![word]", and "![word][]" whose label nothing in the
 * text it was given defines. A "[" that reaches plain text was declined by
 * the link readers, or is one of these; remark-parse 8's reference reader
 * (tokenize/reference.js) says which: the text up to the first "]" holds no
 * other "[", is not empty, and its "]" is plain text among the same
 * children. Inside a link only an image counts, as a link holds no links.
 */
function findBracketedText(kids: readonly MarkdownNode[], doc: string, parentEnd: number, inLink: boolean): BracketedText[] {
    const found: BracketedText[] = [];
    let resume = -1;
    for (let k = 0; k < kids.length; k++) {
        const kid = kids[k];
        if (kid.type !== "text") continue;
        const { offset: start } = kid.position.start;
        const { offset: end } = kid.position.end;
        // the last character a backslash escaped, so that "\\![a]" still reads its "!"
        let escaped = -1;
        for (let i = Math.max(start, resume); i < end; i++) {
            if (doc[i] === "\\") {
                escaped = ++i;
                continue;
            }
            if (doc[i] !== "[") continue;
            const image = i > start && doc[i - 1] === "!" && escaped !== i - 1;
            if (inLink && !image) continue;
            const close = nextBracket(doc, i + 1, parentEnd);
            if (close === -1 || doc[close] !== "]") continue;
            // empty brackets are read as one only with a "[" right after them
            if (close === i + 1 && doc[close + 1] !== "[") continue;
            // "[^" is left to the footnote readers, whatever follows it (remark-footnotes)
            if (doc[i + 1] === "^") continue;
            // what comes right after: "[]" belongs to it, and so does a "["
            // that never closes, which the reader takes with it
            let to = close + 1;
            if (doc[to] === "[") {
                const next = nextBracket(doc, to + 1, parentEnd);
                to += next === to + 1 && doc[next] === "]" ? 2 : 1;
            }
            let last = k;
            while (last < kids.length && kids[last].position.end.offset < to) last++;
            if (last >= kids.length || kids[last].type !== "text" || kids[last].position.start.offset > close) continue;
            found.push({ from: image ? i - 1 : i, to, close, first: k, last, image });
            resume = to;
            k = last - 1;
            break;
        }
    }
    return found;
}

/**
 * Puts back "[word]" and its kind as reference link and image nodes. The
 * package keeps one only when the text it was given defines its label, and
 * otherwise leaves plain text. The plugin needs them all: it reads a long
 * note in parts, each part on its own, so a link's definition is often in
 * another part, and it reads a table cell alone, with the note's labels
 * passed in. Whether one is really drawn as a link is decided later, against
 * all the note's labels (drawnAsLink in landing.ts).
 */
function restoreBracketedText(parent: MarkdownNode, doc: string, inLink: boolean): void {
    const kids = parent.children ?? [];
    if (!kids.some((kid) => kid.type === "text" && kid.value?.includes("["))) return;
    const found = findBracketedText(kids, doc, parent.position.end.offset, inLink);
    if (found.length === 0) return;
    const out: MarkdownNode[] = [];
    let next = 0;
    for (const { from, to, close, first, last, image } of found) {
        out.push(...kids.slice(next, first));
        const head = kids[first];
        const tail = kids[last];
        if (head.position.start.offset < from) out.push(textPiece(doc, head, head.position.start.offset, from));
        const contentFrom = from + (image ? 2 : 1);
        const label = doc.slice(contentFrom, close);
        const start = pointAt(doc, head.position.start, from);
        const node: MarkdownNode = {
            type: image ? "imageReference" : "linkReference",
            identifier: foldedLabel(label),
            referenceType: doc.slice(close + 1, to) === "[]" ? "collapsed" : "shortcut",
            position: { start, end: pointAt(doc, start, to) },
        };
        if (!image) {
            const inner: MarkdownNode[] = [];
            if (first === last) {
                if (contentFrom < close) inner.push(textPiece(doc, head, contentFrom, close));
            } else {
                if (contentFrom < head.position.end.offset) inner.push(textPiece(doc, head, contentFrom, head.position.end.offset));
                inner.push(...kids.slice(first + 1, last));
                if (tail.position.start.offset < close) inner.push(textPiece(doc, tail, tail.position.start.offset, close));
            }
            node.children = inner;
        }
        out.push(node);
        if (to < tail.position.end.offset) {
            // what is left of the last text may hold the next bracketed text, so it stays one node
            kids[last] = textPiece(doc, tail, to, tail.position.end.offset);
            next = last;
        } else {
            next = last + 1;
        }
    }
    out.push(...kids.slice(next));
    parent.children = out;
}

/**
 * Puts back the references written inside an inline footnote "^[...]". The
 * package turns each into plain text, since Obsidian reads no reference
 * there (rule E3). The plugin still counts them, as dead ones: their names
 * are taken, and the result gate counts them. A reference is "[^", a name
 * with no space, tab, or line break, and "]".
 */
function restoreDeadReferences(parent: MarkdownNode, doc: string): void {
    const kids = parent.children ?? [];
    if (!kids.some((kid) => kid.type === "text" && kid.value?.includes("[^"))) return;
    const out: MarkdownNode[] = [];
    for (const kid of kids) {
        if (kid.type !== "text") {
            out.push(kid);
            continue;
        }
        const end = kid.position.end.offset;
        let start = kid.position.start.offset;
        for (let i = start; i < end; i++) {
            if (doc[i] === "\\") {
                i++;
                continue;
            }
            if (doc[i] !== "[" || doc[i + 1] !== "^") continue;
            let close = i + 2;
            while (close < end && !" \t\n]".includes(doc[close])) close++;
            if (close >= end || doc[close] !== "]" || close === i + 2) continue;
            if (start < i) out.push(textPiece(doc, kid, start, i));
            out.push({
                type: "footnoteReference",
                label: doc.slice(i + 2, close),
                position: { start: pointAt(doc, kid.position.start, i), end: pointAt(doc, kid.position.start, close + 1) },
            });
            start = close + 1;
            i = close;
        }
        if (start === kid.position.start.offset) out.push(kid);
        else if (start < end) out.push(textPiece(doc, kid, start, end));
    }
    parent.children = out;
}

/**
 * Walks the package's tree and puts back what the plugin reads in another
 * shape (see the functions above), from the outside in, so that what is
 * restored in a node is then walked too. `inLink` and `inNote` say whether
 * the node sits inside a link or an inline footnote.
 */
function restoreShapes(node: MarkdownNode, doc: string, inLink: boolean, inNote: boolean): void {
    if (node.type === "definition" || node.type === "linkReference" || node.type === "imageReference") node.identifier = untrimmedIdentifier(node);
    if (node.type === "comment") node.type = "percentComment";
    if (node.children === undefined) return;
    // a bare web address, an email address, or an "<...>" link holds only its own text, never read as Markdown
    if (node.type === "link" && doc[node.position.start.offset] !== "[") return;
    if (node.type === "callout") calloutAsQuote(node, doc);
    const holdsLink = inLink || node.type === "link" || node.type === "linkReference";
    restoreBracketedText(node, doc, holdsLink);
    const holdsNote = inNote || node.type === "footnote";
    if (holdsNote) restoreDeadReferences(node, doc);
    for (const child of node.children) restoreShapes(child, doc, holdsLink, holdsNote);
}

/**
 * Whether a link definition "[label]: destination 'title'" starting at
 * `from` would be taken if the text went on, though it is not taken now.
 * A link definition is the one block that looks past the line after it: its
 * label runs to the first "]" wherever that is, over blank lines too; after
 * the ":" any number of line breaks may come before the destination; a
 * destination in "<...>" may hold line breaks; and a title may start after
 * blank lines and run over several lines (remark-parse 8,
 * tokenize/definition.js, read in the same order here). So this answers yes
 * when the text ends inside one of those. Answering yes when nothing would
 * change costs only a longer part, never a wrong reading (see partFacts).
 */
function definitionCutOffByTheEnd(doc: string, from: number): boolean {
    const length = doc.length;
    const skip = (start: number, set: string): number => {
        let i = start;
        while (i < length && set.includes(doc[i])) i++;
        return i;
    };
    let i = skip(from, " \t");
    // a "[^" is left to the footnote readers
    if (doc[i] !== "[" || doc[i + 1] === "^") return false;
    const labelStart = ++i;
    while (i < length && doc[i] !== "]") i += doc[i] === "\\" ? 2 : 1;
    if (i >= length) return true;
    if (i === labelStart || doc[i + 1] !== ":") return false;
    i = skip(i + 2, " \t\n");
    if (i >= length) return true;
    let url = 0;
    if (doc[i] === "<") {
        const open = ++i;
        while (i < length && !"<>[]".slice(1).includes(doc[i])) i++;
        if (i >= length) return true;
        if (doc[i] !== ">") return false;
        url = i - open;
        i++;
    }
    if (url === 0) {
        const urlStart = i;
        while (i < length && !/[[\]\s]/.test(doc[i])) i++;
        url = i - urlStart;
        if (url === 0) return i >= length;
    }
    const gap = skip(i, " \t\n");
    if (gap === i || gap >= length) return false;
    const closer = doc[gap] === '"' ? '"' : doc[gap] === "'" ? "'" : doc[gap] === "(" ? ")" : "";
    if (closer === "") return false;
    i = gap + 1;
    while (i < length && doc[i] !== closer) {
        if (doc[i] === "\n") {
            i++;
            if (doc[i] === "\n" || doc[i] === closer) return false;
        }
        i++;
    }
    return i >= length;
}

/**
 * Whether a link definition at the top level would read differently with
 * more text after the end. Only a paragraph or a table can start where the
 * definition reader was asked and declined; every other block is taken
 * before that reader is asked, or holds it.
 */
function readsPastTheEnd(tree: MarkdownNode, doc: string): boolean {
    return (tree.children ?? []).some((block) => (block.type === "paragraph" || block.type === "table") && definitionCutOffByTheEnd(doc, block.position.start.offset));
}

/** The note with Windows line breaks turned into "\n", the text every offset in the tree refers to. */
export function normalizeLineBreaks(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

/** Frontmatter: "---" alone on the note's first line, up to the three dashes that start a later line (D2). */
const Frontmatter = /^---\n(?:[^\n]*\n)*?---/;

/**
 * Where the note's frontmatter ends: the offset just past the three dashes
 * of its closing line, or 0 when the note has none (rule D2). `doc` is the
 * whole note, with its line breaks normalized.
 */
export function frontmatterEnd(doc: string): number {
    const noteStart = doc.charCodeAt(0) === 0xfeff ? 1 : 0;
    const match = Frontmatter.exec(doc.slice(noteStart));
    return match ? noteStart + match[0].length : 0;
}

/**
 * Parses a note into its tree the way Obsidian reads it. Positions refer to
 * the note with its line breaks normalized to "\n" (normalizeLineBreaks).
 *
 * `startsNote` is false when `text` is a later part of a note, read on its
 * own (the note reading parses a long note in parts, see note-reading.ts):
 * frontmatter can only open the note itself, so a part never reads it.
 *
 * With the tree comes how many characters at the start of each line the
 * note's containers took as their own syntax: quote markers, list markers
 * with their task box and the space after them, the indentation that puts
 * a line inside a list item, a callout's marker, and a footnote's label and
 * indentation. The package reports this table on the root node. It is
 * exactly where the line's text starts inside its containers. Lines count
 * from 1, and a line no container touched is missing.
 *
 * `readsPastEnd` says whether a link definition at the top level would
 * read differently with more text after the end, which matters only to a
 * part of a note.
 */
export function parseObsidianNote(text: string, startsNote = true): { tree: MarkdownNode; containerColumns: Readonly<Record<number, number>>; readsPastEnd: boolean } {
    const doc = normalizeLineBreaks(text);
    const parser = startsNote ? wholeNoteParser : laterPartParser;
    const tree = parser.parse(doc) as unknown as RootNode;
    const containerColumns = tree.data?.lineOffsets ?? {};
    if (doc.charCodeAt(0) === 0xfeff) {
        shiftPastByteOrderMark(tree);
        // the mark stands in front of what the first line's containers took, too
        if (1 in containerColumns) containerColumns[1]++;
    }
    restoreShapes(tree, doc, false, false);
    return { tree, containerColumns, readsPastEnd: readsPastTheEnd(tree, doc) };
}
