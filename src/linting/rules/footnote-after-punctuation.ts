import { definitionLabelIn } from "../../parsing/label-shapes";
import { ClosingMarkChars, FootnotePlacement, punctuationAt, referenceLandingAfter } from "../../parsing/landing";
import { NoteReading } from "../../parsing/note-reading";
import { rewriteDocument } from "../rewrite-document";
import { FootnoteRule } from "../rule";

// The obsidian-linter plugin's "footnote after punctuation" rule, rewritten
// here as a pure function: text in, text out. What it should and should not
// do is pinned by test/footnote-after-punctuation.test.ts.

// What counts as punctuation is asked of punctuationAt, the ONE definition
// the insert commands' end-of-word adjustment uses too: the characters of
// TrailingPunctuationChars (the ASCII punctuation plus the CJK fullwidth
// forms), minus any a backslash escapes.

// A stretch of text the rule moves as one thing: a "[^x]" reference, or a
// whole "^[...]" inline footnote.
interface MovableUnit {
    start: number;
    /** just past the last character */
    end: number;
    /** a "[^x]" reference (true) or an inline footnote (false); only a lone reference can be a label the label reader missed */
    reference: boolean;
}

// The references and inline footnotes on line `i` from column `from` on,
// as the note reading finds them, with their columns counted from `from`.
//
// The reading says which references are live, so everything Obsidian does
// not read as a reference stays where it is: an escaped "\[^1]" is literal
// prose, a name holding a space is prose too (Claude sweep 2026-09-13),
// and a reference-shaped string inside an inline footnote's body belongs
// to that body (rule E3; footnotes never nest, ADR 1), so it moves with the
// footnote, not on its own. This file once found references with a regular
// expression of its own, which swapped such shapes as well and so turned
// text the user had typed on purpose into a live reference (2026-08-11
// review, bug #1).
//
// An inline footnote moves too, as ONE unit, its whole "^[...]" span with
// the body untouched (N1 of the 2026-09 feature round; Jason, 2026-09-19:
// the exclusion was never intended, and inline and normal footnotes should
// place the same way). A body that runs onto the next line never closes on
// this line, so it is not a unit and stays where it is.
function movableUnits(reading: NoteReading, i: number, from: number): MovableUnit[] {
    const references = reading
        .referencesOn(i)
        .filter((reference) => reference.start >= from)
        .map((reference) => ({ start: reference.start - from, end: reference.end - from, reference: true }));
    const notes = reading
        .inlineNotesOn(i)
        .filter((note) => note.open >= from)
        .map((note) => ({ start: note.open - from, end: note.close + 1 - from, reference: false }));
    return [...references, ...notes].sort((a, b) => a.start - b.start);
}

// Swap each run of `units` (see movableUnits) with the run of punctuation
// after it, within one stretch of a line.
//
// The punctuation is looked for on the masked twin, but the text handed
// back is built from the original line. Otherwise a footnote name could
// come out with the blanking characters in it.
function swapInSegment(
    original: string,
    masked: string,
    units: readonly MovableUnit[],
    insideBody = false,
    mayBeLabel = true,
    placement: FootnotePlacement = "after",
): string {
    let out = "";
    let copied = 0;
    let k = 0;
    while (k < units.length) {
        // Units written back to back move as one run. Anything the grammar
        // refuses to count, sitting between two of them, ends the run.
        let last = k;
        while (last + 1 < units.length && units[last + 1].start === units[last].end) {
            last++;
        }
        const start = units[k].start;
        const end = units[last].end;
        const loneReference = last === k && units[k].reference;
        k = last + 1;
        // Whether this run, written at `at` with the character `next` right
        // after it, is a definition label: a SINGLE reference followed by
        // ":" with nothing but whitespace, quote markers, or dead text
        // before it. Such a label can only sit after a blank line or at the
        // top of the note; the same shape directly under prose is lazy
        // paragraph text, a live reference before a colon. A RUN of two or
        // more references is never a label, and neither is a reference at
        // the start of a definition's BODY: "[^1][^2]: x" is two live
        // references and a literal colon to Obsidian, and "[^1]: [^2]: x" a
        // definition whose body starts with a reference (Kimi hunt cycle 4,
        // probed 2026-09-16). Both directions of the move ask it, so a
        // label is never moved and a move never makes one.
        const labelAt = (at: number, next: string | undefined) =>
            loneReference &&
            !insideBody &&
            mayBeLabel &&
            next === ":" &&
            masked.slice(0, at).replace(/[>%\0\s]/g, "") === "";
        // The run of punctuation AND closing marks immediately after it,
        // the same walk the insert commands use (referenceLandingAfter:
        // "bravo[^1]". becomes "bravo".[^1], **bold[^1]** becomes
        // **bold**[^1], and a link's "(url)" tail is stepped over whole).
        // Taking both sides as whole runs is what lets one pass finish the
        // job, so running the lint again changes nothing: "[^1][^2]?!"
        // moves in one go. Under "before" the walk stops in front of
        // punctuation and steps over it only together with a closing mark
        // that follows, so the forward move then carries the run out of a
        // quote and no further.
        const punctuationEnd = referenceLandingAfter(masked, end, placement);
        if (punctuationEnd === end) {
            // Under "before", a run that sits right AFTER punctuation moves
            // back in front of it: "word.[^1]" becomes "word[^1].", and
            // "句子。[^1]" becomes "句子[^1]。" (T5, 2026-09-21). A run after
            // a closing mark stays: the marker belongs outside the quote in
            // every convention found, punctuation inside the quote or not.
            if (placement !== "before" || !punctuationAt(masked, start - 1)) continue;
            let punctuationStart = start;
            while (punctuationAt(masked, punctuationStart - 1)) punctuationStart--;
            // A reference moved in front of a line-initial colon would
            // become a label: ":[^1] text" would turn into "[^1]: text", a
            // second definition of footnote 1 (hunt 2026-10-02, pin
            // bug-placement-before-colon-makes-label).
            if (labelAt(punctuationStart, masked[punctuationStart])) continue;
            out +=
                original.slice(copied, punctuationStart) +
                original.slice(start, end) +
                original.slice(punctuationStart, start);
            copied = end;
            continue;
        }
        // A label the label reader did not claim stays where it is: one
        // indented past three spaces inside a list item ("    [^113]: def",
        // a definition to Obsidian that the plugin does not model yet), or
        // one after a "%%" that is not a block's closer. Swapping its colon
        // would turn it into ":[^113]" for good (Claude sweep 2026-09-13).
        if (labelAt(start, masked[end])) continue;
        // A run of references that already comes AFTER punctuation or a
        // closing mark is where it should be. Any punctuation after it
        // belongs to the next clause, and moving the references again
        // would walk them further and further from the words they belong
        // to. Under "before" the forward move only ever carries a run out
        // of a quote, which is right wherever the run started.
        if (placement === "after" && start > 0 && (punctuationAt(masked, start - 1) || ClosingMarkChars.includes(masked[start - 1]))) continue;
        out +=
            original.slice(copied, start) +
            original.slice(end, punctuationEnd) +
            original.slice(start, end);
        copied = punctuationEnd;
    }
    return out + original.slice(copied);
}

