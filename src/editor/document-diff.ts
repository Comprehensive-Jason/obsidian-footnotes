// The smallest set of line-range edits that turns one version of a note
// into another.
//
// Why it exists (Jason's report from a manual lint pass, 2026-09-11): the lint used to
// write its result back as ONE edit, from the first changed character to
// the last. Everything between those two points was replaced wholesale,
// even the lines that had not changed at all. That threw away every folded
// heading and list in the span, and the caret, if it sat anywhere inside,
// was pushed to the span's start. Editing only the lines that really
// changed leaves folds alone and lets the editor carry the caret through
// untouched text unchanged.
//
// How it works: lines that match at the start and at the end are skipped
// first. What is left in the middle is compared line by line with Myers'
// diff (unmatchedRuns), which keeps as many lines as it can, the prose
// lines before the rest (proseFirstRuns), and each run of lines that does
// not match becomes one edit. Two versions that differ
// in thousands of lines fall back to one edit for the whole middle, so a
// rewrite of a giant note never stalls the app.

import { readNote } from "../parsing/note-reading";

/** One edit, as character offsets into the BEFORE text: replace [from, to) with `text`. Edits come back in document order and never overlap. */
export interface OffsetChange {
    from: number;
    to: number;
    text: string;
}

/**
 * Above this many differing lines (lines deleted plus lines inserted) a
 * comparison stops and replaces its stretch as one edit, so two notes that
 * share almost nothing never stall the app. At the cap a comparison of the
 * 22,400-line speed-test note took about a tenth of a second (the speed
 * brief, 2026-10-05). A lint changes far fewer lines than this: it rewrites
 * the lines a renumbering touches and moves the definitions it gathers.
 */
const MaxDifferences = 2_000;

