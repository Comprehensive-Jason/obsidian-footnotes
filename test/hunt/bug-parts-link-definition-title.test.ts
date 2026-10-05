import { describe, expect, it } from "vitest";

import { footnoteFacts } from "../../src/parsing/footnote-facts";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output, rare): a long note read in parts reads a footnote
// reference differently from the whole note, when a part happens to start
// inside a link definition's title.
//
// What the user would see: a link reference definition (a line such as
// "[foo]: /url" that gives "[text][foo]" links their address) may carry a
// title in quotes, and that title may start after a blank line and run
// over several lines. A "[^1]" written inside the title is part of the
// title, not a footnote. The plugin reads long notes in parts, cut at
// lines a hash picks, to stay fast. When a part starts on the title's
// first line, that part reads "[^1]" as a live reference, so the plugin
// can disagree with itself about the same note depending on where the
// cut fell. Which side is wrong (the parts or the whole note) still
// awaits a live check in Obsidian; the parts and the whole disagreeing is
// a defect either way.
//
// Hunt 2026-10-05, round 1, lens reading. Cluster RD2.
//
// Source of truth: note-reading.ts promises that a note read in parts
// reads exactly as the whole note does. remark-parse 8 (the parser
// Obsidian uses) lets a definition's title start after spaces, tabs, and
// line breaks, and run over lines.
//
// Cause: a part that starts inside the title reads it as a paragraph.
// linkDefinitionsAtTheEnd (obsidian-markdown.ts) marks a part whose last
// link definition would read differently with more text after it, but
// the only text it tries is "]: x" and "x", which finish a label. It
// never tries a title or an angle-bracket address that runs on past the
// part's end.

/** The part-start hash of note-reading.ts (usedAsPartStart), copied so the test can place a part start. */
function usedAsPartStart(line: string): boolean {
    let hash = 0;
    const end = Math.min(line.length, 32);
    for (let i = 0; i < end; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
    return (Math.imul(hash, 0x9e3779b1) >>> 0) % 8 === 0;
}

/** A line starting with `head` that the reading uses as a part start. */
function partStartLine(head: string): string {
    for (let i = 0; ; i++) if (usedAsPartStart(`${head} w${i}`)) return `${head} w${i}`;
}

/** The live references, definitions, and protected spans of a reading, as short strings that compare easily. */
function summary(facts: { references: { name: string; line: number; live: boolean }[]; definitions: { name: string; start: number }[]; protectedSpans: { kind: string; startLine: number; endLine: number }[] }) {
    return {
        references: facts.references.filter((r) => r.live).map((r) => `${r.name}@${r.line}`),
        definitions: facts.definitions.map((d) => `${d.name}@${d.start}`),
        spans: facts.protectedSpans.map((s) => `${s.kind}:${s.startLine}-${s.endLine}`),
    };
}

describe("a part cut inside a link definition's title", () => {
    it.fails("reads in parts as the whole note does when a part starts at the title's first line", () => {
        const title = partStartLine("'tit [^1]");
        const lines = ["[foo]: /url", "", title, "le'", "", "use[^1]", "", "[^1]: d"];
        const whole = summary(footnoteFacts(lines.join("\n")));
        // Today the parts read ["1@2", "1@5"]; the whole note reads ["1@5"].
        expect(summary(readNote(lines) as never)).toEqual(whole);
    });

    it.fails("the same with a destination in angle brackets running over a blank line", () => {
        // remark-parse 8 lets "<...>" hold line breaks, and in commonmark mode
        // an unclosed one rejects the definition. A "[" inside "<...>" rejects
        // the definition too, so no reference can sit in it; the difference
        // here is the protected span.
        const middle = partStartLine("b");
        const lines = ["[foo]: <a", "", middle, "c>", "", "use[^1]", "", "[^1]: d"];
        const whole = summary(footnoteFacts(lines.join("\n")));
        expect(whole.spans).toEqual(["linkDestination:0-3"]);
        expect(summary(readNote(lines) as never)).toEqual(whole);
    });
});
