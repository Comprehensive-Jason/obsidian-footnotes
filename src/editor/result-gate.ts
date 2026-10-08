// The result gate: the one check every edit passes after it is worked out
// and before it is written (ADR 0003, Jason, 2026-10-07). It takes the note
// before the edit, the note after it, and what the action meant to change
// (its intent), reads the note after with the note reading, and passes the
// edit only when the note reads the same as before except for what the
// action meant to change. Six things are compared:
//
// 1. Untouched footnotes read the same: every footnote the action did not
//    mean to change keeps its definition's text and its live references,
//    wherever they now sit, so the lint's moves still pass.
// 2. No footnote ends up inside a footnote that was not there before (ADR
//    0001).
// 3. Protected text reads the same, word for word: code, math, comments,
//    and frontmatter.
// 4. Links, images, and embeds are still drawn as before.
// 5. Lines outside the edit keep their block shape (paragraph, heading,
//    list item, quote, table), and the edited lines keep their containers.
// 6. What the action meant to create is live: a new footnote really is a
//    footnote.
//
// The gate decides only whether a result is acceptable, never where a
// footnote lands; that stays with the landing rules. It knows nothing
// about any command or lint rule: each caller says what it meant in the
// domain's own terms (EditIntent), and the gate judges the result.
//
// While the old shape-by-shape checks still decide (stage 2 of the build,
// "shadow mode"), every write path also hands its edit to shadowGate at
// the bottom of this file, which judges it only when a test has installed
// a recorder, so users pay nothing for it.

import { lineKey, unmatchedRuns } from "./document-diff";
import { labelShapedLines } from "../parsing/label-shapes";
import { drawnLinkShapes } from "../parsing/landing";
import { Definition, NoteReading, readNote } from "../parsing/note-reading";

/** A place in a note: a line and a column, both counted from 0. */
export interface NotePosition {
    line: number;
    ch: number;
}

/** A stretch of a note, from `from` up to (not including) `to`. */
export interface NoteRange {
    from: NotePosition;
    to: NotePosition;
}

/**
 * One footnote an action means to create, as it should read in the note
 * after the edit:
 *
 * - "footnote": a footnote called `name`, with a new reference at each of
 *   `references` and, when `definition` is given, a new definition whose
 *   label is on line `definition.line`, written as `definition.lines`
 *   lines. A press that only adds the definition for a reference already
 *   in the note gives no references.
 * - "placeholder": the empty reference `text` ("[^]", or "[^2.]" with a
 *   prefix) at each of `at`, waiting for a name to be typed into it.
 * - "inline": the inline footnote `text` ("^[...]") at each of `at`.
 */
export type CreatedFootnote =
    | { kind: "footnote"; name: string; references: readonly NotePosition[]; definition?: { line: number; lines: number } }
    | { kind: "placeholder"; text: string; at: readonly NotePosition[] }
    | { kind: "inline"; text: string; at: readonly NotePosition[] };

/**
 * What an action meant to change. Everything it leaves out, the note must
 * read the same without. Names are compared without regard to case, as
 * footnote names are.
 */
export interface EditIntent {
    /** The footnotes the action creates. */
    created?: readonly CreatedFootnote[];
    /** The footnotes the action renames, from the old name to the new one (a rename, the lint's prefix and reindex). */
    renamed?: ReadonlyMap<string, string>;
    /** The footnotes the action takes out: their definitions and references may go (a delete, the orphan rules). */
    removed?: readonly string[];
    /** The footnotes whose definition text the action rewrites (the popup's save-back, a merge of duplicates). Their references must stay. */
    rewritten?: readonly string[];
    /** The footnotes whose definition the action makes out of text already in the note, a lazy label given its blank line (fix-lazy). */
    defined?: readonly string[];
    /** How many inline footnotes the action creates without saying where (Convert normal to inline). */
    inlineCreated?: number;
    /** How many inline footnotes the action takes out (Convert inline to normal). */
    inlineRemoved?: number;
    /** Text the action takes out of the note, as stretches of the note before (a cut, a paste over a selection). */
    removedText?: readonly NoteRange[];
    /** Text the action writes from outside the note, as stretches of the note after (a paste). */
    insertedText?: readonly NoteRange[];
}

/**
 * Why the gate refused an edit. Each reason has one notice (the design's
 * table): "nested" a footnote inside a footnote, "protected" protected
 * text, "link" a link, "formatting" a line's formatting, "dead" something
 * the action meant to create that would not be live, "other" anything
 * else.
 */
