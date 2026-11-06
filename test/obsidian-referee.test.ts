import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compareFacts, unpackAnswer, type SavedAnswer } from "../scripts/oracle/compare.mjs";
import { readerFacts } from "../scripts/oracle/reader-facts";

// The offline referee: the note reader (src/parsing/obsidian-markdown.ts,
// the adapter around @quartz-community/remark-obsidian, and footnote-facts.ts)
// against Obsidian's own answers, saved from the live oracle.
//
// Every saved answer was asked again on Obsidian 1.15.0 on 2026-11-05. None
// flipped. 35 of them changed: their reference names had been marked as
// impossible to ask about, 1.15.0 could answer for those, and 31 of the 35
// gained references that way (the old answers left them unknown, so nothing
// contradicted them). The other answers are as first recorded.
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
// - gate-s45-live: where a press on the last word of bracketed text that is
//   no link now lands (Jason's ruling Q2, 2026-10-07), asked of the live app
//   on 2026-10-08: a reference inside the brackets, with and without a
//   period after them, and an inline footnote there, with text and empty.
// - c6-hunt-live: the shapes hunt cycle 6 asked of the live app on
//   2026-10-08: a tight list against the loose one a blank line makes, a
//   label between two items, an email address with a reference after its
//   period and before it, a block id with a reference after it and before
//   it, text right under a quote or a list inside a footnote, a label whose
//   text starts with "2.", and a label after a quote's empty line with a
//   quote line under it.
// - list-run-live: the notes that list items moved into a footnote leave
//   (Jason's ruling, 2026-10-17), asked of the live app on 2026-10-17: a
//   run from the middle, the start, and the end of a list, numbered, loose,
//   with sub-items, with code in an item, and next to a block id.
// - remark-obsidian-live: the questions that vetting the package left to the
//   live app, asked of Obsidian 1.15.0 on 2026-11-06, 86 notes. Ids starting
//   "vet:" and "rules:" come from the two vetting runs. They cover a highlight
//   or a tag next to other syntax, runs of dollars, a backslash before "$$",
//   open blocks in a definition, byte order marks, and the shapes where the
//   old reader and the package agreed against docs/obsidian-reading-rules.md.
//
// The comparison is the live oracle's own (scripts/oracle/compare.mts), so a
// note agrees here exactly when `npm run oracle -- check --reader` would find
// nothing on it. Any disagreement fails the suite unless the note is on the
// short list below, each with the reason no rule explains it yet. To add
// notes, run the live oracle with --answers (TESTING.md) and add the file to
// AnswerFiles.

const AnswerFiles = ["fuzz-20261003", "reproducers", "recorded-facts", "pins", "probes", "broad-20261004", "overnight-probes", "swap34-probes", "h2-live-probes", "gate-s3-live", "gate-s45-live", "c6-hunt-live", "list-run-live", "remark-obsidian-live"];

/**
 * Notes on which the reader and Obsidian still disagree, by id, with the
 * reason. All but the last are places where the metadata cache reports a
 * live reference at the wrong column: the two sides agree that it is live
 * and on which line, and the reader's column is the one in the text. The
 * reader keeps the true column (the plugin edits by it), so these stay
 * listed rather than copied (the overnight oracle run, 2026-10-03: about
 * 140 of 20,000 notes, every one of the first two shapes; the third found
 * when the plugin began editing references by the reader's columns, the
 * runtime swap step 3, 2026-10-03). The last is a question the oracle could
 * not really ask, so its saved answer says less than it seems to.
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
    "broad:20261004-8185":
        'The same shift as night:cs-ord-co-lazy-text, by one column this time: under "+  > [!note] [^1]: ..." the line "> ...[^\u00c4]" puts the reference at column 45, not 44. This note could not be compared until the 1.15.0 answers said the reference is live (2026-11-05). The reason for the width of one is not worked out.',
    "broad:20261004-12474":
        'The same shift as night:p2b-task-sp-co-quoted, by three columns: under "- [ ]    > [!my note] [^3=]: ..." the line "\t> ...**bold**[^\u00c4]" puts the reference at column 38, not 35. This note could not be compared until the 1.15.0 answers said the reference is live (2026-11-05). The reason for the width of three is not worked out.',
    "vet:rmk:B1-callout":
        'A byte order mark at the very start of the note: the metadata cache counts the first line\'s columns without it ("\ufeff> [!note] t[^1]" puts [^1] at column 11, where it is at 12 in the text). The cache\'s worker turns the note\'s bytes into text with a plain TextDecoder, which drops the mark, so its columns are for the text without the mark (read from worker.js in 1.15.0, 2026-11-06). The plugin reads and edits the text the editor holds, which counts a mark that is there as one character (the byte order mark group in test/remark-obsidian-adapter.test.ts checks this on CodeMirror), so the reader keeps the true column. The two sides agree on the rest of the note.',
    "vet:rmk:B2-list": 'The same as vet:rmk:B1-callout in a list item: "\ufeff- a[^1]" puts [^1] at column 3, where it is at 4 in the text.',
    "rules:rmk:c3-bom-code": 'The same as vet:rmk:B1-callout in a paragraph with a code span: "\ufeffa `c`[^1]" puts [^1] at column 5, where it is at 6 in the text.',
    "rules:rmk:doc-e5-nbsp":
        'A no-break space in a reference\'s name, with no definition: the reader reads "a[^b\u00a0c]" as a live reference, and the saved answer lists none, but Obsidian was not really asked. The metadata cache lists only references that have a definition, so the oracle adds a definition for each name it finds, and its name pattern in scripts/oracle/inapp-parse.js stops at \\s, which counts a no-break space, so this name got none. With a definition in the note, Obsidian does read such a reference as live (swap34:name-nbsp), as the reader does.',
};

function load(name: string): SavedAnswer[] {
    return JSON.parse(readFileSync(new URL(`./obsidian-answers/${name}.json`, import.meta.url), "utf8")) as SavedAnswer[];
}

/** The disagreements on one saved note, as plain lines. */
function disagreements(answer: SavedAnswer): string[] {
    return compareFacts(answer.text, unpackAnswer(answer), readerFacts(answer.text), "the reader").map((d) => d.detail);
}

describe("the note reader agrees with Obsidian's saved answers", () => {
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
