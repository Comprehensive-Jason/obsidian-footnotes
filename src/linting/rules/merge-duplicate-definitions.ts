import { rulePasses } from "../rule-gate";
import { normalizeEol, removeLineRanges } from "../../parsing/line-edits";
import { Definition, readNote } from "../../parsing/note-reading";
import { rewriteDocument } from "../rewrite-document";
import { FootnoteRule } from "../rule";

// Duplicate footnote definitions: two or more "[^x]:" definition blocks for
// the same name, treating upper and lower case as the same.
//
// Checked against the live Reading view on 2026-08-12: Obsidian renders
// ONLY the LAST definition of a name. Every earlier one is dead text that
// disappears without a word.
//
// Jason's policy (2026-08-12). While the "Merge duplicate definitions"
// toggle is off, the lint reports duplicates but leaves them alone;
// duplicates are never passed over in silence, the same promise orphans
// get. With the toggle on, this rule merges the later bodies INTO the first
// definition block, in the order they appear in the note, so no text is
// ever thrown away.
//
// The merged bodies arrive as INDENTED continuation lines. Jason's original
// sketch left the second body unindented, which Obsidian would render just
// as well. The trouble is that an unindented line is not part of the
// definition block, so move-to-bottom would leave it stranded behind (the
// swallowed-prose family of bugs). The indented form looks identical when rendered and
// stays one block.

/**
 * The list the alert reads out: each name that is defined more than once,
 * once each, in the order the names first appear, spelled with the case
 * they were first seen with.
 *
 * Every definition counts, wherever it sits: at the left margin, after a
 * "%%" closer (GLM hunt cycle 1, 2026-09-16), inside a blockquote or
 * callout, or in a list item (Jason's ruling 1, option a, 2026-10-03; hunt
 * 2026-10-02, cluster E7). Obsidian renders only the LAST definition of a
 * name, so any copy silently hides or is hidden by its twin.
 */
export function duplicateFootnoteDefinitionNames(
    markdown: string,
    // The alerts all share ONE pass of normalizing the line endings, done
    // once and handed round (2026-08-11 review, a speed fix). Anything
    // calling this on its own leaves it out.
    precomputed?: { lines: string[] },
): string[] {
    // No "[^" anywhere in the note means no definitions, and so no
    // duplicates. Worth checking first, because this runs on every single
    // lint (speed fix F4).
    if (!markdown.includes("[^")) return [];
    const lines = precomputed?.lines ?? normalizeEol(markdown).text.split("\n");
    const found = readNote(lines).definitions;
    const counts = new Map<string, number>();
    for (const entry of found) {
        const folded = entry.name.toLowerCase();
        counts.set(folded, (counts.get(folded) ?? 0) + 1);
    }
    const names: string[] = [];
    const seen = new Set<string>();
    for (const entry of found) {
        const folded = entry.name.toLowerCase();
        if ((counts.get(folded) ?? 0) < 2 || seen.has(folded)) continue;
        seen.add(folded);
        names.push(entry.name);
    }
    return names;
}

/**
 * Merge every later duplicate into the FIRST definition block for that name.
 * Only a name whose every copy the lint may move is merged (movedDefinitions
 * in rewrite-document.ts): a copy in a quote, a list item, or another
 * footnote cannot take or give indented continuation lines without changing
 * its container, and a copy that holds a copy of some other duplicated name
 * would carry that copy past its twins (hunt 2026-10-05 round 2, cluster
 * L1). Such a name is left as written and the duplicate alert names it
 * (ADR 2; Jason's ruling 1, option a, 2026-10-03).
 *
 * What was written after the duplicate's label becomes an indented
 * continuation line, and the duplicate's own continuation lines follow it
 * exactly as they were, blank lines included. The merged block therefore
 * renders every body, in the order they appeared in the note. The first
 * block keeps the case its name was written with.
 *
 * Anything inside protected text is never a definition. Where a duplicate is
 * cut out, the lines close up through removeLineRanges, the same as any
 * other definition block deletion. Each name's merge, with the ones already
 * made, goes to the result gate (rule-gate.ts), and a name whose merge it
 * refuses is left as written, and the duplicate alert names it: one whose
 * copies cannot be cut out without changing how Obsidian reads the lines
 * around them, such as one sitting between two lists, whose cut would join
 * the lists (hunt 2026-10-05 round 2, pin
 * bug-merge-between-lists-joins-them); one whose copy holds a table on its
 * label line, which folded into indented lines would turn into text (GLM
 * hunt cycle 7, 2026-09-16, pin bug-merge-duplicate-flattens-table); and
 * one whose last copy ends in a "$$" line that ends the note, which merged
 * into a first copy with lines after it opens a math block that takes
 * those lines in (hunt 2026-10-06, cycle 4, pin
 * bug-end-dollar-line-swallows-definition).
 */
