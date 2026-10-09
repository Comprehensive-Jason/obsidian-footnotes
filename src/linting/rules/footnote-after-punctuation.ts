import { holdBack, rulePasses } from "../rule-gate";
import { definitionLabelIn } from "../../parsing/label-shapes";
import { ClosingMarkChars, FootnotePlacement, imageStartsOn, linkLikeEndAt, punctuationAt, referenceLandingAfter, wordEndBefore } from "../../parsing/landing";
import { NoteReading, readNote } from "../../parsing/note-reading";
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
    /** a "[^x]" reference (true) or an inline footnote (false), which the lint's alert names differently */
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
// The punctuation before a run is looked for on the masked twin, and the
// text handed back is built from the original line, so a footnote name
// never comes out with the blanking characters in it. The walk forward
// over the punctuation and closing marks after a run reads the original
// line, as the press does, since the masked twin blanks a bare web address
// or email, and a closing mark glued to one then read as the end of the
// text: the lint moved "word[^1]==https://e.com", as the press writes it,
// to "word==[^1]https://e.com" (hunt 2026-10-06, cycle 4, pin
// bug-lint-press-disagree-glued-url). Code, math, and comments never start
// with punctuation or a closing mark, so the walk still stops in front of
// them.
//
// `images` are the columns of the stretch where the line draws an image
// or an embed (imageStartsOn, counted from the stretch's start): only
// there is a "!" in front of a "[" an image's and not punctuation, so in
// "Wow[^1]![x] more" with no "[x]:" line the reference still moves past
// the "!", as the press puts it (hunt 2026-10-06, cycle 4, pin
// bug-bang-before-undefined-brackets).
//
// `linkEndsAt` says whether, with the stretch written as the text it is
// given, a link, an address, or a wikilink ends at a column of it.
//
// `textStart` is the column of the stretch where the line's text begins,
// past its block syntax ("- ", "> ", "# "): spaces in front of it are the
// syntax's, never a word's (wordEndBefore).
//
// `keeps` is asked about each move before it is made, with the stretch as
// the move would leave it, and a move it turns down is not made. The
// first pass over a note allows every move; a line where a footnote died
// is done again with a real check (footnoteAfterPunctuation).
function swapInSegment(
    original: string,
    masked: string,
    units: readonly MovableUnit[],
    placement: FootnotePlacement = "after",
    keeps: (segment: string) => boolean = () => true,
    images: ReadonlySet<number> = new Set(),
    linkEndsAt: (segment: string, at: number) => boolean = () => false,
    textStart = 0,
): string {
    let out = "";
    let copied = 0;
    // A run whose forward move ends right where the next run starts goes
    // on with that run: it is written in front of it, wherever that run
    // lands, so one pass does what two did. Moved on its own it stopped at
    // the next run's "[", and under "before", where that run then moved out
    // of a closing bracket, only a second lint carried it on: "(see
    // “this[^1]”[^2]) next" became "(see “this”[^1])[^2] next", and then
    // "(see “this”)[^1][^2] next" (hunt 2026-10-02, pin
    // bug-placement-before-two-units-two-lints). `carried` holds such a
    // run's text until the next run is placed.
    let carried = "";
    // the units of the carried run, so a refused move names them too
    let carriedUnits: readonly MovableUnit[] = [];
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
        const runUnits = [...carriedUnits, ...units.slice(k, last + 1)];
        k = last + 1;
        // the run's text, with a run carried to it in front
        const run = carried + original.slice(start, end);
        carried = "";
        carriedUnits = [];
        // The run's move, or null when it stays where it is: the run is
        // written between `before` and `after`, and the three take the
        // place of the text from `copied` up to `to`.
        // Where the word in front of the run ends. Spaces typed between the
        // word and the run go with the run, so a reference moved past its
        // punctuation lands on the word: "water [^1]." becomes
        // "water.[^1]" under After, not "water .[^1]", and "water[^1]."
        // under Before (Jason's ruling Q35, 2026-10-09; hunt 2026-10-09
        // cycle 8, cluster V12, pin
        // spec-punctuation-rule-space-before-reference). A spaced run with
        // no punctuation after it stays as typed.
        const wordEnd = Math.max(copied, wordEndBefore(original, start, textStart));
        const move = ((): { before: string; after: string; to: number } | null => {
            // A link, an address, or a wikilink that ends at the word and
            // would take the run in, glued to it ("See https://e.org
            // [^1]."), is kept apart from the run by the spaces, so the run
            // stays where it is, as the email's period does below.
            if (wordEnd < start && linkEndsAt(original, wordEnd) && !linkEndsAt(original.slice(0, wordEnd) + original.slice(start), wordEnd)) return null;
            // The run of punctuation AND closing marks immediately after
            // it, the same walk the insert commands use
            // (referenceLandingAfter: "bravo[^1]". becomes "bravo".[^1],
            // **bold[^1]** becomes **bold**[^1], and a link's "(url)" tail
            // is stepped over whole). Taking both sides as whole runs is
            // what lets one pass finish the job, so running the lint again
            // changes nothing: "[^1][^2]?!" moves in one go. Under "before"
            // the walk stops in front of punctuation and steps over it only
            // together with a closing mark that follows, so the forward
            // move then carries the run out of a quote and no further.
            const punctuationEnd = referenceLandingAfter(original, end, placement, images);
            if (punctuationEnd === end) {
                // Under "before", a run that sits right AFTER punctuation
                // moves back in front of it: "word.[^1]" becomes
                // "word[^1].", and "句子。[^1]" becomes "句子[^1]。" (T5,
                // 2026-09-21). A run after a closing mark stays: the marker
                // belongs outside the quote in every convention found,
                // punctuation inside the quote or not.
                if (placement !== "before") return null;
                if (!punctuationAt(masked, start - 1, images)) {
                    // A spaced run in front of punctuation attaches to its
                    // word (ruling Q35).
                    return wordEnd < start && punctuationAt(masked, end, images) ? { before: original.slice(copied, wordEnd), after: "", to: end } : null;
                }
                let punctuationStart = start;
                while (punctuationAt(masked, punctuationStart - 1, images)) punctuationStart--;
                // A space in front of the punctuation stays with it, and the
                // run lands on the word: "Vraiment ?[^1]", with the no-break
                // space French puts before a "?", becomes "Vraiment[^1] ?",
                // where the press puts it (ruling Q35, which settles G9; pin
                // spec-lint-french-space-before-punctuation).
                const landing = Math.max(copied, wordEndBefore(original, punctuationStart, textStart, true));
                return { before: original.slice(copied, landing), after: original.slice(landing, start), to: end };
            }
            // A run of references that already comes AFTER punctuation or a
            // closing mark is where it should be. Any punctuation after it
            // belongs to the next clause, and moving the references again
            // would walk them further and further from the words they belong
            // to. Under "before" the forward move only ever carries a run
            // out of a quote, which is right wherever the run started.
            if (placement === "after" && start > 0 && (punctuationAt(masked, start - 1, images) || ClosingMarkChars.includes(masked[start - 1]))) return null;
            // A run right after a link that would take the punctuation in,
            // were the run moved past it, is where it should be too. An
            // email address takes in a period that text follows: in "Write
            // to me@example.com.[^1]" the period is part of the address, and
            // only "me@example.com[^1]." leaves it to the sentence
            // (docs/obsidian-reading-rules.md D8). That is where a press
            // puts the reference (Jason's ruling Q30, 2026-10-08), so
            // the lint leaves it there. It used to try the move, which the
            // result gate refused, and every lint said it could not move
            // the reference (hunt 2026-10-09, cycle 8, cluster V13, pin
            // bug-lint-alerts-on-email-period-reference). A run typed with a
            // space after the address attaches to it there, in front of the
            // period (ruling Q35).
            if (placement === "after" && linkEndsAt(original, wordEnd) && !linkEndsAt(original.slice(0, wordEnd) + original.slice(end, punctuationEnd) + original.slice(start, end) + original.slice(punctuationEnd), wordEnd)) {
                return wordEnd < start ? { before: original.slice(copied, wordEnd), after: "", to: end } : null;
            }
            return { before: original.slice(copied, wordEnd) + original.slice(end, punctuationEnd), after: "", to: punctuationEnd };
        })();
        const refused = move !== null && !keeps(out + move.before + run + move.after + original.slice(move.to));
        if (move === null || refused) {
            // a move the result gate refused is named in the lint's alert
            // (ADR 0002; heldBackBy in rule-gate.ts)
            if (refused) holdBack("punctuation", runUnits.map((unit) => unitLabel(run, unit, runUnits)));
            out += original.slice(copied, start) + run;
            copied = end;
            continue;
        }
        if (move.after === "" && move.to === units[k]?.start) {
            // a forward move up to the next run: go on with it
            out += move.before;
            carried = run;
            carriedUnits = runUnits;
        } else {
            out += move.before + run + move.after;
        }
        copied = move.to;
    }
    return out + original.slice(copied);
}

