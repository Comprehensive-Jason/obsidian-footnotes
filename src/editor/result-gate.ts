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
// It reads the note after the edit once, as the note reading always does,
// and looks only at the stretches of lines the edit can have changed the
// reading of (editWindows), so a press on a long note costs it little more
// than one on a short note.
//
// Every write path asks it before it writes, and refuses with the notice
// for the reason it gives (stage 3 of the build, 2026-10-08); the lint's
// rules ask through rule-gate.ts. It replaced about twenty checks that
// each judged one command's results, and the shadow mode in which it ran
// beside them (stage 2, 2026-10-07) went with them.

import { lineKey, unmatchedRuns } from "./document-diff";
import { tableRowCellSpans } from "./table-cursor";
import { escapedAt } from "../parsing/footnote-grammar";
import { labelShapedLines, lazyDefinitionLabelLines } from "../parsing/label-shapes";
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
 * - "inline": the inline footnote `text` ("^[...]") at each of `at`;
 *   `fromOutside` when its text comes from outside the note (the paste
 *   key's clipboard) rather than from the note (a selection).
 */
export type CreatedFootnote =
    | { kind: "footnote"; name: string; references: readonly NotePosition[]; definition?: { line: number; lines: number } }
    | { kind: "placeholder"; text: string; at: readonly NotePosition[] }
    | { kind: "inline"; text: string; at: readonly NotePosition[]; fromOutside?: boolean };

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
    /** The footnotes whose definition text the action rewrites (the popup's save-back). Their references must stay. */
    rewritten?: readonly string[];
    /** The footnotes whose copies the action folds into one (the lint's merge of duplicates): their definitions may read differently, but the text each copy held, its code and math, its links, and its tables and lists, must still be there. */
    merged?: readonly string[];
    /** The footnotes whose definition the action makes out of text already in the note, a lazy label given its blank line (fix-lazy). */
    defined?: readonly string[];
    /** Whether the action moves references and inline footnotes along their lines, past the punctuation next to them (the lint's punctuation rule): a definition whose text changed only so still reads the same. */
    footnotesMoved?: boolean;
    /** The footnotes the action turns into inline footnotes (Convert normal to inline): their definitions go, and their text moves into an inline footnote where each reference was. */
    inlined?: readonly string[];
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
 * removes or rewrites; on the side after it, the text it writes in from
 * outside, the definitions it rewrites, and any copy left of one it
 * removes.
 */
interface Side {
    lines: readonly string[];
    reading: NoteReading;
    /** where each line starts in the reading's text, for turning a protected span's offsets into lines and columns (lineStart), filled in the first time it is asked for */
    starts: number[];
    /** the stretches of text the action owns on this side */
    ranges: readonly NoteRange[];
    /** the definitions the action owns on this side, by line */
    ownDefinitionLine: boolean[];
    /** a name as this side writes it, mapped to the name the other side gives it (the renames), in lower case */
    map: (name: string) => string;
    /** the names whose references the action takes out, in lower case */
    dropped: ReadonlySet<string>;
    /** whether the action moves footnotes along their lines (EditIntent.footnotesMoved) */
    footnotesMoved: boolean;
    /** the stretches of text that are the user's own, taken out or written in (a cut, a paste), for check 5 */
    usersText: readonly NoteRange[];
    /** whether the action renames or takes out any footnote, so lines are compared with their names mapped (namesMapped) */
    mapsNames: boolean;
    /** the stretches of lines the edit can have changed the reading of, each `from` up to (not including) `to`, in order (editWindows); the checks look at these alone */
    windows: { from: number; to: number }[];
}

/** Whether line `line` of `side` is in one of the stretches the checks look at (Side.windows). */
function inWindow(side: Side, line: number): boolean {
    let low = 0;
    let high = side.windows.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const window = side.windows[mid];
        if (line < window.from) high = mid - 1;
        else if (line >= window.to) low = mid + 1;
        else return true;
    }
    return false;
}

/** Whether lines `start` to `end` of `side` take in any line of the stretches the checks look at. */
function overlapsWindow(side: Side, start: number, end: number): boolean {
    let low = 0;
    let high = side.windows.length - 1;
    // the first stretch that ends after `start`
    while (low < high) {
        const mid = (low + high) >> 1;
        if (side.windows[mid].to > start) high = mid;
        else low = mid + 1;
    }
    const window = side.windows[low] as { from: number; to: number } | undefined;
    return window !== undefined && window.to > start && window.from <= end;
}

/** Every line of `side` in the stretches the checks look at, in order. */
function windowLines(side: Side): number[] {
    const out: number[] = [];
    for (const window of side.windows) for (let line = window.from; line < window.to; line++) out.push(line);
    return out;
}

/**
 * Whether a new top-level block starts on line `i` of `side`, or the line
 * is a blank line outside every block, or the note has ended there. The
 * note's reading from such a line on depends on nothing above it, apart
 * from the link reference definitions, which editWindows compares on their
 * own (the reason the note reading may parse a note in parts,
 * notePartFacts in note-reading.ts).
 */
function startsFresh(side: Side, i: number): boolean {
    if (i >= side.lines.length) return true;
    const blocks = side.reading.lineBlocks[i] ?? "";
    return blocks === "" || blocks.startsWith("^");
}

/** A stretch of lines that differ: lines aStart up to aEnd of the one note stand where lines bStart up to bEnd of the other do. */
interface ChangedRun {
    aStart: number;
    aEnd: number;
    bStart: number;
    bEnd: number;
}

/**
 * The stretches of lines that differ between `a` and `b` (ChangedRun).
 * Lines with text on them that belong to no definition (`anchorA` and
 * `anchorB` say which) are lined up first, by their text without footnotes
 * (lineKey), as check 5 lines up the body of the note; then, between two
 * body lines lined up with each other, the other lines with text, the
 * definitions' lines; and what still differs between two lines lined up is
 * a change. Blank lines are never lined up:
 * they read as nothing, and lined up with each other they paired the wrong
 * lines, so a line that changed how it reads was taken for a new one (a
 * "   ===" left under a deleted lazy label, which started a paragraph of
 * its own after the deletion and carried on the one above before it; pin
 * bug-delete-cuts-rule-under-lazy-label). And definitions move: lined up
 * before the body, the body lines a move took them past were taken for
 * lines taken out in one place and written in another.
 *
 * A body line whose footnotes alone changed is lined up with itself, as a
 * change of its own. Lined up by its whole text, it found no partner, and
 * the definition the lint moved past it was lined up instead; the line
 * then went into one stretch as a line taken out and into another as a
 * line written in, and check 5 compared it with nothing (two lists joined
 * around a moved definition; hunt 2026-10-08, cycle 6, pin
 * bug-gate-windows-trailing-line-break-joins-lists).
 */
