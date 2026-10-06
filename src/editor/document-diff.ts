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
    const runs = proseFirstRuns(middleA.map(lineKey), middleB.map(lineKey), lineKinds(a).slice(head, aTail), lineKinds(b).slice(head, bTail));
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
 * reference with the space next to it. So every "[^...]" (references and
 * labels alike) and every inline footnote "^[...]" is taken out, and each
 * run of spaces becomes one space, with none at either end. A line the lint
 * rewrote in place then has the same key before and after, and is lined
 * up with itself. (A space was left at the front: "[^2] alpha[^1] bravo."
 * keyed as " alpha bravo.", and once Delete orphaned references took out
 * "[^2] " the line keyed as "alpha bravo.", so it was taken as deleted and
 * written again, and the caret at its end went to a definition the lint
 * moved past it: hunt 2026-10-06, cycle 5, cluster X21, pin
 * bug-linekey-leading-space.) (An inline footnote used to be left in the key, so
 * "- item^[note]." and the "- item.^[note]" the punctuation rule makes of
 * it did not match, and a fold on that item was dropped: hunt 2026-10-05
 * round 2, cluster D5, pin bug-fold-list-item-rewritten-in-place.)
 *
 * A line that holds nothing but footnotes, such as "[^1]", keeps them in
 * its key. Taken out, they left nothing to recognise the line by: every
 * such line keyed as "", the same as a blank line and as each other. When
 * the lint emptied one of them (an orphaned "[^9]" taken out), the line-up
 * paired the emptied line's old text with another untouched "[^1]" line,
 * and the caret on that line jumped to the next paragraph or to a moved
 * definition (hunt 2026-10-06 cycle 3, cluster D1, pin
 * bug-caret-reference-only-line).
 */
