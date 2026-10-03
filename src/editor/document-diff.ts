// The smallest set of line-range edits that turns one version of a note
// into another.
//
// Why it exists (Jason's report, former sheet 20, 2026-09-11): the lint used to
// write its result back as ONE edit, from the first changed character to
// the last. Everything between those two points was replaced wholesale,
// even the lines that had not changed at all. That threw away every folded
// heading and list in the span, and the caret, if it sat anywhere inside,
// was pushed to the span's start. Editing only the lines that really
// changed leaves folds alone and lets the editor carry the caret through
// untouched text unchanged.
//
// How it works: lines that match at the start and at the end are skipped
// first. What is left in the middle goes through a longest-common-
// subsequence comparison on whole lines, and each run of lines that does
// not match becomes one edit. A very large middle (millions of line pairs
// to compare) falls back to one edit for the whole middle, so a giant note
// never stalls the app.

/** One edit, as character offsets into the BEFORE text: replace [from, to) with `text`. Edits come back in document order and never overlap. */
export interface OffsetChange {
    from: number;
    to: number;
    text: string;
}

/** Above this many line pairs the middle is replaced as one edit instead of compared line by line. */
const MaxComparedPairs = 4_000_000;

export function lineDiffChanges(before: string, after: string): OffsetChange[] {
    if (before === after) return [];
    const a = before.split("\n");
    const b = after.split("\n");
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let aTail = a.length;
    let bTail = b.length;
    while (aTail > head && bTail > head && a[aTail - 1] === b[bTail - 1]) {
        aTail--;
        bTail--;
    }
    const middleA = a.slice(head, aTail);
    const middleB = b.slice(head, bTail);
    const hunks =
        middleA.length * middleB.length <= MaxComparedPairs
            ? unmatchedRuns(middleA, middleB)
            : [{ aStart: 0, aEnd: middleA.length, bStart: 0, bEnd: middleB.length }];

    // where each line of `before` starts
    const starts: number[] = [0];
    for (let i = 0; i < a.length; i++) starts.push(starts[i] + a[i].length + 1);

    const changes: OffsetChange[] = [];
    for (const hunk of hunks) {
        const s = head + hunk.aStart;
        const e = head + hunk.aEnd;
        const inserted = b.slice(head + hunk.bStart, head + hunk.bEnd);
        if (e < a.length) {
            if (s === e) {
                // lines inserted BEFORE line e: they bring their own newlines
                changes.push({ from: starts[s], to: starts[s], text: inserted.join("\n") + "\n" });
            } else if (inserted.length === 0) {
                // lines deleted, newlines and all
                changes.push({ from: starts[s], to: starts[e], text: "" });
            } else {
                // lines replaced: their text swaps, the newline after the
                // last one stays where it is, so the edit stops at the end
                // of that line and never touches the line below
                changes.push({ from: starts[s], to: starts[e] - 1, text: inserted.join("\n") });
            }
        } else if (s < a.length) {
            // the replaced range reaches the end of the note, where the last
            // line has no newline after it; a pure deletion here must also
            // eat the newline BEFORE the range, or one would be left dangling
            const from = inserted.length === 0 && s > 0 ? starts[s] - 1 : starts[s];
            changes.push({ from, to: before.length, text: inserted.join("\n") });
        } else {
            // a pure insertion after the last line: the last line has no
            // newline after it, so one is opened first
            changes.push({ from: before.length, to: before.length, text: "\n" + inserted.join("\n") });
        }
    }
    // Within each edit, the characters that match at its start and end are
    // left out: a caret sitting after the changed characters on a changed
    // line then keeps its column, since only the differing characters are
    // rewritten (Jason's report: the caret went to the line's start).
    return changes.map((change) => trimCommonEdges(before, change));
}

/** `change` with the characters it shares with the text it replaces removed from both ends. */
function trimCommonEdges(before: string, change: OffsetChange): OffsetChange {
    const old = before.slice(change.from, change.to);
    let head = 0;
    const maxHead = Math.min(old.length, change.text.length);
    while (head < maxHead && old[head] === change.text[head]) head++;
    let tail = 0;
    const maxTail = maxHead - head;
    while (tail < maxTail && old[old.length - 1 - tail] === change.text[change.text.length - 1 - tail]) tail++;
    return {
        from: change.from + head,
        to: change.to - tail,
        text: change.text.slice(head, change.text.length - tail),
    };
}