function changedRuns(a: readonly string[], b: readonly string[], anchorA: (i: number) => boolean, anchorB: (j: number) => boolean): ChangedRun[] {
    const runs: ChangedRun[] = [];
    // the lines from `fromA` up to `toA` of `a` and from `fromB` up to
    // `toB` of `b`, lined up by the lines `useA` and `useB` allow, each
    // compared by `key`, and then, in each stretch between two lines lined
    // up, by `next` (or, with none left, taken as one change when the
    // stretches differ)
    type Level = readonly [(i: number) => boolean, (j: number) => boolean, (line: string) => string];
    const lineUp = (fromA: number, toA: number, fromB: number, toB: number, levels: readonly Level[]): void => {
        // compared in place: most stretches between two lined-up lines are
        // empty, and a press lines up every line of a long note
        if (toA - fromA === toB - fromB) {
            let k = 0;
            while (fromA + k < toA && a[fromA + k] === b[fromB + k]) k++;
            if (fromA + k === toA) return;
        }
        if (levels.length === 0) {
            runs.push({ aStart: fromA, aEnd: toA, bStart: fromB, bEnd: toB });
            return;
        }
        const [[useA, useB, key], ...next] = levels;
        const textA: number[] = [];
        const textB: number[] = [];
        for (let i = fromA; i < toA; i++) if (a[i].trim() !== "" && useA(i)) textA.push(i);
        for (let j = fromB; j < toB; j++) if (b[j].trim() !== "" && useB(j)) textB.push(j);
        let i = 0;
        let j = 0;
        let lastA = fromA - 1;
        let lastB = fromB - 1;
        const end = { aStart: textA.length, aEnd: textA.length, bStart: textB.length, bEnd: textB.length };
        for (const run of [...unmatchedRuns(textA.map((n) => key(a[n])), textB.map((n) => key(b[n]))), end]) {
            for (; i < run.aStart; i++, j++) {
                lineUp(lastA + 1, textA[i], lastB + 1, textB[j], next);
                // two lines lined up by their key whose text differs are a change
                if (a[textA[i]] !== b[textB[j]]) runs.push({ aStart: textA[i], aEnd: textA[i] + 1, bStart: textB[j], bEnd: textB[j] + 1 });
                lastA = textA[i];
                lastB = textB[j];
            }
            i = run.aEnd;
            j = run.bEnd;
        }
        lineUp(lastA + 1, toA, lastB + 1, toB, next);
    };
    lineUp(0, a.length, 0, b.length, [
        [anchorA, anchorB, lineKey],
        [() => true, () => true, (line) => line],
    ]);
    return runs;
}

/** Whether the checks look at the stretches the edit can have changed alone (editWindows); off only in the test that holds them to the whole note's verdict. */
let windowsOn = true;

/** Switches the stretches off (false) so the checks look at the whole note, or back on; for test/result-gate.test.ts, which holds the two to the same verdict. */
export function useEditWindows(on: boolean): void {
    windowsOn = on;
}

/**
 * The stretches of lines the edit can have changed the reading of, set on
 * both sides (Side.windows). The lines that differ are found by lining the
 * two notes up (changedRuns), and each stretch of them is widened,
 * on both sides at once, back and forth to lines where both notes read
 * afresh (startsFresh). Between two stretches, and before the first and
 * after the last, the notes then have the same lines, read from the same
 * fresh start, so they read the same there, and every check can look at
 * the stretches alone. An edit changes a few lines, a press two places
 * (the reference and the definition at the bottom), so a long note costs
 * the gate little more than a short one. A rename (`renamed`, from the old
 * name to the new one) changes the lines that hold its footnote, so those
 * are stretches too, even where a line reads the same, since a line the
 * rename passed over names the wrong footnote; a reindex of a long note
 * then looks at the lines holding a footnote, not the whole note (the
 * footnote that keeps a name a rename would take is judged apart, in
 * judgeEdit). Where the notes' link reference definitions differ, any
 * "[text]" in the note may read differently, and the stretch is the whole
 * note.
 */
function editWindows(oldSide: Side, newSide: Side, renamed: ReadonlyMap<string, string>): void {
    if (!windowsOn) return;
    // the lines holding a footnote called one of `names`: its live
    // references and its definitions' labels
    const holding = (side: Side, names: ReadonlySet<string>) => {
        const lines = new Set<number>();
        if (names.size === 0) return lines;
        for (const reference of side.reading.references) if (reference.live && names.has(fold(reference.name))) lines.add(reference.line);
        for (const definition of side.reading.definitions) if (names.has(fold(definition.name))) lines.add(definition.start);
        return lines;
    };
    // each such line is marked, differently on the two sides, so it never
    // lines up as unchanged
    const marked = (side: Side, names: ReadonlySet<string>, mark: string) => {
        const lines = holding(side, names);
        return lines.size === 0 ? side.lines : side.lines.map((line, i) => (lines.has(i) ? line + mark : line));
    };
    const a = marked(oldSide, new Set(renamed.keys()), "\u0000before");
    const b = marked(newSide, new Set(renamed.values()), "\u0000after");
    const labelsAlike = oldSide.reading.linkLabels.size === newSide.reading.linkLabels.size && [...oldSide.reading.linkLabels].every((label) => newSide.reading.linkLabels.has(label));
    if (!labelsAlike) {
        oldSide.windows = [{ from: 0, to: a.length }];
        newSide.windows = [{ from: 0, to: b.length }];
        return;
    }
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const runs = changedRuns(
        a.slice(head, a.length - tail),
        b.slice(head, b.length - tail),
        // the body: the lines that belong to no definition
        (i) => oldSide.reading.definitionAt(head + i) === null,
        (j) => newSide.reading.definitionAt(head + j) === null,
    );
    // The end of one note is no fresh start against a line of the other:
    // the lines above it can read differently with a line under them (a
    // "$$" line opens a math block only with a line after it; pin
    // bug-end-dollar-line-swallows-definition).
    const fresh = (i: number, j: number) => (i >= a.length) === (j >= b.length) && startsFresh(oldSide, i) && startsFresh(newSide, j);
    // Frontmatter is read only at the start of a note: a stretch that
    // starts there runs on past the frontmatter of either note, as the
    // note reading's first part does (notePartFacts in note-reading.ts).
    const frontmatterEnd = (side: Side) => {
        const span = side.reading.protectedSpans.find((protectedSpan) => protectedSpan.kind === "frontmatter");
        return span === undefined ? 0 : span.endLine + 1;
    };
    const oldFrontmatter = frontmatterEnd(oldSide);
    const newFrontmatter = frontmatterEnd(newSide);
    const oldWindows: { from: number; to: number }[] = [];
    const newWindows: { from: number; to: number }[] = [];
    let k = 0;
    while (k < runs.length) {
        let aFrom = head + runs[k].aStart;
        let bFrom = head + runs[k].bStart;
        let aTo = head + runs[k].aEnd;
        let bTo = head + runs[k].bEnd;
        k++;
        // back to a fresh start, not past the stretch before
        const floor = oldWindows.at(-1)?.to ?? 0;
        const newFloor = newWindows.at(-1)?.to ?? 0;
        while (aFrom > floor && bFrom > newFloor && !fresh(aFrom, bFrom)) {
            aFrom--;
            bFrom--;
        }
        // on to a fresh start; a stretch reached on the way is taken in
        for (;;) {
            const atStart = aFrom === 0 || bFrom === 0;
            while (
                aTo < a.length &&
                bTo < b.length &&
                (!fresh(aTo, bTo) || (atStart && (aTo < oldFrontmatter || bTo < newFrontmatter))) &&
                (k >= runs.length || aTo < head + runs[k].aStart)
            ) {
                aTo++;
                bTo++;
            }
            if (k < runs.length && aTo >= head + runs[k].aStart) {
                aTo = Math.max(aTo, head + runs[k].aEnd);
                bTo = Math.max(bTo, head + runs[k].bEnd);
                k++;
                continue;
            }
            break;
        }
        const last = oldWindows.at(-1);
        const lastNew = newWindows.at(-1);
        // a stretch that reaches the one before is one with it
        if (last !== undefined && lastNew !== undefined && (aFrom <= last.to || bFrom <= lastNew.to)) {
            last.to = aTo;
            lastNew.to = bTo;
        } else {
            oldWindows.push({ from: aFrom, to: aTo });
            newWindows.push({ from: bFrom, to: bTo });
        }
    }
    oldSide.windows = oldWindows;
    newSide.windows = newWindows;
}

