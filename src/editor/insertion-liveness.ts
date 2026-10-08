import { EditorChange, EditorPosition } from "obsidian";
import { NoFootnoteCreated } from "./notice";

import { escapedAt } from "../parsing/footnote-grammar";
import { NoteReading } from "../parsing/note-reading";

// What an insertion's text does where it lands, and the note an edit
// would leave. The question behind it: once the text lands, will it still
// MEAN what it says? An insertion can be swallowed by whatever sits
// directly before it, an escaping backslash or an inline-footnote opener,
// and safeInsertionCh steps it clear. Whether the note as the edit leaves
// it reads as it should is the result gate's to judge (result-gate.ts);
// the functions here work out that note (simulateChanges) and where each
// change lands in it. The failure modes were found by the command-press
// property suite (2026-08-12).
//
// Split out of the all-in-one commands file 2026-08-12: one subject, and
// mutation-testable on its own.

export const ProtectedCreationNotice =
    NoFootnoteCreated + "footnotes can't go inside code, math, or other protected text.";

/**
 * The furthest right column, at or left of `ch`, where an insertion still
 * means what it says.
 *
 * Two hazards. Text placed directly after an ESCAPING backslash is itself
 * escaped: "\" plus "[^N]" is literal prose, so the definition appended for
 * it is an orphaned definition the moment it lands, while the character the
 * backslash used to protect goes LIVE. And a reference placed directly
 * after an unescaped "^" is swallowed as inline-footnote text: "^" plus
 * "[^N]" reads as "^[^N]".
 *
 * Both were found by the command-press property suite (2026-08-12). Each
 * hazard steps the column one to the left, and a run of them is walked
 * until the insertion is safe.
 */
export function safeInsertionCh(lineText: string, ch: number): number {
    for (;;) {
        if (escapedAt(lineText, ch)) {
            ch--;
            continue;
        }
        if (
            ch > 0 &&
            lineText[ch - 1] === "^" &&
            !escapedAt(lineText, ch - 1)
        ) {
            ch--;
            continue;
        }
        return ch;
    }
}

// Shared by simulateChanges and simulatedAnchor: how many characters into
// `lines` a position sits, counting the lines as joined by a single "\n",
// which is how CodeMirror counts them.
function offsetIn(lines: string[], pos: EditorPosition): number {
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
    }
    return offset + pos.ch;
}

// The ONE sorted view of a transaction's changes, shared by simulateChanges
// and simulatedAnchor so the two can never disagree about them.
//
// The rules: every offset is measured against the ORIGINAL text, which is
// how CodeMirror transactions work; the changes are sorted by position; a
// zero-length INSERT at the same offset as a range change comes first,
// REGARDLESS of the order the array had; and inserts at the same position
// keep their array order. Both tie rules were checked by experiment against
// @codemirror/state 6.5 (hunt 2026-08-25: the old back-to-front splice
// worked out a tied replace's `to` against a string it had already changed,
// and silently dropped a character of the tied insert).
//
// Range changes never overlap, because CodeMirror itself refuses
// overlapping spans.
function resolveChanges(lines: string[], changes: EditorChange[]) {
    return changes
        .map((change, index) => ({
            from: offsetIn(lines, change.from),
            to: change.to
                ? offsetIn(lines, change.to)
                : offsetIn(lines, change.from),
            text: change.text,
            index,
        }))
        // Stryker disable ConditionalExpression, ArithmeticOperator: changing this comparator's tiebreak may or may not alter anything, depending only on which argument order the sort happens to probe with, not on real behavior - the tie ORDER contract itself (an insert comes before a replace, stacked inserts keep array order) is pinned in bug-simulate-changes-tie-drops-text
        .sort(
            (a, b) =>
                a.from - b.from ||
                Number(a.to > a.from) - Number(b.to > b.from) ||
                a.index - b.index,
        );
    // Stryker restore all
}

