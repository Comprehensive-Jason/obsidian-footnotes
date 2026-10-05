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

import { MarkdownNode, normalizeLineBreaks, parseObsidianNote } from "./obsidian-markdown";

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
    | "inlineMath"
    | "imageAlt";

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

/**
 * How far into a line its block syntax reaches: the column where the line's
 * own text starts, after quote markers, list markers and task boxes, the
 * indentation that keeps it inside a list item, a footnote's label, a
 * callout's marker, and a heading's "#" marks. `end` is Infinity for a
 * line that is block syntax through to its end: a thematic break, a setext
 * underline, an ATX heading with no text.
 */
interface BlockSyntaxFact {
    line: number;
    end: number;
}

/**
 * A link-like construct: an inline link "[text](url)", a reference link
 * "[text][label]" or "[text]", an image, or a wikilink "[[...]]". It runs
 * from column `start` of line `startLine` up to (not including) column
 * `end` of line `endLine`. A "[^name]" written inside one is part of the
 * link, not a footnote: "[sic][^1]" is a reference link whose label is
 * "^1" (Jason's ruling on its refusal notice, 2026-10-04).
 */
interface LinkFact {
    startLine: number;
    start: number;
    endLine: number;
    end: number;
}

/** The node types read as a LinkFact. */
const LinkNodes = new Set(["link", "linkReference", "image", "imageReference", "wikiLink"]);

export interface FootnoteFacts {
    definitions: DefinitionFact[];
    references: ReferenceFact[];
    protectedSpans: ProtectedSpan[];
    blockSyntax: BlockSyntaxFact[];
    /** The lines that are rows of a table (its header and delimiter row included), outside any footnote's definition: a table inside a definition belongs to the definition. */
    tableRows: number[];
    /**
     * One entry per line: the blocks the line belongs to, from the
     * outermost in, each as its kind ("blockquote", "listItem",
     * "paragraph", "heading2", "list.ordered", ...) with a "^" in front
     * where the block starts on this line. "^paragraph" alone is the first
     * line of a paragraph at the top level, "paragraph" one of its later
     * lines, and "" a blank line outside every container. Comparing these
     * before and after an edit says whether the edit changed how Obsidian
     * reads a line (see linesReadAlike in note-reading.ts).
     */
    lineBlocks: string[];
    /** Every inline footnote "^[...]" that starts and ends on one line: its line, the column of its "^", and the column of its closing "]". */
    inlineNotes: { line: number; open: number; close: number }[];
    /** Every link-like construct, in the order the note reads them. */
    links: LinkFact[];
}

/** Node types that hold blocks; a child of one of these is a block itself, anything deeper is inline. */
const BlockContainers = new Set(["root", "blockquote", "list", "listItem", "footnoteDefinition", "calloutTitle"]);

/**
 * What may come before a label on its line for the line to be cut out with
 * the definition: indentation, quote markers ">", and list markers ("-",
 * "*", "+", "1.", "1)", each followed by a space or a tab) with a task box
 * after one: "[ ]", "[x]", or any other one character in the brackets, as
 * the list reader takes them (remark-parse-list.js). So "---" (a
 * frontmatter closer) and "%%" do not qualify.
 */
const ContainerMarkersOnly = /^(?:[ \t]*(?:>|(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[.\])?(?=[ \t])))*[ \t]*$/;

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

/**
 * Reads the facts off a parsed tree of `doc` (the normalized note).
 * `containerColumns` is what the containers took at the start of each line
 * (see parseObsidianNote), counted from line 1.
 */
