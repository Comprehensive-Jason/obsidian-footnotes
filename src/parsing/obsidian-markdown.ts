// Reads a note the way Obsidian's Reading view and metadata cache read it.
//
// Obsidian's Reading view, its metadata cache, and Obsidian Publish all share
// one Markdown parser: a fork of remark-parse 8 (an older version of the
// remark library, from 2020) with some readers of Obsidian's own added
// (research 2026-10-03, obsidian-parser-research.md). So this file starts
// from the real remark-parse 8.0.3, with the footnote and math plugins of
// the same era (remark-footnotes 2.0.0, remark-math 3.0.1), and adds
// Obsidian's extra rules on top, each as one small named reader below.
//
// Obsidian's own code is closed, so none of it is copied here. Every rule
// below was written "clean room": from Obsidian's observed answers on test
// notes. The rules carry the letter and number (A1, B3, ...) they have in
// the research notes of 2026-10-03 (obsidian-rules.md, kept outside the
// repo), and the notes behind them are in test/obsidian-answers/probes.json,
// with Obsidian's answers. The rules hook into remark-parse 8
// through its own extension points: the tables of block and inline readers
// ("tokenizers") and the lists of readers allowed to interrupt a paragraph,
// a list, or a quote. The one stock reader that had to change, the list
// reader, is vendored next to this file (remark-parse-list.js) rather than
// patched inside node_modules (Jason, 2026-10-03).
//
// For now this reader is the offline referee that test/obsidian-referee
// checks against Obsidian's saved answers; the plugin's commands still use
// the hand-written scanner in markdown-scan.ts (Jason, 2026-10-03: adopt
// remark-parse 8 in steps, the runtime swap comes later).
//
// Terms used below:
// - A "tokenizer" is remark-parse's word for a reader: a function that looks
//   at the start of the remaining text and either takes ("eats") a piece of
//   it as a node, or declines. With `silent` set, it only answers whether it
//   would take something, which is how "can this line interrupt a
//   paragraph?" is asked.
// - A "node" is one piece of the parsed tree (mdast): a paragraph, a list
//   item, a footnote reference, and so on, with its position in the note.
// - An "offset" is a character index into the note's text, counted from 0.

import remarkFootnotes from "remark-footnotes";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import listTokenizer from "./remark-parse-list";

/** A place in the note as remark-parse reports it: line and column count from 1, the offset from 0. */
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
    /** The text of a leaf node (code, math, HTML, plain text). */
    value?: string;
    /** For a "%%" comment: true for a block comment, false for an inline pair. */
    block?: boolean;
}

/** A node as a tokenizer builds it; remark-parse adds the position when the node is eaten. */
type NewNode = Omit<MarkdownNode, "position">;

/** What `eat(text)` returns: the function that adds the new node to the tree. */
type AddNode = (node: NewNode, parent?: MarkdownNode) => MarkdownNode;

interface Eat {
    (subvalue: string): AddNode;
    /** Where the remaining text starts. */
    now(): Point;
}

/** The parser's state, as a tokenizer sees it through `this`. */
interface ParserState {
    /** The text being parsed. */
    file: ParseInput;
    offset: Record<number, number>;
    blockTokenizers: Record<string, Tokenizer>;
    tokenizeBlock(value: string, now: Point): MarkdownNode[];
    tokenizeInline(value: string, now: Point): MarkdownNode[];
    /** Where the current quote's first line starts (an offset), for the callout reader. */
    calloutAt?: number;
}

export interface Tokenizer {
    (this: ParserState, eat: Eat, value: string, silent?: boolean): MarkdownNode | boolean | undefined;
    /** For an inline tokenizer: where in `value`, from `fromIndex` on, it could next match, or -1. */
    locator?: (value: string, fromIndex: number) => number;
}

/** A reader allowed to interrupt a paragraph, list, or quote, with the options it depends on. */
type InterruptRule = [string, { commonmark?: boolean; pedantic?: boolean }?];