/** The runs of lines in `a` and `b` that do not match, from a longest-common-subsequence comparison; each run is one edit. */
function unmatchedRuns(
    a: string[],
    b: string[],
): { aStart: number; aEnd: number; bStart: number; bEnd: number }[] {
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0) return n === 0 && m === 0 ? [] : [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];
    // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
    const width = m + 1;
    const lcs = new Int32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i * width + j] =
                a[i] === b[j]
                    ? lcs[(i + 1) * width + j + 1] + 1
                    : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
        }
    }
    const runs: { aStart: number; aEnd: number; bStart: number; bEnd: number }[] = [];
    let i = 0;
    let j = 0;
    let open: { aStart: number; aEnd: number; bStart: number; bEnd: number } | null = null;
    const closeRun = () => {
        if (open) runs.push(open);
        open = null;
    };
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) {
            closeRun();
            i++;
            j++;
            continue;
        }
        if (!open) open = { aStart: i, aEnd: i, bStart: j, bEnd: j };
        // take from whichever side keeps the longer common subsequence ahead
        if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
            i++;
            open.aEnd = i;
        } else {
            j++;
            open.bEnd = j;
        }
    }
    closeRun();
    return runs;
}

/** A fold as Obsidian's view reports it: the heading (or list item) line and the last folded line, both 0-based. */
export interface FoldRange {
    from: number;
    to: number;
}

/**
 * `folds` with their line numbers carried through `changes` (lineDiffChanges
 * of `before` to the new text).
 *
 * Obsidian drops a heading's fold on any edit inside it, even a single
 * character (probed live, 2026-09-11), so after a lint the plugin puts the
 * folds back itself, and this works out where each one now lives. The
 * lines of the note before and after are lined up (alignLines), and each
 * fold's first and last lines are read off that: a line the lint rewrote
 * in place is still the same line, a line above an insertion or deletion
 * stays, a line below one shifts. A fold whose heading line was removed is
 * dropped; a fold whose last line was removed ends on the line before the
 * removal; a fold whose last line was replaced by more or fewer lines
 * grows or shrinks with them.
 *
 * It used to map each fold line by its character offset through the
 * edits, which broke whenever one edit covered two neighbouring lines: the
 * second line's start fell inside the edit and collapsed onto the first,
 * so folds came back a line short or not at all (Kimi and Claude sweeps
 * 2026-09-13, Jason's original fold complaint in a narrower form).
 */
export function mapFoldLines(folds: FoldRange[], changes: OffsetChange[], before: string): FoldRange[] {
    if (changes.length === 0) return folds;
    const after = applyOffsetChanges(before, changes);
    const map = alignLines(before.split("\n"), after.split("\n"));
    const out: FoldRange[] = [];
    for (const fold of folds) {
        if (fold.from >= map.length || fold.to >= map.length) continue;
        const from = map[fold.from].from;
        if (from === -1) continue;
        const to = map[fold.to].to;
        if (to > from) out.push({ from, to });
    }
    return out;
}

/**
 * Where a line of the text before a rewrite sits afterwards, for putting
 * another pane's caret back (write-back.ts, Jason's report 2026-09-24). It
 * reads the same line alignment the folds use: a line rewritten in place
 * is still the same line, a line below an insertion or deletion shifts
 * with it, and a line deleted outright lands on the line before the
 * deletion (the top of the note when there is none). The answer is always
 * a real line of the new text.
 */
export function lineMapper(changes: OffsetChange[], before: string): (line: number) => number {
    if (changes.length === 0) return (line) => line;
    const after = applyOffsetChanges(before, changes);
    const map = alignLines(before.split("\n"), after.split("\n"));
    const last = after.split("\n").length - 1;
    return (line) => {
        if (line >= map.length) return last;
        const { from, to } = map[line];
        return Math.max(0, Math.min(last, from === -1 ? to : from));
    };
}