export type GateReason = "nested" | "protected" | "link" | "formatting" | "dead" | "other";

/** The gate's answer: pass, or refuse with a reason, the check that refused (1 to 6, as numbered at the top of this file), and the names or lines involved. */
export type GateVerdict = { pass: true } | { pass: false; reason: GateReason; check: number; detail: string };

const Pass: GateVerdict = { pass: true };

function refuse(reason: GateReason, check: number, detail: string): GateVerdict {
    return { pass: false, reason, check, detail };
}

const fold = (name: string): string => name.toLowerCase();

/** `text` cut short for a refusal's detail, with the masked twin's blotted characters shown as dots. */
function readable(text: string): string {
    return text.replace(/\0/g, "·").slice(0, 80);
}

/** Whether `a` comes before `b` in the note. */
function precedes(a: NotePosition, b: NotePosition): boolean {
    return a.line < b.line || (a.line === b.line && a.ch < b.ch);
}

/** Whether the place `line`, `ch` falls inside one of `ranges`. */
function inRanges(ranges: readonly NoteRange[], line: number, ch: number): boolean {
    const at = { line, ch };
    return ranges.some((range) => !precedes(at, range.from) && precedes(at, range.to));
}

/** Whether line `line` holds any part of one of `ranges`. */
function lineInRanges(ranges: readonly NoteRange[], line: number): boolean {
    return ranges.some((range) => range.from.line <= line && line <= range.to.line && precedes(range.from, range.to));
}

/** How many times each entry is in `items`. */
function counted(items: Iterable<string>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return counts;
}

/** The first entry `a` holds more often than `b`, or null when there is none. */
function surplus(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): string | null {
    for (const [item, n] of a) if (n > (b.get(item) ?? 0)) return item;
    return null;
}

/**
 * One side of the edit, read: the lines, their reading, and which of its
 * text is the action's own, so the checks leave it out. On the side before
 * the edit that is the text the action takes out and the definitions it
 * removes or rewrites; on the side after it, the text it writes in and the
 * definitions it rewrites.
 */
interface Side {
    lines: readonly string[];
    reading: NoteReading;
    /** where each line starts in the reading's text, for turning a protected span's offsets into lines and columns */
    starts: number[];
    /** the stretches of text the action owns on this side */
    ranges: readonly NoteRange[];
    /** the definitions the action owns on this side, by line */
    ownDefinitionLine: boolean[];
    /** a name as this side writes it, mapped to the name the other side gives it (the renames), in lower case */
    map: (name: string) => string;
}

/** Whether column `ch` of line `line` is text the action owns on `side`. */
function owned(side: Side, line: number, ch: number): boolean {
    return side.ownDefinitionLine[line] || inRanges(side.ranges, line, ch);
}

function sideOf(lines: readonly string[], ranges: readonly NoteRange[], ownNames: ReadonlySet<string>, map: (name: string) => string): Side {
    const reading = readNote(lines);
    const starts: number[] = [];
    let offset = 0;
    // the reading drops a "\r" at the end of a line (cleanLine in note-reading.ts)
    for (const line of lines) {
        starts.push(offset);
        offset += line.replace(/\r$/, "").length + 1;
    }
    const ownDefinitionLine: boolean[] = [];
    for (const definition of reading.definitions) {
        if (!ownNames.has(fold(definition.name))) continue;
        for (let line = definition.start; line <= definition.end; line++) ownDefinitionLine[line] = true;
    }
    return { lines, reading, starts, ranges, ownDefinitionLine, map };
}

/**
 * Line `i` with the name of every live reference and every definition label
 * on it written as `side.map` gives it, in lower case: so a line whose
 * footnotes were only renamed reads the same on both sides.
 */
function namesMapped(side: Side, i: number): string {
    const line = side.lines[i] ?? "";
    const marks = [...side.reading.referencesOn(i), ...side.reading.labelsOn(i)].sort((a, b) => a.start - b.start);
    if (marks.length === 0) return line;
    let out = "";
    let at = 0;
    for (const mark of marks) {
        if (mark.start < at) continue;
        out += `${line.slice(at, mark.start)}[^${side.map(fold(mark.name))}]`;
        at = mark.end;
    }
    return out + line.slice(at);
}