// Apply the sorted changes left to right against the original text, and
// note where each change's text BEGINS in the result, stored under the
// change's ORIGINAL position in the array. Those landing offsets fall out
// of the building itself, so the anchor arithmetic can never drift away
// from what was actually applied.
function applyResolvedChanges(
    text: string,
    resolved: ReturnType<typeof resolveChanges>,
): { out: string; landing: number[] } {
    let out = "";
    let pos = 0;
    // Stryker disable next-line ArrayDeclaration: the length is only a hint about how much room to reserve up front - every slot is filled in by index just below, so a plain new Array() behaves identically
    const landing = new Array<number>(resolved.length);
    for (const change of resolved) {
        out += text.slice(pos, Math.max(pos, change.from));
        landing[change.index] = out.length;
        out += change.text;
        pos = Math.max(pos, change.to);
    }
    return { out: out + text.slice(pos), landing };
}

/** The document `changes` would produce. Every change is measured against
 * the ORIGINAL text, the way CodeMirror transactions work. */
export function simulateChanges(
    lines: string[],
    changes: EditorChange[],
): string[] {
    const { out } = applyResolvedChanges(
        lines.join("\n"),
        resolveChanges(lines, changes),
    );
    return out.split("\n");
}

/**
 * Where the text of `changes[anchorIndex]` BEGINS in the simulated
 * document.
 *
 * It is read straight off the same construction simulateChanges applies, so
 * it is exact by definition. The shift arithmetic used before 2026-08-25
 * disagreed with the applied result whenever two changes tied at one
 * offset.
 *
 * The reference-liveness checks used to look up the anchor's ORIGINAL line
 * number in the simulated document instead. That wrongly refused perfectly
 * good creations whenever the definition was appended ABOVE the caret,
 * which happens with definitions under a heading partway down the note that
 * has prose below them (found by the entry corpus, 2026-08-12).
 */
export function simulatedAnchor(
    lines: string[],
    changes: EditorChange[],
    anchorIndex: number,
    simulated: string[],
): EditorPosition {
    return simulatedAnchors(lines, changes, [anchorIndex], simulated)[0];
}

/** Every requested landing spot from ONE pass. The single-anchor form above
 * re-joined and re-sorted the whole document once per reference (review B4,
 * 2026-09-09). */
export function simulatedAnchors(
    lines: string[],
    changes: EditorChange[],
    anchorIndices: number[],
    simulated: string[],
): EditorPosition[] {
    const { landing } = applyResolvedChanges(
        lines.join("\n"),
        resolveChanges(lines, changes),
    );
    return anchorIndices.map((anchorIndex) => {
        let offset = landing[anchorIndex];
        let line = 0;
        while (line < simulated.length && offset > simulated[line].length) {
            offset -= simulated[line].length + 1;
            line++;
        }
        return { line, ch: offset };
    });
}

// The line and column of character `offset` in `lines`, counting the lines
// as joined by a single "\n". The reverse of offsetIn.
function positionAt(lines: string[], offset: number): EditorPosition {
    let line = 0;
    while (line < lines.length - 1 && offset > lines[line].length) {
        offset -= lines[line].length + 1;
        line++;
    }
    return { line, ch: offset };
}

/**
 * One list of changes that does what `first` and then `second` do, as a
 * single transaction. `first` is measured against `lines`, the way every
 * transaction is; `second` is measured against the text `first` produces.
 * The result is measured against `lines` again, so it can go to the editor
 * in one transaction, one undo.
 *
 * Why it exists: a creation press writes a reference at the caret and a
 * definition at the bottom in one edit, and the definition has to be
 * planned against the note as it reads AFTER the reference is in. Planned
 * against the note before it, the two halves collided: the trailing-blank
 * trim ran over the caret and wrote the reference into its own definition,
 * and an empty line filled by the reference joined the definition above it
 * (hunt 2026-10-02, clusters R1, R2, I1, I2, O1, C12, C13).
 *
 * How it works: every change of both lists is a stretch of the text in the
 * middle (after `first`, before `second`). Stretches that touch or overlap
 * are merged into one change, whose text is read straight off the final
 * result; a stretch that touches nothing is passed through as it is. So a
 * reference with nothing near it stays its own small edit, and one that
 * the definition lands right after becomes one edit with it. Different
 * merged changes never touch, so no tie rule decides their order, and the
 * result is exact by construction (pinned against CodeMirror's own
 * ChangeSet.compose in test/simulate-changes-differential.test.ts).
 */
