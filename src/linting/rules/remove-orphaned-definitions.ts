import { definitionCuts, normalizeEol, removeLineRanges, restoreEol } from "../../parsing/line-edits";
import { Definition, linesReadAlike, readNote } from "../../parsing/note-reading";
import { FootnoteRule } from "../rule";

// Deleting orphaned definitions, as a rule of its own (2026-08-10).
//
// This used to live inside reindex, as its keepOrphanedDefinitions option,
// which reindexFootnotes still honours for code that calls it directly. The
// lint runs this rule instead, for two reasons: the "Delete orphaned
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
            if (!blocks[i].removable) continue;
            alive.delete(i);
            for (const name of blockRefs[i]) {
                refCount.set(name, (refCount.get(name) ?? 0) - 1);
            }
            changed = true;
        }
    }
    return blocks.filter((_, i) => !alive.has(i));
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
 *
 * Reindex's own keepOrphanedDefinitions:false path calls this too, so both
 * routes to deleting orphaned definitions always agree, however long the
 * chain.
 */
export function orphanedDefinitionBlocks(lines: string[]): Definition[] {
    // a definition that is not removable is reported by the alert but
    // never cut, and orphanedBlocks already keeps it alive
    return orphanedBlocks(scanReferences(lines));
}

/**
 * `lines` with `dead` cut out (definitionCuts, removeLineRanges), or null
 * when the cut would change how Obsidian reads a line it keeps
 * (linesReadDifferently).
 */
function cutDefinitionsIfClean(lines: string[], dead: readonly Definition[]): string[] | null {
    const cut = definitionCuts(lines, dead);
    const out = removeLineRanges(cut.lines, cut.ranges);
    return linesReadDifferently(lines, cut, out) ? null : out;
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
    // The same promise the orphan-reference rule makes: a deletion that
    // changes how Obsidian reads a line it did not touch is refused, and
    // that orphan stays for the user to sort out (the alert names it).
    // Cutting a block can put the line below it under a setext underline
    // or a blank line, which turns a lazy label there into a real
    // definition that the NEXT lint then deletes as an orphan, so lint
    // twice was not lint once (Kimi hunt cycle 2, 2026-09-16).
    //
    // The whole set of orphans goes in one cut when that cut changes
    // nothing else. When it would, each block is tried on its own, in
    // order, and the note is read again after every cut so a chain still
    // dies all the way down: one refused block used to veto every safe
    // deletion in the note, and the alert then blamed the safe ones too
    // (Kimi hunt cycle 4, 2026-09-16).
    let current = lines;
    for (;;) {
        const dead = orphanedDefinitionBlocks(current);
        if (dead.length === 0) break;
        let next = cutDefinitionsIfClean(current, dead);
        for (const block of dead) {
            if (next !== null) break;
            next = cutDefinitionsIfClean(current, [block]);
        }
        if (next === null) break;
        current = next;
    }
    if (current === lines) return markdown;
    return restoreEol(current.join("\n"), eol);
}

/**
 * Whether cutting whole lines out of `before` changed how Obsidian reads
 * any line it kept. `cut` is the cut as definitionCuts gives it: the lines
 * with every label on a list marker's line trimmed back to the marker, and
 * the ranges of whole lines removed; `out` is the result. A kept line must
 * read as it did (linesReadAlike), and a trimmed marker line may only lose
 * the definition it held. The kept lines are walked in step with the
 * result; a blank line the cut collapsed is skipped over.
 *
 * Cutting a block can put the line below it under a setext underline or a
 * blank line, which turns a lazy label there into a real definition (Kimi
 * hunt cycle 2, 2026-09-16), and emptying a marker line right under a
 * paragraph leaves a "-" that makes the paragraph a heading (hunt
 * 2026-10-02, cluster D5).
 *
 * Shared with the Delete footnote command, which cuts a definition block
 * the same way (T4, 2026-09-21), and the conversion to inline footnotes.
 */
export function linesReadDifferently(
    before: string[],
    cut: { lines: string[]; ranges: readonly { start: number; end: number }[] },
    out: string[],
): boolean {
    const readingBefore = readNote(before);
    const readingAfter = readNote(out);
    const removed = new Set<number>();
    for (const range of cut.ranges) for (let i = range.start; i <= range.end; i++) removed.add(i);
    let j = 0;
    for (let i = 0; i < before.length; i++) {
        if (removed.has(i)) continue;
        const kept = cut.lines[i];
        // a blank line removeLineRanges put in (in front of a "---" the cut
        // would have promoted to the note's first line, or between a kept
        // paragraph and a setext underline) keeps the kept line reading as
        // it did, so it is stepped over (GLM hunt cycle 11, 2026-09-16:
        // the guard's own blank made the rule refuse a clean cut)
        while (j < out.length && out[j] === "" && kept !== "") j++;
        if (out[j] !== kept) {
            // a blank line the cut merged away, or dropped from the end of
            // the note (removeLineRanges takes the separator blank with a
            // block cut from the end)
            if (kept.trim() === "") continue;
            return true;
        }
        if (!linesReadAlike(readingBefore, i, readingAfter, j, kept === before[i] ? "none" : "cut")) return true;
        j++;
    }
    return false;
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