/** A definition as check 1 compares it: its container and its lines, names mapped. */
function definitionKey(side: Side, definition: Definition): string {
    const { quotes, listItems, footnotes } = definition.container;
    const lines: string[] = [];
    for (let i = definition.start; i <= definition.end; i++) lines.push(namesMapped(side, i));
    return [quotes, listItems, footnotes, ...lines].join("\n");
}

/** The protected spans check 3 compares; a link's address, a wikilink's target, and an image's alt text belong to the links, check 4. */
const ProtectedKinds = new Set(["code", "math", "html", "htmlComment", "percentComment", "frontmatter", "inlineCode", "inlineMath"]);

/**
 * The text of every protected span on `side` the action does not own,
 * each as its kind and its text, for check 3. The kinds are the protected
 * text of CONTEXT.md: code, math, comments, frontmatter, and HTML. Blank
 * lines inside a span do not count, and nor do spaces at the end of a line:
 * the reading counts the blank line under a definition that ends in a "%%"
 * line as part of that comment only when lines follow it, which changes
 * nothing a reader sees (pin bug-protected-text-alike-blank-lines). A "%%"
 * comment's references are live and are renamed and cut like any other, so
 * they are left out of its text.
 */
function protectedTexts(side: Side): string[] {
    const texts: string[] = [];
    for (const span of side.reading.protectedSpans) {
        if (!ProtectedKinds.has(span.kind)) continue;
        const startCh = span.from - (side.starts[span.startLine] ?? 0);
        if (owned(side, span.startLine, startCh)) continue;
        const parts: string[] = [];
        for (let line = span.startLine; line <= span.endLine && line < side.lines.length; line++) {
            const text = side.lines[line].replace(/\r$/, "");
            const from = line === span.startLine ? startCh : 0;
            const to = line === span.endLine ? span.to - (side.starts[line] ?? 0) : text.length;
            parts.push(text.slice(from, to));
        }
        let text = parts.map((part) => part.trimEnd()).filter((part) => part.trim() !== "").join("\n");
        if (span.kind === "percentComment") text = text.replace(/\[\^[^\]\s]*\]/g, "");
        texts.push(`${span.kind}:${text}`);
    }
    return texts;
}

/**
 * Every link `side` draws that the action does not own, by its shape
 * (drawnLinkShapes), and every link reference definition "[ref]: url", for
 * check 4. A footnote reference inside a link's text is left out of its
 * shape, so a renamed one does not count as a changed link.
 */
function linkShapes(side: Side): string[] {
    const shapes = drawnLinkShapes(side.reading, side.reading.linkLabels, (link) => !owned(side, link.startLine, link.start)).map((shape) =>
        shape.replace(/\[\^[^\]\s]*\]/g, ""),
    );
    side.reading.lineBlocks.forEach((blocks, line) => {
        if (/(?:^| )\^definition(?: |$)/.test(blocks) && !owned(side, line, 0)) shapes.push("a link reference definition");
    });
    return shapes;
}

/** The containers in a line's blocks (quotes, lists and their items, footnote definitions), with the marks where each starts. */
function containersOf(blocks: string): string {
    return blocks
        .split(" ")
        .filter((kind) => /^\^?(?:blockquote|list|list\.ordered|listItem|footnoteDefinition)$/.test(kind))
        .join(" ");
}

/** A line's blocks with the definition around it and every start mark taken out: how a line reads once a lazy label's paragraph is a definition. */
function withoutDefinition(blocks: string): string {
    return blocks
        .split(" ")
        .filter((kind) => !/^\^?footnoteDefinition$/.test(kind) && kind !== "")
        .map((kind) => kind.replace(/^\^/, ""))
        .join(" ");
}

/** Whether line `i` holds nothing a reader sees: blank, and no part of protected text. */
function blankLine(side: Side, i: number): boolean {
    return (side.lines[i] ?? "").trim() === "" && !side.reading.protectedLines[i];
}

/**
 * Check 6: the reference `text` the action wrote at `at` reads, in `after`,
 * as the reference `name`, and as no definition's label. Returns the reason
 * it does not, or null when it does.
 */
