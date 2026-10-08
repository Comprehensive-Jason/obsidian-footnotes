import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compareFacts, unpackAnswer, type SavedAnswer } from "../scripts/oracle/compare.mjs";
import { readerFacts } from "../scripts/oracle/reader-facts";

// The offline referee: the remark-parse 8 reader (src/parsing/
// obsidian-markdown.ts and footnote-facts.ts) against Obsidian's own
// answers, saved from the live oracle on 2026-10-03.
//
// Each file in test/obsidian-answers/ holds notes with what Obsidian's
// parser said about them: its definitions and where each ends, its live
// references, its top-level code blocks, and the reference names it could
// not be asked about. The notes are:
// - fuzz-20261003: the 3000 container-heavy notes of the oracle's fuzz with
//   seed 20261003 (scripts/oracle/generate.mjs);
// - reproducers: the 966 shrunk notes on which the plugin's scanner and
//   Obsidian disagreed in that fuzz;
// - recorded-facts and pins: the facts recorded in commit messages and the
//   premises of the bug pins in test/hunt/, as notes;
// - probes: the families written to pin down each rule in
//   docs/obsidian-reading-rules.md (callouts, lists, tables, Obsidian-only syntax, the
//   footnote reader, "%%" comments, list indentation, and the Reading-view
//   sample);
// - broad-20261004: notes of the overnight run of 2026-10-03, 20,000 notes
//   from the broad generator with seed 20261004 (generateBroadNotes in
//   scripts/oracle/generate.mjs): a few hundred the reader agreed on, spread
//   over the run, and whole notes behind each rule found that night;
// - overnight-probes: that night's shrunk reproducers and the families
//   written to pin each new rule down;
// - swap34-probes: the shapes steps 1 and 2 of the runtime swap left
//   resting on the reader alone, asked of the live app (with Reading view)
//   on 2026-10-03: a bracketed word right before a reference, a blank line
//   ending a "<div>" block (in a quote, in a list item, at the top level)
//   against a "<pre>" one, "Notes:" over a bare "- " or "-", a label whose
//   name holds a code span with a bracket, names holding a no-break or an
//   ideographic space, a link definition's label running over blank
//   lines (which swallows a footnote's label below it), and a reference
//   written as a link's text ("[^1](url)" is a link, no footnote);
// - h2-live-probes: the shapes the pre-stable hunt of 2026-10-05 left to the
//   live app, asked after its fixes: a definition between two lists (and the
//   two lists alone, which Obsidian reads as one list), task boxes holding
//   another character ("- [/]", "- [>]"), a link definition's title or
//   "<...>" destination running over blank lines, an inline HTML tag whose
//   attribute runs over a line break, and a reference right after a bare
//   email address;
// - gate-s3-live: the shapes the result gate's stage 3 asked of the live
//   app on 2026-10-08: a reference written into the blank line under a
//   paragraph, over a rule, more prose, a table, a definition, and
//   indented code (Jason's ruling B1); a definition gathered under the
//   section heading of a note that ends in an open fence or comment; and a
//   quote holding indented code moved into a definition.
//
// The comparison is the live oracle's own (scripts/oracle/compare.mts), so a
// note agrees here exactly when `npm run oracle -- check --reader` would find
// nothing on it. Any disagreement fails the suite unless the note is on the
// short list below, each with the reason no rule explains it yet. To add
// notes, run the live oracle with --answers (TESTING.md) and add the file to
// AnswerFiles.

const AnswerFiles = ["fuzz-20261003", "reproducers", "recorded-facts", "pins", "probes", "broad-20261004", "overnight-probes", "swap34-probes", "h2-live-probes", "gate-s3-live"];

/**
 * Notes on which the reader and Obsidian still disagree, by id, with the
 * reason. Every one left today is a place where the metadata cache reports
 * a live reference at the wrong column: the two sides agree that it is live
 * and on which line, and the reader's column is the one in the text. The
 * reader keeps the true column (the plugin edits by it), so these stay
 * listed rather than copied (the overnight oracle run, 2026-10-03: about
 * 140 of 20,000 notes, every one of the first two shapes; the third found
 * when the plugin began editing references by the reader's columns, the
 * runtime swap step 3, 2026-10-03).
 */
const KnownDisagreements: Record<string, string> = {
    "fact:e3eba8c-percent-closer-definition-body-live":
        'A footnote definition after a "%%" closer on the same line: the metadata cache places the text of the definition as if the "%%" were not there ("%% [^a]: sees [^b]" puts [^b] at column 13, not 15), the same shortfall as on an opener line below.',
    "night:cs-pct-sp-ref":
        'Text on a "%%" opener line: the metadata cache places it as if the line\'s indentation and the "%%" were not there ("%% a[^1]" puts [^1] at column 3, not 5; "  %% a[^1]" at 3, not 7; in a quote or a list item, short by the "%%" alone). Varied in out-fam-cs: the line after the opener, a closer line with text, and inline pairs are placed right.',
    "night:cs-ord-co-lazy-text":
        'A lazy line right under a callout title that has anything after its marker (a title, or only a space), when the callout sits inside a list item or another quote: the metadata cache shifts the lazy line right by the outer container\'s width ("1. > [!note] T" then "ab cd[^1]" puts [^1] at column 9, not 6; ">> [!note] T" then "[^1]" at 2, not 1; "- > [!note] T" then "ab[^1]" at 5, not 3). Varied in out-fam-cs and out-fam-p2: without anything after the marker, at the top level, after a quoted line, or with a plain quote, there is no shift.',
    "night:p2b-task-sp-co-quoted":
        'The same shift in a task item reaches the quoted line under the title too: "- [ ] > [!note] T" then "  > ab[^1]" puts [^1] at column 9, not 7 (and a lazy line under it at 9, not 3). Varied in out-fam-p2b: a plain quote or a callout with nothing after its marker in the same task item, and a tab instead of the task box, show no shift.',
};

function load(name: string): SavedAnswer[] {
    return JSON.parse(readFileSync(new URL(`./obsidian-answers/${name}.json`, import.meta.url), "utf8")) as SavedAnswer[];
}

/** The disagreements on one saved note, as plain lines. */
function disagreements(answer: SavedAnswer): string[] {
    return compareFacts(answer.text, unpackAnswer(answer), readerFacts(answer.text), "the reader").map((d) => d.detail);
}

describe("the remark-parse 8 reader agrees with Obsidian's saved answers", () => {
    // a generous time limit: under the full suite's load, parsing the 3000
    // fuzz notes alone can take more than vitest's default 5 seconds
    for (const file of AnswerFiles) {
        it(file, () => {
            const failures: string[] = [];
            for (const answer of load(file)) {
                if (answer.id in KnownDisagreements) continue;
                const found = disagreements(answer);
                if (found.length > 0) failures.push(`${answer.id} ${JSON.stringify(answer.text)}\n    ${found.join("\n    ")}`);
            }
            expect(failures).toEqual([]);
        }, 120000);
    }

    it("every known disagreement is still one (a fixed note leaves the list)", () => {
        const all = AnswerFiles.flatMap(load);
        const stale = Object.keys(KnownDisagreements).filter((id) => {
            const answer = all.find((a) => a.id === id);
            return answer === undefined || disagreements(answer).length === 0;
        });
        expect(stale).toEqual([]);
    }, 120000);
});
