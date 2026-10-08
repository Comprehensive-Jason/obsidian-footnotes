import { rulePasses } from "../rule-gate";
import { footnotePrefixProblem } from "../../parsing/footnote-prefix";
import { nameForBody } from "../../parsing/footnote-grammar";
import { NoteReading } from "../../parsing/note-reading";
import { endsInLazyLine, movedDefinitions, rewriteDocument } from "../rewrite-document";
import { rewriteFootnoteNames } from "../rewrite-footnote-names";
import { FootnoteRule } from "../rule";

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
//   referenced. Reindex never deletes anything: deleting orphans is the
//   orphan rule's job (remove-orphaned-definitions.ts), which refuses a cut
//   that would change how Obsidian reads the lines around it. Reindex had
//   its own unguarded orphan cut, behind a keepOrphanedDefinitions option
//   no setting reached, and it was removed (hunt 2026-10-05 round 2,
//   cluster L7). Their definitions go after the referenced ones, unless
//   leaveOrphansInPlace keeps each in its own slot (cluster L4).
// - Code and frontmatter are invisible to all of this.

export interface ReindexOptions {
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
    /**
     * Leave each orphaned definition (one nothing references) in its own
     * slot, instead of swapping it into the slot of a later definition
     * (off by default; the lint turns it on while Delete orphaned
     * definitions is on). The orphan still takes its number after every
     * referenced footnote, as it always does.
     *
     * Why: with that setting on, an orphan still in the note when reindex
     * runs is one the orphan rule left on purpose, usually because cutting
     * it would change how Obsidian reads the lines around it, such as one
     * sitting between two lists. Swapped into a later definition's slot,
     * at the end of the note, it could land where nothing stops the cut,
     * and the next lint deleted it: linting twice did more than linting
     * once, and the alert after the first lint did not name it. In its own
     * slot the reason it was left still holds, lint after lint, and the
     * alert names it (hunt 2026-10-05 round 2, cluster L4, pin
     * bug-reindex-moves-refused-orphan; Jason's decision, 2026-10-05).
     *
     * With the setting off, nothing deletes an orphan, so moving it is
     * harmless; it still goes after the referenced definitions, so the
     * definitions read in the order of their numbers.
     */
    leaveOrphansInPlace?: boolean;
    /**
     * Leave every copy of a name defined more than once in its own slot
     * (off by default; the lint turns it on while Merge duplicate
     * definitions is on), as leaveOrphansInPlace does for orphans.
     *
     * Why: with that setting on, a name still defined twice when reindex
     * runs is one the merge left on purpose, such as a copy between two
     * lists, whose cut would join them. Swapped to the end of the note,
     * the copy landed where the cut is clean, and the next lint merged
     * it: linting twice did more than linting once, and the duplicate
     * alert after the first lint said nothing. In their own slots the
     * reason the copies were left still holds, and the alert names the
     * name (hunt 2026-10-06, cycle 5, pin bug-merge-refused-then-relocated).
     */
    leaveDuplicatesInPlace?: boolean;
}

/**
 * The reference names, each listed once, in the order they first appear in
 * the text, as the note reading finds the live ones. They come back
 * lower-cased, because Obsidian treats footnote names as the same whatever
 * their case: "[^Note]" and "[^note]" are one footnote, both for ordering
 * and for identity.
 *
 * A definition's own "[^name]:" label does not count as a reference; a
 * reference inside a definition's body does, and so does a lazy label's
 * own "[^x]", which really is a reference. A name holding a space is prose
 * to Obsidian, so it takes no slot in the order (Kimi hunt cycle 1,
 * 2026-09-16: the slot went unused and the real footnotes started at 2).
 */