/**
 * Where position `pos` of `before` sits in `after`, when the one is turned
 * into the other by the edits lineDiffChanges works out. It follows the
 * edits the way the editor carries a caret through them: an edit before
 * the position moves it along by however much longer or shorter that edit
 * made the text, and a position inside text that an edit replaced or
 * deleted moves to the start of whatever took that text's place. The
 * answer is always a real position of `after`. (Written for the caret after
 * a cut, whose own line can be trimmed away with the blank lines around
 * it; hunt 2026-10-02, pin bug-carry-cut-caret-stale-line.)
 */
export function positionAfterRewrite(before: string, after: string, pos: { line: number; ch: number }): { line: number; ch: number } {
    const beforeLines = before.split("\n");
    let offset = pos.ch;
    for (let i = 0; i < pos.line; i++) offset += beforeLines[i].length + 1;
    let grew = 0;
    for (const change of lineDiffChanges(before, after)) {
        if (change.from >= offset) break;
        if (change.to > offset) {
            // the position was inside this edit's text
            offset = change.from;
            break;
        }
        grew += change.text.length - (change.to - change.from);
    }
    const afterLines = after.split("\n");
    let rest = offset + grew;
    let line = 0;
    while (line < afterLines.length - 1 && rest > afterLines[line].length) {
        rest -= afterLines[line].length + 1;
        line++;
    }
    return { line, ch: Math.min(rest, afterLines[line].length) };
}

/**
 * For each line of `a`, where it lives in `b`: `from` is the line a fold
 * may START on (-1 when the line is gone), `to` the line a fold may END
 * on.
 *
 * Lines are matched with their footnote references stripped out, because
 * that is what a lint changes: a renumbered line is the same line, and
 * matching on the raw text paired up look-alike lines across each other
 * instead. Inside a run of lines that do not match, old lines and new
 * lines pair up by position; old lines left over past the new count are
 * gone; a fold ending on the run's last old line ends on the run's last
 * new line, so it grows or shrinks with the run; and a fold ending on a
 * line that was deleted outright ends on the line before the deletion.
 */
function alignLines(a: string[], b: string[]): { from: number; to: number }[] {
    const strip = (line: string) => line.replace(/\[\^[^\]]*\]/g, "");
    const na = a.map(strip);
    const nb = b.map(strip);
    let head = 0;
    while (head < na.length && head < nb.length && na[head] === nb[head]) head++;
    let aTail = na.length;
    let bTail = nb.length;
    while (aTail > head && bTail > head && na[aTail - 1] === nb[bTail - 1]) {
        aTail--;
        bTail--;
    }
    const middleA = na.slice(head, aTail);
    const middleB = nb.slice(head, bTail);
    const hunks =
        middleA.length * middleB.length <= MaxComparedPairs
            ? unmatchedRuns(middleA, middleB)
            : [{ aStart: 0, aEnd: middleA.length, bStart: 0, bEnd: middleB.length }];
    const map: { from: number; to: number }[] = [];
    let bi = 0;
    const matchedUpTo = (aEnd: number) => {
        while (map.length < aEnd) {
            map.push({ from: bi, to: bi });
            bi++;
        }
    };
    for (const hunk of hunks) {
        matchedUpTo(head + hunk.aStart);
        const n = hunk.aEnd - hunk.aStart;
        const m = hunk.bEnd - hunk.bStart;
        const bStart = head + hunk.bStart;
        for (let k = 0; k < n; k++) {
            if (m === 0) {
                map.push({ from: -1, to: bStart - 1 });
            } else {
                map.push({
                    from: k < m ? bStart + k : -1,
                    to: k === n - 1 ? bStart + m - 1 : Math.min(bStart + k, bStart + m - 1),
                });
            }
        }
        bi = bStart + m;
    }
    matchedUpTo(a.length);
    return map;
}

/** `before` with `changes` (offsets into `before`, in order, non-overlapping) applied. */
function applyOffsetChanges(before: string, changes: OffsetChange[]): string {
    let out = "";
    let copied = 0;
    for (const change of changes) {
        out += before.slice(copied, change.from) + change.text;
        copied = change.to;
    }
    return out + before.slice(copied);
}