export function composeChanges(
    lines: string[],
    first: EditorChange[],
    second: EditorChange[],
): EditorChange[] {
    const text = lines.join("\n");
    const firstResolved = resolveChanges(lines, first);
    const middleBuilt = applyResolvedChanges(text, firstResolved);
    const middleLines = middleBuilt.out.split("\n");
    const secondResolved = resolveChanges(middleLines, second);
    const finalBuilt = applyResolvedChanges(middleBuilt.out, secondResolved);
    // every change as a stretch of the middle text, with how much longer
    // it makes the text it belongs to (`first`'s or `second`'s)
    const stretches = [
        ...firstResolved.map((change) => ({
            start: middleBuilt.landing[change.index],
            end: middleBuilt.landing[change.index] + change.text.length,
            grows: change.text.length - (change.to - change.from),
            isFirst: true,
        })),
        ...secondResolved.map((change) => ({
            start: change.from,
            end: change.to,
            grows: change.text.length - (change.to - change.from),
            isFirst: false,
        })),
    ].sort((a, b) => a.start - b.start || a.end - b.end);
    const composed: EditorChange[] = [];
    // how much the changes already passed have grown each text
    let firstGrew = 0;
    let secondGrew = 0;
    let k = 0;
    while (k < stretches.length) {
        // one group: every stretch that touches the group so far
        const start = stretches[k].start;
        let end = stretches[k].end;
        let groupFirstGrew = 0;
        let groupSecondGrew = 0;
        while (k < stretches.length && stretches[k].start <= end) {
            end = Math.max(end, stretches[k].end);
            if (stretches[k].isFirst) groupFirstGrew += stretches[k].grows;
            else groupSecondGrew += stretches[k].grows;
            k++;
        }
        composed.push({
            from: positionAt(lines, start - firstGrew),
            to: positionAt(lines, end - firstGrew - groupFirstGrew),
            text: finalBuilt.out.slice(start + secondGrew, end + secondGrew + groupSecondGrew),
        });
        firstGrew += groupFirstGrew;
        secondGrew += groupSecondGrew;
    }
    return composed;
}

/**
 * Where position `pos` of `lines` ends up once `changes` land. Text
 * inserted exactly at `pos` goes after it when `assoc` is -1 and before it
 * when `assoc` is 1, so the start of a stretch of text is carried with 1
 * and its end with -1. A position inside replaced text moves to the start
 * (-1) or the end (1) of the replacement. This is CodeMirror's mapPos, for
 * the change lists the plugin builds.
 */
export function mapPosition(
    lines: string[],
    changes: EditorChange[],
    pos: EditorPosition,
    assoc: -1 | 1,
    mapped: string[] = simulateChanges(lines, changes),
): EditorPosition {
    const offset = offsetIn(lines, pos);
    let grew = 0;
    for (const change of resolveChanges(lines, changes)) {
        const grows = change.text.length - (change.to - change.from);
        if (change.to < offset) {
            grew += grows;
        } else if (change.from > offset) {
            break;
        } else if (change.from === change.to) {
            // an insert right at the position
            if (assoc > 0) grew += grows;
        } else if (change.to === offset) {
            // a replacement that ends right at the position
            grew += grows;
        } else if (change.from < offset) {
            // inside the replaced text
            return positionAt(mapped, change.from + grew + (assoc > 0 ? change.text.length : 0));
        }
    }
    return positionAt(mapped, offset + grew);
}

/** Whether `ch` sits STRICTLY inside a masked span (the run of NULs that
 * stands in for protected text), meaning the characters on both sides of it
 * are claimed. The edges are fine: just before an opener, or just after a
 * closer, inserts outside the span. At column 0 there is no character to
 * the left, and at end of line none to the right, so `openAtStart` and
 * `openAtEnd` say whether a masked span is already open there. */
export function caretInsideMaskedSpan(
    masked: string,
    ch: number,
    openAtStart: boolean,
    openAtEnd: boolean,
): boolean {
    const before = ch > 0 ? masked[ch - 1] === "\0" : openAtStart;
    const after = ch < masked.length ? masked[ch] === "\0" : openAtEnd;
    return before && after;
}

/** Whether `line` belongs to a link reference definition "[ref]: http://u": its label's line, or a line its address or title runs on to, as the reading marks its blocks. */
export function onLinkDefinition(reading: NoteReading, line: number): boolean {
    return /(?:^| )\^?definition(?: |$)/.test(reading.lineBlocks[line] ?? "");
}