/** The tables a remark-parse 8 parser keeps on its prototype, which plugins edit. */
interface ParserTables {
    options: Record<string, unknown>;
    blockTokenizers: Record<string, Tokenizer>;
    inlineTokenizers: Record<string, Tokenizer>;
    blockMethods: string[];
    inlineMethods: string[];
    interruptParagraph: InterruptRule[];
    interruptList: InterruptRule[];
    interruptBlockquote: InterruptRule[];
}

/** The stand-in for a vfile that remark-parse's Parser reads the text from. */
interface ParseInput {
    toString(): string;
    message(): void;
    fail(error: Error): never;
}

type ParserConstructor = new (doc: string, file: ParseInput) => ParserTables & { parse(): MarkdownNode };

/** A remark plugin of this era: it registers itself on `this.Parser`. */
type RemarkPlugin = (this: { Parser: ParserConstructor }, options?: object) => void;

const StockParser = (remarkParse as unknown as { Parser: ParserConstructor }).Parser;

/** A point `columns` characters further along the same line. */
function along(point: Point, columns: number): Point {
    return { line: point.line, column: point.column + columns, offset: point.offset + columns };
}

/** The offset where the line holding `from` ends (its "\n", or the end of the text). */
function lineEnd(value: string, from: number): number {
    const end = value.indexOf("\n", from);
    return end === -1 ? value.length : end;
}

/**
 * "%%" comments (rules F1 to F4 and D5). A line whose text, after at most
 * three spaces, starts with "%%" and holds no other "%" at all opens a block
 * comment: "%%" and "%% note" open one, while "%%%", "%% 50%", and
 * "%% a %%" are ordinary paragraphs (F1). The block runs through the first
 * "%%" anywhere on a later line, or to the end of its container (the note,
 * a quote, a list item) when there is none. Any other "%%" pairs with a later "%%" on the same line as an
 * inline comment, or stays plain text. A comment's text is still read
 * inline, so a reference inside it is live (Jason's ruling, 2026-10-03,
 * which is what Obsidian's parser says).
 *
 * A block comment's opener interrupts a paragraph, a quote, and a list item,
 * and is never a lazy line of a quote or an item (F4). It does not end a
 * footnote definition (D5): the footnote plugin is registered before this
 * reader, so "%%" is not in the definition's interrupt list.
 */
function percentComments(tables: ParserTables): void {
    const block: Tokenizer = function (eat, value, silent) {
        let start = 0;
        while (start < 3 && value.charCodeAt(start) === 32) start++;
        if (!value.startsWith("%%", start)) return undefined;
        const openerEnd = lineEnd(value, start);
        // any other "%" on the opener's own line, a lone one included, makes
        // the line a paragraph (F1, F3; the overnight oracle run of
        // 2026-10-03 found "%%%" lines and "%% 50%" lines read this way)
        if (value.slice(start + 2, openerEnd).includes("%")) return undefined;
        if (silent === true) return true;
        const close = openerEnd === value.length ? -1 : value.indexOf("%%", openerEnd);
        const innerEnd = close === -1 ? value.length : close;
        const children = this.tokenizeInline(value.slice(start + 2, innerEnd), along(eat.now(), start + 2));
        return eat(value.slice(0, close === -1 ? value.length : close + 2))({ type: "percentComment", block: true, children });
    };
    const inline: Tokenizer = function (eat, value, silent) {
        if (!value.startsWith("%%")) return undefined;
        const close = value.indexOf("%%", 2);
        if (close === -1 || close > lineEnd(value, 0)) return undefined;
        if (silent === true) return true;
        const children = this.tokenizeInline(value.slice(2, close), along(eat.now(), 2));
        return eat(value.slice(0, close + 2))({ type: "percentComment", block: false, children });
    };
    inline.locator = (value, fromIndex) => value.indexOf("%%", fromIndex);
    tables.blockTokenizers.percentComment = block;
    tables.inlineTokenizers.percentComment = inline;
    // before fenced code, as Obsidian registers it, so a "%%" indented four spaces is indented code
    tables.blockMethods.splice(tables.blockMethods.indexOf("fencedCode"), 0, "percentComment");
    tables.inlineMethods.splice(tables.inlineMethods.indexOf("html"), 0, "percentComment");
    tables.interruptParagraph.push(["percentComment"]);
    tables.interruptList.push(["percentComment"]);
    tables.interruptBlockquote.push(["percentComment"]);
}

