import { footnotePrefixProblem } from "../../parsing/footnote-prefix";
import { computeNextFootnoteNumber, referenceOccurrences } from "../../parsing/footnote-grammar";

import { rewriteDocument } from "../rewrite-document";
import { rewriteFootnoteNames } from "../rewrite-footnote-names";
import { FootnoteRule } from "../rule";

// The "Apply footnote prefix" rule, added to make life easier
// (2026-07-18).
//
// A prefix is a per-note namespace, like "2.", put in front of footnote
// names so that chapters merged into one document do not collide. Footnotes
// written before the note was given its footnote-prefix property do not
// carry it. This rule renames them so they do.
//
// Plain numbered footnotes are converted in the order they first appear:
// references first, then any orphaned definitions. They are numbered
// starting AFTER the highest prefixed footnote already in the note, so no
// new name lands on an existing one.
//
// Named footnotes keep their name, behind the prefix: "[^note]" becomes
// "[^2.note]" (A6 bug, 2026-07-20). The exception is when that prefixed
// name is already some other footnote in the note, because the rename would
// then quietly merge two footnotes into one; such a name is left alone.
//
// Footnotes already carrying the prefix are not touched. Definitions are
// not reordered either; putting them in order is reindex's job, so
// definition blocks stay where they are.
//
// This runs BEFORE reindex in the lint, so footnotes converted here are
// renumbered into reading order by the same lint.
//
// Running the lint twice cannot change anything a second time: everything
// this rule touches comes out carrying the prefix, and carrying the prefix
// is exactly what makes the rule skip a footnote.

/**
 * Rename every footnote that does not yet carry `prefix` so that it does. An
 * invalid prefix changes nothing here; the lint guard has already cancelled
 * such a run before it reaches this point.
 */
export function applyFootnotePrefix(markdown: string, prefix: string): string {
    if (!prefix || footnotePrefixProblem(prefix) !== null) return markdown;
    const prefixFolded = prefix.toLowerCase();

    // The masked twin (the copy of the note with protected text blanked
    // out) is built with the whole note in view, not line by line. That
    // matters on a line where a comment starts or ends: the part inside the
    // comment is blanked, the part outside it stays live.
    return rewriteDocument(markdown, (text, { lines, scan, maskedLines, definitions, definitionStarts }) => {
        const isProtected = scan.isProtected;

        // One walk over the note collects two things at once.
        //
        // `order`: the plain numbered names, each once, in the order they
        // first appear, references first and then orphaned definitions.
        // Numbers have no upper and lower case, so nothing needs folding
        // here.
        //
        // `existingIds`: every name in the note, lower-cased, for the guard
        // further down that stops a rename from landing on a name that is
        // already taken.
        const order: string[] = [];
        const seen = new Set<string>();
        const existingIds = new Set<string>();
        const record = (id: string) => {
            existingIds.add(id.toLowerCase());
            if (/^\d+$/.test(id) && !seen.has(id)) {
                seen.add(id);
                order.push(id);
            }
        };
        for (let i = 0; i < lines.length; i++) {
            if (isProtected[i]) continue;
            // referenceOccurrences finds each reference against the masked
            // twin but cuts the name out of the raw line. That matters
            // because the rewrite below compares the names as the user
            // typed them (bug-masked-name-identity).
            for (const { name } of referenceOccurrences(lines[i], maskedLines[i], definitionStarts[i])) {
                record(name);
            }
        }
        // then the definitions, in the order they appear, wherever each
        // sits. Skipping the ones inside a blockquote or callout once let a
        // rename land on a name a quoted definition already owned, merging
        // two footnotes, and left a quoted numbered orphan outside the
        // prefix's namespace (Kimi and Claude sweeps 2026-09-13); one in a
        // list item counts the same (Jason's ruling 1, option a,
        // 2026-10-03).
        for (const { name } of definitions) record(name);

        // Plain numbers carry on from after the highest-numbered footnote
        // that already carries the prefix. The masked twin is already built,
        // so it is passed in rather than made a second time (speed fix F1).
        let nextNumber = computeNextFootnoteNumber(
            text,
            prefix,
            maskedLines.join("\n"),
        );
        const numberedRenames = new Map<string, string>();
        for (const name of order) {
            numberedRenames.set(name, `${prefix}${nextNumber++}`);
        }

        // The new name for `id`, or null to leave that footnote alone. A
        // named footnote keeps the exact upper and lower case it was written
        // with in each place. Names are compared without regard to case, so
        // "[^Note]" and "[^note]:" are still one footnote once both have
        // gained the prefix.
        const renameFor = (id: string): string | null => {
            const numbered = numberedRenames.get(id);
            if (numbered !== undefined) return numbered;
            if (/^\d+$/.test(id)) return null; // a number the walk above did not collect
            const folded = id.toLowerCase();
            if (folded.startsWith(prefixFolded)) return null; // already carries the prefix
            if (existingIds.has(prefixFolded + folded)) return null; // the new name is taken
            return `${prefix}${id}`;
        };

        const rewritten = lines.map((line, i) =>
            isProtected[i] ? line : rewriteFootnoteNames(line, maskedLines[i], renameFor),
        );
        return rewritten.join("\n");
    });
}

/** This rule's catalogue entry. The prefix arrives as the rule's option. */
export const applyFootnotePrefixRule: FootnoteRule<{ prefix?: string }> = {
    id: "apply-footnote-prefix",
    name: "Apply footnote prefix",
    description:
        "Rename footnotes to carry the note's footnote-prefix property: plain numbered ones are numbered after any existing prefixed footnotes, named ones keep their name behind the prefix.",
    examples: [
        {
            description: "Prefixes plain footnotes in appearance order",
            before: "b[^2] a[^1] end\n\n[^1]: one\n[^2]: two",
            after: "b[^3.1] a[^3.2] end\n\n[^3.2]: one\n[^3.1]: two",
            options: { prefix: "3." },
        },
        {
            description: "Named footnotes keep their name behind the prefix",
            before: "x[^note] end\n\n[^note]: n",
            after: "x[^3.note] end\n\n[^3.note]: n",
            options: { prefix: "3." },
        },
    ],
    apply: (text, options) => applyFootnotePrefix(text, options.prefix ?? ""),
};