/** Where line `line` of `side` starts in the reading's text. The reading drops a "\r" at the end of a line (cleanLine in note-reading.ts). */
function lineStart(side: Side, line: number): number {
    if (side.starts.length === 0) {
        let offset = 0;
        for (const text of side.lines) {
            side.starts.push(offset);
            offset += text.length + (text.endsWith("\r") ? 0 : 1);
        }
    }
    return side.starts[line] ?? 0;
}

/** Whether column `ch` of line `line` is text the action owns on `side`. */
function owned(side: Side, line: number, ch: number): boolean {
    return side.ownDefinitionLine[line] || inRanges(side.ranges, line, ch);
}

function sideOf(
    reading: NoteReading,
    lines: readonly string[],
    usersText: readonly NoteRange[],
    ranges: readonly NoteRange[],
    ownNames: ReadonlySet<string>,
    map: (name: string) => string,
    dropped: ReadonlySet<string>,
    footnotesMoved: boolean,
    mapsNames: boolean,
): Side {
    const ownDefinitionLine: boolean[] = [];
    for (const definition of reading.definitions) {
        if (!ownNames.has(fold(definition.name))) continue;
        for (let line = definition.start; line <= definition.end; line++) ownDefinitionLine[line] = true;
    }
    return { lines, reading, starts: [], ranges, ownDefinitionLine, map, dropped, footnotesMoved, usersText, mapsNames, windows: [{ from: 0, to: lines.length }] };
}

/**
 * Line `i` with the name of every live reference and every definition label
 * on it written as `side.map` gives it, in lower case, and every reference
 * the action takes out taken out: so a line whose footnotes were only
 * renamed, or lost a reference the action meant to take, reads the same on
 * both sides. With `withoutOwn`, the text the action owns on the line (the
 * user's own text, taken out or written in) is taken out too.
 */
function namesMapped(side: Side, i: number, withoutOwn = false): string {
    const line = side.lines[i] ?? "";
    const labels = side.reading.labelsOn(i);
    const references = side.reading.referencesOn(i);
    const own = withoutOwn ? ownSpans(side, i, line.length) : [];
    if (labels.length === 0 && references.length === 0 && own.length === 0) return line;
    const marks = [...references.map((mark) => ({ ...mark, label: false })), ...labels.map((mark) => ({ ...mark, label: true }))];
    const all = [...marks, ...own.map((span) => ({ ...span, name: "", label: false, own: true }))].sort((a, b) => a.start - b.start);
    let out = "";
    let at = 0;
    for (const mark of all) {
        if (mark.start < at) {
            // what an owned stretch takes in goes with it
            if ("own" in mark) at = Math.max(at, mark.end);
            continue;
        }
        out += line.slice(at, mark.start);
        if (!("own" in mark)) out += side.dropped.has(fold(mark.name)) && !mark.label ? "" : `[^${side.map(fold(mark.name))}]`;
        at = mark.end;
    }
    return out + line.slice(Math.min(at, line.length));
}

/** The stretches of line `i` (`length` long) the action owns on `side` (Side.ranges), each from `start` up to `end`, in order. */
function ownSpans(side: Side, i: number, length: number): { start: number; end: number }[] {
    return side.ranges
        .filter((range) => range.from.line <= i && i <= range.to.line && precedes(range.from, range.to))
        .map((range) => ({ start: range.from.line < i ? 0 : range.from.ch, end: range.to.line > i ? length : Math.min(range.to.ch, length) }))
        .filter((span) => span.end > span.start)
        .sort((a, b) => a.start - b.start);
}

/**
 * A definition as check 1 compares it: its container and its lines, names
 * mapped (namesMapped). Each line's indentation is kept, and every other run
 * of spaces counts as one, with none at the end: taking a reference out
 * closes up the space around it (cutOne in remove-orphaned-references.ts).
 * Text the user writes into a definition or takes out of it (a paste into
 * a footnote's text, a cut from it) is left out of its lines, and a line
 * that held only that text with it: the user's own text is theirs to
 * change, and a footnote it brings is judged as nesting (check 2).
 */
function definitionKey(side: Side, definition: Definition): string {
    const { quotes, listItems, footnotes } = definition.container;
    const lines: string[] = [];
    for (let i = definition.start; i <= definition.end; i++) {
        // a definition held inside this one is compared on its own
        if (i > definition.start && side.reading.definitionAt(i) !== definition) continue;
        // where the action moves footnotes along their lines, a line is
        // compared without them, as the lint's line-up compares it (lineKey);
        // the references are counted on their own (untouchedVerdict)
        if (side.footnotesMoved) {
            lines.push(lineKey(side.lines[i] ?? ""));
            continue;
        }
        const line = namesMapped(side, i, true);
        if (line.trim() === "" && (side.lines[i] ?? "").trim() !== "") continue;
        const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
        lines.push(indent + line.slice(indent.length).replace(/[ \t]+/g, " ").trimEnd());
    }
    // blank lines at the end belong to the definition only while something
    // follows them in it
    while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
    return [quotes, listItems, footnotes, ...lines].join("\n");
}