export function mergeDuplicateFootnoteDefinitions(markdown: string): string {
    if (!markdown.includes("[^")) return markdown;
    return rewriteDocument(markdown, (text, { lines, definitions, blocks, reading }) => {
        // Whether the last line of `copy` sits in a block inside the
        // footnote other than its own paragraph: a quote, a list, a table,
        // code, or a definition held inside it. The note's reading lists
        // the blocks each line belongs to, outermost first, the copy's
        // footnoteDefinition among them.
        const endsInBlock = (copy: Definition) =>
            reading.lineBlocks[copy.end].replace(/\^/g, "").split(" ").slice(1).some((block) => block !== "paragraph");
        const groups = new Map<string, Definition[]>();
        for (const block of definitions) {
            const folded = block.name.toLowerCase();
            const group = groups.get(folded);
            if (group) group.push(block);
            else groups.set(folded, [block]);
        }

        // Two things are collected here: the continuation lines to add,
        // keyed by the LAST line of the block they are joining, and the
        // ranges of lines the duplicates occupy, to be cut out.
        let appendAfter = new Map<number, string[]>();
        let doomed: { start: number; end: number }[] = [];
        // the names merged so far
        const merged: string[] = [];
        for (const [name, group] of groups) {
            if (group.length < 2 || group.some((block) => !blocks.includes(block))) continue;
            // this name's duplicates cut out, together with the ones
            // already taken
            const cuts = group.slice(1).map((duplicate) => ({ start: duplicate.start, end: duplicate.end }));
            const trial = [...doomed, ...cuts].sort((a, b) => a.start - b.start);
            const base = group[0];
            const appended: string[] = [];
            // the copy whose lines the next copy's text lands under: the
            // first copy, then each copy that added lines
            let above = base;
            for (const duplicate of group.slice(1)) {
                const piece: string[] = [];
                const body = lines[duplicate.start].slice(duplicate.labelEnd).trim();
                if (body !== "") piece.push(`    ${body}`);
                for (let i = duplicate.start + 1; i <= duplicate.end; i++) {
                    piece.push(lines[i]);
                }
                if (piece.length === 0) continue;
                // When the copy above ends inside a block of its own other
                // than a paragraph, a line straight under it would join
                // that block. After a definition held inside the copy (an
                // indented "[^b]: inner" on its last lines) b would read
                // "inner two" (hunt 2026-10-05 round 2, pin
                // bug-merge-into-held-definition); after a quote, a
                // callout, or a list the text was drawn inside the quote or
                // the last bullet (live Obsidian 1.14.4, 2026-10-08; hunt
                // 2026-10-08 cycle 6, cluster Z20, pin
                // bug-merge-text-joins-quote-or-list). A blank line first
                // makes the merged text a paragraph of the first copy's
                // own, after that block. That goes for every copy the text
                // lands under, not only the first: a middle copy ending in
                // a held definition took the third copy's text the same
                // way (hunt 2026-10-06, cycle 5, pin
                // bug-merge-held-definition-middle-copy).
                if (piece[0] !== "" && endsInBlock(above)) piece.unshift("");
                appended.push(...piece);
                above = duplicate;
            }
            // A line right under the first copy that is not part of it,
            // such as a paragraph under an empty label "[^a]:" (which takes
            // no lazy text), would carry on the indented text added under
            // the label and join the footnote (live Obsidian 1.14.4,
            // 2026-10-06). A blank line after the added text keeps it out
            // (hunt 2026-10-06, cycle 5, pin bug-merge-under-empty-label).
            // Where that line starts a block of its own, such as a heading,
            // the blank line changes nothing; under a label right under the
            // first copy, none goes in, so definitions stay packed.
            if (
                appended.length > 0 &&
                appended[appended.length - 1].trim() !== "" &&
                base.end + 1 < lines.length &&
                lines[base.end + 1].trim() !== "" &&
                !definitions.some((definition) => definition.start === base.end + 1)
            ) {
                appended.push("");
            }
            const appends = new Map(appendAfter);
            if (appended.length > 0) appends.set(base.end, appended);
            // the result gate judges this name's merge with the ones made
            if (!rulePasses(lines, mergedLines(lines, appends, trial), { merged: [...merged, name] })) continue;
            merged.push(name);
            doomed = trial;
            appendAfter = appends;
        }
        if (doomed.length === 0) return text;
        return mergedLines(lines, appendAfter, doomed).join("\n");
    });
}

/**
 * `lines` with the merges made: the lines in `appendAfter` added under the
 * line each is keyed by (the last line of a first copy), and the duplicates
 * in `doomed` cut out.
 */
function mergedLines(lines: readonly string[], appendAfter: ReadonlyMap<number, string[]>, doomed: readonly { start: number; end: number }[]): string[] {
    // Glue the new lines onto the first block's last line BEFORE
    // cutting the duplicates out. removeLineRanges does not look inside
    // a line, so one entry holding several lines joined together passes
    // through it untouched and comes apart again when the result is joined
    // and split back into lines.
    const mutated = lines.slice();
    for (const [end, appended] of appendAfter) {
        mutated[end] = [mutated[end], ...appended].join("\n");
    }
    const out = removeLineRanges(mutated, doomed).join("\n").split("\n");
    // Cutting a duplicate at the very end of the note can leave behind
    // the blank line that used to separate it. Never hand back more
    // blank lines at the end than the note started with.
    let trailingBefore = 0;
    for (let i = lines.length - 1; i >= 0 && lines[i] === ""; i--) {
        trailingBefore++;
    }
    let trailingAfter = 0;
    for (let i = out.length - 1; i >= 0 && out[i] === ""; i--) {
        trailingAfter++;
    }
    while (trailingAfter > trailingBefore) {
        out.pop();
        trailingAfter--;
    }
    return out;
}

/** This rule's catalogue entry. The id matches the settings toggle's rule. */
export const mergeDuplicateDefinitionsRule: FootnoteRule = {
    id: "merge-duplicate-definitions",
    name: "Merge duplicate definitions",
    description:
        "Merge every later definition of an already-defined footnote into the first one, keeping each body as a continuation line (Obsidian renders only the last definition otherwise).",
    examples: [
        {
            description:
                "A second definition merges into the first as a continuation",
            before: "use[^d] here\n\n[^d]: first\n\n[^d]: second\n\ntail prose",
            after: "use[^d] here\n\n[^d]: first\n    second\n\ntail prose",
        },
    ],
    apply: (text) => mergeDuplicateFootnoteDefinitions(text),
};
