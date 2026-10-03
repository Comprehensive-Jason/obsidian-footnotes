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
//   sample).
//
// The comparison is the live oracle's own (scripts/oracle/compare.mts), so a
// note agrees here exactly when `npm run oracle -- check --reader` would find
// nothing on it. Any disagreement fails the suite unless the note is on the
// short list below, each with the reason no rule explains it yet. To add
// notes, run the live oracle with --answers (TESTING.md) and add the file to
// AnswerFiles.

const AnswerFiles = ["fuzz-20261003", "reproducers", "recorded-facts", "pins", "probes"];

/** Notes on which the reader and Obsidian still disagree, by id, with the reason. */
const KnownDisagreements: Record<string, string> = {
    "fuzz:20261003-1463":
        'Obsidian ends [^1] at its label line and makes the "    %%" line after it a top-level indented code block, outside the list; no rule in obsidian-rules.md predicts that (reduced: probe j1-1463).',
    "probe:j1-1463": 'The reduced fuzz note 1463: "1. p / 10. %% / x / [^1]: def / %%". Obsidian ends [^1] on line 4; a 4-space line is inside the item by rule B2, and "%%" lines do not end definitions (D5).',
    "probe:e3-empty": 'Obsidian lists a reference with an empty name at the empty inline footnote "^[]" of "a^[] [^1]", as if it were a reference with no name; harmless, and not a reference the plugin should count.',
    "probe:e3-caret-ref-name": 'Obsidian reads no reference at all in "a[^^[x]]"; remark-footnotes reads one named "^[x".',
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