function lineKey(line: string): string {
    // most lines hold no footnote, and two searches are quicker than the scan
    const plain = line.includes("[^") || line.includes("^[") ? withoutFootnotes(line) : line;
    const key = plain.replace(/\s+/g, " ").trim();
    return key === "" ? line.replace(/\s+/g, " ").trim() : key;
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
 * a run of its own, one line for one line, so each line rewritten in place
 * is an edit of its own.
 *
 * A rewritten line is never merged with the run next to it. Merged, the
 * edit spanned from the first changed character of the one line to the
 * last changed character of the other, and a caret after the changed
 * characters of the first line went to the edit's start: with two
 * neighbouring list items renumbered, the caret in "- apple[^2] is red"
 * jumped into the reference (hunt 2026-10-06 cycle 3, cluster D3, pin
 * bug-caret-merged-rewrite-runs). Kept apart, each edit is trimmed to its
 * own changed characters. They still never overlap: a rewritten line's
 * edit stops before its line break, and the edits of the runs next to it
 * start at a line's start or end at the line break before it.
 */
function withRewrittenLines(runs: readonly Run[], a: readonly string[], b: readonly string[]): Run[] {
    const out: Run[] = [];
    let i = 0;
    let j = 0;
    for (const run of [...runs, { aStart: a.length, aEnd: a.length, bStart: b.length, bEnd: b.length }]) {
        // the matched lines before this run, which pair up one for one
        for (; i < run.aStart; i++, j++) {
            if (a[i] !== b[j]) out.push({ aStart: i, aEnd: i + 1, bStart: j, bEnd: j + 1 });
        }
        if (run.aEnd > run.aStart || run.bEnd > run.bStart) out.push(run);
        i = run.aEnd;
        j = run.bEnd;
    }
    return out;
}

/**
 * What a line is, for lining up two versions of a note: "prose" is a line
 * with text on it that is no part of a footnote definition, read the way
 * Obsidian reads the note (so a "[^1]: x" line inside a code block is
 * prose); "citation" is such a line that holds nothing but footnotes, such
 * as "[^4]" under a paragraph; "other" is everything else (blank lines and
 * the lines of definitions).
 */
type LineKind = "prose" | "citation" | "other";

/** For each line of `lines`, what it is (LineKind). */
function lineKinds(lines: readonly string[]): LineKind[] {
    const kinds = lines.map((line): LineKind => {
        if (line.trim() === "") return "other";
        return (line.includes("[^") || line.includes("^[")) && withoutFootnotes(line).trim() === "" ? "citation" : "prose";
    });
    for (const definition of readNote(lines).definitions) {
        for (let line = definition.start; line <= definition.end; line++) kinds[line] = "other";
    }
    return kinds;
}

/**
 * unmatchedRuns, with the prose lines lined up before the rest, and then
 * the citation lines.
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
 * `kindsA` and `kindsB` say what each line of `a` and `b` is (lineKinds).
 *
 * A citation line is lined up only after the prose, inside the stretch
 * between two paired prose lines (citationPairs). Its key is its own text,
 * names and all, since without them it has nothing to be told apart by;
 * but a lint that renumbers rewrites those names, so in the prose line-up
 * the old "[^4]" under one paragraph matched the new "[^4]" under another,
 * and to make the rest fit, unchanged paragraph lines were rewritten into
 * their neighbours' text: the caret on "Fourth paragraph." ended on "Third
 * paragraph." (hunt 2026-10-06 cycle 4, cluster D1, pin
 * bug-diff-citation-lines-outrank-prose).
 */
function proseFirstRuns(a: readonly string[], b: readonly string[], kindsA: readonly LineKind[], kindsB: readonly LineKind[]): Run[] {
    const linesA = a.flatMap((_, i) => (kindsA[i] === "prose" ? [i] : []));
    const linesB = b.flatMap((_, i) => (kindsB[i] === "prose" ? [i] : []));
    const prosePairs = matchedPairs(
        linesA,
        linesA.map((i) => a[i]),
        linesB,
        linesB.map((i) => b[i]),
    );
    // the citation lines of each stretch between two paired prose lines,
    // paired up, with the prose pairs in order
    const pairs: [number, number][] = [];
    let aCitation = 0;
    let bCitation = 0;
    for (const [aLine, bLine] of [...prosePairs, [a.length, b.length] as [number, number]]) {
        const citationsA: number[] = [];
        const citationsB: number[] = [];
        for (; aCitation < aLine; aCitation++) if (kindsA[aCitation] === "citation") citationsA.push(aCitation);
        for (; bCitation < bLine; bCitation++) if (kindsB[bCitation] === "citation") citationsB.push(bCitation);
        pairs.push(...citationPairs(citationsA, citationsA.map((i) => a[i]), citationsB, citationsB.map((i) => b[i])));
        if (aLine < a.length) pairs.push([aLine, bLine]);
        aCitation = aLine + 1;
        bCitation = bLine + 1;
    }
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
 * Above this many comparisons (citation lines of the one side times those
 * of the other, in one stretch) citationPairs pairs by text alone, so a
 * note of thousands of citation lines with no prose between them never
 * stalls the app.
 */
const MaxCitationComparisons = 1_000_000;

/**
 * The citation lines of one stretch between two paired prose lines, each
 * given by its line number (`linesA`, `linesB`) and its key (`keysA`,
 * `keysB`): the pairs that line them up, in order. As many are paired as
 * the two counts allow, and of the ways to do that, the one that pairs the
 * most lines with the same text is taken.
 *
 * The lint never moves a citation line and never adds one; it rewrites the
 * names on it, or empties it when it takes out an orphaned reference. So
 * with as many citation lines after as before, each is the one in the same
 * place: two neighbouring lines "[^2]" and "[^1]" whose names the lint
 * swapped are each rewritten in place, and the caret at the end of the
 * first stays there (hunt 2026-10-06 cycle 4, cluster D2, pin
 * bug-diff-swapped-reference-only-lines; paired by text, the one was
 * deleted and written again below the other). With fewer after, the one
 * the lint emptied is the one left out, and the text says which: when the
 * orphaned "[^9]" is taken out above an untouched "[^1]", the "[^1]" lines
 * pair up, not the "[^9]" line with the "[^1]" line (hunt 2026-10-06 cycle
 * 3, cluster D1, pin bug-caret-reference-only-line).
 *
 * The answer is worked out on a table of the best pairing of each start of
 * the one list with each start of the other (a longest-common-subsequence
 * table that scores a pair of lines with the same text a little higher than
 * any other pair).
 */
function citationPairs(linesA: readonly number[], keysA: readonly string[], linesB: readonly number[], keysB: readonly string[]): [number, number][] {
    const n = keysA.length;
    const m = keysB.length;
    if (n === 0 || m === 0) return [];
    if (n * m > MaxCitationComparisons) return matchedPairs(linesA, keysA, linesB, keysB);
    // A pair is worth more than every same-text bonus together, so the
    // count of pairs comes first and the same text breaks ties.
    const pairWorth = Math.min(n, m) + 1;
    // best[i * (m + 1) + j]: the best score for lines i.. of A and j.. of B
    const best = new Int32Array((n + 1) * (m + 1));
    const at = (i: number, j: number) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            const paired = best[at(i + 1, j + 1)] + pairWorth + (keysA[i] === keysB[j] ? 1 : 0);
            best[at(i, j)] = Math.max(paired, best[at(i + 1, j)], best[at(i, j + 1)]);
        }
    }
    // walk the table from the start, taking a pair wherever it is part of the best score
    const pairs: [number, number][] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (best[at(i, j)] === best[at(i + 1, j + 1)] + pairWorth + (keysA[i] === keysB[j] ? 1 : 0)) {
            pairs.push([linesA[i], linesB[j]]);
            i++;
            j++;
        } else if (best[at(i, j)] === best[at(i + 1, j)]) {
            i++;
        } else {
            j++;
        }
    }
    return pairs;
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
 *
 * A definition the lint moved is then found again by its text
 * (findMovedDefinitions), so a fold on it follows it.
 */