function referenceAppearanceOrder(reading: NoteReading, lineCount: number): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < lineCount; i++) {
        for (const { name } of reading.referencesOn(i)) {
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
 * Orphaned definitions are kept and numbered after the referenced ones.
 * `options` chooses whether named footnotes are renumbered or given names,
 * the note's prefix, and whether orphans keep their own slots.
 */
export function reindexFootnotes(markdown: string, options: ReindexOptions = {}): string {
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
        const lines = view.lines;
        const reading = view.reading;
        const definitions = view.definitions;
        const referenceOrder = referenceAppearanceOrder(reading, lines.length);

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
        const renamed = lines.map((line, i) => rewriteFootnoteNames(reading, i, line, (name) => renames.get(name.toLowerCase()) ?? null));
        // Renames the result gate refuses (a "$" prefix pairing with an
        // earlier dollar turns a footnote into plain text) are not made, and
        // the definitions are only put in order.
        const rewritten = rulePasses(lines, renamed, { renamed: renames }) ? renamed : lines;

        // Swap the definition blocks between the places definitions already
        // sit, so that they read in appearance order. Only the definitions
        // whose lines are their own move: one in a quote, a list item, or
        // another footnote stays in its container (Jason's ruling 1, option
        // a, 2026-10-03), and so does every copy of its name, so the copy
        // Obsidian renders stays the same one (movedDefinitions). The sort is stable, which keeps two definitions
        // of one name next to each other in the order they were written.
        //
        // Every block's name is in `order`: referenced names went in first,
        // then every definition's. So the lookup below always
        // finds something. If that ever stopped being true, a block with an
        // unknown name sorts to the END rather than jumping to the front,
        // which is what the old `?? 0` made it do (review C9).
        const orderIndex = new Map(order.map((name, i) => [name, i]));
        const rank = (name: string) => orderIndex.get(name.toLowerCase()) ?? order.length;
        // With leaveOrphansInPlace, an orphan takes no part in the swap: it
        // keeps its own slot, renamed there, and only the referenced
        // definitions trade places (see the option for why). With
        // leaveDuplicatesInPlace, the same goes for every copy of a name
        // defined more than once.
        const referenced = new Set(referenceOrder);
        const copies = new Map<string, number>();
        for (const definition of definitions) copies.set(definition.name.toLowerCase(), (copies.get(definition.name.toLowerCase()) ?? 0) + 1);
        const blocks = movedDefinitions(reading).filter(
            (block) =>
                (!options.leaveOrphansInPlace || referenced.has(block.name.toLowerCase())) &&
                (!options.leaveDuplicatesInPlace || copies.get(block.name.toLowerCase()) === 1),
        );
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
            // A block that ends in a lazy line, swapped into a slot with a
            // label right under it, gets a blank line after it, or that
            // label would read as more of its text and stop being a
            // definition; the next lint then added the blank line, so a
            // lint was not idempotent (endsInLazyLine).
            if (block !== blocks[slot] && endsInLazyLine(reading, lines, block) && reading.labelLines[i + 1]) out.push("");
            // And the other way round: when the slot's old block ended in a
            // lazy line, the blank line under it was there to keep the next
            // label a definition. A block that does not end in a lazy line
            // needs no such line, and move-to-bottom packs it label to
            // label, so the blank line goes with the block that needed it.
            // Left behind, the next lint's move took it out, and a lint was
            // not idempotent (hunt 2026-10-06, cycle 3, pin
            // bug-lint-lazy-tail-swapped-after-plain).
            else if (
                block !== blocks[slot] &&
                endsInLazyLine(reading, lines, blocks[slot]) &&
                !endsInLazyLine(reading, lines, block) &&
                lines[i + 1] === "" &&
                reading.labelLines[i + 2]
            ) {
                i++;
            }
        }
        // The swap moves whole definitions, and a definition must read the
        // same in its new slot as in its old one. One whose last line is a
        // "$$" that ends the note, swapped into an earlier slot, has lines
        // after it there, and the "$$" opens a math block that swallows
        // the definitions below (live Obsidian 1.14.4, 2026-10-06; hunt
        // 2026-10-06, cycle 4, pin bug-end-dollar-line-swallows-definition).
        // A swap the result gate refuses is not made: the footnotes are
        // renamed, and their definitions stay in the order they were in.
        if (!rulePasses(rewritten, out, {})) return rewritten.join("\n");
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
