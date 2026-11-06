import { rulePasses } from "../rule-gate";
import { BlockquotePrefix } from "../../parsing/label-shapes";
import { definitionCuts, normalizeEol, removeLineRangesKeeping, restoreEol } from "../../parsing/line-edits";
import { Definition, NoteReading, readNote } from "../../parsing/note-reading";
import { FootnoteRule } from "../rule";

// Deleting orphaned definitions, as a rule of its own (2026-08-10).
//
// This used to live inside reindex, as its keepOrphanedDefinitions option.
// That option is gone (hunt 2026-10-05 round 2, cluster L7: its cut skipped
// the check below on how the lines around a cut read), so this rule is the
// only place the lint deletes an orphaned definition. It is a rule of its
// own for two reasons: the "Delete orphaned
// definitions" toggle then works even with reindexing switched off, and the
// two orphan settings behave the same as each other.
//
// Deletion follows the chain. A definition kept alive only by a reference in
// another definition's body dies when that one dies, however long the chain
// gets, and it all happens in ONE call, so the repeat limit in reindex never
// comes into it. Definitions that reference each other in a ring count as
// referenced and survive, exactly as they do under reindex. Every
// definition takes part, wherever it sits: at the top level, in a quote or
// callout, in a list item (Jason's ruling 1, option a, 2026-10-03), or
// inside another footnote. A definition that is never cut (its label
// follows other text on its line, such as a "%%" closer or a callout's
// title) keeps every reference in its body alive: Reading view still shows
// the footnote such a body cites, so cutting it would orphan a live
// reference (GLM hunt cycle 9, probed 2026-09-16), and the alert names it
// instead (ADR 2).
//
// A cut takes the label and the indented lines under it. A line under the label
// that is not indented stays behind as prose. Obsidian reads such a line as more
// of the footnote, but the user may well have written it as a paragraph: a label
// typed into the middle of one gets its blank line from Fix definitions, and the
// rest of the paragraph then reads as the footnote's text. This reverses an older
// ruling, for data loss (hunt 2026-11-06, cycle 10, replacing cycle 9's H13; pin
// spec-orphan-cut-leaves-lazy-lines). Delete footnote everywhere and the cut that
// carries definitions still take those lines: there the user asked for that
// footnote to go, or the clipboard keeps its text.

/** How many characters a line's quote markers take. */
function quoteMarkersLength(line: string): number {
    return BlockquotePrefix.exec(line)?.[0].length ?? 0;
}

/**
 * Whether line `line`, in the body of `owner`, stays behind when `owner` is cut:
 * it has text, and it starts to the left of the four columns past the label that
 * would make it the footnote's own, so it reads as the footnote's text only
 * because a paragraph carries on across it. Both columns are counted from after
 * the quote markers, and a tab runs on to the next multiple of four, as Obsidian
 * reads it (pin bug-quoted-definition-tab-continuation).
 */
function staysBehind(lines: readonly string[], owner: Definition, line: number): boolean {
    if (line === owner.start) return false;
    const text = lines[line].slice(quoteMarkersLength(lines[line]));
    if (text.trim() === "") return false;
    let indent = 0;
    for (const character of /^[ \t]*/.exec(text)?.[0] ?? "") indent += character === "\t" ? 4 - (indent % 4) : 1;
    return indent < owner.labelStart - quoteMarkersLength(lines[owner.start]) + 4;
}

interface ReferenceScan {
    blocks: readonly Definition[];
    /**
     * For each name, lower-cased, how many references to it there are on
     * lines OUTSIDE every definition.
     */
    liveRefs: Map<string, number>;
    /**
     * One entry per definition: the names, lower-cased, that its own lines
     * reference (a line inside a nested definition counts for the innermost).
     */
    blockRefs: string[][];
}

