import { rulePasses } from "../rule-gate";
import { lazyDefinitionLabelLines } from "../../parsing/label-shapes";
import { readNote } from "../../parsing/note-reading";
import { rewriteDocument } from "../rewrite-document";
import { FootnoteRule } from "../rule";

// The "Fix definitions hidden by a missing blank line" rule.
//
// The problem it fixes: when you type a "[^x]:" line directly under a line
// of prose (a paragraph, a list item, a quote or callout line) with no
// blank line between them, Obsidian does not see a definition. It
// sees more of the paragraph. The project calls such a line a "lazy label";
// the note reading is what decides it. You meant a definition and are one
// blank line short of it.
//
// What this rule does: inserts that blank line.
//
// Why it runs first in the lint pipeline: every rule after it should judge
// the definition you meant, not the prose line Obsidian saw. Once the blank
// line exists, move-to-bottom gathers the definition, the orphan and
// duplicate rules judge it, and reindex numbers it.
//
// When the setting is off, nothing is inserted and the lazy-definition lint
// alert reports the line instead. (Ruling: Jason, 2026-09-09.)
//
// The result gate judges each blank line before it goes in (rule-gate.ts),
// and a label whose blank line it refuses stays lazy, and the alert names
// it. Such as a label whose blank line would make the definition SWALLOW
// protected text below it: an indented code chunk two lines under the
// label is code while the label is prose, but the moment the label becomes
// a definition, that chunk (indented, after a blank line) reads as the
// definition's continuation, and the code is gone (found by the lint
// properties, 2026-09-15). Or one whose blank line would change how the
// lines after it read: under "1. one", "[^a]: lazy", "2. two", a numbered
// item that does not start at 1 cannot break into a paragraph, so the
// blank line would make "2. two" (and every item after it) part of the
// footnote's text, and under "- one", "[^a]: lazy", "- two" it would split
// the list in two (live Obsidian 1.14.4, 2026-10-05; Jason's triage
// decision Q7, 2026-10-05). Or one whose blank line would make a heading:
// two lazy labels in one paragraph with a "===" under the second, where
// the first would become a definition and the second, over its "===", a
// level 1 heading the note never had (hunt 2026-10-06, cycle 5, pin
// bug-fix-lazy-makes-heading-of-next-label), or a heading inside the new
// definition's own text (Jason's ruling on Q24 and list B, B6). The rest of
// the label's own paragraph may become the definition's text, or
// definitions and tables of their own: that is what the user meant.

// The blockquote markers in front of a label line. Inside a quote, a line
// holding nothing but those same ">" markers is what counts as a blank
// line, so the inserted line copies them (checked against the real app,
// ground truth 2026-09-09).
const QuoteMarkers = /^ {0,3}((?:>[ \t]?)*)/;

/**
 * `markdown` with one blank line inserted above each hidden definition, or a
 * bare quote line where the definition is inside a quote. A note that has no
 * hidden definitions comes back byte for byte as it went in.
 */
export function fixLazyDefinitions(markdown: string): string {
    // A label the pass skipped (its blank line would have swallowed
    // protected text) can become safe once a LATER insertion in the same
    // pass changes the note, so one pass could leave a label that the next
    // lint then fixed, and lint twice was not lint once (Kimi hunt cycle
    // 2, 2026-09-16). So the pass repeats until it changes nothing; each
    // pass inserts at least one line or stops, and the cap is a safety net.
    let current = markdown;
    for (let pass = 0; pass < 20; pass++) {
        const next = fixLazyDefinitionsOnce(current);
        if (next === current) return current;
        current = next;
    }
    return current;
}

function fixLazyDefinitionsOnce(markdown: string): string {
    return rewriteDocument(markdown, (text, view) => {
        let lines = view.lines;
        let read = readNote(lines);
        let lazy = lazyDefinitionLabelLines(lines, undefined, read);
        if (lazy.length === 0) return text;
        // labels the rule has decided to leave alone, by line number in the
        // CURRENT numbering (an insertion above one shifts it down by one)
        let skipped = new Set<number>();
        // Insert one line above the TOPMOST lazy label, then look at the
        // note again. That single blank line often turns the labels below it
        // into definitions too, because a label sitting directly under a
        // definition is itself a definition. Inserting above every lazy
        // label in one go would therefore add lines that are not needed.
        //
        // Each time round, either the label being aimed at becomes a
        // definition or it is skipped, so this always finishes. The loop
        // count is only a safety net, not what actually stops it.
        for (let guard = lazy.length * 2; guard > 0; guard--) {
            const at = lazy.find((line) => !skipped.has(line));
            if (at === undefined) break;
            const markers = (QuoteMarkers.exec(lines[at])?.[1] ?? "").trimEnd();
            const trial = [...lines.slice(0, at), markers, ...lines.slice(at)];
            // A blank line goes in only when it makes the label a definition
            // in Obsidian's reading. One that does not, because the line
            // above opens something the blank line would close differently
            // ("x $$" then "$$ tail" over the label, where the blank line
            // turns the "$$" line into a math block that takes the label
            // in), is not inserted: it used to be inserted on every lint, one
            // more blank line each time (the runtime swap, 2026-10-03; found
            // by the adjacency property). Nor is one the result gate
            // refuses: what it means is the labels it makes definitions,
            // this one and any lazy label under it that a definition now
            // takes in as a label of its own.
            const reading = readNote(trial);
            if (!reading.labelLines[at + 1]) {
                skipped.add(at);
                continue;
            }
            const defined = lazy
                .map((line) => (line >= at ? line + 1 : line))
                .flatMap((line) => {
                    const label = reading.labelLines[line] ? reading.labelOn(line) : null;
                    return label === null ? [] : [label.name];
                });
            // A lazy label can sit inside a footnote's own text: one typed
            // straight under a footnote longer than Obsidian's look-ahead
            // reads as more of that footnote (rule E4 of
            // docs/obsidian-reading-rules.md). Its blank line ends that
            // footnote's text above the label, which the gate is told, so
            // it still refuses any other change to that footnote (pin
            // bug-label-past-lookahead-not-lazy).
            const holder = read.definitionAt(at);
            const shortened = holder !== null && holder.start < at ? { name: holder.name, line: at } : undefined;
            if (!rulePasses(lines, trial, { defined, ...(shortened ? { shortened } : {}) })) {
                skipped.add(at);
                continue;
            }
            lines = trial;
            read = reading;
            skipped = new Set([...skipped].map((line) => (line >= at ? line + 1 : line)));
            lazy = lazyDefinitionLabelLines(lines, undefined, read);
        }
        return lines.join("\n");
    });
}

export const fixLazyDefinitionsRule: FootnoteRule = {
    id: "fix-lazy-definitions",
    name: "Fix definitions hidden by a missing blank line",
    description:
        "Insert the blank line a footnote definition needs when its label line sits directly under a paragraph, list item, or quote line - Obsidian reads such a line as plain text.",
    examples: [
        {
            description: "A definition typed directly under its paragraph gets its blank line",
            before: "Some prose[^1] here.\n[^1]: the definition",
            after: "Some prose[^1] here.\n\n[^1]: the definition",
        },
        {
            description: "Inside a callout the blank line is a bare quote line",
            before: "> [!note]\n> body[^1]\n> [^1]: the definition",
            after: "> [!note]\n> body[^1]\n>\n> [^1]: the definition",
        },
    ],
    apply: (text) => fixLazyDefinitions(text),
};