function alignLines(a: string[], b: string[]): { from: number; to: number }[] {
    const anchorsA = headingKeys(a);
    const anchorsB = headingKeys(b);
    const pairs = matchedPairs(anchorsA.lines, anchorsA.keys, anchorsB.lines, anchorsB.keys);
    const kindsA = lineKinds(a);
    const kindsB = lineKinds(b);
    const map: { from: number; to: number }[] = [];
    let aFrom = 0;
    let bFrom = 0;
    for (const [aLine, bLine] of [...pairs, [a.length, b.length] as [number, number]]) {
        for (const { from, to } of alignRun(a.slice(aFrom, aLine), b.slice(bFrom, bLine), kindsA.slice(aFrom, aLine), kindsB.slice(bFrom, bLine))) {
            map.push({ from: from === -1 ? -1 : from + bFrom, to: to + bFrom });
        }
        if (aLine < a.length) map.push({ from: bLine, to: bLine });
        aFrom = aLine + 1;
        bFrom = bLine + 1;
    }
    findMovedDefinitions(map, a, b);
    return map;
}

/**
 * `map` (alignLines of `a` to `b`) with each definition the lint moved
 * mapped to where it now is, found by its text without footnotes
 * (lineKey), its lines one for one.
 *
 * The line-up keeps the prose in place and takes a definition the lint
 * moved to the bottom as lines deleted in one place and inserted in
 * another, so a fold on the definition (Obsidian folds a line followed by
 * more indented lines, such as a definition with an indented second line)
 * had no line to start on and was dropped (hunt 2026-10-06 cycle 3,
 * cluster D2, pin bug-fold-moved-definition). Only the folds and the
 * other panes' carets read this map; the edits themselves
 * (lineDiffChanges) are left as they are, so the caret on the line being
 * typed still stays put (pin bug-caret-below-moved-definitions).
 *
 * A definition of `a` is first looked for under its own name, as the lint
 * renamed it (renamesOf), with the same text: two definitions with the
 * same text ("twins", such as two "Ibid." footnotes) are told apart only
 * by their names. Found by text alone, the first one moved took the first
 * twin below whatever its name, so a fold on [^2]'s definition came back
 * on [^1]'s, and an orphaned twin the lint deleted took the place of the
 * used one, whose fold was dropped (hunt 2026-10-06 cycle 4, cluster D3,
 * pin bug-fold-follows-wrong-twin).
 *
 * A definition not found that way that the line-up already put on a line
 * with its own key stays where it was put, and the definition there is
 * taken. Each other definition the lint can move takes the first
 * definition of `b` with the same text that no other has taken.
 */