function scanReferences(lines: string[]): ReferenceScan {
    const reading = readNote(lines);
    const blocks = reading.definitions;
    const indexOf = new Map(blocks.map((block, i) => [block, i]));

    // The live references, as the note reading finds them. No definition
    // label ever counts as a reference: a label defines a footnote, it does
    // not point at one, and counting labels as references kept orphaned
    // definitions alive. A LAZY label's "[^x]" is a reference, because
    // that is how it renders, and it does keep the definition it points at
    // alive. So does a reference on a line that stays behind when the definition
    // around it is cut: that line is the user's prose, and cutting what it cites
    // would leave it citing nothing.
    const liveRefs = new Map<string, number>();
    const blockRefs: string[][] = blocks.map(() => []);
    for (let i = 0; i < lines.length; i++) {
        const owner = reading.definitionAt(i);
        for (const { name: raw } of reading.referencesOn(i)) {
            const name = raw.toLowerCase();
            if (owner === null || staysBehind(lines, owner, i)) {
                liveRefs.set(name, (liveRefs.get(name) ?? 0) + 1);
            } else {
                blockRefs[indexOf.get(owner) ?? 0].push(name);
            }
        }
    }
    return { blocks, liveRefs, blockRefs };
}

/**
 * The definition blocks nothing keeps alive.
 *
 * The method: go round removing every definition whose name has no
 * references left, and each time one goes, take away the references its own
 * body was making. Repeat until a round removes nothing. Two definitions
 * sharing a name live or die together, since a reference to that name is a
 * reference to both.
 *
 * This always finishes, because every round but the last removes at least
 * one block.
 */
function orphanedBlocks(referenceScan: ReferenceScan): Definition[] {
    const { blocks } = referenceScan;
    // A definition can hold another one inside its body, as an indented
    // "[^b]: inner" under "[^a]: outer". Cutting the outer one takes the
    // inner one's lines with it, so an outer definition may only die when
    // every definition it holds dies too. One that would die while
    // something inside it lives is kept, like a definition the rule never
    // cuts, and the count is run again, since keeping it keeps the
    // references in its body alive as well (hunt 2026-10-05, pin
    // bug-nested-definition-deleted-with-outer; ADR 0001: hand-typed
    // nesting is reported, never destroyed).
    const held = blocks.map((_, i) => heldIndices(blocks, i));
    const kept = new Set<number>();
    for (;;) {
        const alive = survivors(referenceScan, kept);
        const holders = blocks.flatMap((_, i) => (!alive.has(i) && held[i].some((j) => alive.has(j)) ? [i] : []));
        if (holders.length === 0) return blocks.filter((_, i) => !alive.has(i));
        for (const i of holders) kept.add(i);
    }
}

/**
 * Which definitions, by their index in the scan, stay alive once every
 * unreferenced one is taken away, round after round, as orphanedBlocks
 * describes. The definitions in `kept` stay whatever their references,
 * as a definition that is not removable does.
 */
function survivors(referenceScan: ReferenceScan, kept: ReadonlySet<number>): Set<number> {
    const { blocks, liveRefs, blockRefs } = referenceScan;
    const refCount = new Map(liveRefs);
    for (const refs of blockRefs) {
        for (const name of refs) {
            refCount.set(name, (refCount.get(name) ?? 0) + 1);
        }
    }
    const alive = new Set(blocks.map((_, i) => i));
    let changed = true;
    while (changed) {
        changed = false;
        for (const i of [...alive]) {
            if ((refCount.get(blocks[i].name.toLowerCase()) ?? 0) > 0) continue;
            // a definition the rule never cuts stays, references and all
            if (!blocks[i].removable || kept.has(i)) continue;
            alive.delete(i);
            for (const name of blockRefs[i]) {
                refCount.set(name, (refCount.get(name) ?? 0) - 1);
            }
            changed = true;
        }
    }
    return alive;
}

/**
 * The definitions that sit inside `outer`'s body: their labels are on one
 * of its continuation lines, so cutting `outer` from its label line to its
 * last line would cut them too. `definitions` is the note reading's list.
 * Shared by the orphan rule, the Delete footnote command, and the nesting
 * alert (hunt 2026-10-05, pin bug-nested-definition-deleted-with-outer).
 */
export function definitionsHeldBy(definitions: readonly Definition[], outer: Definition): Definition[] {
    return heldIndices(definitions, definitions.indexOf(outer)).map((j) => definitions[j]);
}