function referenceVerdict(after: NoteReading, lines: readonly string[], at: NotePosition, name: string, text: string): GateReason | null {
    const live = after.referencesOn(at.line).some((reference) => reference.start === at.ch && fold(reference.name) === fold(name));
    // A reference followed by ":" can be a definition's label: one the
    // reading finds, or a lazy label, which the lint's fix-lazy would make
    // a definition (pins bug-colon-line-start-label and
    // spec-colon-line-start-notice).
    if ((lines[at.line] ?? "")[at.ch + text.length] === ":") {
        if (after.labelsOn(at.line).some((label) => label.start === at.ch)) return "formatting";
        const lead = (lines[at.line] ?? "").slice(after.containerEnd(at.line), at.ch);
        if (/^ *$/.test(lead) && labelShapedLines([...lines]).some((label) => label.line === at.line)) return "formatting";
    }
    if (!live) return deadReason(after, at);
    return after.definitionAt(at.line) !== null ? "nested" : null;
}

/** Why something written at `at` is not live in `after`: a link took it in, protected text did, or something else. */
function deadReason(after: NoteReading, at: NotePosition): GateReason {
    if (after.insideLink(at.line, at.ch)) return "link";
    return after.maskedLine(at.line)[at.ch] === "\0" || after.protectedLines[at.line] ? "protected" : "dead";
}

/** Check 6 for every footnote the action meant to create. */
function createdVerdict(after: Side, created: readonly CreatedFootnote[]): GateVerdict {
    const reading = after.reading;
    for (const footnote of created) {
        if (footnote.kind === "footnote") {
            for (const at of footnote.references) {
                const reason = referenceVerdict(reading, after.lines, at, footnote.name, `[^${footnote.name}]`);
                if (reason !== null) return refuse(reason, 6, `the reference [^${footnote.name}] on line ${String(at.line)}`);
            }
            const wanted = footnote.definition;
            if (wanted) {
                const label = reading.labelOn(wanted.line);
                const live = label !== null && fold(label.name) === fold(footnote.name) && label.movable && label.end >= wanted.line + wanted.lines - 1;
                if (!live) {
                    const hidden = reading.protectedLines[wanted.line] || reading.commentLines[wanted.line];
                    return refuse(hidden ? "protected" : "dead", 6, `the definition [^${footnote.name}]: on line ${String(wanted.line)}`);
                }
            }
        } else if (footnote.kind === "placeholder") {
            // An empty "[^]" reads as nothing until a name is typed into it,
            // so the note is read with a name typed into every one.
            const probe = "gateprobe";
            const lines = [...after.lines];
            const shifted: NotePosition[] = [];
            const byLine = [...footnote.at].sort((a, b) => a.line - b.line || a.ch - b.ch);
            let shift = 0;
            byLine.forEach((at, k) => {
                if (k > 0 && byLine[k - 1].line !== at.line) shift = 0;
                shifted.push({ line: at.line, ch: at.ch + shift });
                shift += probe.length;
            });
            for (let k = shifted.length - 1; k >= 0; k--) {
                const at = shifted[k];
                const line = lines[at.line] ?? "";
                lines[at.line] = line.slice(0, at.ch) + footnote.text.slice(0, -1) + probe + line.slice(at.ch + footnote.text.length - 1);
            }
            const named = readNote(lines);
            const name = footnote.text.slice(2, -1) + probe;
            for (const at of shifted) {
                const reason = referenceVerdict(named, lines, at, name, `[^${name}]`);
                if (reason !== null) return refuse(reason, 6, `the placeholder ${footnote.text} on line ${String(at.line)}`);
            }
        } else {
            for (const at of footnote.at) {
                const note = reading.inlineNoteAt(at.line, at.ch + 1);
                if (note === null || note.open !== at.ch || note.close !== at.ch + footnote.text.length - 1) {
                    return refuse(deadReason(reading, at), 6, `the inline footnote on line ${String(at.line)}`);
                }
                if (reading.definitionAt(at.line) !== null) return refuse("nested", 6, `the inline footnote on line ${String(at.line)}`);
            }
        }
    }
    return Pass;
}

/**
 * Check 2: every footnote that sits inside a definition, as a pair of the
 * definition's name and what sits in it (a reference's name, "^" for an
 * inline footnote, a definition's name after "def:").
 */
