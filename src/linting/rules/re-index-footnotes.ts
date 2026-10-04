import { footnotePrefixProblem } from "../../parsing/footnote-prefix";
import { referenceOccurrences, nameForBody } from "../../parsing/footnote-grammar";
import { definitionCuts, removeLineRanges } from "../../parsing/markdown-scan";
import { readNote } from "../../parsing/note-reading";
import { rewriteDocument } from "../rewrite-document";
import { rewriteFootnoteNames } from "../rewrite-footnote-names";
import { FootnoteRule } from "../rule";
import { orphanedDefinitionBlocks } from "./remove-orphaned-definitions";

// Reindex: renumbering the note's footnotes. This is a pure function,
// markdown in and markdown out, with no editor involved.
//
// What it does, pinned by test/reindex-footnotes.test.ts:
//
// - Numbered footnotes are renumbered 1, 2, 3 and so on, in the order their
//   references first appear, and their definitions are put in the same
//   order.
// - Named footnotes keep their names, unless renumberNamedFootnotes is on,
//   but they still take their place in that ordering of definitions.
// - Orphaned definitions are kept, and numbered after everything that is
//   referenced, unless keepOrphanedDefinitions is off.
// - Code and frontmatter are invisible to all of this.

export interface ReindexOptions {
    /**
     * Keep orphaned definitions, the ones nothing references, and number
     * them after everything that is referenced. This is what happens by
     * default; turn it off and they are deleted instead.
     */
    keepOrphanedDefinitions?: boolean;
    /**
     * Give named footnotes numbers, in order of appearance, instead of
     * leaving their names alone (off by default). When a `prefix` is in
     * play, they are renumbered into that namespace.
     */
    renumberNamedFootnotes?: boolean;
    /**
     * Give numbered footnotes names taken from their definitions, the
     * first meaningful word of the body (off by default; the Named half of
     * the Preferred footnote naming style setting, Jason, 2026-09-22). A footnote that is
     * already named is left alone, so a lint never renames twice; a
     * numbered one whose definition offers no word, or has no definition
     * block, stays numbered and is renumbered as usual.
     */
    nameNumberedFootnotes?: boolean;
    /**
     * The note's own footnote-prefix.
     *
     * A name made of the prefix followed by digits is a NUMBERED footnote of
     * that namespace. Such footnotes get their own counter and are
     * renumbered prefix-1, prefix-2 and so on by appearance, behaving
     * exactly like plain numbered footnotes (added to make life easier,
     * 2026-07-18). Names carrying any other prefix stay named.
     *
     * A prefix ending in a digit is invalid and is ignored here, as a
     * precaution.
     */
    prefix?: string;
}

/**
 * The reference names, each listed once, in the order they first appear in
 * the text outside protected regions. They come back lower-cased, because
 * Obsidian treats footnote names as the same whatever their case: "[^Note]"
 * and "[^note]" are one footnote, both for ordering and for identity.
 *
 * A definition's own "[^name]:" label does not count as a reference;
 * referenceOccurrences leaves it out on a line the note reading says holds
 * one. A reference inside a definition's body does count.
 */
function referenceAppearanceOrder(
    lines: string[],
    maskedLines: readonly string[],
    starts: readonly boolean[],
): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
        // A protected line is nothing but NUL characters in the masked
        // twin, so it matches nothing. referenceOccurrences cuts each name
        // out of the raw line rather than the twin
        // (bug-masked-name-identity). And a lazy label's own "[^x]" really
        // is a reference, so it takes its place in the order here.
        for (const { name } of referenceOccurrences(lines[i], maskedLines[i], starts[i])) {
            // a name holding whitespace is prose to Obsidian; the rewrite
            // never renames it, so it takes no slot in the order either
            // (Kimi hunt cycle 1, 2026-09-16: the slot went unused and the
            // real footnotes started at 2)
            if (/\s/.test(name)) continue;
            const id = name.toLowerCase();
            if (!seen.has(id)) {
                seen.add(id);
                order.push(id);
            }
        }
    }
    return order;
}

/**
 * Reindex every footnote in `markdown`.
 *
 * Numbered footnotes become 1, 2, 3 and so on, in the order their references
 * first appear; later references to the same footnote follow their first.
 * Named footnotes keep their names. The definition blocks are put into that
 * same order, but only by swapping them between the places definitions
 * already sit: everything in between stays exactly where it was.
 *
 * `options` chooses the two alternatives: deleting orphaned definitions
 * rather than keeping them, and renumbering named footnotes rather than
 * leaving their names alone.
 */