/**
 * The indices of the definitions inside definition `i`'s body. The
 * reading lists definitions in the order of their labels, so these are the
 * ones straight after it whose labels still fall within its lines.
 */
function heldIndices(definitions: readonly Definition[], i: number): number[] {
    const out: number[] = [];
    if (i < 0) return out;
    for (let j = i + 1; j < definitions.length && definitions[j].start <= definitions[i].end; j++) {
        if (definitions[j].start > definitions[i].start) out.push(j);
    }
    return out;
}

/**
 * The list the alert reads out: the names of definitions nothing
 * references, each once, spelled as they were written, in the order the
 * definitions appear.
 *
 * This deliberately does not follow chains. A definition referenced only
 * from an orphan's body still counts as referenced, which is what the
 * alert's wording says. The alert names those separately, as what deleting
 * the orphan also takes (definitionsTakenAlong). Once the user fixes the
 * orphan that was listed, the next lint reports that one.
 */
export function orphanedFootnoteDefinitionNames(
    markdown: string,
    // The alerts share the note's lines, split once (2026-08-11 review, a
    // speed fix); the reading is remembered per text. Anything calling this
    // on its own leaves it out.
    precomputed?: { lines: string[] },
): string[] {
    // No "[^" anywhere in the note means no definitions, and so no
    // orphaned ones. Worth checking first, because this runs on every
    // single lint (speed fix F4).
    if (!markdown.includes("[^")) return [];
    const lines = precomputed?.lines ?? normalizeEol(markdown).text.split("\n");
    const referenceScan = scanReferences(lines);
    const referenced = new Set(referenceScan.liveRefs.keys());
    for (const refs of referenceScan.blockRefs) {
        for (const name of refs) referenced.add(name);
    }
    const names: string[] = [];
    const seen = new Set<string>();
    for (const block of referenceScan.blocks) {
        const folded = block.name.toLowerCase();
        if (referenced.has(folded) || seen.has(folded)) continue;
        seen.add(folded);
        names.push(block.name);
    }
    return names;
}

/**
 * The definition blocks nothing keeps alive, following chains all the way
 * down; see the note at the top of this file.
 */
export function orphanedDefinitionBlocks(lines: string[]): Definition[] {
    // a definition that is not removable is reported by the alert but
    // never cut, and orphanedBlocks already keeps it alive
    return orphanedBlocks(scanReferences(lines));
}

/**
 * The names of the definitions the rule would delete along with the orphans
 * in `orphans`, because only those orphans keep them alive, each once, spelled
 * as written, in the order the definitions appear. It asks before the result
 * gate has judged the cut, so in the rare note where the gate refuses it, this
 * promises more than the rule then deletes, which loses nothing.
 */
export function definitionsTakenAlong(lines: string[], orphans: readonly string[]): string[] {
    const seen = new Set(orphans.map((name) => name.toLowerCase()));
    const names: string[] = [];
    for (const block of orphanedDefinitionBlocks(lines)) {
        const folded = block.name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(block.name);
    }
    return names;
}

/** Whether taking `dead` out of a note, leaving `out`, may go ahead. */
type CutAccepted = (dead: readonly Definition[], out: string[]) => boolean;

/** `ranges` as one range per line, leaving out the lines where `stays` says true. */
function rangesWithout(ranges: readonly { start: number; end: number }[], stays: (line: number) => boolean): { start: number; end: number }[] {
    const left: { start: number; end: number }[] = [];
    for (const { start, end } of ranges) {
        for (let line = start; line <= end; line++) if (!stays(line)) left.push({ start: line, end: line });
    }
    return left;
}

/**
 * A test for which lines stay behind when `dead` are cut. A line stays only when
 * no definition being cut holds it as its own, so an inner footnote's short line
 * that is the outer footnote's indented text goes.
 */
function proseAmong(lines: readonly string[], dead: readonly Definition[]): (line: number) => boolean {
    return (line) => dead.every((block) => line < block.start || line > block.end || staysBehind(lines, block, line));
}