function factsOfTree(doc: string, tree: MarkdownNode, containerColumns: Readonly<Record<number, number>>): FootnoteFacts {
    const definitions: DefinitionFact[] = [];
    const references: ReferenceFact[] = [];
    const protectedSpans: ProtectedSpan[] = [];
    const blockSyntax: BlockSyntaxFact[] = [];
    const tableRows: number[] = [];
    for (const [line, end] of Object.entries(containerColumns)) if (end > 0) blockSyntax.push({ line: Number(line) - 1, end });

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
    const lineBlocks: string[][] = lineStarts.map(() => []);
    const inlineNotes: { line: number; open: number; close: number }[] = [];
    const links: LinkFact[] = [];

    const walk = (node: MarkdownNode, parentType: string, inInlineNote: boolean, container: DefinitionContainer): void => {
        const block = BlockContainers.has(parentType);
        const from = node.position.start.offset;
        const to = node.position.end.offset;
        if (block) {
            // The block's kind on every line it covers, marked where it
            // starts. A quote or a list is only the lines it gathers: where
            // it starts moves when an edit cuts its first lines, and that
            // changes how no line reads, so those two carry no mark.
            const kind = node.type === "heading" ? `heading${node.depth ?? 0}` : node.type === "list" && node.ordered === true ? "list.ordered" : node.type;
            const first = node.position.start.line - 1;
            const marked = node.type !== "blockquote" && node.type !== "list";
            for (let line = first; line <= lastLineOf(node); line++) lineBlocks[line]?.push(marked && line === first ? `^${kind}` : kind);
        }
        // A link-like construct is noted whole, so a press can tell a
        // reference that would be read as part of a link from one that would
        // land in protected text, and say which it is (NoteReading.insideLink).
        if (LinkNodes.has(node.type)) {
            const { start, end } = node.position;
            links.push({ startLine: start.line - 1, start: start.column - 1, endLine: end.line - 1, end: end.column - 1 });
        }
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
            case "footnote":
                // an inline footnote "^[...]"; one running over several lines is left out
                if (node.position.start.line === node.position.end.line) {
                    inlineNotes.push({ line: node.position.start.line - 1, open: node.position.start.column - 1, close: node.position.end.column - 2 });
                }
                break;
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
            case "heading": {
                // an ATX heading's "#" marks run up to its text, and a
                // setext heading's underline is its own line, all syntax
                const first = node.children?.[0];
                const line = node.position.start.line - 1;
                blockSyntax.push({ line, end: first ? first.position.start.column - 1 : Infinity });
                if (lastLineOf(node) > line) blockSyntax.push({ line: lastLineOf(node), end: Infinity });
                break;
            }
            case "table":
                // every line of the table is a row (the delimiter row has no node of its own)
                if (container.footnotes === 0) for (let line = node.position.start.line - 1; line <= lastLineOf(node); line++) tableRows.push(line);
                break;
            case "thematicBreak":
                blockSyntax.push({ line: node.position.start.line - 1, end: Infinity });
                break;
            case "wikiLink": {
                const open = doc[from] === "!" ? 3 : 2;
                protect("wikilink", false, from + open, to - 2);
                break;
            }
            case "image":
            case "imageReference": {
                // an image's alt text is not read as Markdown: a reference
                // written there renders no footnote (GLM hunt cycle 3,
                // probed in Reading view 2026-09-16)
                const altEnd = afterLabel(doc, from, to);
                if (altEnd - 1 > from + 2) protect("imageAlt", false, from + 2, altEnd - 1);
                if (node.type === "image") protect("linkDestination", false, altEnd, to);
                break;
            }
            case "link":
                // "[text](destination)": the part after the label; an autolink "<...>" or a bare URL is all destination
                protect("linkDestination", false, doc[from] === "[" ? afterLabel(doc, from, to) : from, to);
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
    return { definitions, references, protectedSpans, blockSyntax, tableRows, lineBlocks: lineBlocks.map((kinds) => kinds.join(" ")), inlineNotes, links };
}

/** The footnote facts of a note, as Obsidian reads it. */
export function footnoteFacts(text: string): FootnoteFacts {
    const doc = normalizeLineBreaks(text);
    const { tree, containerColumns } = parseObsidianNote(doc);
    return factsOfTree(doc, tree, containerColumns);
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
 * item, a code block or comment still open), or a link definition's label
 * is still open at the end (the one reader that looks further than the
 * line after a block; see linkDefinitionsAtTheEnd in obsidian-markdown.ts),
 * the part does not end there, and the result is null.
 */
export function partFacts(doc: string, startsNote: boolean, borrowsLine: boolean): FootnoteFacts | null {
    const { tree, containerColumns, readsPastEnd } = parseObsidianNote(doc, startsNote);
    if (!borrowsLine) return factsOfTree(doc, tree, containerColumns);
    if (readsPastEnd) return null;
    // where the borrowed line starts, as an offset and as a line
    const last = doc.lastIndexOf("\n") + 1;
    if (!(tree.children ?? []).some((block) => block.position.start.offset === last)) return null;
    let lastLine = 0;
    for (let i = doc.indexOf("\n"); i !== -1; i = doc.indexOf("\n", i + 1)) lastLine++;
    const facts = factsOfTree(doc, tree, containerColumns);
    return {
        definitions: facts.definitions.filter((definition) => definition.start < lastLine),
        references: facts.references.filter((reference) => reference.line < lastLine),
        protectedSpans: facts.protectedSpans.filter((span) => span.startLine < lastLine),
        blockSyntax: facts.blockSyntax.filter((syntax) => syntax.line < lastLine),
        tableRows: facts.tableRows.filter((line) => line < lastLine),
        lineBlocks: facts.lineBlocks.slice(0, lastLine),
        inlineNotes: facts.inlineNotes.filter((note) => note.line < lastLine),
        links: facts.links.filter((link) => link.startLine < lastLine),
    };
}
