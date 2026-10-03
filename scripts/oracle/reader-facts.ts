// The remark-parse 8 reader's reading of a note (src/parsing/footnote-facts.ts),
// in the shape the oracle's comparison takes (compare.mts): its definitions
// with their last lines, its live references, and per line the kind of
// protected block covering it, or "" for an ordinary line.
//
// The offline referee suite (test/obsidian-referee.test.ts) compares this
// with Obsidian's saved answers, and `npm run oracle -- check --reader`
// compares it with Obsidian's live answers (run-oracle.mjs bundles this file
// with esbuild, as it does plugin-facts.ts).

import { footnoteFacts } from "../../src/parsing/footnote-facts";
import { normalizeLineBreaks } from "../../src/parsing/obsidian-markdown";
import type { ReaderFacts } from "./compare.mjs";

export function readerFacts(text: string): ReaderFacts {
    const facts = footnoteFacts(text);
    const lineKinds = normalizeLineBreaks(text)
        .split("\n")
        .map(() => "");
    // a protected block covers every line from its first to its last, the
    // last included even when the block stops at its first column: an
    // unclosed fence ends at the start of the note's final empty line, and
    // Obsidian's code section counts that line
    for (const span of facts.protectedSpans) {
        if (!span.block) continue;
        for (let line = span.startLine; line <= span.endLine; line++) if (lineKinds[line] === "") lineKinds[line] = span.kind;
    }
    return {
        definitions: facts.definitions.map((d) => ({ name: d.name, kind: "block", line: d.start, end: d.end })),
        references: facts.references.filter((r) => r.live).map((r) => ({ name: r.name, line: r.line, column: r.start })),
        lineKinds,
    };
}
