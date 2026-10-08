import { Editor, EditorChange, EditorPosition } from "obsidian";
import { NoFootnoteCreated } from "./notice";

import { contextOfLines, DocContext, docLines, insideDefinition } from "./doc-context";
import { escapedAt } from "../parsing/footnote-grammar";
import { drawnLinkShapes } from "../parsing/landing";
import { labelShapedLines } from "../parsing/label-shapes";
import { NoteReading, readNote } from "../parsing/note-reading";

// The born-dead safety kit. One question: once the text lands, will it
// still MEAN what it says?
//
// Two ways it can fail. The insertion is swallowed by whatever sits
// directly before it: an escaping backslash, or an inline-footnote opener.
// Or the insertion RECLASSIFIES the text around it, by completing a "$…$"
// math pair, or by demoting a quote whose region then swallows the appended
// definition. Every failure mode here was found by the command-press
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

/**
 * The shared view of the note as it WOULD read after writing `insert` at
 * `position`: the way a single insertion with no definition alongside it
 * (an inline footnote, a placeholder) is checked.
 *
 * An insertion can COMPLETE a construct around itself and so be masked
 * into it at birth: the case found was a "$...$" math pair whose contents
 * previously had a space at the edge (command-press property suite,
 * 2026-08-12). And one that fills the empty line under a definition joins
 * that definition (hunt 2026-10-02, cluster R2). The simulation runs
 * against the whole document, so region state spanning several lines is
 * honored.
 */
