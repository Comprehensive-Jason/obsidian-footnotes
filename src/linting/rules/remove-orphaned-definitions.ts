import { rulePasses } from "../rule-gate";
import { definitionCuts, normalizeEol, removeLineRanges, restoreEol } from "../../parsing/line-edits";
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
    // alive.
    const liveRefs = new Map<string, number>();
    const blockRefs: string[][] = blocks.map(() => []);
    for (let i = 0; i < lines.length; i++) {
        const owner = reading.definitionAt(i);
        for (const { name: raw } of reading.referencesOn(i)) {
            const name = raw.toLowerCase();
            if (owner === null) {
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
 * alert's wording says. Once the user fixes the orphan that was listed, the
 * next lint reports that one.
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

/** Whether taking `dead` out of a note, leaving `out`, may go ahead. */
type CutAccepted = (dead: readonly Definition[], out: string[]) => boolean;

/**
 * `lines` with `dead` cut out (definitionCuts, removeLineRanges), or null
 * when `accepts` refuses the cut.
 */
function cutDefinitionsIfClean(lines: string[], dead: readonly Definition[], accepts: CutAccepted): string[] | null {
    const cut = definitionCuts(lines, dead);
    const out = removeLineRanges(cut.lines, cut.ranges);
    return accepts(dead, out) ? out : null;
}

/**
 * Which of the `candidates` can be taken out of `lines`, and the note once
 * they are gone. Shared by the orphan rule and the cut that carries
 * definitions (planCut in carry-footnotes.ts), so both leave the same
 * definitions in place (hunt 2026-10-05 round 2, cluster C2, and the pin
 * bug-orphan-rule-cuts-footnote-cited-by-kept-orphan).
 *
 * A candidate stays when `accepts` refuses taking it out: by default when
 * the result gate refuses it (rule-gate.ts), as when it would change how
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
 */
export function definitionsToCut(
    lines: string[],
    candidates: readonly Definition[],
    accepts: CutAccepted = (dead, out) => rulePasses(lines, out, { removed: dead.map((block) => block.name) }),
): { removed: Definition[]; kept: string[] } {
    const reading = readNote(lines);
    const all = stillUnused(reading, candidates);
    const whole = cutDefinitionsIfClean(lines, all, accepts);
    if (whole !== null) return { removed: all, kept: whole };
    let removed: Definition[] = [];
    let kept = lines;
    for (let grew = true; grew; ) {
        grew = false;
        for (const block of candidates) {
            if (removed.includes(block)) continue;
            const trial = stillUnused(reading, [...removed, block]);
            if (trial.length === removed.length) continue;
            const out = cutDefinitionsIfClean(lines, trial, accepts);
            if (out === null) continue;
            removed = trial;
            kept = out;
            grew = true;
        }
    }
    return { removed, kept };
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
        const { removed, kept } = definitionsToCut(current, dead);
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