function findMovedDefinitions(map: { from: number; to: number }[], a: string[], b: string[]): void {
    const textOf = (lines: string[], start: number, end: number) => lines.slice(start, end + 1).map(lineKey).join("\n");
    const renamed = renamesOf(map, a, b);
    // the movable definitions of `b` not taken yet, by their text: the
    // line each starts on, in order; and by their name, folded to lower
    // case as Obsidian compares names
    const free = new Map<string, number[]>();
    const named = new Map<string, { start: number; text: string }>();
    for (const definition of readNote(b).definitions) {
        if (!definition.movable) continue;
        const text = textOf(b, definition.start, definition.end);
        free.set(text, [...(free.get(text) ?? []), definition.start]);
        const name = definition.name.toLowerCase();
        if (!named.has(name)) named.set(name, { start: definition.start, text });
    }
    const take = (text: string, start: number) => {
        const starts = free.get(text);
        if (starts?.includes(start)) starts.splice(starts.indexOf(start), 1);
    };
    const place = (start: number, end: number, now: number) => {
        for (let line = start; line <= end; line++) map[line] = { from: now + line - start, to: now + line - start };
    };
    // the lines of `b` where a definition found by its name starts
    const takenByName = new Set<number>();
    const unnamed: { start: number; end: number; text: string }[] = [];
    for (const definition of readNote(a).definitions) {
        if (!definition.movable) continue;
        const text = textOf(a, definition.start, definition.end);
        const name = definition.name.toLowerCase();
        const twin = named.get(renamed.get(name) ?? name);
        if (twin !== undefined && twin.text === text && free.get(text)?.includes(twin.start)) {
            take(text, twin.start);
            takenByName.add(twin.start);
            place(definition.start, definition.end, twin.start);
        } else {
            unnamed.push({ start: definition.start, end: definition.end, text });
        }
    }
    const lost: { start: number; end: number; text: string }[] = [];
    for (const definition of unnamed) {
        const now = map[definition.start].from;
        if (now !== -1 && !takenByName.has(now) && lineKey(b[now]) === lineKey(a[definition.start])) {
            take(definition.text, now);
        } else {
            lost.push(definition);
        }
    }
    for (const { start, end, text } of lost) {
        const now = free.get(text)?.shift();
        if (now !== undefined) place(start, end, now);
    }
}

/**
 * The names the lint gave the footnotes, read off the lines it rewrote in
 * place: for each line of `a` that `map` (alignLines) puts on a line of
 * `b` with the same text without footnotes, the references on the two
 * lines pair up in order, so a "[^3]" that became "[^1]" maps "3" to "1".
 * Names are folded to lower case, as Obsidian compares them. A name the
 * lines say nothing about is missing from the map; the first pairing seen
 * for a name wins.
 */
function renamesOf(map: readonly { from: number; to: number }[], a: string[], b: string[]): Map<string, string> {
    const readingA = readNote(a);
    const readingB = readNote(b);
    const renamed = new Map<string, string>();
    for (let line = 0; line < map.length; line++) {
        const now = map[line].from;
        if (now === -1 || !a[line].includes("[^") || lineKey(a[line]) !== lineKey(b[now])) continue;
        const before = readingA.referencesOn(line);
        const after = readingB.referencesOn(now);
        if (before.length !== after.length) continue;
        before.forEach((reference, k) => {
            const name = reference.name.toLowerCase();
            if (!renamed.has(name)) renamed.set(name, after[k].name.toLowerCase());
        });
    }
    return renamed;
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
function alignRun(a: string[], b: string[], kindsA: LineKind[], kindsB: LineKind[]): { from: number; to: number }[] {
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
    const hunks = proseFirstRuns(na.slice(head, aTail), nb.slice(head, bTail), kindsA.slice(head, aTail), kindsB.slice(head, bTail));
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
