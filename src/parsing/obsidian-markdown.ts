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
// docs/obsidian-reading-rules.md, which says each one in plain sentences,
// and the notes behind them are in test/obsidian-answers/, with Obsidian's
// answers. The rules hook into remark-parse 8
// through its own extension points: the tables of block and inline readers
// ("tokenizers") and the lists of readers allowed to interrupt a paragraph,
// a list, or a quote. The one stock reader that had to change, the list
// reader, is vendored next to this file (remark-parse-list.js) rather than
// patched inside node_modules (Jason, 2026-10-03). The loop that runs the
// readers is vendored too (remark-parse-tokenizer.js), for speed only.
//
// test/obsidian-referee checks this reader against Obsidian's saved
// answers, and the plugin's commands read notes through it (the note
// reading, note-reading.ts): definitions since step 1 of the runtime swap,
// protected text and the masked twin since step 2 (Jason, 2026-10-03:
// adopt remark-parse 8 in steps).
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
import tokenizerLoop from "./remark-parse-tokenizer";

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
    /** For a reference link, a reference image, or a link reference definition: its label in lower case, with runs of spaces as one, so a link and its definition match. */
    identifier?: string;
    /** The text of a leaf node (code, math, HTML, plain text). */
    value?: string;
    /** For a "%%" comment: true for a block comment, false for an inline pair. */
    block?: boolean;
    /** For a heading: its level, 1 to 6. */
    depth?: number;
    /** For a list: whether it is numbered. */
    ordered?: boolean;
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
    inlineMethods: string[];
    inlineTokenizers: Record<string, Tokenizer>;
    /** Each inline reader's last answer to "where could you next match?", for textLineByLine. */
    locatorMemo?: Map<string, LocatorAnswer>;
    /** Where a math opener of each kind last found no closer, for mathWithoutRescans. */
    mathMemo?: Map<string, { start: number; length: number }>;
}

/**
 * An inline reader's answer to "where could you next match?", asked from
 * offset `from` on a line that ends at offset `end`: the offset of the
 * match, or -1 for none before the line's end.
 */
interface LocatorAnswer {
    from: number;
    end: number;
    at: number;
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
    /** The loop that hands the remaining text to each block reader in turn (remark-parse's tokenizer.js). */
    tokenizeBlock: ParserState["tokenizeBlock"];
    /** The same loop for the text inside a block. */
    tokenizeInline: ParserState["tokenizeInline"];
}

/** The stand-in for a vfile that remark-parse's Parser reads the text from. */
interface ParseInput {
    toString(): string;
    message(): void;
    fail(error: Error): never;
    /** Whether the text starts the note, so that frontmatter may open it (see parseObsidianNote). */
    startsNote: boolean;
    /** Set when a link definition's reading at the top level would change with more text after the end (see linkDefinitionsAtTheEnd). */
    readsPastEnd?: boolean;
}