export function simulatedContext(doc: Editor, position: EditorPosition, insert: string): DocContext {
    return contextOfLines(simulateChanges(docLines(doc), [{ from: position, text: insert }]));
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

/**
 * What a creation's result means once it lands: "live" when it reads as
 * the footnote it promised; "link" when a reference died because Obsidian
 * reads it as part of a link, or the press undid a link reference
 * definition (the caller shows InsideLinkNotice and refuses); "dead" when
 * something else died, in code, math, or other protected text (the caller
 * shows ProtectedCreationNotice and refuses); "nested" when a reference
 * landed inside a definition (the caller shows NestedFootnoteNotice and
 * refuses); "label" when a reference would be read as a definition's label
 * (the caller shows BlockSyntaxNotice and refuses). The cause is decided
 * here, once, so every press shows the right notice without a check of its
 * own (Jason's ruling, 2026-10-04).
 */
export type InsertionVerdict = "live" | "dead" | "link" | "nested" | "label";

/**
 * The verdict for an insertion at `at` that did not land as itself: "link"
 * when the reading puts its first character inside a link, a reference
 * link, an image, or a wikilink, "dead" otherwise. "[sic][^1]" is a
 * reference link whose label is "^1", so the "[" of "[^1]" sits inside the
 * link (Jason's ruling, 2026-10-04).
 */
export function deadInsertionVerdict(after: NoteReading, at: EditorPosition): "dead" | "link" {
    return after.insideLink(at.line, at.ch) ? "link" : "dead";
}

/**
 * What a press does to the note around the text it writes, judged before
 * whether the text itself landed: "label" or "link" when the press must be
 * refused for that, null when it leaves the note as it was. `before` is the
 * note as it reads before the press, `after` the note as the press leaves
 * it, `anchors` where each copy of `text` begins in `after`.
 *
 * "label": a reference the note would read as a definition's label:
 * "[^1]: smile: done" written at the start of ":smile: done" defines a
 * footnote and points at none. A lazy label counts too, one directly
 * under a line of prose: Obsidian still reads its "[^1]" as a reference,
 * but the lint's Fix lazy definitions makes it a definition all the same.
 * And the named key's "[^]" counts as soon as a name typed into it would
 * make it a label. So the press refuses (hunt 2026-10-05, pins
 * bug-colon-line-start-label and spec-colon-line-start-notice; the notice
 * is Jason's pick, 2026-10-05).
 *
 * "link": the press leaves fewer link reference definitions ("[ref]:
 * http://u", which give "[x][ref]" links their address) than there were.
 * A reference written in one's label or after its address turns the line
 * into a paragraph, and every link that used it stops being one (hunt
 * 2026-10-05, Jason's pick of the triage's Q5, pin
 * spec-press-on-link-reference-definition). Or some link drawn before the
 * press is not drawn the same after it (fewerLinksDrawn): a selection
 * inside a defined "[some text]" turned into a footnote changes the link's
 * label, "[[^1] text]", which no definition carries, so the link is gone
 * (hunt 2026-10-05, round 2, pin bug-selection-kills-defined-shortcut-link);
 * a press between an embed's "!" and its "[[" leaves a plain link in its
 * place; a press inside a bare address cuts it short. A link the selection
 * takes whole moves into the footnote and is still drawn there.
 */
export function pressLineVerdict(
    before: NoteReading,
    after: DocContext,
    anchors: EditorPosition[],
    text: string,
): "label" | "link" | null {
    if (text.startsWith("[^") && anchors.some((anchor) => startsLabel(after, anchor, text))) return "label";
    const lost = linkDefinitionCount(after.reading()) < linkDefinitionCount(before) || fewerLinksDrawn(before, after.reading());
    return lost ? "link" : null;
}

/**
 * Whether some link `before` draws (drawnAsLink) is no longer drawn the
 * same in `after`. Each link is compared by its shape: its text in the
 * masked twin (the copy of the note where protected text, link addresses,
 * and bare web and email addresses are blotted out, every column kept), so
 * its "!", its brackets, and its length.
 *
 * Counting links was not enough. A press inside a bare address cuts it
 * short and still leaves one link drawn: "contact b[^1]ob@example.com"
 * links "ob@example.com", a different address, and in
 * "see ht[^1]tps://e.com/[t](u)" the address is gone and "[t](u)" is drawn
 * alone (hunt 2026-10-06, cycle 5, cluster X3, pin
 * bug-press-cuts-bare-address). And a press between an embed's "!" and its
 * "[[" writes "![^1][[file]]", a plain link where the picture was (hunt
 * 2026-10-06, cycle 4, cluster P2, pin
 * bug-press-between-image-bang-and-bracket). Compared by shape, both are a
 * link lost. A link a selection moves whole into a footnote keeps its
 * shape there.
 *
 * Each reading is judged with its own link labels unless a caller hands
 * in `linkLabels` (a table cell, whose reading has none of its own, hands
 * in the note's).
 */
export function fewerLinksDrawn(before: NoteReading, after: NoteReading, linkLabels?: ReadonlySet<string>): boolean {
    const now = new Map<string, number>();
    for (const shape of drawnLinkShapes(after, linkLabels ?? after.linkLabels)) now.set(shape, (now.get(shape) ?? 0) + 1);
    for (const shape of drawnLinkShapes(before, linkLabels ?? before.linkLabels)) {
        const left = now.get(shape) ?? 0;
        if (left === 0) return true;
        now.set(shape, left - 1);
    }
    return false;
}

/**
 * Whether the reference `text` written at `anchor` reads as a definition's
 * label in the note `after`: the label of a definition the reading finds,
 * or a lazy label (labelShapedLines), one a blank line above would make a
 * definition.
 *
 * The reader answers, not a count of columns. A column count refused a
 * press at the start of a heading's text ("# [^1]:rocket: Launch plan" is
 * a heading with a live reference) and on a line four spaces in under a
 * paragraph ("    [^1]:x done" is a lazy line of the paragraph, and four
 * spaces is too far in for a label), though neither is a label (Obsidian
 * 1.14.4, asked live 2026-10-05; hunt 2026-10-05, round 2, pin
 * bug-false-label-refusal). In a list item or a quote, where a definition
 * counts as well, the reader finds the label all the same.
 */
function startsLabel(after: DocContext, anchor: EditorPosition, text: string): boolean {
    const line = after.lines[anchor.line] ?? "";
    // a label ends in "]:", so with no ":" right after the reference the
    // question does not arise, and most presses stop here
    if (line[anchor.ch + text.length] !== ":") return false;
    // An empty "[^]" reads as nothing until a name is typed into it, so the
    // note is read with a name in it.
    let lines = after.lines;
    let reading = after.reading();
    if (text === "[^]") {
        lines = [...after.lines];
        lines[anchor.line] = line.slice(0, anchor.ch) + "[^x]" + line.slice(anchor.ch + text.length);
        reading = readNote(lines);
    }
    if (reading.labelsOn(anchor.line).some((label) => label.start === anchor.ch)) return true;
    // A lazy label starts its line's text inside its containers, at most
    // three spaces in, so a line that holds one holds it at the reference
    // when only spaces come between the containers' end and the reference.
    if (!/^ *$/.test(line.slice(reading.containerEnd(anchor.line), anchor.ch))) return false;
    return labelShapedLines(lines).some((label) => label.line === anchor.line);
}

/** How many link reference definitions the note holds: the lines where the reading starts a "definition" block (a footnote's is a "footnoteDefinition"). */
function linkDefinitionCount(reading: NoteReading): number {
    return reading.lineBlocks.filter((blocks) => /(?:^| )\^definition(?: |$)/.test(blocks)).length;
}

/** Whether `line` belongs to a link reference definition "[ref]: http://u": its label's line, or a line its address or title runs on to, as the reading marks its blocks. */
export function onLinkDefinition(reading: NoteReading, line: number): boolean {
    return /(?:^| )\^?definition(?: |$)/.test(reading.lineBlocks[line] ?? "");
}

/**
 * The shared born-dead verdict for any insertion that comes with a
 * definition: the single-caret insert, the multi-caret press, and the
 * selection conversion (one copy since 2026-08-25).
 *
 * It judges the note exactly as the transaction will leave it (`lines`,
 * from planDefinitionAppend), and three things must hold. The definition
 * must read as a live definition block that starts at `definitionLabelLine`
 * and claims every continuation line seeded under it. Every reference the
 * press writes must read as a live "[^id]" at its spot in `anchors`. And no
 * such reference may sit inside any definition: an empty line the
 * reference fills can join the definition above it, as its lazy
 * continuation, and the plugin never creates a nested footnote (ADR 0001;
 * hunt 2026-10-02, pin bug-press-blank-line-under-definition-nests).
 *
 * Before all that, the press must leave the note around its references
 * as it was (pressLineVerdict). One dead or nested landing refuses the
 * whole press. Every "dead" failure
 * mode was found by the command-press property suite (2026-08-12). A
 * reference that dies inside a link gets "link" instead, so the press can
 * say so (deadInsertionVerdict; Jason's ruling, 2026-10-04).
 */
export function verifyLiveFootnoteInsertion(opts: {
    /** the note as it reads before the press */
    before: NoteReading;
    /** the note as the transaction leaves it */
    lines: string[];
    /** where each reference the press writes begins, in `lines` */
    anchors: EditorPosition[];
    footnoteId: string;
    /** the definition label's line in `lines` */
    definitionLabelLine: number;
    /** how many continuation lines are seeded under the label, for a
     * definition whose body runs over several lines */
    definitionBodyExtraLines?: number;
}): InsertionVerdict {
    const ctx = contextOfLines(opts.lines);
    // what the press does to the lines around its references comes first:
    // a reference read as a label is not there to be found as a reference
    const aroundIt = pressLineVerdict(opts.before, ctx, opts.anchors, `[^${opts.footnoteId}]`);
    if (aroundIt !== null) return aroundIt;
    const bodyExtraLines = opts.definitionBodyExtraLines ?? 0;
    // the new definition must read as one at the top level of the note,
    // where the plugin writes it, running at least over its seeded body
    const label = ctx.reading().labelOn(opts.definitionLabelLine);
    const definitionLive = label !== null && label.movable && label.end >= opts.definitionLabelLine + bodyExtraLines;
    if (!definitionLive) return "dead";
    // the first reference that would not read as a live "[^id]" at its spot
    // decides the verdict, and the reading says why: a link took it in, or
    // something else did
    const deadAnchor = opts.anchors.find(
        (anchor) =>
            !ctx
                .reading()
                .referencesOn(anchor.line)
                .some((occurrence) => occurrence.start === anchor.ch && occurrence.name === opts.footnoteId),
    );
    if (deadAnchor !== undefined) return deadInsertionVerdict(ctx.reading(), deadAnchor);
    return opts.anchors.some((anchor) => insideDefinition(ctx, anchor.line)) ? "nested" : "live";
}