/** A callout's marker: "[!type]" with an optional "+" or "-", then a space, a tab, or the end of the line (A1). */
const CalloutMarker = /^\[![^\]\n]+\][+-]?(?=[ \t\n]|$)/;

/**
 * Callout titles (rules A1 to A5). A quote whose first line, after ">" and
 * at most one space, is a callout marker is a callout, and its first line
 * stands alone: the next line starts a fresh block instead of continuing a
 * paragraph (A2). Whatever follows the marker and one space or tab on that
 * line is read as block content of its own (A4), so "> [!note] [^1]: def"
 * defines [^1]. Only the quote's first line can be a title (A3).
 *
 * The quote reader is wrapped to note where its first line's text starts;
 * the title reader runs first among the block readers and acts only there.
 */
function calloutTitles(tables: ParserTables): void {
    const stockBlockquote = tables.blockTokenizers.blockquote;
    tables.blockTokenizers.blockquote = function (eat, value, silent) {
        if (silent !== true) {
            let i = 0;
            while (value[i] === " " || value[i] === "\t") i++;
            if (value[i] === ">") {
                i++;
                if (value[i] === " ") i++;
                this.calloutAt = eat.now().offset + i;
            }
        }
        return stockBlockquote.call(this, eat, value, silent);
    };
    tables.blockTokenizers.calloutTitle = function (eat, value, silent) {
        if (eat.now().offset !== this.calloutAt) return undefined;
        const marker = CalloutMarker.exec(value);
        if (!marker) return undefined;
        if (silent === true) return true;
        const line = value.slice(0, lineEnd(value, 0));
        let rest = marker[0].length;
        if (line[rest] === " " || line[rest] === "\t") rest++;
        const now = eat.now();
        // remark-parse keeps, per line, how many characters its containers
        // stripped from the start of the line, and the footnote reader adds
        // its label's length to that count to place the definition's text.
        // The title's own text starts after the marker, so the count for
        // this line must say so too, or a reference in a definition on the
        // title line is placed short by the marker's length (rule A4; the
        // overnight oracle run of 2026-10-03, about 1,100 of 20,000 notes).
        this.offset[now.line] = Math.max(this.offset[now.line] ?? 0, now.column - 1 + rest);
        const children = this.tokenizeBlock(line.slice(rest), along(now, rest));
        return eat(line)({ type: "calloutTitle", children });
    };
    tables.blockMethods.unshift("calloutTitle");
}

/**
 * Lists with lazy lines (rule B3): remark-parse 8's list reader, vendored
 * with one change so that an unindented (lazy) line no longer stops the
 * item's other lines from being de-indented. See remark-parse-list.js.
 */
function listLazyLines(tables: ParserTables): void {
    tables.blockTokenizers.list = listTokenizer;
}

/** Whether a line starts with "|", after any spaces or tabs: a table row's "pipe style". */
function startsWithPipe(line: string): boolean {
    return /^[ \t]*\|/.test(line);
}

/** Whether `line` is a body row of a table of the given pipe style (C2). */
function isTableRow(line: string, piped: boolean): boolean {
    if (piped) return startsWithPipe(line) && line.indexOf("|", line.indexOf("|") + 1) !== -1;
    return !startsWithPipe(line) && line.includes("|");
}

/**
 * Where a table at the start of `value` ends by Obsidian's pipe-style rules,
 * or -1 when its first two lines cannot start one. The header and the
 * delimiter row must share a pipe style (C1), and the table runs on only
 * while each next line is a row of that same style (C2). So a label line
 * under a piped table ends it even when the label holds a pipe (C3).
 */