type ParserConstructor = new (doc: string, file: ParseInput) => ParserTables & { parse(): MarkdownNode; offset: Record<number, number> };

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
 * "%%" comments (rules F1 to F5 and D5). A line whose text, after any
 * spaces, starts with "%%" and holds no other "%" at all opens a block
 * comment: "%%" and "%% note" open one, while "%%%", "%% 50%", and
 * "%% a %%" are ordinary paragraphs (F1). The block runs through the first
 * "%%" anywhere on a later line, or to the end of its container (the note,
 * a quote, a list item) when there is none. Any other "%%" pairs with a later "%%" on the same line as an
 * inline comment, or stays plain text. A comment's text is still read
 * inline, so a reference inside it is live (Jason's ruling, 2026-10-03,
 * which is what Obsidian's parser says).
 *
 * A block comment's opener interrupts a paragraph, a quote, and a list item,
 * and is never a lazy line of a quote or an item (F4). An opener indented
 * four spaces, too shallow for the list item above it, still ends that
 * item and is then read as indented code (F5: the overnight oracle run of
 * 2026-10-03 explained fuzz note 1463 with it). It does not end a
 * footnote definition (D5): the footnote plugin is registered before this
 * reader, so "%%" is not in the definition's interrupt list.
 */
function percentComments(tables: ParserTables): void {
    const block: Tokenizer = function (eat, value, silent) {
        let start = 0;
        // any number of spaces may come first (F5): a line indented four or
        // more is read as indented code before this reader is asked, so the
        // difference shows only where a list asks whether a line may end an
        // item
        while (value.charCodeAt(start) === 32) start++;
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
        const comment = eat(value.slice(0, close === -1 ? value.length : close + 2))({ type: "percentComment", block: true, children });
        if (close !== -1 && value.slice(close + 2, lineEnd(value, close)).trim() !== "") {
            // Text after the closer on its line is read as a block of its
            // own, starting just past the "%%". remark-parse places the text
            // inside a footnote definition by its table of how many
            // characters each line's containers took, and that table did not
            // know the "%%" was there, so in "%% [^a]: sees [^b]" the [^b]
            // was placed two columns early (the metadata cache places it
            // there too). The plugin edits the note by these columns since
            // step 3 of the runtime swap (2026-10-03), so the table is told,
            // as the callout reader tells it of a title's marker. It is told
            // only now: the comment's own text and its end are placed
            // without the closer counted.
            const line = comment.position.end.line;
            this.offset[line] = (this.offset[line] ?? 0) + close + 2 - (value.lastIndexOf("\n", close) + 1);
        }
        return comment;
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

/**
 * Whether a line's very first character is "|": a table row's "pipe style".
 * A line indented by even one space counts as not starting with a pipe, so
 * " | a | b |" over "| --- | --- |" is no table, and " | c | d |" under a
 * piped table is not one of its rows (C1, C2; the overnight oracle run of
 * 2026-10-03: 45 notes, and a family of 55 with every indentation of the
 * header, the delimiter row, and a body row). The line here is what the
 * containers leave, so in a quote or a list item it starts after the
 * quote marker or at the item's content column.
 */
function startsWithPipe(line: string): boolean {
    return line.startsWith("|");
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

/** A wikilink or embed: "[[" (or "![[") up to the first "]]" on the same line, with something between that holds no "[[" (D1). */
const Wikilink = /^!?\[\[(?:(?!\[\[)[^\n])+?\]\]/;

/**
 * Wikilinks and embeds (rule D1). Nothing inside one is read, so a
 * reference or a label inside a wikilink is dead text, and a reference right
 * after one ("[[note]][^1]") is live instead of being read as a link.
 *
 * A wikilink's text cannot hold a second "[[": in "[[a [[b]] [^1]]]" only
 * "[[b]]" is a link, and in "[[^1][[]]" there is none at all, so [^1] is a
 * live reference. Single brackets inside are fine ("[[a [b] [^1]]]" is one
 * link). (The overnight oracle run of 2026-10-03: 16 notes, and 55 family
 * notes on what may sit inside and right before a "[[".)
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
 *
 * When a block follows the closer's "---" on its line, the parser's table
 * of how many characters each line's containers took is told about the
 * three dashes, as the "%%" closer tells it (see percentComments), or every
 * column of that block is placed three characters early: "[^2]" in
 * "---[^1]: body [^2]" was read at "dy [", and a press in front of "- item"
 * on "---- item" was let through as if it were text (hunt 2026-10-05, pin
 * bug-frontmatter-closer-columns). It is told only after the frontmatter is
 * eaten, so the frontmatter's own end is placed without the dashes counted.
 */
function frontmatter(tables: ParserTables): void {
    tables.blockTokenizers.frontmatter = function (eat, value, silent) {
        // a later part of a note, parsed on its own, holds no frontmatter (see parseObsidianNote)
        if (!this.file.startsNote) return undefined;
        const noteStart = this.file.toString().charCodeAt(0) === 0xfeff ? 1 : 0;
        if (eat.now().offset !== noteStart) return undefined;
        const match = Frontmatter.exec(value);
        if (!match) return undefined;
        if (silent === true) return true;
        const yaml = eat(match[0])({ type: "yaml", value: match[0] });
        if (value.slice(match[0].length, lineEnd(value, match[0].length)).trim() !== "") {
            const line = yaml.position.end.line;
            this.offset[line] = (this.offset[line] ?? 0) + "---".length;
        }
        return yaml;
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
 * A speed-up with no change to the reading. An inline math opener ("$", or
 * "$$" for rule M1) searches the rest of its run of text for a closer, and
 * when there is none it is plain text; on a long line of prices ("$5 or $6
 * and ...") every dollar searched to the end of the line in vain, so the
 * read took time growing with the line's length squared: a line of 32,000
 * characters took about a second (measured 2026-10-03, the runtime swap,
 * step 2). A closer is judged by the characters around it alone, not by
 * where its opener was, and a search from a later opener walks the same
 * characters a search from an earlier one walked past it, so once an
 * opener of one kind finds no closer, no later opener of that kind in the
 * same run can. The run is recognised by the text left in it shrinking by
 * exactly as much as the reader moved on.
 */
function mathWithoutRescans(tables: ParserTables): void {
    for (const name of ["math", "doubleDollarMath"]) {
        const stock = tables.inlineTokenizers[name];
        const wrapped: Tokenizer = function (eat, value, silent) {
            if (value.charCodeAt(0) !== 36) return stock.call(this, eat, value, silent);
            // the kind of opener: a single or a double dollar (remark-math
            // needs a double closer for a double opener, rule M1 any "$$")
            const kind = `${name}${value.charCodeAt(1) === 36 ? "$$" : "$"}`;
            const start = eat.now().offset;
            const memo = (this.mathMemo ??= new Map<string, { start: number; length: number }>());
            const dead = memo.get(kind);
            if (dead !== undefined && start >= dead.start && start - dead.start === dead.length - value.length) return undefined;
            const result = stock.call(this, eat, value, silent);
            // an opener with a space or tab after it is no opener; any other
            // that took nothing found no closer
            const after = value.charCodeAt(kind.endsWith("$$") ? 2 : 1);
            if ((result === undefined || result === false) && after !== 32 && after !== 9 && !Number.isNaN(after)) memo.set(kind, { start, length: value.length });
            return result;
        };
        wrapped.locator = stock.locator;
        tables.inlineTokenizers[name] = wrapped;
    }
}

/**
 * Text that, written after the end of the note, finishes a link definition
 * the reader ran out of text in the middle of: a label's closing "]" with
 * its ":" and an address (after a line break, so that a label ending in a
 * backslash does not escape the "]"), an address after the ":", the ">"
 * that closes an address in angle brackets, and the quote or parenthesis
 * that closes a title. Each is one way the definition reader of
 * remark-parse 8 (tokenize/definition.js) can stop short at the end of its
 * text and decline, where more text would have made it take a definition.
 */
const DefinitionEndings = ["\n]: x", "x", ">", '"', "'", ")"];

/**
 * A link definition, "[label]: destination 'title'", is the one block
 * reader that looks past the line after it. Its label runs to the first
 * "]" wherever that is, over blank lines too; after the ":" it skips any
 * number of line breaks, blank lines included, to find the destination; a
 * destination in angle brackets may hold line breaks; and the title may
 * start after blank lines and run over several lines (remark-parse 8,
 * tokenize/definition.js). So "[" alone on a line, a paragraph, and then
 * "[^1]: def" read as one link definition, and Obsidian reads it so too:
 * Reading view shows no footnote (live answers swap34:lrd-label-blank-para
 * and swap34:lrd-label-parts-repro, 2026-10-03).
 *
 * The note reading parses a note in parts (note-reading.ts), and a part
 * ends where a later part may read on its own. Read alone, a part cut off
 * inside such a definition reads a paragraph instead, a different reading
 * of lines the part owns. So this reader, at the top level, notes when it
 * took nothing but WOULD have taken a definition had the text gone on: one
 * of DefinitionEndings written after the end completes one. The part is
 * then not ended there (partFacts in footnote-facts.ts), and is tried
 * again with more of the note, as a part whose fence is still open is
 * (found by test/note-reading-parts.test.ts at FC_NUM_RUNS=3000, the
 * runtime swap, step 2, 2026-10-03, for an open label; and for a title or
 * an address cut off by a part's end by the hunt of 2026-10-05, pin
 * bug-parts-link-definition-title). Saying so when nothing would change
 * costs only a longer part, never a wrong reading. Nothing about the
 * reading changes.
 */
function linkDefinitionsAtTheEnd(tables: ParserTables): void {
    // remark-footnotes' own reader, which leaves "[^" to the footnote readers
    const stockDefinition = tables.blockTokenizers.definition;
    tables.blockTokenizers.definition = function (eat, value, silent) {
        const result = stockDefinition.call(this, eat, value, silent);
        if (result === undefined || result === false) {
            const text = this.file.toString();
            // only a reader that was handed the rest of the note is cut off by its end
            if (eat.now().offset + value.length === text.length && DefinitionEndings.some((more) => stockDefinition.call(this, eat, value + more, true) === true)) {
                this.file.readsPastEnd = true;
            }
        }
        return result;
    };
}

/**
 * A speed-up with no change to the reading: the stock HTML block reader
 * builds a new regular expression from its whole list of tag names every
 * time it is asked, which is at the start of every block and, to check
 * whether a line may interrupt a paragraph, at every line of every
 * paragraph; it was about a sixth of a long note's parse (the runtime swap,
 * 2026-10-03). It only ever takes a line whose first character after any
 * spaces or tabs is "<", so it is asked only then.
 */
function htmlBlockPrecheck(tables: ParserTables): void {
    const stockHtml = tables.blockTokenizers.html;
    tables.blockTokenizers.html = function (eat, value, silent) {
        let i = 0;
        while (value[i] === " " || value[i] === "\t") i++;
        if (value[i] !== "<") return undefined;
        return stockHtml.call(this, eat, value, silent);
    };
}

/**
 * A speed-up with no change to the reading. To find where a stretch of
 * plain text ends, remark-parse's text reader asks every inline reader
 * where it could next match, and each one searches the rest of the run of
 * inline text being read (a paragraph, a heading, a "%%" comment) to its
 * end, every time. A run is usually a few lines, but a "%%" left open near
 * the top of a long note makes the rest of the note one run, and then every
 * stretch of text searched the rest of the note again: on the 5,600-line
 * speed-test note one read took about 3 seconds, and on the 22,400-line
 * one a minute and a half (measured 2026-10-03, the speed brief).
 *
 * So the text reader is handed the text only up to the end of the current
 * line, and its search stops there. A stretch of text then ends at a line's
 * end at the latest, where every inline reader is tried and, finding
 * nothing to match, the text goes on; each reader still starts exactly
 * where its search would have sent it, because what the readers look for
 * (a "[", a "%%", a "`", ...) never runs across a line break, except a hard
 * line break, whose spaces and "\n" stay inside the line handed over.
 *
 * With `plainTextAsIs` set, a stretch holding no "&" is taken as it
 * stands, without the stock reader's walk for character references (see
 * the comment inside).
 */
function textLineByLine(tables: ParserTables, plainTextAsIs: boolean): void {
    const stockText = tables.inlineTokenizers.text;
    tables.inlineTokenizers.text = function (eat, value, silent) {
        const lineEnd = value.indexOf("\n");
        const line = lineEnd === -1 ? value : value.slice(0, lineEnd + 1);
        if (silent === true) return stockText.call(this, eat, line, silent);
        // the stock reader, handed the line only up to where the next
        // reader could match, finds no match before that point and reads
        // the stretch up to it, exactly as it would have on the whole line
        const stretch = line.slice(0, nextInlineMatch(this, eat.now().offset, line));
        // A speed-up with no change to the reading. The stock reader
        // passes every stretch to a decoder (the parse-entities package)
        // that turns character references such as "&amp;" into the
        // character they stand for. The decoder walks the stretch one
        // character at a time and builds a copy of it as it goes, which was
        // about a quarter of a long note's parse (the speed brief,
        // 2026-10-05). Every character reference starts with "&", and with
        // none in the stretch the decoder hands back the stretch unchanged
        // as one piece of text, so that one piece is made here directly.
        if (plainTextAsIs && stretch !== "" && !stretch.includes("&")) {
            eat(stretch)({ type: "text", value: stretch });
            return undefined;
        }
        return stockText.call(this, eat, stretch, silent);
    };
}

/**
 * Where on `line` (which starts at offset `start` in the note) the next
 * inline reader could match, counted from the line's second character, as
 * remark-parse's text reader asks it; the line's length when none can.
 *
 * A speed-up with no change to the reading. The text reader asks every
 * inline reader this question at the start of every stretch of plain text,
 * and a reader whose mark does not come again on the line (a "~~", a
 * "%%", a "<") searched the rest of the line each time. On one long line
 * with many short stretches (a line of 8,000 prices, "$5 or $6 and ...")
 * that took time growing with the line's length squared: 32,000 characters
 * took about two seconds (measured 2026-10-03, the runtime swap, step 2).
 * So each reader's answer is remembered. It holds for any later question on
 * the same line asked from a point no further on than the match (nothing
 * matched between), and for every later question when there was no match
 * at all. Every reader looks for its mark at or after the point it is
 * asked from, so the remembered answer is the one it would give.
 */
function nextInlineMatch(state: ParserState, start: number, line: string): number {
    const memo = (state.locatorMemo ??= new Map<string, LocatorAnswer>());
    const from = start + 1;
    const end = start + line.length;
    let min = line.length;
    for (const name of state.inlineMethods) {
        // a method may be listed with no reader behind it (remark-parse
        // lists some its options switch off), as the stock text reader knows
        const reader = state.inlineTokenizers[name] as Tokenizer | undefined;
        const locator = name === "text" ? undefined : reader?.locator;
        if (locator === undefined) continue;
        let known = memo.get(name);
        if (known === undefined || known.end !== end || known.from > from || (known.at !== -1 && known.at < from)) {
            const position = locator.call(state, line, 1);
            known = { from, end, at: position === -1 ? -1 : start + position };
            memo.set(name, known);
        }
        if (known.at !== -1 && known.at - start < min) min = known.at - start;
    }
    return min;
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
 *
 * With `speedUps` set (always, outside one test), the parser also runs the
 * two speed-ups of the speed brief of 2026-10-05, which change how fast a
 * note is read and nothing about the reading: the vendored tokenizer loop
 * (remark-parse-tokenizer.js) and plain text taken as it stands
 * (textLineByLine). test/tokenizer-differential.test.ts builds the parser
 * without them too, and checks that both read every saved note alike.
 */
function buildParser(speedUps: boolean): ParserConstructor {
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

    linkDefinitionsAtTheEnd(tables);
    percentComments(tables);
    calloutTitles(tables);
    listLazyLines(tables);
    tablePipeStyles(tables);
    htmlBlockPrecheck(tables);
    textLineByLine(tables, speedUps);
    wikilinks(tables);
    frontmatter(tables);
    doubleDollarMath(tables);
    mathWithoutRescans(tables);
    if (speedUps) {
        tables.tokenizeBlock = tokenizerLoop("block");
        tables.tokenizeInline = tokenizerLoop("inline");
    }
    return ObsidianParser;
}

/** The parser class with the speed-ups and the one without, each built when first needed. */
const parserClasses = new Map<boolean, ParserConstructor>();

/** The note with Windows line breaks turned into "\n", the text every offset in the tree refers to. */
export function normalizeLineBreaks(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

/**
 * Where the note's frontmatter ends: the offset just past the three dashes
 * of its closing line, or 0 when the note has none (rule D2, as the
 * frontmatter reader above reads it). `doc` is the whole note, with its line
 * breaks normalized.
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
 * indentation. remark-parse keeps this count per line (its "offset" table)
 * to place the text of nested blocks, so it is exactly where the line's
 * text starts inside its containers. Lines count from 1, as remark-parse
 * counts them, and a line no container touched is missing.
 *
 * `readsPastEnd` says whether a link definition at the top level would
 * read differently with more text after the end (linkDefinitionsAtTheEnd),
 * which matters only to a part of a note.
 *
 * `speedUps` is false only in the test that checks the speed-ups change
 * nothing (see buildParser).
 */
export function parseObsidianNote(
    text: string,
    startsNote = true,
    speedUps = true,
): { tree: MarkdownNode; containerColumns: Readonly<Record<number, number>>; readsPastEnd: boolean } {
    let parserClass = parserClasses.get(speedUps);
    if (parserClass === undefined) {
        parserClass = buildParser(speedUps);
        parserClasses.set(speedUps, parserClass);
    }
    const doc = normalizeLineBreaks(text);
    const input: ParseInput = {
        toString: () => doc,
        // remark-parse reports oddities such as unknown character references
        // here; they change nothing in the tree
        message: () => undefined,
        fail: (error) => {
            throw error;
        },
        startsNote,
    };
    const parser = new parserClass(doc, input);
    const tree = parser.parse();
    return { tree, containerColumns: parser.offset, readsPastEnd: input.readsPastEnd === true };
}