/**
 * `lines` with a blank line above each stretch of prose that stays behind when
 * `dead` are cut, so that prose no longer reads as part of a footnote. This is
 * the note the result gate compares the cut with. Compared with the note as it
 * stands, the gate would see a link or a reference on such a line arrive from
 * nowhere, since what a removed footnote holds is not counted, and it would
 * refuse a cut that loses nothing.
 */
function withProseSetApart(lines: readonly string[], dead: readonly Definition[]): string[] {
    const stays = proseAmong(lines, dead);
    const owned = (line: number): boolean => dead.some((block) => block.start <= line && line <= block.end);
    return lines.flatMap((text, line) => (owned(line) && stays(line) && !stays(line - 1) ? [text.slice(0, quoteMarkersLength(text)).trimEnd(), text] : [text]));
}

/**
 * Whether cutting `dead` would part a stretch of protected text, such as inline
 * code or an inline comment running over several lines, by taking some of its
 * lines and leaving the rest. What is left would read as something else, so such a
 * definition stays and the alert names it (hunt 2026-11-06, cycle 10).
 */
function partsProtectedText(lines: string[], dead: readonly Definition[]): boolean {
    const stays = proseAmong(lines, dead);
    return readNote(lines).protectedSpans.some(({ startLine, endLine }) => {
        for (let line = startLine + 1; line <= endLine; line++) if (stays(line) !== stays(startLine)) return true;
        return false;
    });
}

/**
 * `lines` with `dead` cut out (definitionCuts, removeLineRangesKeeping),
 * never line `keep`, and where that line is now; or null when `accepts`
 * refuses the cut. With `leaveProse`, the lines that stay behind (staysBehind) do.
 */
function cutDefinitionsIfClean(
    lines: string[],
    dead: readonly Definition[],
    accepts: CutAccepted,
    keep: number,
    leaveProse: boolean,
): { lines: string[]; keep: number } | null {
    const cut = definitionCuts(lines, dead);
    const out = removeLineRangesKeeping(cut.lines, leaveProse ? rangesWithout(cut.ranges, proseAmong(lines, dead)) : cut.ranges, keep);
    return accepts(dead, out.lines) ? out : null;
}

/**
 * Which of the `candidates` can be taken out of `lines`, and the note once
 * they are gone. Shared by the orphan rule and the cut that carries
 * definitions (planCut in carry-footnotes.ts), so both leave the same
 * definitions in place (hunt 2026-10-05 round 2, cluster C2, and the pin
 * bug-orphan-rule-cuts-footnote-cited-by-kept-orphan).
 *
 * A candidate stays when `accepts` refuses taking it out: for the orphan rule,
 * when the result gate refuses it (rule-gate.ts), as when it would change how
 * Obsidian reads a line that stays: a definition between two lists keeps
 * them apart, and with it gone the lists join into one, a second numbered
 * list running on from the first one's numbers. Such a definition stays in
 * the note, where the lint's alert names it as an orphan (Jason,
 * 2026-10-05, triage decision Q2). The cut hands in the gate's verdict on
 * the whole cut instead (planCut).
 *
 * The candidates go all at once when that is clean. Otherwise they are
 * taken one at a time, as many as can go cleanly. Whatever stays keeps
 * alive the footnotes its text cites (stillUnused), so a definition cited
 * only by one that stays is never cut from under it: that would leave the
 * one that stays citing a footnote with no definition.
 *
 * Line `keep` of `lines` is never removed (removeLineRangesKeeping): the
 * cut keeps the line its caret stands on, and `keptLine` says where that
 * line is in `kept` (-1 without one).
 *
 * `leaveProse` leaves the lines under a label that are not indented in the note
 * (staysBehind). The orphan rule asks for that, and the cut that carries
 * definitions does not, since the clipboard takes those lines with the footnote.
 */
