import { lazyDefinitionLabelLines } from "../../parsing/markdown-scan";
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
// One label the rule leaves alone even when the setting is on: a lazy label
// whose blank line would make the definition SWALLOW protected text below
// it. An indented code chunk two lines under the label is code while the
// label is prose, but the moment the label becomes a definition, that
// chunk (indented, after a blank line) reads as the definition's
// continuation, and the code is gone. The lint's promise that protected
// text survives untouched outranks the fix, so such a label stays lazy and
// the alert names it (found by the lint properties, 2026-09-15; the same
// swallowing as the pinned move-to-bottom finding).

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
        let lazy = lazyDefinitionLabelLines(lines);
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
            // by the adjacency property). Nor is one that changes which text
            // is protected.
            if (protectedTextChanged(lines, trial) || !readNote(trial).labelLines[at + 1]) {
                skipped.add(at);
                continue;
            }
            lines = trial;
            skipped = new Set([...skipped].map((line) => (line >= at ? line + 1 : line)));
            lazy = lazyDefinitionLabelLines(lines);
        }
        return lines.join("\n");
    });
}

/**
 * Whether the set of protected lines (code, math, comments, frontmatter)
 * reads differently after a trial insertion: a protected line that went
 * live, or a live line that became protected. Compared as sorted lists of
 * line contents, so the inserted line's shift does not matter.
 */
function protectedTextChanged(before: string[], after: string[]): boolean {
    const pick = (lines: string[]) => {
        const flags = readNote(lines).protectedLines;
        return lines.filter((_line, i) => flags[i]).sort().join("\n");
    };
    return pick(before) !== pick(after);
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