/**
 * Move every footnote reference to the side of the punctuation the
 * placement setting says: under "after" (the default) "word[^1]." becomes
 * "word.[^1]"; under "before" the opposite, "word.[^1]" becomes
 * "word[^1]."; under "none" nothing moves at all. An inline footnote
 * moves the same way, as one unit: "word^[note]." becomes "word.^[note]".
 * Closing marks are stepped over whatever the setting, so a reference
 * never lands inside a quote.
 *
 * A definition's own label is never touched. The body of a definition is
 * prose like any other, so references in it are moved too. Code blocks,
 * inline code and frontmatter are left alone.
 */
export function footnoteAfterPunctuation(markdown: string, placement: FootnotePlacement = "after"): string {
    if (placement === "none") return markdown;
    // The masked twin is built with the whole note in view. On a line where
    // a comment opens or closes, the part inside the comment is blanked
    // while the part outside it still gets the swap
    // (bug-comment-boundary-lines).
    return rewriteDocument(markdown, (_text, { lines, reading, maskedLines }) => {
        const result = lines.map((line, i) => {
            if (reading.protectedLines[i]) return line;
            const masked = maskedLines[i];
            // A definition's own "[^x]:" label is not a reference sitting
            // in front of a colon, so start after it, wherever the
            // definition sits. Labels inside a blockquote or a callout
            // ("> [^1]: def.") are labels just the same (C22); the swap used
            // to mangle those into "> :[^1] def.", and the label of a
            // definition in a list item ("- [^la]: text", even behind a
            // quote marker) the same way (found by the former sheet 23
            // tests, 2026-09-20; hunt 2026-10-02, cluster Q1). A lazy
            // label's start is stepped over too, so the label the user
            // meant stays whole for fix-lazy to repair.
            // a byte order mark in front of a line-0 label is not text
            // the label reader sees, so it is stepped over first (the old
            // colon guard happened to cover it; spec-bom-before-line-zero-label)
            const bom = line.startsWith("\ufeff") ? 1 : 0;
            const prefixLength = reading.labelOn(i)?.labelEnd ?? bom + (definitionLabelIn(line.slice(bom))?.labelEnd ?? 0);
            return (
                line.slice(0, prefixLength) +
                swapInSegment(
                    line.slice(prefixLength),
                    masked.slice(prefixLength),
                    movableUnits(reading, i, prefixLength),
                    prefixLength > bom,
                    i === 0 || lines[i - 1].trim() === "",
                    placement,
                )
            );
        });
        return result.join("\n");
    });
}

/** This rule's catalogue entry. The id matches obsidian-linter's file name; the option is the placement setting. */
export const footnoteAfterPunctuationRule: FootnoteRule<{ placement?: FootnotePlacement }> = {
    id: "footnote-after-punctuation",
    name: "Footnote after punctuation",
    description:
        'Move footnote references to the side of punctuation the placement setting says: after it by default ("word[^1]." → "word.[^1]"), before it, or not at all.',
    examples: [
        {
            description: "Reference before a period moves after it",
            before: "word[^1].",
            after: "word.[^1]",
            options: {},
        },
        {
            description: "A run of references crosses a run of punctuation as one unit",
            before: "wait[^1]?!",
            after: "wait?![^1]",
            options: {},
        },
        {
            description: "An inline footnote moves whole, its body untouched",
            before: "word^[an inline note].",
            after: "word.^[an inline note]",
            options: {},
        },
        {
            description: "References inside inline code are left alone",
            before: "use `x[^1].` as-is",
            after: "use `x[^1].` as-is",
            options: {},
        },
        {
            description:
                "An escaped literal \\[^1] is prose, not a reference - never moved",
            before: "prose \\[^1]. tail",
            after: "prose \\[^1]. tail",
            options: {},
        },
        {
            description: "Under 'before', a reference after a period moves in front of it",
            before: "句子。[^1]",
            after: "句子[^1]。",
            options: { placement: "before" },
        },
        {
            description: "Under 'before', a reference still lands outside a closing quote",
            before: "「句子[^1]。」",
            after: "「句子。」[^1]",
            options: { placement: "before" },
        },
    ],
    apply: (text, options) => footnoteAfterPunctuation(text, options.placement),
};