/** A run of lines that do not match: lines [aStart, aEnd) of the one side stand where lines [bStart, bEnd) of the other do. */
interface Run {
    aStart: number;
    aEnd: number;
    bStart: number;
    bEnd: number;
}

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
    // Lines are lined up by their text without footnotes (lineKey), and a
    // pair lined up that way whose footnotes differ is then rewritten in
    // place. A lint that renumbers rewrites every reference below the
    // first one it changes: compared as they stand, each such line counted
    // as one line deleted and one inserted, so on a long note the
    // comparison had thousands of differences to find and took as long as
    // the rest of the lint (the speed brief, 2026-10-05). Lined up without
    // their references, they cost nothing, and only the lines the lint
    // really moved, added, or removed are left to find. The prose lines
    // are lined up before the rest (proseFirstRuns).
    const runs = proseFirstRuns(middleA.map(lineKey), middleB.map(lineKey), proseLines(a).slice(head, aTail), proseLines(b).slice(head, bTail));
    const hunks = withRewrittenLines(runs, middleA, middleB);

    // where each line of `before` starts
    const starts: number[] = [0];
    for (let i = 0; i < a.length; i++) starts.push(starts[i] + a[i].length + 1);

    const changes: OffsetChange[] = [];
    for (const hunk of hunks) {
        const s = head + hunk.aStart;
        const e = head + hunk.aEnd;
        const inserted = b.slice(head + hunk.bStart, head + hunk.bEnd);
        if (e < a.length) {
            if (s === e && s > 0) {
                // lines inserted between line s - 1 and line s go in at the
                // END of line s - 1, each after a newline of its own. The
                // editor carries a caret that sits exactly where text goes in
                // to the front of that text, so written at the start of line
                // s, a caret at column 0 of that line ended up on the first
                // inserted line; written here, a caret at the end of line
                // s - 1 and one at the start of line s both stay on their
                // lines (hunt 2026-10-05, pin bug-caret-jumps-to-inserted-line)
                changes.push({ from: starts[s] - 1, to: starts[s] - 1, text: "\n" + inserted.join("\n") });
            } else if (s === e) {
                // lines inserted above the note's first line: they bring
                // their own newlines, and go in at the very start
                changes.push({ from: 0, to: 0, text: inserted.join("\n") + "\n" });
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

/**
 * The runs of lines in `a` and `b` that do not match; each run is one
 * edit. They come from Myers' diff (Eugene Myers, "An O(ND) Difference
 * Algorithm and Its Variations", 1986), which finds the fewest lines to
 * delete and insert, and so the most lines kept, as the table it replaced
 * did. Its cost grows with the length of the stretch times the number of
 * differing lines, where the table's grew with the length of one side
 * times the other: on a 5,600-line note the line diff after a press took
 * 71 ms and takes 6, and on long notes the table hit its size cap and
 * gave up (the speed brief, 2026-10-05; hunt 2026-10-05, cluster D3, pin
 * bug-long-note-diff-cap). Past MaxDifferences the whole stretch is one
 * run.
 *
 * How it works, in short: picture a grid with the lines of `a` down one
 * side and those of `b` along the other. A path from the top corner to the
 * bottom one steps right (delete a line of `a`), down (insert a line of
 * `b`), or diagonally where the two lines match, for free. Round d finds,
 * for every diagonal the path can have reached with d paid steps, how far
 * along it the path gets, always sliding down free diagonal steps as far as
 * they go. The first round that reaches the far corner has the fewest paid
 * steps. Each round's answers are kept, so the path can then be walked
 * back from the corner to read off which lines matched.
 */
function unmatchedRuns(a: readonly string[], b: readonly string[]): Run[] {
    const n = a.length;
    const m = b.length;
    const whole: Run[] = n === 0 && m === 0 ? [] : [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];
    if (n === 0 || m === 0) return whole;
    const most = Math.min(n + m, MaxDifferences);
    // furthest[shift + k] is how far down `a` the path on diagonal k
    // (lines of `a` taken minus lines of `b` taken) has got; shift keeps
    // the index from going below zero
    const shift = most + 1;
    const furthest = new Int32Array(2 * most + 3);
    // rounds[d] holds furthest as it stood before round d, for the
    // diagonals -d - 1 to d + 1, the only ones round d reads
    const rounds: Int32Array[] = [];
    let cost = -1;
    for (let d = 0; d <= most && cost === -1; d++) {
        rounds.push(furthest.slice(shift - d - 1, shift + d + 2));
        for (let k = -d; k <= d; k += 2) {
            // arrive by inserting a line of `b` (from diagonal k + 1) or by
            // deleting a line of `a` (from diagonal k - 1), whichever got
            // further down `a`
            let x = k === -d || (k !== d && furthest[shift + k - 1] < furthest[shift + k + 1]) ? furthest[shift + k + 1] : furthest[shift + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            furthest[shift + k] = x;
            if (x >= n && y >= m) {
                cost = d;
                break;
            }
        }
    }
    if (cost === -1) return whole;
    // walk back from the far corner, noting each matched pair of lines
    const matched: [number, number][] = [];
    let x = n;
    let y = m;
    for (let d = cost; d > 0; d--) {
        const before = rounds[d];
        const at = (diagonal: number) => before[diagonal + d + 1];
        const k = x - y;
        const fromK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
        const fromX = at(fromK);
        // the free diagonal steps of this round start just past its paid step
        const startX = fromK === k + 1 ? fromX : fromX + 1;
        while (x > startX) {
            x--;
            y--;
            matched.push([x, y]);
        }
        x = fromX;
        y = fromX - fromK;
    }
    while (x > 0 && y > 0) {
        x--;
        y--;
        matched.push([x, y]);
    }
    matched.reverse();
    const runs: Run[] = [];
    let i = 0;
    let j = 0;
    for (const [mi, mj] of [...matched, [n, m] as [number, number]]) {
        if (mi > i || mj > j) runs.push({ aStart: i, aEnd: mi, bStart: j, bEnd: mj });
        i = mi + 1;
        j = mj + 1;
    }
    return runs;
}

/**
 * The key a line is lined up by: the line as the lint leaves it alone. The
 * lint only changes the footnotes on a line, never its other text: it
 * renumbers references, turns a reference into an inline footnote and
 * back, moves a footnote past the punctuation next to it, and takes out a
 * reference with the space before it. So every "[^...]" (references and
 * labels alike) and every inline footnote "^[...]" is taken out, and each
 * run of spaces becomes one space, with none at the end. A line the lint
 * rewrote in place then has the same key before and after, and is lined
 * up with itself. (An inline footnote used to be left in the key, so
 * "- item^[note]." and the "- item.^[note]" the punctuation rule makes of
 * it did not match, and a fold on that item was dropped: hunt 2026-10-05
 * round 2, cluster D5, pin bug-fold-list-item-rewritten-in-place.)
 */
function lineKey(line: string): string {
    // most lines hold no footnote, and two searches are quicker than the scan
    const plain = line.includes("[^") || line.includes("^[") ? withoutFootnotes(line) : line;
    return plain.replace(/\s+/g, " ").trimEnd();
}

/**
 * `line` with every "[^...]" and every inline footnote "^[...]" taken
 * out. An inline footnote ends at the "]" that balances its "[", so one
 * that holds a link ("^[see [Smith](https://example.com) p. 5]") or a
 * wikilink ("^[[[Smith 2020]], p. 5]") is taken out whole; a pattern that
 * stopped at the first "]" left the rest of it behind, and a heading
 * converted to hold such a footnote lost its fold (hunt 2026-10-05 round
 * 2, cluster D4, pin bug-convert-fold-dropped-under-converted-definitions).
 * An inline footnote whose "]" is on a later line is left as it is: the
 * lint does not change it.
 */
function withoutFootnotes(line: string): string {
    let out = "";
    let i = 0;
    while (i < line.length) {
        if (line.startsWith("[^", i)) {
            const close = line.indexOf("]", i + 2);
            if (close !== -1) {
                i = close + 1;
                continue;
            }
        } else if (line.startsWith("^[", i)) {
            const close = balancedClose(line, i + 1);
            if (close !== -1) {
                i = close + 1;
                continue;
            }
        }
        out += line[i];
        i++;
    }
    return out;
}

/** Where the "]" that balances the "[" at `open` in `line` is, or -1 when the line has none. A character after a backslash does not count. */
function balancedClose(line: string, open: number): number {
    let depth = 0;
    for (let i = open; i < line.length; i++) {
        const char = line[i];
        if (char === "\\") i++;
        else if (char === "[") depth++;
        else if (char === "]" && --depth === 0) return i;
    }
    return -1;
}

/**
 * `runs` (from lines `a` and `b` compared without their references) with
 * every pair of lines they leave matched whose full text differs added as
 * a run of its own, one line for one line, and runs that touch merged
 * into one, so each run is still one edit.
 */
function withRewrittenLines(runs: readonly Run[], a: readonly string[], b: readonly string[]): Run[] {
    const out: Run[] = [];
    const add = (run: Run) => {
        const last = out.at(-1);
        if (last !== undefined && last.aEnd === run.aStart && last.bEnd === run.bStart) {
            last.aEnd = run.aEnd;
            last.bEnd = run.bEnd;
        } else {
            out.push({ ...run });
        }
    };
    let i = 0;
    let j = 0;
    for (const run of [...runs, { aStart: a.length, aEnd: a.length, bStart: b.length, bEnd: b.length }]) {
        // the matched lines before this run, which pair up one for one
        for (; i < run.aStart; i++, j++) {
            if (a[i] !== b[j]) add({ aStart: i, aEnd: i + 1, bStart: j, bEnd: j + 1 });
        }
        if (run.aEnd > run.aStart || run.bEnd > run.bStart) add(run);
        i = run.aEnd;
        j = run.bEnd;
    }
    return out;
}

/**
 * For each line of `lines`, whether it is prose: a line with text on it
 * that is no part of a footnote definition, read the way Obsidian reads the
 * note (so a "[^1]: x" line inside a code block is prose).
 */
function proseLines(lines: readonly string[]): boolean[] {
    const prose = lines.map((line) => line.trim() !== "");
    for (const definition of readNote(lines).definitions) {
        for (let line = definition.start; line <= definition.end; line++) prose[line] = false;
    }
    return prose;
}

/**
 * unmatchedRuns, with the prose lines lined up before the rest.
 *
 * Myers' diff keeps the most lines it can, and a lint that gathers a block
 * of definitions at the bottom moves more lines than the prose it moves
 * them past. Lining up every line at once, the diff kept the definitions
 * where they were and took the prose line between them and the bottom as
 * the line that moved: deleted below them and written again above them.
 * The caret on that line, the line the user was typing on, went with the
 * deleted copy and landed on the last definition (hunt 2026-10-05, cluster
 * D1, pin bug-caret-below-moved-definitions). The lint never moves prose
 * (it only rewrites the footnotes on a line), so the prose lines are lined
 * up first, on their own, and only the stretches between two paired prose
 * lines are then compared line by line, definitions, blank lines, and all.
 * `proseA` and `proseB` say which lines of `a` and `b` are prose
 * (proseLines).
 */
function proseFirstRuns(a: readonly string[], b: readonly string[], proseA: readonly boolean[], proseB: readonly boolean[]): Run[] {
    const linesA = a.flatMap((_, i) => (proseA[i] ? [i] : []));
    const linesB = b.flatMap((_, i) => (proseB[i] ? [i] : []));
    const pairs = matchedPairs(
        linesA,
        linesA.map((i) => a[i]),
        linesB,
        linesB.map((i) => b[i]),
    );
    const runs: Run[] = [];
    let aFrom = 0;
    let bFrom = 0;
    for (const [aLine, bLine] of [...pairs, [a.length, b.length] as [number, number]]) {
        for (const run of unmatchedRuns(a.slice(aFrom, aLine), b.slice(bFrom, bLine))) {
            runs.push({ aStart: run.aStart + aFrom, aEnd: run.aEnd + aFrom, bStart: run.bStart + bFrom, bEnd: run.bEnd + bFrom });
        }
        aFrom = aLine + 1;
        bFrom = bLine + 1;
    }
    return runs;
}

/**
 * Some lines of two texts, each given by its line number (`linesA`,
 * `linesB`) and a key to compare it by (`keysA`, `keysB`): the pairs of
 * line numbers whose keys Myers' diff matches, in order.
 */
function matchedPairs(linesA: readonly number[], keysA: readonly string[], linesB: readonly number[], keysB: readonly string[]): [number, number][] {
    const pairs: [number, number][] = [];
    let ai = 0;
    let bi = 0;
    for (const run of [...unmatchedRuns(keysA, keysB), { aStart: keysA.length, bStart: keysB.length, aEnd: 0, bEnd: 0 }]) {
        // the lines between one unmatched run and the next match
        while (ai < run.aStart && bi < run.bStart) pairs.push([linesA[ai++], linesB[bi++]]);
        ai = run.aEnd;
        bi = run.bEnd;
    }
    return pairs;
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
 *
 * A folded heading never reaches past its own section afterwards: the
 * fold ends on the line before the next heading of the same level or a
 * higher one, which is where Obsidian ends a heading's fold. Without
 * that, a section folded at the end of the note took in the footnote
 * section heading the lint added below it, and every definition under
 * that heading (Jason's report, sheet 12, 2026-10-04: a "# Footnotes"
 * heading folded away inside a level 2 heading's fold).
 */
export function mapFoldLines(folds: FoldRange[], changes: OffsetChange[], before: string): FoldRange[] {
    if (changes.length === 0) return folds;
    const after = applyOffsetChanges(before, changes);
    const afterLines = after.split("\n");
    const map = alignLines(before.split("\n"), afterLines);
    const sectionEnd = sectionEnds(afterLines);
    const out: FoldRange[] = [];
    for (const fold of folds) {
        if (fold.from >= map.length || fold.to >= map.length) continue;
        const from = map[fold.from].from;
        if (from === -1) continue;
        const to = Math.min(map[fold.to].to, sectionEnd(from));
        if (to > from) out.push({ from, to });
    }
    return out;
}

/**
 * For a line of `lines`, the last line a fold starting there may reach:
 * for a heading, the line before the next heading of the same level or a
 * higher one (the note's last line when there is none), since that is
 * where its section ends; for any other line, the note's last line. Only
 * headings outside quotes, lists, and footnotes count, read the way
 * Obsidian reads the note, so a "# " line inside a code block is no
 * heading.
 */
function sectionEnds(lines: string[]): (line: number) => number {
    const levelOf = headingLevels(lines);
    return (line) => {
        const level = levelOf(line);
        if (level === 0) return lines.length - 1;
        for (let next = line + 1; next < lines.length; next++) {
            const nextLevel = levelOf(next);
            if (nextLevel !== 0 && nextLevel <= level) return next - 1;
        }
        return lines.length - 1;
    };
}

/**
 * For a line of `lines`, its heading level (1 to 6), or 0 when it is no
 * heading. Only headings outside quotes, lists, and footnotes count, read
 * the way Obsidian reads the note, so a "# " line inside a code block is
 * no heading.
 */
function headingLevels(lines: string[]): (line: number) => number {
    const blocks = readNote(lines).lineBlocks;
    return (line) => {
        const heading = /^\^heading(\d)$/.exec(blocks[line] ?? "");
        return heading ? Number(heading[1]) : 0;
    };
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
 * Headings are lined up first, and the lines between two paired headings
 * are then lined up with each other only (alignRun). The lint never turns
 * a heading into anything else or a line into a heading: it only moves
 * footnotes on one, so a heading is matched by its level and its text
 * without footnotes (lineKey).
 * Lined up with the rest, a heading could lose out to look-alike lines: in
 * a note whose definitions all read "Ibid.", the blank lines and the
 * ": Ibid." lines left after the names are stripped matched better than
 * the headings did, so a fold came back on another section's paragraph
 * (hunt 2026-10-05, pin bug-fold-mapping-look-alike-lines). A heading the
 * lint rewrote in place right under a removed definition was paired by
 * position with the removed line, and its fold was dropped (hunt
 * 2026-10-02, cluster U1, and 2026-10-05, cluster PR4; pin
 * bug-convert-fold-dropped-under-converted-definitions). Obsidian refolds
 * a heading over its own section from the line a fold starts on, so
 * finding the heading again is what keeps the fold.
 */
function alignLines(a: string[], b: string[]): { from: number; to: number }[] {
    const anchorsA = headingKeys(a);
    const anchorsB = headingKeys(b);
    const pairs = matchedPairs(anchorsA.lines, anchorsA.keys, anchorsB.lines, anchorsB.keys);
    const proseA = proseLines(a);
    const proseB = proseLines(b);
    const map: { from: number; to: number }[] = [];
    let aFrom = 0;
    let bFrom = 0;
    for (const [aLine, bLine] of [...pairs, [a.length, b.length] as [number, number]]) {
        for (const { from, to } of alignRun(a.slice(aFrom, aLine), b.slice(bFrom, bLine), proseA.slice(aFrom, aLine), proseB.slice(bFrom, bLine))) {
            map.push({ from: from === -1 ? -1 : from + bFrom, to: to + bFrom });
        }
        if (aLine < a.length) map.push({ from: bLine, to: bLine });
        aFrom = aLine + 1;
        bFrom = bLine + 1;
    }
    return map;
}

/** The heading lines of `lines`, in order, and for each a key of its level and its text without footnotes (lineKey). */
function headingKeys(lines: string[]): { lines: number[]; keys: string[] } {
    const levelOf = headingLevels(lines);
    const out: { lines: number[]; keys: string[] } = { lines: [], keys: [] };
    for (let i = 0; i < lines.length; i++) {
        const level = levelOf(i);
        if (level === 0) continue;
        out.lines.push(i);
        out.keys.push(`${String(level)} ${lineKey(lines[i])}`);
    }
    return out;
}

/**
 * alignLines for a stretch of lines with no heading paired in it: the
 * same answer, for `a` and `b` on their own.
 *
 * Lines are matched by their text without footnotes (lineKey), because
 * the footnotes are what a lint changes: a renumbered line, or one whose
 * inline footnote moved past a full stop, is the same line, and matching
 * on the raw text paired up look-alike lines across each other instead.
 * Prose lines are lined up first, as lineDiffChanges does
 * (proseFirstRuns), so a line of prose the lint moved definitions past
 * stays the same line. Inside a run of lines that do not match, old lines and new
 * lines pair up by position; old lines left over past the new count are
 * gone; a fold ending on the run's last old line ends on the run's last
 * new line, so it grows or shrinks with the run; and a fold ending on a
 * line that was deleted outright ends on the line before the deletion.
 */
function alignRun(a: string[], b: string[], proseA: boolean[], proseB: boolean[]): { from: number; to: number }[] {
    const na = a.map(lineKey);
    const nb = b.map(lineKey);
    // The lines that match at the end are taken first, then those at the
    // start. The lint adds lines at the bottom of the note, so a stretch
    // that only grew grew at its end: its last line, often the note's
    // blank last line, is still its last line, and a fold that ran to it
    // still runs to the end (test/fold-heading-level.test.ts).
    let aTail = na.length;
    let bTail = nb.length;
    while (aTail > 0 && bTail > 0 && na[aTail - 1] === nb[bTail - 1]) {
        aTail--;
        bTail--;
    }
    let head = 0;
    while (head < aTail && head < bTail && na[head] === nb[head]) head++;
    const hunks = proseFirstRuns(na.slice(head, aTail), nb.slice(head, bTail), proseA.slice(head, aTail), proseB.slice(head, bTail));
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
export function applyOffsetChanges(before: string, changes: OffsetChange[]): string {
    let out = "";
    let copied = 0;
    for (const change of changes) {
        out += before.slice(copied, change.from) + change.text;
        copied = change.to;
    }
    return out + before.slice(copied);
}
