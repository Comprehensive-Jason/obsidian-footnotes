// The footnote facts of a note, read off the tree that obsidian-markdown.ts
// builds the way Obsidian reads the note: which labels are definitions and
// where each one ends, which references are live, and which stretches of
// text are protected (code, math, comments, frontmatter, and the like,
// where footnote syntax is plain text).
//
// Lines and columns count from 0 here, as everywhere else in the plugin;
// offsets are character indices into the note with its line breaks
// normalized to "\n". Today the oracle and the referee suite read these
// facts (scripts/oracle/reader-facts.ts, test/obsidian-referee.test.ts);
// the plugin's commands still read the note with markdown-scan.ts.

import { MarkdownNode, normalizeLineBreaks, parseObsidianMarkdown } from "./obsidian-markdown";

/** A definition: its name as written, where its label starts, and the last line of its block. */
interface DefinitionFact {
    name: string;
    line: number;
    /** The column of the label's "[". */
    column: number;
    lastLine: number;
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

    const walk = (node: MarkdownNode, parentType: string, inInlineNote: boolean): void => {
        const block = BlockContainers.has(parentType);
        const from = node.position.start.offset;
        const to = node.position.end.offset;
        switch (node.type) {
            case "footnoteDefinition": {
                // the node starts at the line's indentation; the label's "[" comes after it
                let label = from;
                while (doc[label] === " " || doc[label] === "\t") label++;
                definitions.push({ name: node.label ?? "", line: node.position.start.line - 1, column: node.position.start.column - 1 + (label - from), lastLine: lastLineOf(node) });
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
        for (const child of node.children ?? []) walk(child, node.type, inInlineNote || node.type === "footnote");
    };
    walk(tree, "", false);
    return { definitions, references, protectedSpans };
}

/** The footnote facts of a note, as Obsidian reads it. */
export function footnoteFacts(text: string): FootnoteFacts {
    const doc = normalizeLineBreaks(text);
    return factsOfTree(doc, parseObsidianMarkdown(doc));
}