/** The protected spans check 3 compares; a link's address, a wikilink's target, and an image's alt text belong to the links, check 4. */
const ProtectedKinds = new Set(["code", "math", "html", "htmlComment", "percentComment", "frontmatter", "inlineCode", "inlineMath"]);

/**
 * The text of every protected span on `side` the action does not own,
 * each as its kind and its text, for check 3. The kinds are the protected
 * text of CONTEXT.md: code, math, comments, frontmatter, and HTML. Blank
 * lines inside a span do not count, and nor do the spaces at either end of
 * a line, which a definition's continuation indent adds when a merge folds
 * a copy into indented lines:
 * the reading counts the blank line under a definition that ends in a "%%"
 * line as part of that comment only when lines follow it, which changes
 * nothing a reader sees (pin bug-protected-text-alike-blank-lines). A "%%"
 * comment's text is live (Jason's ruling A1): a press may write a footnote
 * in it, and the lint renames and cuts its references, so its footnotes are
 * left out of its text.
 */
function protectedTexts(side: Side): string[] {
    const texts: string[] = [];
    for (const span of side.reading.protectedSpans) {
        if (!ProtectedKinds.has(span.kind) || !inWindow(side, span.startLine)) continue;
        const startCh = span.from - lineStart(side, span.startLine);
        if (owned(side, span.startLine, startCh)) continue;
        const parts: string[] = [];
        for (let line = span.startLine; line <= span.endLine && line < side.lines.length; line++) {
            const text = side.lines[line].replace(/\r$/, "");
            const from = line === span.startLine ? startCh : 0;
            const to = line === span.endLine ? span.to - lineStart(side, line) : text.length;
            parts.push(text.slice(from, to));
        }
        // a "%%" comment's text is live, so only where it runs is compared:
        // its lines without their footnotes, spaces closed up (lineKey)
        const kept = span.kind === "percentComment" ? parts.map(lineKey) : parts.map((part) => part.trim());
        const text = kept.filter((part) => part !== "").join("\n");
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
    const shapes = drawnLinkShapes(side.reading, side.reading.linkLabels, (link) => inWindow(side, link.startLine) && !owned(side, link.startLine, link.start)).map((shape) =>
        shape.replace(/\[\^[^\]\s]*\]/g, ""),
    );
    for (const line of windowLines(side)) {
        if (/(?:^| )\^definition(?: |$)/.test(side.reading.lineBlocks[line] ?? "") && !owned(side, line, 0)) shapes.push("a link reference definition");
    }
    return shapes;
}

/** The containers in a line's blocks (quotes, lists and their items, footnote definitions), with the marks where each starts. */
function containersOf(blocks: string): string {
    return blocks
        .split(" ")
        .filter((kind) => /^\^?(?:blockquote|list|list\.ordered|listItem|footnoteDefinition)$/.test(kind))
        .join(" ");
}

/**
 * Whether a line's blocks before an edit (`was`) and after it (`is`) are
 * the same kinds in the same containers. Where each block starts counts
 * too, except that a line that started a paragraph may carry on the one
 * above it: a line written into the blank line between two paragraphs
 * joins them, as Obsidian reads it (Jason's ruling B1, 2026-10-08;
 * docs/obsidian-reading-rules.md G1). A paragraph split in two is a line
 * read differently, and so are two lists that become one, or a table,
 * code, a list, a quote, or a heading that stops being one.
 *
 * Next to the user's own text, taken out or written in (`nextToUsersText`:
 * a cut, a paste), only the blocks count, not where each starts. Taking
 * out a list's first item leaves the next item to start the list, and an
 * item pasted above the first one starts the list in its place; the
 * editor does the same with or without the plugin (hunt 2026-10-08, cycle
 * 6, pins bug-cut-first-line-of-block-refused and
 * bug-paste-before-first-item-refused). A line that stops being a list
 * item or a quote is still read differently: "2. second" under a pasted
 * paragraph joins that paragraph, since "2." cannot interrupt one
 * (docs/obsidian-reading-rules.md B5).
 */
function sameKind(was: string, is: string, nextToUsersText = false): boolean {
    const carriedOn = (blocks: string) => blocks.replace(/\^paragraph$/, "paragraph");
    const blocksAlone = (blocks: string) => blocks.replace(/\^/g, "");
    return was === is || carriedOn(was) === is || (nextToUsersText && blocksAlone(was) === blocksAlone(is));
}

/** The innermost of a line's blocks, its own kind, without the mark for where it starts. */
function ownKind(blocks: string): string {
    return (blocks.split(" ").pop() ?? "").replace(/^\^/, "");
}

/**
 * Whether the line `merged`, which an edit made of the lines `first` to
 * `last` (a selection across lines, replaced by its reference), still
 * holds text of `last`: it holds more than the start of `first`, and it
 * ends as `last` does. Each is compared by its text without footnotes
 * (lineKey). A selection that takes the whole of `last` leaves the start
 * of `first` alone.
 */
function holdsTextOfLast(first: string, last: string, merged: string): boolean {
    const [start, end, line] = [lineKey(first), lineKey(last), lineKey(merged)];
    let fromStart = 0;
    while (fromStart < line.length && line[fromStart] === start[fromStart]) fromStart++;
    return fromStart < line.length && end !== "" && line.endsWith(end[end.length - 1]);
}

/**
 * Whether a line of a lazy label's paragraph reads, once fix-lazy has made
 * the label a definition (`is`), as it did before (`was`): it carried on
 * the paragraph, and its own block, the innermost, is the same kind, start
 * marks aside. The containers are
 * not compared: a lazy line belongs to whatever held the paragraph above
 * it, and as the definition's text it belongs to what the user wrote in
 * front of it ("> > deep" over "> [^9]: x" takes the label into the inner
 * quote). Paragraph text that becomes a table is what the user meant, as
 * fix-lazy's own comment says; a line that starts a heading is not (hunt
 * 2026-10-06, cycle 5, pin bug-fix-lazy-makes-heading-of-next-label;
 * design, Q24; Jason's ruling B6, 2026-10-08).
 */
function lazyLineReadsAlike(was: string, is: string): boolean {
    // only a line that carried on the label's paragraph may become the
    // definition's text; one that started a block of its own must read as
    // it did (Jason's triage decision Q7, 2026-10-05)
    if (was.includes("^")) return false;
    return ownKind(was) === ownKind(is) || (ownKind(was) === "paragraph" && ownKind(is) === "table");
}