/**
 * How the lint's alert names `unit`, one of the `units` written back to
 * back as `run`: a reference by its name, an inline footnote by its text.
 */
function unitLabel(run: string, unit: MovableUnit, units: readonly MovableUnit[]): string {
    // where the unit sits in the run: after the units before it
    let at = 0;
    for (const other of units) {
        if (other === unit) break;
        at += other.end - other.start;
    }
    const text = run.slice(at, at + unit.end - unit.start);
    return unit.reference ? text.slice(2, -1) : text;
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
    // Each move is worked out on the line as it was, so a move can leave a
    // footnote next to punctuation that only a second pass sees: under
    // "before", 'He said "yes[^1]![^2]" and' first became
    // 'He said "yes[^1]!"[^2] and', and only the next lint moved [^1] out
    // after the quote; "true?[^1]![^2]" took two lints the same way. So
    // the pass repeats until it changes nothing, as fix-lazy's does, and
    // one lint settles the note (hunt 2026-10-06, cycle 3, pin
    // bug-placement-before-punctuation-between-references). A note that
    // needs no move takes one pass; the cap is a safety net.
    let current = markdown;
    for (let pass = 0; pass < 10; pass++) {
        const next = placedOnce(current, placement);
        if (next === current) break;
        current = next;
    }
    return current;
}