export function reindexFootnotes(
    markdown: string,
    options: ReindexOptions = {},
): string {
    // One pass is not always enough. Moving definition blocks around
    // changes the order in which references INSIDE those blocks appear, and
    // the next pass then renumbers those. So this runs again and again
    // until a pass changes nothing.
    //
    // Some notes never settle. The reordering and the renumbering of nested
    // references can chase each other round a genuine loop
    // (bug-reindex-cycle, a loop of three states), and with lint-on-save
    // that rewrote the note on every single save, forever.
    //
    // The fix: spot a state that has come round before, and return one
    // agreed member of the loop. The one chosen is whichever sorts first as
    // text; any fixed choice would do. That makes running the lint again
    // safe, because starting from that state walks the same loop and lands
    // on the same choice.
    //
    // Deleting orphaned definitions does not drive this loop: it follows
    // chains of any length within ONE pass, see orphanedDefinitionBlocks.
    //
    // The limit is a pure safety net, in case of a loop longer than that.
    // None has ever been seen. It was 30, which a chain of definitions
    // each citing the next, 32 deep and in reverse order, ran past: the
    // stray name drifts one block per pass, so the note needed a second
    // save to settle (Kimi sweep 2026-09-13). 200 passes over a note is
    // still cheap, and a real note never needs anywhere near it.
    let current = markdown;
    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
        const next = reindexOnce(current, options);
        if (next === current) return current;
        const cycleStart = seen.indexOf(next);
        if (cycleStart !== -1) {
            let canonical = next;
            for (const state of seen.slice(cycleStart + 1)) {
                if (state < canonical) canonical = state;
            }
            if (current < canonical) canonical = current;
            return canonical;
        }
        seen.push(current);
        current = next;
    }
    return current;
}