/** The lazy labels among the lines the checks look at on `side` (lazyDefinitionLabelLines), worked out the first time they are asked for. */
const lazyOf = new WeakMap<Side, ReadonlySet<number>>();
function lazyLines(side: Side): ReadonlySet<number> {
    let lazy = lazyOf.get(side);
    if (lazy === undefined) {
        lazy = new Set(side.windows.flatMap((window) => lazyDefinitionLabelLines(side.lines as string[], window, side.reading)));
        lazyOf.set(side, lazy);
    }
    return lazy;
}

/**
 * Whether line `i` holds nothing a reader sees: blank, and no part of a
 * code, math, or HTML block or the frontmatter, where a blank line is text
 * of the block (the blank lines NoteReading.protectedLines counts, read
 * off the line's own blocks, so a long note's every line need not be
 * looked at).
 */
function blankLine(side: Side, i: number): boolean {
    return (side.lines[i] ?? "").trim() === "" && !/(?:^| )\^?(?:code|math|html|yaml)(?: |$)/.test(side.reading.lineBlocks[i] ?? "");
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
        if (/^ *$/.test(lead) && labelShapedLines(lines as string[], { from: at.line, to: at.line + 1 }, after).length > 0) return "formatting";
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
            // written in from the right, so each one's place is still as it was
            for (let k = byLine.length - 1; k >= 0; k--) {
                const at = byLine[k];
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
 * Check 2: every footnote that sits inside another footnote, as a pair of
 * the one around it and what sits in it. The one around it is a
 * definition's name, or "^" for an inline footnote; what sits in it is a
 * reference's name, "^" for an inline footnote, "[^]" for an empty
 * placeholder (a footnote still being named), or "def:" and a
 * definition's name. `skipped` says which references to leave out (text
 * the action takes out), and `holders` turns the name of the footnote
 * around into the one the pair is written with (null to leave the pair
 * out).
 */
function nestingPairs(side: Side, skipped: (line: number, ch: number) => boolean, holders: (name: string) => string | null): string[] {
    const reading = side.reading;
    const pairs: string[] = [];
    const add = (holder: string, what: string) => {
        const around = holders(holder);
        if (around !== null) pairs.push(`${around}>${what}`);
    };
    const inside = (line: number, ch: number, what: string) => {
        const definition = reading.definitionAt(line);
        if (definition !== null) add(side.map(fold(definition.name)), what);
    };
    for (const reference of reading.references) {
        if (!inWindow(side, reference.line) || skipped(reference.line, reference.start)) continue;
        // a reference the reading finds but does not count as live sits
        // inside an inline footnote (rule E3), a footnote in a footnote too
        if (!reference.live) add("^", side.map(fold(reference.name)));
        else inside(reference.line, reference.start, side.map(fold(reference.name)));
    }
    const notes = reading.inlineNotes.filter((note) => inWindow(side, note.line));
    for (const note of notes) {
        if (skipped(note.line, note.open)) continue;
        inside(note.line, note.open, "^");
        // one inline footnote inside another
        const around = notes.some(
            (other) =>
                other !== note &&
                (other.line < note.line || (other.line === note.line && other.open < note.open)) &&
                (other.closeLine > note.closeLine || (other.closeLine === note.closeLine && other.close > note.close)),
        );
        if (around) add("^", "^");
    }
    // an empty placeholder is no reference to the reading, so it is found
    // on the masked twin, where protected text holds none, and an escaped
    // "\[^]" is prose about footnotes (selectionTouchesFootnote's rule)
    const definitions = reading.definitions.filter((definition) => inWindow(side, definition.start));
    for (const definition of definitions) {
        for (let line = definition.start; line <= definition.end; line++) {
            const masked = reading.maskedLine(line);
            for (let at = masked.indexOf("[^]"); at !== -1; at = masked.indexOf("[^]", at + 3)) {
                if (escapedAt(masked, at) || skipped(line, at)) continue;
                inside(line, at, "[^]");
            }
        }
    }
    for (const definition of definitions) {
        if (definition.container.footnotes === 0 || skipped(definition.start, definition.labelStart)) continue;
        // the definition around this one: the last one before it that runs over its label line
        const holder = [...definitions].reverse().find((other) => other !== definition && other.start <= definition.start && other.end >= definition.start);
        if (holder !== undefined) add(side.map(fold(holder.name)), `def:${side.map(fold(definition.name))}`);
    }
    return pairs;
}

/**
 * Judges the edit that turns the note `beforeLines` into `afterLines`, an
 * action meaning `intent`: pass, or refuse with the reason (see the top of
 * this file for the six checks, in the order they are run here: what the
 * action meant to create, nesting, protected text, links, block shape, and
 * the untouched footnotes). `beforeReading` and `afterReading` are the
 * readings of the two notes, when the caller already has them: reading a
 * long note again, even from the reading's memory, costs a pass over its
 * text.
 */
export function judgeEdit(
    beforeLines: readonly string[],
    afterLines: readonly string[],
    intent: EditIntent,
    beforeReading: NoteReading = readNote(beforeLines),
    afterReading: NoteReading = readNote(afterLines),
): GateVerdict {
    const renamed = new Map<string, string>();
    for (const [from, to] of intent.renamed ?? []) if (fold(from) !== fold(to)) renamed.set(fold(from), fold(to));
    const removed = new Set((intent.removed ?? []).map(fold));
    const rewritten = new Set((intent.rewritten ?? []).map(fold));
    const inlined = new Set((intent.inlined ?? []).map(fold));
    const created = intent.created ?? [];
    // The names each side writes. The note before the edit is read with
    // every renamed footnote under its new name, and the note after it as
    // it is, so the two compare name for name. One action can take a
    // footnote out and then rename another to its name (the lint deletes
    // an orphaned reference to "3" and renumbers "4" to "3"); the one taken
    // out then goes under a name no footnote can have, so the two are never
    // taken for each other.
    const targets = new Set(renamed.values());
    const before = (name: string) => renamed.get(name) ?? (removed.has(name) && targets.has(name) ? `\u0001${name}` : name);
    const after = (name: string) => renamed.get(name) ?? name;
    // a name the action takes out, as the note after it writes it: none,
    // when another footnote now has it
    const removedAfter = new Set([...removed].filter((name) => !targets.has(name)));
    // fix-lazy and the merge work before the lint renames anything, so
    // their names are written as the note before has them
    const defined = new Set((intent.defined ?? []).map(fold));
    const merged = new Set((intent.merged ?? []).map(fold));
    const definedAfter = new Set([...defined].map(after));
    const mergedAfter = new Set([...merged].map(after));
    // a placeholder with a prefix, "[^2.]", already reads as a reference
    // to "2.", the name the user is still typing
    const createdNames = new Set(
        created.flatMap((footnote) => (footnote.kind === "footnote" ? [fold(footnote.name)] : footnote.kind === "placeholder" ? [fold(footnote.text.slice(2, -1))] : [])),
    );
    // A footnote renamed to a name another footnote keeps would join the
    // two into one. The rename command and the lint's renames never do that,
    // so this is a last guard, asked of the whole note (the stretches below
    // look at the lines the renames changed, and the footnote that keeps the
    // name may sit anywhere else).
    if (renamed.size > 0) {
        const kept = new Set<string>();
        for (const { name } of beforeReading.definitions) kept.add(fold(name));
        for (const { name, live } of beforeReading.references) if (live) kept.add(fold(name));
        for (const target of targets) {
            if (kept.has(target) && !renamed.has(target) && !removed.has(target)) return refuse("other", 1, `[^${target}]`);
        }
    }
    // a footnote turned from normal into inline or back changes how the
    // lines that cite it are written, so definitions are then compared
    // without their footnotes too
    const moved = (intent.footnotesMoved ?? false) || inlined.size > 0 || (intent.inlineRemoved ?? 0) > 0;
    const mapsNames = renamed.size > 0 || removed.size > 0 || inlined.size > 0;
    const oldSide = sideOf(
        beforeReading,
        beforeLines,
        intent.removedText ?? [],
        intent.removedText ?? [],
        new Set([...removed, ...rewritten]),
        before,
        new Set([...removed, ...inlined]),
        moved,
        mapsNames,
    );
    // an inline footnote whose text comes from outside the note (the paste
    // key's clipboard) holds text of its own, so that text is the action's
    const written: NoteRange[] = created.flatMap((footnote) =>
        footnote.kind === "inline" && footnote.fromOutside === true ? footnote.at.map((at) => ({ from: at, to: { line: at.line, ch: at.ch + footnote.text.length } })) : [],
    );
    const newSide = sideOf(
        afterReading,
        afterLines,
        intent.insertedText ?? [],
        [...(intent.insertedText ?? []), ...written],
        // what a removed footnote's definition held is the action's on both
        // sides: a copy the action keeps holds it in both
        new Set([...rewritten, ...removedAfter]),
        (name) => name,
        new Set([...removedAfter, ...inlined]),
        moved,
        mapsNames,
    );

    editWindows(oldSide, newSide, renamed);

    // 6. what the action meant to create is live
    const made = createdVerdict(newSide, created);
    if (!made.pass) return made;

    // 2. no footnote inside a footnote that was not there before. What a
    // removed footnote held goes with it, and what a lazy label's paragraph
    // held when fix-lazy makes it a definition, it holds as the user wrote
    // it; so does a definition the action writes in from outside the note
    // (a paste's carried definitions). A footnote turned from inline into
    // normal or back is the same footnote, so the pairs it is in are
    // written with "*" for it either way.
    const pasted = new Set(
        newSide.reading.definitions
            .filter((definition) => inWindow(newSide, definition.start) && owned(newSide, definition.start, definition.labelStart) && !rewritten.has(fold(definition.name)))
            .map((definition) => fold(definition.name)),
    );
    const converted = new Set([...inlined, ...(intent.inlineRemoved ? createdNames : [])]);
    const holder = (left: ReadonlySet<string>) => (name: string) => (left.has(name) ? null : name === "^" || converted.has(name) ? "*" : name);
    const outerBefore = nestingPairs(oldSide, (line, ch) => inRanges(oldSide.ranges, line, ch), holder(new Set([...removed].map(before))));
    const outerAfter = nestingPairs(newSide, () => false, holder(new Set([...removedAfter, ...definedAfter, ...pasted])));
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
    const shape = blockShapeVerdict(oldSide, newSide, created, defined, definedAfter) ?? mergedShapeVerdict(oldSide, newSide, merged, mergedAfter);
    if (shape !== null) return shape;

    // 1. untouched footnotes read the same
    return untouchedVerdict(oldSide, newSide, {
        removed: new Set([...[...removed].map(before), ...inlined]),
        rewritten: new Set([...rewritten, ...mergedAfter]),
        defined: definedAfter,
        createdNames,
        renamedTo: targets,
        inlineCreated: created.reduce((n, footnote) => n + (footnote.kind === "inline" ? footnote.at.length : 0), 0) + (intent.inlineCreated ?? 0),
        inlineRemoved: intent.inlineRemoved ?? 0,
    });
}

/**
 * Whether `line` holds nothing but footnotes: a reference or an inline
 * footnote standing where whole blocks were. A selection that takes a
 * whole table, a heading, or a code block leaves only its reference on
 * the line, and none of the line's text is left to read differently
 * (Jason's rulings: a whole table converts, sheet 05, 2026-09-09; a
 * selection whose first line is a block construct, pin
 * bug-block-first-line-on-label). A selection that takes a heading's "# "
 * and leaves the rest of its text does leave text, which now reads as a
 * paragraph (design, cycle 3 Q3).
 */
function onlyFootnotes(line: string): boolean {
    return lineKey(line).replace(/\[\^[^\]]*\]|\^\[[^\]]*\]/g, "").trim() === "";
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
 * action wrote for it. Blank lines are left out too: they hold nothing to
 * read, and lined up with each other they paired the wrong lines, so a
 * line that changed how it reads was taken for a new one (a "---" under a
 * lazy label that turned from part of a list item into a rule of its own,
 * pin bug-delete-cuts-rule-under-lazy-label). What a blank line changes
 * shows on the lines around it.
 *
 * Every line lined up with one before must read exactly as it did: the
 * same blocks around it and starting on it. A stretch that does not line
 * up is the edit itself: where it has as many lines as it replaces, each
 * keeps its blocks; otherwise its first line does. Where the stretch holds
 * text the action takes out or writes in (a cut, a paste), only the first
 * line's containers are compared, since the rest is the user's own text.
 */