function tableEnd(value: string): number {
    const headerEnd = lineEnd(value, 0);
    if (headerEnd === value.length || !value.slice(0, headerEnd).includes("|")) return -1;
    const piped = startsWithPipe(value);
    const delimiterEnd = lineEnd(value, headerEnd + 1);
    if (startsWithPipe(value.slice(headerEnd + 1, delimiterEnd)) !== piped) return -1;
    let end = delimiterEnd;
    while (end < value.length) {
        const rowEnd = lineEnd(value, end + 1);
        if (!isTableRow(value.slice(end + 1, rowEnd), piped)) break;
        end = rowEnd;
    }
    return end;
}

/**
 * Tables (rules C1 to C3). The stock table reader accepts mixed pipe styles
 * and any later line holding a pipe; this wrapper hands it only the lines
 * Obsidian counts as the table, and nothing when the first two lines do not
 * make one. Everything else about tables (cells, alignment, a table ending a
 * definition but not a paragraph) is stock (C4, C5).
 */
function tablePipeStyles(tables: ParserTables): void {
    const stockTable = tables.blockTokenizers.table;
    tables.blockTokenizers.table = function (eat, value, silent) {
        const end = tableEnd(value);
        if (end === -1) return undefined;
        return stockTable.call(this, eat, value.slice(0, end), silent);
    };
}

/** A wikilink or embed: "[[" (or "![[") up to the first "]]" on the same line, with something between (D1). */
const Wikilink = /^!?\[\[[^\n]+?\]\]/;

/**
 * Wikilinks and embeds (rule D1). Nothing inside one is read, so a
 * reference or a label inside a wikilink is dead text, and a reference right
 * after one ("[[note]][^1]") is live instead of being read as a link.
 */
function wikilinks(tables: ParserTables): void {
    const wikilink: Tokenizer = function (eat, value, silent) {
        const match = Wikilink.exec(value);
        if (!match) return undefined;
        if (silent === true) return true;
        return eat(match[0])({ type: "wikiLink", value: match[0] });
    };
    wikilink.locator = (value, fromIndex) => {
        const at = value.indexOf("[[", fromIndex);
        return at > fromIndex && value[at - 1] === "!" ? at - 1 : at;
    };
    tables.inlineTokenizers.wikiLink = wikilink;
    tables.inlineMethods.splice(tables.inlineMethods.indexOf("link"), 0, "wikiLink");
}

/** Frontmatter: "---" alone on the note's first line, up to the three dashes that start a later line (D2). */
const Frontmatter = /^---\n(?:[^\n]*\n)*?---/;

/**
 * Frontmatter (rule D2): a YAML section at the very top of the note. Inside
 * it labels define nothing and references are dead. The first line must be
 * exactly "---". The section closes at the first later line that starts
 * with three dashes, and ends right after them: whatever follows on that
 * line is ordinary Markdown again, so "---[^2]: two" closes the section and
 * defines [^2], "--- # H" closes it and starts a heading, and "---x" closes
 * it and starts a paragraph (the overnight oracle run of 2026-10-03: 27
 * notes, and a family of 38 closer and opener shapes). Without such a
 * line there is no frontmatter, and the lines read as ordinary Markdown (a
 * thematic break, setext headings, paragraphs). A byte order
 * mark before the first "---" changes nothing (recorded fact from commit
 * bca376c); remark-parse skips it, so the note's text then starts at offset 1.
 */
function frontmatter(tables: ParserTables): void {
    tables.blockTokenizers.frontmatter = function (eat, value, silent) {
        const noteStart = this.file.toString().charCodeAt(0) === 0xfeff ? 1 : 0;
        if (eat.now().offset !== noteStart) return undefined;
        const match = Frontmatter.exec(value);
        if (!match) return undefined;
        if (silent === true) return true;
        return eat(match[0])({ type: "yaml", value: match[0] });
    };
    tables.blockMethods.unshift("frontmatter");
}