function nestingPairs(side: Side, skip: (line: number, ch: number) => boolean, outerSkipped: ReadonlySet<string>): string[] {
    const reading = side.reading;
    const pairs: string[] = [];
    const outer = (line: number): Definition | null => reading.definitionAt(line);
    const add = (holder: Definition | null, what: string) => {
        if (holder === null || outerSkipped.has(fold(holder.name))) return;
        pairs.push(`${side.map(fold(holder.name))}>${what}`);
    };
    for (const reference of reading.references) {
        if (!reference.live || skip(reference.line, reference.start)) continue;
        add(outer(reference.line), side.map(fold(reference.name)));
    }
    for (const note of reading.inlineNotes) {
        if (skip(note.line, note.open)) continue;
        add(outer(note.line), "^");
    }
    for (const definition of reading.definitions) {
        if (definition.container.footnotes === 0 || skip(definition.start, definition.labelStart)) continue;
        // the definition around this one: the last one before it that runs over its label line
        const holder = [...reading.definitions].reverse().find((other) => other !== definition && other.start <= definition.start && other.end >= definition.start) ?? null;
        add(holder, `def:${side.map(fold(definition.name))}`);
    }
    return pairs;
}

/**
 * Judges the edit that turns the note `beforeLines` into `afterLines`, an
 * action meaning `intent`: pass, or refuse with the reason (see the top of
 * this file for the six checks, in the order they are run here: what the
 * action meant to create, nesting, protected text, links, block shape, and
 * the untouched footnotes).
 */
export function judgeEdit(beforeLines: readonly string[], afterLines: readonly string[], intent: EditIntent): GateVerdict {
    const renamed = new Map<string, string>();
    for (const [from, to] of intent.renamed ?? []) renamed.set(fold(from), fold(to));
    const removed = new Set((intent.removed ?? []).map(fold));
    const rewritten = new Set((intent.rewritten ?? []).map(fold));
    const defined = new Set((intent.defined ?? []).map(fold));
    const created = intent.created ?? [];
    // a placeholder with a prefix, "[^2.]", already reads as a reference
    // to "2.", the name the user is still typing
    const createdNames = new Set(
        created.flatMap((footnote) => (footnote.kind === "footnote" ? [fold(footnote.name)] : footnote.kind === "placeholder" ? [fold(footnote.text.slice(2, -1))] : [])),
    );
    const oldSide = sideOf(beforeLines, intent.removedText ?? [], new Set([...removed, ...rewritten]), (name) => renamed.get(name) ?? name);
    const newSide = sideOf(afterLines, intent.insertedText ?? [], rewritten, (name) => name);

    // 6. what the action meant to create is live
    const made = createdVerdict(newSide, created);
    if (!made.pass) return made;

    // 2. no footnote inside a footnote that was not there before. A lazy
    // label's paragraph that becomes its definition (fix-lazy) holds what
    // it held, as the user wrote it.
    const outerBefore = nestingPairs(oldSide, (line, ch) => owned(oldSide, line, ch) && !rewritten.has(fold(oldSide.reading.definitionAt(line)?.name ?? "")), new Set());
    const outerAfter = nestingPairs(newSide, () => false, defined);
    const nested = surplus(counted(outerAfter), counted(outerBefore));
    if (nested !== null) return refuse("nested", 2, nested);

    // 3. protected text reads the same
    const hidden = surplus(counted(protectedTexts(oldSide)), counted(protectedTexts(newSide))) ?? surplus(counted(protectedTexts(newSide)), counted(protectedTexts(oldSide)));
    if (hidden !== null) return refuse("protected", 3, readable(hidden));

    // 4. links are drawn as before
    const linksBefore = counted(linkShapes(oldSide));
    const linksAfter = counted(linkShapes(newSide));
    const link = surplus(linksBefore, linksAfter) ?? surplus(linksAfter, linksBefore);
    if (link !== null) return refuse("link", 4, readable(link));

    // 5. block shape
    const shape = blockShapeVerdict(oldSide, newSide, created, defined);
    if (!shape.pass) return shape;

    // 1. untouched footnotes read the same
    return untouchedVerdict(oldSide, newSide, intent, { removed, rewritten, defined, createdNames });
}

/**
 * Check 5. The lines that belong to no definition (the body) are lined up,
 * before and after, by their text without footnotes (lineKey, the lint's
 * own line-up), so a line whose footnotes alone changed is lined up with
 * itself. Definitions are left out: check 1 compares them wherever they
 * sit, so the lint's moves change no body line. Two kinds of definition
 * lines stay in the line-up: the lines a lazy label's new definition takes
 * over (fix-lazy), which must read as they did apart from the definition
 * around them, and any line a new definition takes in beyond the lines the
 * action wrote for it.
 *
 * Every line lined up with one before must read exactly as it did: the
 * same blocks around it and starting on it. A stretch that does not line
 * up is the edit itself: where it has as many lines as it replaces, each
 * keeps its blocks; otherwise its first line does. Where the stretch holds
 * text the action takes out or writes in (a cut, a paste), only the first
 * line's containers are compared, since the rest is the user's own text.
 */