export function definitionsToCut(
    lines: string[],
    candidates: readonly Definition[],
    accepts: CutAccepted,
    keep = -1,
    leaveProse = false,
): { removed: Definition[]; kept: string[]; keptLine: number } {
    const reading = readNote(lines);
    const all = stillUnused(reading, candidates);
    const whole = cutDefinitionsIfClean(lines, all, accepts, keep, leaveProse);
    if (whole !== null) return { removed: all, kept: whole.lines, keptLine: whole.keep };
    let removed: Definition[] = [];
    let kept = { lines, keep };
    for (let grew = true; grew; ) {
        grew = false;
        for (const block of candidates) {
            if (removed.includes(block)) continue;
            const trial = stillUnused(reading, [...removed, block]);
            if (trial.length === removed.length) continue;
            const out = cutDefinitionsIfClean(lines, trial, accepts, keep, leaveProse);
            if (out === null) continue;
            removed = trial;
            kept = out;
            grew = true;
        }
    }
    return { removed, kept: kept.lines, keptLine: kept.keep };
}

/**
 * The definitions of `blocks` that nothing outside them cites: going
 * round, each definition whose name a live reference on a line outside
 * every definition still in the set uses is taken out of the set, until a
 * round takes out nothing. What is left can go together without leaving
 * a reference behind that has no definition. (The carry group's rule,
 * 3145b1e, moved here to be shared.)
 */
function stillUnused(reading: NoteReading, blocks: readonly Definition[]): Definition[] {
    let unused = [...blocks];
    for (;;) {
        const inside = (line: number) => unused.some((block) => block.start <= line && line <= block.end);
        const cited = new Set<string>();
        for (const { line, name, live } of reading.references) if (live && !inside(line)) cited.add(name.toLowerCase());
        const next = unused.filter((block) => !cited.has(block.name.toLowerCase()));
        if (next.length === unused.length) return unused;
        unused = next;
    }
}

/**
 * `markdown` with every unreferenced definition block removed, following
 * chains all the way down; see the note at the top of this file. Protected
 * text, and everything that is referenced, stays exactly where it is.
 */
export function removeOrphanedFootnoteDefinitions(markdown: string): string {
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    if (orphanedDefinitionBlocks(lines).length === 0) return markdown;
    // The same promise the orphan-reference rule makes: a deletion the
    // result gate refuses (rule-gate.ts), one that changes how Obsidian
    // reads a line it did not touch, is not made, and that orphan stays for
    // the user to sort out (the alert names it).
    // Cutting a block can put the line below it under a setext underline
    // or a blank line, which turns a lazy label there into a real
    // definition that the NEXT lint then deletes as an orphan, so lint
    // twice was not lint once (Kimi hunt cycle 2, 2026-09-16).
    //
    // The whole set of orphans goes in one cut when that cut changes
    // nothing else. When it would, as many as can go cleanly go
    // (definitionsToCut), and the note is read again after every cut so a
    // chain still dies all the way down: one refused block used to veto
    // every safe deletion in the note, and the alert then blamed the safe
    // ones too (Kimi hunt cycle 4, 2026-09-16). An orphan that stays keeps
    // the footnotes its text cites: cutting one of them left the orphan
    // citing a footnote with no definition (pin
    // bug-orphan-rule-cuts-footnote-cited-by-kept-orphan).
    let current = lines;
    for (;;) {
        const dead = orphanedDefinitionBlocks(current);
        if (dead.length === 0) break;
        const before = current;
        const accepts: CutAccepted = (gone, out) =>
            !partsProtectedText(before, gone) && rulePasses(withProseSetApart(before, gone), out, { removed: gone.map((block) => block.name) });
        const { removed, kept } = definitionsToCut(before, dead, accepts, -1, true);
        if (removed.length === 0) break;
        current = kept;
    }
    if (current === lines) return markdown;
    return restoreEol(current.join("\n"), eol);
}

/** This rule's catalogue entry. */
export const removeOrphanedDefinitionsRule: FootnoteRule = {
    id: "remove-orphaned-definitions",
    name: "Remove orphaned definitions",
    description:
        "Delete footnote definitions that nothing references, including chains only kept alive by each other's bodies.",
    examples: [
        {
            description: "An unreferenced definition is removed",
            before: "text[^1]\n\n[^1]: used\n[^9]: stray",
            after: "text[^1]\n\n[^1]: used",
        },
        {
            description: "A definition only an orphan's body references dies with it",
            before: "text\n\n[^a]: uses[^b]\n[^b]: chained",
            after: "text",
        },
    ],
    apply: (text) => removeOrphanedFootnoteDefinitions(text),
};