function reindexOnce(
    markdown: string,
    options: ReindexOptions = {},
): string {
    const keepOrphans = options.keepOrphanedDefinitions ?? true;
    const renumberNamed = options.renumberNamedFootnotes ?? false;
    const nameNumbered = options.nameNumberedFootnotes ?? false;
    // The namespace prefix. It is written out with the case the user gave
    // it, but matched without regard to case, since footnote names are
    // compared that way everywhere.
    const prefixOut =
        options.prefix && footnotePrefixProblem(options.prefix) === null
            ? options.prefix
            : "";
    const prefixFolded = prefixOut.toLowerCase();
    const isPrefixedNumbered = (name: string) =>
        prefixFolded !== "" &&
        name.startsWith(prefixFolded) &&
        /^\d+$/.test(name.slice(prefixFolded.length));

    return rewriteDocument(markdown, (text, view) => {
        // These are all replaced further down if orphan deletion rewrites
        // the note part way through this pass
        let lines = view.lines;
        let protectedLines = view.reading.protectedLines;
        let maskedLines = view.maskedLines;
        let starts = view.definitionStarts;
        let definitions = view.definitions;
        let referenceOrder = referenceAppearanceOrder(lines, maskedLines, starts);

        if (!keepOrphans) {
            // The shared orphan-finding code. It follows chains of any
            // length in THIS one pass: a definition kept alive only by an
            // orphan that is itself being deleted goes too, and so on down.
            // The loop above used to peel off one link per go, and its
            // limit meant a chain 21 or more deep was left half deleted
            // (bug-reindex-orphan-cap). Definitions that reference each
            // other in a ring count as referenced and survive.
            const orphans = orphanedDefinitionBlocks(lines);
            if (orphans.length > 0) {
                // Cut the orphaned blocks out, then work everything out
                // again from scratch: the line numbers have all shifted,
                // and removing lines can even change which code fences pair
                // with which.
                const cut = definitionCuts(lines, orphans);
                lines = removeLineRanges(cut.lines, cut.ranges);
                const reading = readNote(lines);
                protectedLines = reading.protectedLines;
                maskedLines = reading.maskedLines();
                starts = reading.labelLines;
                definitions = reading.definitions;
                referenceOrder = referenceAppearanceOrder(lines, maskedLines, starts);
            }
        }

        // The full order: names that are referenced first, in the order
        // their references first appear, then any orphaned definitions that
        // are left, in the order their definitions appear.
        //
        // Every name here is lower-cased, so that a reference and a
        // definition written with different capitals count as one footnote
        // all the way through the ordering and the numbering.
        const order = [...referenceOrder];
        const seen = new Set(order);
        // Every definition takes its place, wherever it sits: one in a
        // blockquote or callout (C22) or in a list item (Jason's ruling 1,
        // option a, 2026-10-03) is renamed like any other. An orphan among
        // them still needs its place in the order, or the number it holds
        // could be handed to some other footnote being renumbered, and two
        // footnotes would end up sharing a name (review A3, 2026-09-08).
        for (const definition of definitions) {
            const name = definition.name.toLowerCase();
            if (!seen.has(name)) {
                seen.add(name);
                order.push(name);
            }
        }

        // Work out each numbered name's new number, walking the order
        // above. The prefix namespace has its own counter, quite separate
        // from the plain one.
        //
        // A named footnote only takes a number when named footnotes are
        // being renumbered as well. When there is a prefix, it is renumbered
        // INTO that namespace, because it is one of this note's footnotes.
        // That also keeps the lint from changing the note twice over: give
        // it a plain number here and the next apply-prefix pass would put
        // the prefix on it anyway.
        const renames = new Map<string, string>();
        // Under Named, a numbered footnote takes the first meaningful word of
        // its definition's body as its name, kept clear of every name the
        // note holds and of the names handed out before it in this pass
        // (the last definition of a name is the one Obsidian renders, so it
        // is the one read).
        const bodyOf = new Map<string, string>();
        const taken = new Set<string>(order);
        if (nameNumbered) {
            for (const definition of definitions) {
                bodyOf.set(
                    definition.name.toLowerCase(),
                    [lines[definition.start].slice(definition.labelEnd), ...lines.slice(definition.start + 1, definition.end + 1)].join("\n"),
                );
            }
        }
        const nameFromBody = (name: string, prefix: string): string | null => {
            const body = bodyOf.get(name);
            if (body === undefined) return null;
            const generated = nameForBody(body, taken, prefix);
            if (generated !== null) taken.add(generated.toLowerCase());
            return generated;
        };
        let nextNumber = 1;
        let nextPrefixed = 1;
        const takePlain = (): string => String(nextNumber++);
        const takePrefixed = (): string => `${prefixOut}${nextPrefixed++}`;
        for (const name of order) {
            if (isPrefixedNumbered(name)) {
                renames.set(name, (nameNumbered ? nameFromBody(name, prefixOut) : null) ?? takePrefixed());
            } else if (/^\d+$/.test(name)) {
                renames.set(name, (nameNumbered ? nameFromBody(name, "") : null) ?? takePlain());
            } else if (renumberNamed) {
                // the bare-prefix placeholder ("[^3.]" under a "3." prefix)
                // is a footnote the user is still naming: the unnamed
                // alert counts it as unfilled and orphan deletion leaves
                // it alone, so renumbering it away would silence that
                // alert and hijack the name the user goes on to type (Kimi
                // hunt cycle 3, 2026-09-16)
                if (prefixOut !== "" && name === prefixFolded) continue;
                renames.set(name, prefixOut ? takePrefixed() : takePlain());
            }
        }

        // Names are matched without regard to case. Every name that is
        // changing is in the map, so no footnote can be renamed onto
        // another one's name.
        const rewritten = lines.map((line, i) =>
            protectedLines[i]
                ? line
                : rewriteFootnoteNames(line, maskedLines[i], (name) => renames.get(name.toLowerCase()) ?? null),
        );

        // Swap the definition blocks between the places definitions already
        // sit, so that they read in appearance order. Only the definitions
        // whose lines are their own move: one in a quote, a list item, or
        // another footnote stays in its container (Jason's ruling 1, option
        // a, 2026-10-03). The sort is stable, which keeps two definitions
        // of one name next to each other in the order they were written.
        //
        // Every block's name is in `order`: referenced names went in first,
        // then every definition's. So the lookup below always
        // finds something. If that ever stopped being true, a block with an
        // unknown name sorts to the END rather than jumping to the front,
        // which is what the old `?? 0` made it do (review C9).
        const orderIndex = new Map(order.map((name, i) => [name, i]));
        const rank = (name: string) => orderIndex.get(name.toLowerCase()) ?? order.length;
        const blocks = definitions.filter((definition) => definition.movable);
        const sorted = blocks
            .map((block, i) => ({ block, i }))
            .sort((a, b) => rank(a.block.name) - rank(b.block.name) || a.i - b.i)
            .map((entry) => entry.block);

        const slotAtLine = new Map(blocks.map((block, i) => [block.start, i]));
        const out: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const slot = slotAtLine.get(i);
            if (slot === undefined) {
                out.push(rewritten[i]);
                continue;
            }
            const block = sorted[slot];
            for (let j = block.start; j <= block.end; j++) out.push(rewritten[j]);
            i = blocks[slot].end;
        }
        return out.join("\n");
    });
}

/** This rule's catalogue entry. The id matches obsidian-linter's file name. */
export const reIndexFootnotesRule: FootnoteRule<ReindexOptions> = {
    id: "re-index-footnotes",
    name: "Re-index footnotes",
    description:
        "Renumber numbered footnotes 1..n by first reference appearance and reorder their definitions to match.",
    examples: [
        {
            description: "Renumbers by first reference appearance",
            before: "bravo[^2] alpha[^1].\n\n[^1]: one\n[^2]: two",
            after: "bravo[^1] alpha[^2].\n\n[^1]: two\n[^2]: one",
            options: {},
        },
        {
            description: "Closes gaps in the numbering",
            before: "a[^3] b[^7].\n\n[^3]: three\n[^7]: seven",
            after: "a[^1] b[^2].\n\n[^1]: three\n[^2]: seven",
            options: {},
        },
    ],
    apply: (text, options) => reindexFootnotes(text, options),
};