function blockShapeVerdict(oldSide: Side, newSide: Side, created: readonly CreatedFootnote[], defined: ReadonlySet<string>): GateVerdict {
    const oldBody: number[] = [];
    const inOldDefinition: boolean[] = [];
    for (const definition of oldSide.reading.definitions) for (let i = definition.start; i <= definition.end; i++) inOldDefinition[i] = true;
    for (let i = 0; i < oldSide.lines.length; i++) if (!inOldDefinition[i]) oldBody.push(i);

    // the definitions a lazy label's paragraph became: those of a defined
    // name that read like no definition before
    const oldKeys = counted(oldSide.reading.definitions.filter((definition) => defined.has(fold(definition.name))).map((definition) => definitionKey(oldSide, definition)));
    const lenient: boolean[] = [];
    const excluded: boolean[] = [];
    const writtenFor = new Map<number, number>();
    for (const footnote of created) if (footnote.kind === "footnote" && footnote.definition) writtenFor.set(footnote.definition.line, footnote.definition.lines);
    for (const definition of newSide.reading.definitions) {
        if (defined.has(fold(definition.name))) {
            const key = definitionKey(newSide, definition);
            const left = oldKeys.get(key) ?? 0;
            if (left === 0) {
                for (let i = definition.start; i <= definition.end; i++) lenient[i] = true;
                continue;
            }
            oldKeys.set(key, left - 1);
        }
        const written = writtenFor.get(definition.start);
        const last = written === undefined ? definition.end : Math.min(definition.end, definition.start + written - 1);
        for (let i = definition.start; i <= last; i++) excluded[i] = true;
    }
    const newBody: number[] = [];
    for (let i = 0; i < newSide.lines.length; i++) if (!excluded[i] || lenient[i]) newBody.push(i);

    const readsAlike = (i: number, j: number): boolean => {
        if (blankLine(oldSide, i) && blankLine(newSide, j)) return true;
        const was = oldSide.reading.lineBlocks[i] ?? "";
        const is = newSide.reading.lineBlocks[j] ?? "";
        return lenient[j] ? withoutDefinition(was) === withoutDefinition(is) : was === is;
    };
    const formatting = (j: number) => refuse("formatting", 5, `line ${String(j)}: ${(newSide.lines[j] ?? "").slice(0, 60)}`);

    // lines that match at the start and the end, as they are
    let head = 0;
    while (head < oldBody.length && head < newBody.length && oldSide.lines[oldBody[head]] === newSide.lines[newBody[head]]) {
        if (!readsAlike(oldBody[head], newBody[head])) return formatting(newBody[head]);
        head++;
    }
    let oldTail = oldBody.length;
    let newTail = newBody.length;
    while (oldTail > head && newTail > head && oldSide.lines[oldBody[oldTail - 1]] === newSide.lines[newBody[newTail - 1]]) {
        oldTail--;
        newTail--;
        if (!readsAlike(oldBody[oldTail], newBody[newTail])) return formatting(newBody[newTail]);
    }
    const oldMiddle = oldBody.slice(head, oldTail);
    const newMiddle = newBody.slice(head, newTail);
    const runs = unmatchedRuns(
        oldMiddle.map((i) => lineKey(oldSide.lines[i])),
        newMiddle.map((j) => lineKey(newSide.lines[j])),
    );
    let i = 0;
    let j = 0;
    for (const run of [...runs, { aStart: oldMiddle.length, aEnd: oldMiddle.length, bStart: newMiddle.length, bEnd: newMiddle.length }]) {
        for (; i < run.aStart; i++, j++) if (!readsAlike(oldMiddle[i], newMiddle[j])) return formatting(newMiddle[j]);
        const was = oldMiddle.slice(run.aStart, run.aEnd);
        const is = newMiddle.slice(run.bStart, run.bEnd);
        const usersText = was.some((line) => lineInRanges(oldSide.ranges, line)) || is.some((line) => lineInRanges(newSide.ranges, line));
        const pairs = usersText || was.length !== is.length ? Math.min(1, was.length, is.length) : was.length;
        for (let k = 0; k < pairs; k++) {
            if (blankLine(oldSide, was[k]) || blankLine(newSide, is[k]) || lenient[is[k]]) continue;
            const wasBlocks = oldSide.reading.lineBlocks[was[k]] ?? "";
            const isBlocks = newSide.reading.lineBlocks[is[k]] ?? "";
            if (usersText ? containersOf(wasBlocks) !== containersOf(isBlocks) : wasBlocks !== isBlocks) return formatting(is[k]);
        }
        i = run.aEnd;
        j = run.bEnd;
    }
    return Pass;
}