function blockShapeVerdict(oldSide: Side, newSide: Side, created: readonly CreatedFootnote[], defined: ReadonlySet<string>, definedAfter: ReadonlySet<string>): GateVerdict | null {
    // the definitions that run over any line the checks look at
    const near = (side: Side) => side.reading.definitions.filter((definition) => overlapsWindow(side, definition.start, definition.end));
    const oldDefinitions = near(oldSide);
    const newDefinitions = near(newSide);
    const inOldDefinition: boolean[] = [];
    for (const definition of oldDefinitions) for (let i = definition.start; i <= definition.end; i++) inOldDefinition[i] = true;

    // the definitions a lazy label's paragraph became: those of a defined
    // name that read like no definition before
    const oldKeys = counted(oldDefinitions.filter((definition) => defined.has(fold(definition.name))).map((definition) => definitionKey(oldSide, definition)));
    const lenient: boolean[] = [];
    const excluded: boolean[] = [];
    const writtenFor = new Map<number, number>();
    for (const footnote of created) if (footnote.kind === "footnote" && footnote.definition) writtenFor.set(footnote.definition.line, footnote.definition.lines);
    for (const definition of newDefinitions) {
        if (definedAfter.has(fold(definition.name))) {
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
    // the body lines of a stretch, each side's own
    const oldBodyOf = (window: { from: number; to: number }) => {
        const body: number[] = [];
        for (let i = window.from; i < window.to; i++) if (!inOldDefinition[i] && !blankLine(oldSide, i)) body.push(i);
        return body;
    };
    const newBodyOf = (window: { from: number; to: number }) => {
        const body: number[] = [];
        for (let i = window.from; i < window.to; i++) if ((!excluded[i] || lenient[i]) && !blankLine(newSide, i)) body.push(i);
        return body;
    };

    // each body line as the line-up compares it: with its footnotes' names
    // mapped (namesMapped), so a line whose footnotes were only renamed, or
    // lost one the action meant to take, is the same line on both sides
    const oldText = (i: number) => (oldSide.mapsNames ? namesMapped(oldSide, i) : oldSide.lines[i]);
    const newText = (j: number) => (newSide.mapsNames ? namesMapped(newSide, j) : newSide.lines[j]);
    const readsAlike = (i: number, j: number): boolean => {
        if (blankLine(oldSide, i) && blankLine(newSide, j)) return true;
        const was = oldSide.reading.lineBlocks[i] ?? "";
        const is = newSide.reading.lineBlocks[j] ?? "";
        if (lenient[j]) return lazyLineReadsAlike(was, is);
        if (was === is) return sameCells(i, j);
        // Under a lazy label fix-lazy makes a definition, the rest of the
        // label's paragraph may become the table the user meant, as
        // fix-lazy's own comment says.
        if (defined.size > 0 && lazyLineReadsAlike(was, is) && /(?:^| )\^?table$/.test(is)) return true;
        // text the action takes out or writes in from outside (a cut, a
        // paste) is the user's own, doing what it does in any editor next
        // to the lines around it
        const nextToUsersText =
            lineInRanges(newSide.usersText, j - 1) || lineInRanges(newSide.usersText, j + 1) || lineInRanges(oldSide.usersText, i - 1) || lineInRanges(oldSide.usersText, i + 1);
        return sameKind(was, is, nextToUsersText);
    };
    // a table row keeps its cells: text taken across a "|" leaves the row
    // a cell short (Jason's ruling on partial-table selections, 2026-09-04)
    const cells = (side: Side, line: number) => tableRowCellSpans(side.reading.maskedLine(line)).length;
    const sameCells = (i: number, j: number) =>
        !oldSide.reading.tableRowLines[i] || !newSide.reading.tableRowLines[j] || oldSide.lines[i] === newSide.lines[j] || cells(oldSide, i) === cells(newSide, j);
    const formatting = (j: number) => refuse("formatting", 5, `line ${String(j)}: ${(newSide.lines[j] ?? "").slice(0, 60)}`);
    // Nor may an edited line become a lazy label, a line shaped like a
    // definition that Obsidian reads as more of the paragraph above:
    // "[^8][^9]: x" under a line of prose with "[^9]" cut out leaves
    // "[^8]: x", which reads the same, but the lint's fix-lazy would make it
    // a definition, so the edit would change the note on the next lint (the
    // orphan rules' promise, hunt 2026-10-02, cluster P4).
    const becameLazy = (was: readonly number[], is: readonly number[]) =>
        is.filter((line) => lazyLines(newSide).has(line)).length > was.filter((line) => lazyLines(oldSide).has(line)).length;

    // Whether the lines `was` of the note before are whole blocks: the
    // first starts its own block, and the line after the last starts
    // another or is blank. A selection that takes the last row of a table
    // with the text under it leaves the table a row short, and its
    // reference standing where the row was is no whole block's (Jason's
    // ruling, 2026-09-04: a partial table refuses).
    const wholeBlocks = (was: readonly number[]) => {
        const own = (line: number) => (oldSide.reading.lineBlocks[line] ?? "").split(" ").pop() ?? "";
        const last = was[was.length - 1];
        return was.length > 0 && own(was[0]).startsWith("^") && (last + 1 >= oldSide.lines.length || own(last + 1) === "" || own(last + 1).startsWith("^"));
    };
    // two lines lined up with each other: they read alike, and a line whose
    // text changed (its footnotes) did not become a lazy label
    const matched = (i: number, j: number) => readsAlike(i, j) && (oldSide.lines[i] === newSide.lines[j] || !becameLazy([i], [j]));

    // each stretch before is lined up with its own stretch after: what lies
    // between them is the same on both sides (editWindows)
    for (let k = 0; k < oldSide.windows.length; k++) {
        const verdict = lineUp(oldBodyOf(oldSide.windows[k]), newBodyOf(newSide.windows[k]));
        if (verdict !== null) return verdict;
    }
    return null;

    // The body lines of one stretch, lined up. Lines that match at the
    // start and the end are taken as they are, and the rest by the lint's
    // line-up.
    function lineUp(oldBody: readonly number[], newBody: readonly number[]): GateVerdict | null {
        let head = 0;
        while (head < oldBody.length && head < newBody.length && oldText(oldBody[head]) === newText(newBody[head])) {
            if (!matched(oldBody[head], newBody[head])) return formatting(newBody[head]);
            head++;
        }
        let oldTail = oldBody.length;
        let newTail = newBody.length;
        while (oldTail > head && newTail > head && oldText(oldBody[oldTail - 1]) === newText(newBody[newTail - 1])) {
            oldTail--;
            newTail--;
            if (!matched(oldBody[oldTail], newBody[newTail])) return formatting(newBody[newTail]);
        }
        const oldMiddle = oldBody.slice(head, oldTail);
        const newMiddle = newBody.slice(head, newTail);
        const runs = unmatchedRuns(
            oldMiddle.map((i) => lineKey(oldText(i))),
            newMiddle.map((j) => lineKey(newText(j))),
        );
        let i = 0;
        let j = 0;
        for (const run of [...runs, { aStart: oldMiddle.length, aEnd: oldMiddle.length, bStart: newMiddle.length, bEnd: newMiddle.length }]) {
            for (; i < run.aStart; i++, j++) if (!matched(oldMiddle[i], newMiddle[j])) return formatting(newMiddle[j]);
            const was = oldMiddle.slice(run.aStart, run.aEnd);
            const is = newMiddle.slice(run.bStart, run.bEnd);
            const usersText = was.some((line) => lineInRanges(oldSide.usersText, line)) || is.some((line) => lineInRanges(newSide.usersText, line));
            if (!usersText && becameLazy(was, is)) return formatting(is.find((line) => lazyLines(newSide).has(line)) ?? is[0]);
            const pairs = usersText || was.length !== is.length ? Math.min(1, was.length, is.length) : was.length;
            for (let k = 0; k < pairs; k++) {
                if (blankLine(oldSide, was[k]) || blankLine(newSide, is[k]) || lenient[is[k]] || (onlyFootnotes(newSide.lines[is[k]] ?? "") && wholeBlocks(was))) continue;
                const wasBlocks = oldSide.reading.lineBlocks[was[k]] ?? "";
                const isBlocks = newSide.reading.lineBlocks[is[k]] ?? "";
                if (usersText ? containersOf(wasBlocks) !== containersOf(isBlocks) : !sameKind(wasBlocks, isBlocks) || !sameCells(was[k], is[k])) return formatting(is[k]);
            }
            // Lines the edit runs into one: what is left of the last of
            // them now ends that one line, and must keep its own kind of
            // block there: prose stays prose, a table row a row, a heading
            // a heading. Its containers are the first line's, since the
            // edit joined the two lines. A selection from prose into a
            // table's last row left the rest of the row on the prose's
            // line, read as prose, and only the first line was compared
            // (hunt 2026-10-08, cycle 6, pin
            // bug-selection-into-table-last-row-converts).
            const last = was[was.length - 1];
            if (!usersText && was.length > 1 && is.length === 1 && holdsTextOfLast(oldText(was[0]), oldText(last), newText(is[0]))) {
                if (ownKind(oldSide.reading.lineBlocks[last] ?? "") !== ownKind(newSide.reading.lineBlocks[is[0]] ?? "")) return formatting(is[0]);
            }
            // A line the edit adds may join the paragraph next to it, as a
            // reference written on the blank line under a paragraph does;
            // what it does to the lines around it is judged on those lines
            // (Jason's ruling B1, 2026-10-08).
            i = run.aEnd;
            j = run.bEnd;
        }
        return null;
    }
}

/**
 * Check 5 for a merge of duplicates: what the copies of each merged name
 * held, as blocks other than paragraphs (a table, code, a list, a quote, a
 * heading), is still held by the copy left. A copy whose table starts on
 * its label line cannot be folded into indented lines without the table
 * turning into text (GLM hunt cycle 7, 2026-09-16, pin
 * bug-merge-duplicate-flattens-table). `merged` names them as the note
 * before the edit does, `mergedAfter` as the note after it does.
 */
function mergedShapeVerdict(oldSide: Side, newSide: Side, merged: ReadonlySet<string>, mergedAfter: ReadonlySet<string>): GateVerdict | null {
    if (merged.size === 0) return null;
    const blocksOf = (side: Side, names: ReadonlySet<string>) => {
        const out: string[] = [];
        for (const definition of side.reading.definitions) {
            if (!names.has(fold(definition.name)) || !inWindow(side, definition.start)) continue;
            for (let line = definition.start; line <= definition.end; line++) {
                // the blocks inside the definition that start on this line
                const inside = (side.reading.lineBlocks[line] ?? "").split(" ");
                const at = inside.findIndex((kind) => /^\^?footnoteDefinition$/.test(kind));
                for (const kind of inside.slice(at + 1)) if (kind.startsWith("^") && kind !== "^paragraph") out.push(`${side.map(fold(definition.name))}:${kind}`);
            }
        }
        return counted(out);
    };
    const was = blocksOf(oldSide, merged);
    const is = blocksOf(newSide, mergedAfter);
    const lost = surplus(was, is) ?? surplus(is, was);
    return lost === null ? null : refuse("formatting", 5, lost);
}

/**
 * Check 1: every footnote the action did not mean to change keeps its live
 * references (as many as before) and its definitions (each with its
 * container and its lines), wherever they now sit; a renamed footnote
 * keeps them under its new name. The inline footnotes are compared by
 * their text: as many as the action meant to take out may go, and as many
 * as it meant to create may come. Every name in `names` is written as the
 * note after the edit has it.
 */
function untouchedVerdict(
    oldSide: Side,
    newSide: Side,
    names: {
        removed: ReadonlySet<string>;
        rewritten: ReadonlySet<string>;
        defined: ReadonlySet<string>;
        createdNames: ReadonlySet<string>;
        renamedTo: ReadonlySet<string>;
        inlineCreated: number;
        inlineRemoved: number;
    },
): GateVerdict {
    const skipped = (name: string) => names.removed.has(name) || names.defined.has(name) || names.createdNames.has(name);
    const why = (name: string): GateVerdict => refuse(names.renamedTo.has(name) ? "dead" : "other", 1, `[^${name}]`);

    // the live references, by name, and those of them inside a definition
    const references = (side: Side) => {
        const all: string[] = [];
        const held: string[] = [];
        for (const reference of side.reading.references) {
            if (!reference.live || !inWindow(side, reference.line) || owned(side, reference.line, reference.start)) continue;
            all.push(side.map(fold(reference.name)));
            if (side.reading.definitionAt(reference.line) !== null) held.push(side.map(fold(reference.name)));
        }
        return { all: counted(all), held: counted(held) };
    };
    const referencesBefore = references(oldSide);
    const referencesAfter = references(newSide);
    for (const name of new Set([...referencesBefore.all.keys(), ...referencesAfter.all.keys()])) {
        if (skipped(name)) continue;
        if ((referencesBefore.all.get(name) ?? 0) === (referencesAfter.all.get(name) ?? 0)) continue;
        // a reference that comes alive inside a footnote, such as one an
        // inline footnote held as dead text (rule E3) whose text becomes a
        // definition, is a footnote inside a footnote (Jason's ruling B12,
        // 2026-10-08)
        if ((referencesAfter.held.get(name) ?? 0) > (referencesBefore.held.get(name) ?? 0)) return refuse("nested", 2, `[^${name}]`);
        return why(name);
    }

    const definitions = (side: Side) => {
        const out = new Map<string, string[]>();
        for (const definition of side.reading.definitions) {
            if (!inWindow(side, definition.start)) continue;
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
            if (!inWindow(side, note.line) || owned(side, note.line, note.open)) continue;
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
    if (gone > names.inlineRemoved || come > names.inlineCreated) return refuse("other", 1, "an inline footnote");
    return Pass;
}