/** Inline display math: "$$", some text, and the first "$$" after it; spaces and single dollars allowed inside (M1). */
const DoubleDollarMath = /^\$\$[\s\S]+?\$\$/;

/**
 * "$$ ... $$" inside a paragraph (rule M1). A "$$" pair within one
 * paragraph is math, with spaces allowed after the opener and before the
 * closer, and it may span the paragraph's lines. It ends at the first "$$"
 * after the opener, so a single "$" inside does not stop it: in
 * "$$ a $ b [^1] $$" and "$$ m [^a$] $$" the reference is dead (the
 * overnight oracle run of 2026-10-03: 62 notes, all with a footnote name
 * holding a "$" inside such a pair). remark-math 3 rejects a
 * space after the opening "$$", so without this reader such a reference
 * would be live. A line that starts with "$$" and is not a closed pair still
 * opens a display block, as stock remark-math reads it (M2).
 */
function doubleDollarMath(tables: ParserTables): void {
    const math: Tokenizer = function (eat, value, silent) {
        const match = DoubleDollarMath.exec(value);
        if (!match) return undefined;
        if (silent === true) return true;
        return eat(match[0])({ type: "inlineMath", value: match[0].slice(2, -2) });
    };
    math.locator = (value, fromIndex) => value.indexOf("$$", fromIndex);
    tables.inlineTokenizers.doubleDollarMath = math;
    tables.inlineMethods.splice(tables.inlineMethods.indexOf("math"), 0, "doubleDollarMath");
}

/**
 * The parser class, built once: remark-parse 8 with its own copy of the
 * reader tables (so registering readers never changes the stock Parser),
 * the math and footnote plugins, then Obsidian's readers.
 *
 * Order matters in one place: the footnote plugin builds the list of
 * readers that may end a footnote definition from the block readers
 * registered when it attaches. Math is registered before it, so a "$$" line
 * ends a definition; Obsidian's readers come after it, so a "%%" line does
 * not (rules E1 and D5).
 */
function buildParser(): ParserConstructor {
    class ObsidianParser extends StockParser {}
    const tables = ObsidianParser.prototype;
    tables.options = { ...tables.options, commonmark: true };
    tables.blockTokenizers = { ...tables.blockTokenizers };
    tables.inlineTokenizers = { ...tables.inlineTokenizers };
    tables.blockMethods = tables.blockMethods.slice();
    tables.inlineMethods = tables.inlineMethods.slice();
    tables.interruptParagraph = tables.interruptParagraph.slice();
    tables.interruptList = tables.interruptList.slice();
    tables.interruptBlockquote = tables.interruptBlockquote.slice();

    const host = { Parser: ObsidianParser };
    (remarkMath as unknown as RemarkPlugin).call(host, {});
    // inline notes "^[...]" are read too; facts treat everything inside one as dead (rule E3)
    (remarkFootnotes as unknown as RemarkPlugin).call(host, { inlineNotes: true });

    percentComments(tables);
    calloutTitles(tables);
    listLazyLines(tables);
    tablePipeStyles(tables);
    wikilinks(tables);
    frontmatter(tables);
    doubleDollarMath(tables);
    return ObsidianParser;
}

let parserClass: ParserConstructor | null = null;

/** The note with Windows line breaks turned into "\n", the text every offset in the tree refers to. */
export function normalizeLineBreaks(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

/**
 * Parses a note into its tree the way Obsidian reads it. Positions refer to
 * the note with its line breaks normalized to "\n" (normalizeLineBreaks).
 */
export function parseObsidianMarkdown(text: string): MarkdownNode {
    parserClass ??= buildParser();
    const doc = normalizeLineBreaks(text);
    const input: ParseInput = {
        toString: () => doc,
        // remark-parse reports oddities such as unknown character references
        // here; they change nothing in the tree
        message: () => undefined,
        fail: (error) => {
            throw error;
        },
    };
    return new parserClass(doc, input).parse();
}