/**
 * Check 1: every footnote the action did not mean to change keeps its live
 * references (as many as before) and its definitions (each with its
 * container and its lines), wherever they now sit; a renamed footnote
 * keeps them under its new name. The inline footnotes are compared by
 * their text: as many as the action meant to take out may go, and as many
 * as it meant to create may come.
 */
function untouchedVerdict(
    oldSide: Side,
    newSide: Side,
    intent: EditIntent,
    names: { removed: ReadonlySet<string>; rewritten: ReadonlySet<string>; defined: ReadonlySet<string>; createdNames: ReadonlySet<string> },
): GateVerdict {
    const skipped = (name: string) => names.removed.has(name) || names.defined.has(name) || names.createdNames.has(name);
    const renamedTo = new Set([...(intent.renamed ?? new Map<string, string>()).values()].map(fold));
    const why = (name: string): GateVerdict => refuse(renamedTo.has(name) ? "dead" : "other", 1, `[^${name}]`);

    const references = (side: Side) => {
        const out: string[] = [];
        for (const reference of side.reading.references) {
            if (!reference.live || owned(side, reference.line, reference.start)) continue;
            out.push(side.map(fold(reference.name)));
        }
        return counted(out);
    };
    const referencesBefore = references(oldSide);
    const referencesAfter = references(newSide);
    for (const name of new Set([...referencesBefore.keys(), ...referencesAfter.keys()])) {
        if (skipped(name)) continue;
        if ((referencesBefore.get(name) ?? 0) !== (referencesAfter.get(name) ?? 0)) return why(name);
    }

    const definitions = (side: Side) => {
        const out = new Map<string, string[]>();
        for (const definition of side.reading.definitions) {
            const name = side.map(fold(definition.name));
            if (skipped(name) || names.rewritten.has(name) || owned(side, definition.start, definition.labelStart)) continue;
            out.set(name, [...(out.get(name) ?? []), definitionKey(side, definition)]);
        }
        return out;
    };
    const definitionsBefore = definitions(oldSide);
    const definitionsAfter = definitions(newSide);
    for (const name of new Set([...definitionsBefore.keys(), ...definitionsAfter.keys()])) {
        const was = counted(definitionsBefore.get(name) ?? []);
        const is = counted(definitionsAfter.get(name) ?? []);
        if (surplus(was, is) !== null || surplus(is, was) !== null) return why(name);
    }

    const inlineTexts = (side: Side) => {
        const out: string[] = [];
        for (const note of side.reading.inlineNotes) {
            if (owned(side, note.line, note.open)) continue;
            const lines = side.lines.slice(note.line, note.closeLine + 1);
            out.push(lines.length === 1 ? lines[0].slice(note.open, note.close + 1) : [lines[0].slice(note.open), ...lines.slice(1, -1), lines[lines.length - 1].slice(0, note.close + 1)].join("\n"));
        }
        return counted(out);
    };
    const inlineBefore = inlineTexts(oldSide);
    const inlineAfter = inlineTexts(newSide);
    let gone = 0;
    let come = 0;
    for (const [text, n] of inlineBefore) gone += Math.max(0, n - (inlineAfter.get(text) ?? 0));
    for (const [text, n] of inlineAfter) come += Math.max(0, n - (inlineBefore.get(text) ?? 0));
    const createdInline = (intent.created ?? []).reduce((n, footnote) => n + (footnote.kind === "inline" ? footnote.at.length : 0), 0) + (intent.inlineCreated ?? 0);
    if (gone > (intent.inlineRemoved ?? 0) || come > createdInline) return refuse("other", 1, "an inline footnote");
    return Pass;
}