/** One pass of footnoteAfterPunctuation: every move worked out on the note as it is. */
function placedOnce(markdown: string, placement: "after" | "before"): string {
    // The masked twin is built with the whole note in view. On a line where
    // a comment opens or closes, the part inside the comment is blanked
    // while the part outside it still gets the swap
    // (bug-comment-boundary-lines).
    return rewriteDocument(markdown, (_text, { lines, reading, maskedLines }) => {
        // Line `i` with its moves made, each one only if `keeps` allows
        // the line as that move would leave it.
        const rewriteLine = (i: number, keeps: (line: string) => boolean = () => true): string => {
            const line = lines[i];
            if (reading.protectedLines[i]) return line;
            const masked = maskedLines[i];
            // A definition's own "[^x]:" label is not a reference sitting
            // in front of a colon, so start after it, wherever the
            // definition sits. Labels inside a blockquote or a callout
            // ("> [^1]: def.") are labels just the same (C22); the swap used
            // to mangle those into "> :[^1] def.", and the label of a
            // definition in a list item ("- [^la]: text", even behind a
            // quote marker) the same way (found by the
            // manual lint-alerts tests, 2026-09-20; hunt 2026-10-02, cluster Q1). A lazy
            // label's start is stepped over too, so the label the user
            // meant stays whole for fix-lazy to repair.
            // A lazy label is read from where the line's containers end,
            // as labelShapedLines reads it, so one at a list item's content
            // column of 4 or more ("10. item" puts it at column 4) is a
            // label too. Read from the margin it sat four spaces in, and its
            // "[^b]" was moved after the colon, ":[^b] lazy" (hunt
            // 2026-10-05, round 2, pin bug-punctuation-wide-item-label).
            const textStart = reading.containerEnd(i);
            const shaped = definitionLabelIn(line.slice(textStart));
            const prefixLength = reading.labelOn(i)?.labelEnd ?? (shaped === null ? 0 : textStart + shaped.labelEnd);
            // Whether a link ends at column `at` of the stretch written as
            // `segment`. The note is read again only for a stretch that
            // differs from the line, which happens only for a run right
            // after a link.
            const linkEndsAt = (segment: string, at: number): boolean => {
                const written = line.slice(0, prefixLength) + segment;
                const read = written === line ? reading : readNote(lines.map((text, j) => (j === i ? written : text)));
                const linkEnd = linkLikeEndAt(read, i, prefixLength + at - 1);
                return linkEnd?.line === i && linkEnd.ch === prefixLength + at;
            };
            return (
                line.slice(0, prefixLength) +
                swapInSegment(
                    line.slice(prefixLength),
                    masked.slice(prefixLength),
                    movableUnits(reading, i, prefixLength),
                    placement,
                    (segment) => keeps(line.slice(0, prefixLength) + segment),
                    new Set([...imageStartsOn(reading, i)].map((column) => column - prefixLength)),
                    linkEndsAt,
                    Math.max(0, reading.blockSyntaxEnd(i) - prefixLength),
                )
            );
        };
        const result = lines.map((_line, i) => rewriteLine(i));
        // The result gate judges the moves (rule-gate.ts). A move must
        // leave every footnote it moves a footnote, as a press must (check
        // 6 of the result gate). Stepping over the "]" of bracketed text
        // that is no link turns "[some text[^1]] here" into
        // "[some text][^1] here", which reads as a reference link with the
        // label "^1", so the footnote's only reference is gone (hunt
        // 2026-10-05, round 2, pin bug-punctuation-steps-over-bracket); so
        // does stepping over a "!" in front of "(sic)", which makes an
        // image (pin bug-placement-after-builds-image). Under "before",
        // "mc^.[^1]" became "mc^[^1].", an inline footnote "^[^1]" in place
        // of the reference (hunt 2026-10-06, cycle 3, pin
        // bug-placement-before-changes-footnote-kind). A move stays on its
        // line, so when the gate refuses the whole pass, each line is
        // judged on its own, and a line it refuses is done again, each move
        // on it made only if the gate passes the line with it.
        const intent = { footnotesMoved: true };
        if (!result.some((line, i) => line !== lines[i]) || rulePasses(lines, result, intent)) return result.join("\n");
        const kept = [...lines];
        const withLine = (i: number, line: string) => {
            const trial = [...kept];
            trial[i] = line;
            return trial;
        };
        for (let i = 0; i < result.length; i++) {
            if (result[i] === lines[i]) continue;
            kept[i] = rulePasses(lines, withLine(i, result[i]), intent) ? result[i] : rewriteLine(i, (line) => rulePasses(lines, withLine(i, line), intent));
        }
        return kept.join("\n");
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
