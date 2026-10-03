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
//   obsidian-rules.md (callouts, lists, tables, Obsidian-only syntax, the
//   footnote reader, "%%" comments, list indentation, and the Reading-view
//   sample);
// - broad-20261004: notes of the overnight run of 2026-10-03, 20,000 notes
//   from the broad generator with seed 20261004 (generateBroadNotes in
//   scripts/oracle/generate.mjs): a few hundred the reader agreed on, spread
//   over the run, and whole notes behind each rule found that night;
// - overnight-probes: that night's shrunk reproducers and the families
//   written to pin each new rule down.
//
// The comparison is the live oracle's own (scripts/oracle/compare.mts), so a
// note agrees here exactly when `npm run oracle -- check --reader` would find
// nothing on it. Any disagreement fails the suite unless the note is on the
// short list below, each with the reason no rule explains it yet. To add
// notes, run the live oracle with --answers (TESTING.md) and add the file to
// AnswerFiles.

const AnswerFiles = ["fuzz-20261003", "reproducers", "recorded-facts", "pins", "probes", "broad-20261004", "overnight-probes"];

/**
 * Notes on which the reader and Obsidian still disagree, by id, with the
 * reason. Both left today are places where the metadata cache reports a
 * live reference at the wrong column: the two sides agree that it is live
 * and on which line, and the reader's column is the one in the text. The
 * reader keeps the true column (the plugin will edit by it), so these stay
 * listed rather than copied (the overnight oracle run, 2026-10-03: about
 * 140 of 20,000 notes, every one of these two shapes).
 */
const KnownDisagreements: Record<string, string> = {
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
