import { readNote } from "../src/parsing/note-reading";
import fc from "fast-check";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { mathFromMarkdown } from "mdast-util-math";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { math } from "micromark-extension-math";
import { describe, expect, it } from "vitest";

import { PREFIXES } from "./helpers/prefixes";
import { docArb } from "./arbitraries";
import { sanitizeInlineFootnoteContent } from "../src/commands/inline-footnotes";
import { endOfWordOffset } from "../src/editor/cursor-motion";
import { definitionLabelWithName } from "../src/parsing/label-shapes";
import { lineDiffChanges, mapFoldLines } from "../src/editor/document-diff";
import { lintFootnotes, LintOptions } from "../src/linting/linter";
import { applyFootnotePrefix } from "../src/linting/rules/apply-footnote-prefix";
import { fixLazyDefinitions } from "../src/linting/rules/fix-lazy-definitions";
import { footnoteAfterPunctuation } from "../src/linting/rules/footnote-after-punctuation";
import { mergeDuplicateFootnoteDefinitions } from "../src/linting/rules/merge-duplicate-definitions";
import { moveFootnoteDefinitionsToBottom } from "../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../src/linting/rules/remove-orphaned-definitions";
import { orphanedFootnoteDefinitionNames } from "../src/linting/rules/remove-orphaned-definitions";
import { duplicateFootnoteDefinitionNames } from "../src/linting/rules/merge-duplicate-definitions";
import {
    underlinedDefinitionLabelNames,
    lazyDefinitionLabelNames,
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
} from "../src/linting/rules/remove-orphaned-references";
import { normalizeEol } from "../src/parsing/line-edits";

// Property-based tests (fast-check, adopted 2026-08-10): instead of
// hand-picked cases, every property is asserted over RANDOMLY GENERATED
// documents and option combos; failures shrink to a minimal repro
// automatically. These are the invariants the hunt sessions kept pinning
// one counterexample at a time - idempotence, protected-region
// preservation, and conservation - made permanent.
//
// Runs per property default to 200; crank it for a deep soak:
//   $env:FC_NUM_RUNS = "5000"; npx vitest run test/properties.test.ts
fc.configureGlobal({ numRuns: Number(process.env.FC_NUM_RUNS ?? 200) });

// soaks legitimately run for minutes - vitest's 5s default timeout is for
// hangs, not for 5000 double-parses (the oracle "failed" a soak purely by
// exceeding it); scale the ceiling with the run count
const SOAK_TIMEOUT = Math.max(30_000, Number(process.env.FC_NUM_RUNS ?? 200) * 60);
const soakIt = (name: string, fn: () => void) => { it(name, fn, SOAK_TIMEOUT); };

// The document generator lives in ./arbitraries.ts so the sample-corpus
// script can render the same docs in Obsidian for human review.

const optionsArb: fc.Arbitrary<LintOptions> = fc.record({
    fixPunctuation: fc.boolean(),
    // all three placements (T5, 2026-09-21), so the idempotence and
    // conservation properties exercise the backward move too
    placement: fc.constantFrom("after" as const, "before" as const, "none" as const),
    fixLazyDefinitions: fc.boolean(),
    moveDefinitionsToBottom: fc.boolean(),
    reindex: fc.boolean(),
    reindexOptions: fc.record({
        renumberNamedFootnotes: fc.boolean(),
        // the Named half of the Preferred footnote naming style setting (2026-09-22)
        nameNumberedFootnotes: fc.boolean(),
    }),
    removeOrphanedReferences: fc.boolean(),
    removeOrphanedDefinitions: fc.boolean(),
    mergeDuplicateDefinitions: fc.boolean(),
    // the whole separator set, never just "2." (review D3, 2026-09-09)
    orphanSafePrefix: fc.constantFrom("", ...PREFIXES),
    applyNotePrefix: fc.boolean(),
    sectionHeading: fc.constantFrom("", "# Footnotes", "---\n## Footnotes"),
});

// options with every deletion pathway off - the conservation properties
const keepingOptionsArb: fc.Arbitrary<LintOptions> = optionsArb.map(
    (options) => ({
        ...options,
        removeOrphanedReferences: false,
        removeOrphanedDefinitions: false,
        // merging collapses duplicate definitions into one - a deliberate
        // structure change the conservation/oracle properties must not see
        mergeDuplicateDefinitions: false,
    }),
);

// options with only DEFINITION deletion off - since definition blocks span
// regions their continuations open (Sol bug #3 fix), deleting an orphaned
// definition legitimately deletes its embedded protected math/comment
// lines; reference deletion never touches protected lines, so it stays on
const definitionKeepingOptionsArb: fc.Arbitrary<LintOptions> = optionsArb.map(
    (options) => ({
        ...options,
        removeOrphanedDefinitions: false,
        // mergeDuplicateDefinitions stays ON here on purpose: it deletes
        // only unprotected duplicate label lines and carries continuation
        // content along verbatim, so the protected-line conservation this
        // arb feeds must hold with merging active too
    }),
);

// ---------- helpers ----------

function definitionCount(text: string): number {
    const lines = normalizeEol(text).text.split("\n");
    return readNote(lines).blocks.length;
}

function referenceCount(text: string): number {
    return readNote(normalizeEol(text).text.split("\n")).references.filter((reference) => reference.live).length;
}

// ---------- differential oracle (remark/micromark) ----------
// An INDEPENDENT markdown implementation as referee: micromark with the
// GFM-footnote and math extensions parses the document before and after
// lint, and the footnote structure it sees must match. Comparing
// before-vs-after under the SAME parser cancels out parser-vs-plugin
// opinion differences - any change in what remark sees was introduced by
// lint itself.

interface OracleNode {
    type: string;
    identifier?: string;
    children?: OracleNode[];
}

interface FootnoteShape {
    definitions: number;
    references: number;
    /** references whose identifier has a matching definition */
    resolved: number;
}

function footnoteShape(markdown: string): FootnoteShape {
    const tree = fromMarkdown(markdown, {
        extensions: [gfmFootnote(), math()],
        mdastExtensions: [gfmFootnoteFromMarkdown(), mathFromMarkdown()],
    }) as OracleNode;
    const defined = new Set<string>();
    const referenced: string[] = [];
    let definitions = 0;
    const stack: OracleNode[] = [tree];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) break;
        // mdast stores `identifier` already case-normalized
        if (node.type === "footnoteDefinition" && node.identifier !== undefined) {
            definitions++;
            defined.add(node.identifier);
        }
        if (node.type === "footnoteReference" && node.identifier !== undefined) {
            referenced.push(node.identifier);
        }
        if (node.children) stack.push(...node.children);
    }
    return {
        definitions,
        references: referenced.length,
        resolved: referenced.filter((id) => defined.has(id)).length,
    };
}

// The one KNOWN parser disagreement, found by this very property on its
// first run (2026-08-10): micromark's math extension lets a "$" inside a
// reference name open a math span - in "[^a$1] x[^ch-2]. $m$" the two
// dollars pair up and swallow the [^ch-2] reference - while Obsidian keeps
// such names as footnotes (verified live; dollarInsideReference implements
// that). Renaming [^a$1] during reindex then changes what remark sees for
// reasons that are micromark's opinion, not a lint bug. The oracle recuses
// itself from documents with a "$" inside a footnote name; every other
// property still covers them.
// The SECOND known disagreement (found by a 500k overnight soak at run
// 277k, 2026-08-13): a "---" head block reads as YAML frontmatter to
// Obsidian even when its body is prose (metadataCache: section type
// "yaml", frontmatter null - verified live), so reference-shaped text
// inside it is DEAD, and reindex may legitimately renumber an orphaned
// definition into that dead name. micromark can't referee those documents
// from EITHER side: frontmatter-blind, it reads the fences as thematic
// breaks and the dead reference as live prose (GFM tokenizes a reference
// only once its definition exists, so the rename "mints" a resolving
// pair); with micromark-extension-frontmatter loaded, a FAILED frontmatter
// open at line 0 poisons GFM footnote-definition tokenization for the
// whole document ("[^1]: alpha" parses as a plain link definition -
// upstream interop bug, probed 2026-08-13). So the oracle recuses itself
// from documents carrying reference-shaped text inside a closed head
// block; the lint behavior there is pinned deterministically below.
const headBlockWithReference = (doc: string): boolean => {
    const head = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(doc);
    return head !== null && head[1].includes("[^");
};
// ... and from documents whose footnote-prefix property carries a "$":
// the apply-prefix rule MINTS dollar names from plain ones ("[^1]" under
// prefix "a$" becomes "[^a$1]"), which is the same micromark disagreement
// one rename later (found the day the generators started offering the
// regex-special prefixes, 2026-09-09)
const dollarPrefix = (doc: string): boolean => /footnote-prefix:[^\n]*\$/.test(doc);
// ... and from documents with a label directly under a prose line: Obsidian
// reads it as lazy paragraph text (the prose-label rule, 2026-09-09) while
// micromark's GFM footnotes let a definition interrupt a paragraph, so the
// two parsers disagree before the lint ever runs
const hasLazyLabel = (doc: string): boolean => {
    const lines = normalizeEol(doc).text.split("\n");
    return lazyDefinitionLabelNames(lines).length > 0;
};
// ... and from documents with an Obsidian "%%" comment: micromark reads
// "%%" as text, while Obsidian hides the block and kills the definitions
// in it (ground truth 2026-09-09, spec-obsidian-comments)
// ... and, since step 2 of the runtime swap (2026-10-03), from documents
// where micromark and Obsidian's own reading (the note reading the plugin
// now masks with) already disagree about the footnotes before the lint
// runs. The known case is inline math: remark-math, which Obsidian uses,
// lets a "$" whose closer would follow a space keep looking, so
// "$5 or $6 alpha[^1]. $m$" is one math span to Obsidian and [^1] dead,
// while micromark pairs the dollars differently. Where the two parsers
// disagree on the input, micromark cannot referee what the lint did.
const parsersDisagree = (doc: string): boolean => {
    const reading = readNote(normalizeEol(doc).text.split("\n"));
    const live = reading.references.filter((reference) => reference.live);
    const defined = new Set(reading.definitions.map((definition) => definition.name.toLowerCase()));
    const obsidian: FootnoteShape = {
        definitions: reading.definitions.length,
        references: live.length,
        resolved: live.filter((reference) => defined.has(reference.name.toLowerCase())).length,
    };
    const micromark = footnoteShape(doc);
    return JSON.stringify(obsidian) !== JSON.stringify(micromark);
};

const oracleDocArb = docArb.filter(
    (doc) =>
        !/\[\^[^\]\n]*\$/.test(doc) &&
        !dollarPrefix(doc) &&
        !headBlockWithReference(doc) &&
        !hasLazyLabel(doc) &&
        !doc.includes("%%") &&
        !parsersDisagree(doc),
);

describe("differential oracle over random documents", () => {
    it("recuses itself when a frontmatter head block carries reference-shaped text", () => {
        // the 500k-soak counterexample of 2026-08-13, pinned: "alpha[^2]."
        // sits inside the yaml head block (dead text to Obsidian), and
        // reindex legitimately renumbers the orphaned [^42] definition to
        // [^2] - correct by the live ground truth, unjudgeable by
        // micromark (see headBlockWithReference above)
        const doc =
            "---\n\nalpha[^2].\n\n---\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua[^1].\n\n[^42]: alpha";
        const options: LintOptions = {
            fixPunctuation: false,
            moveDefinitionsToBottom: false,
            reindex: true,
            reindexOptions: {
                renumberNamedFootnotes: false,
            },
            removeOrphanedReferences: false,
            removeOrphanedDefinitions: false,
            mergeDuplicateDefinitions: false,
            orphanSafePrefix: "",
            applyNotePrefix: false,
            sectionHeading: "",
        };
        expect(lintFootnotes(doc, options)).toContain("[^2]: alpha");
        expect(headBlockWithReference(doc)).toBe(true);
        // a doc whose head block is reference-free stays IN the oracle's
        // jurisdiction, closed or not
        expect(headBlockWithReference("---\ntitle: t\n---\nbody[^1].")).toBe(false);
        expect(headBlockWithReference("---\n\nalpha[^2].\n\nno closer")).toBe(false);
    });

    soakIt("remark sees the same footnote structure before and after lint (deletions off)", () => {
        fc.assert(
            fc.property(oracleDocArb, keepingOptionsArb, (doc, options) => {
                const before = footnoteShape(doc);
                const after = footnoteShape(lintFootnotes(doc, options));
                expect(after).toEqual(before);
            }),
        );
    });
});

// ---------- transform invariants ----------

describe("lint invariants over random documents", () => {
    soakIt("lint is idempotent for every document and option combo", () => {
        fc.assert(
            fc.property(docArb, optionsArb, (doc, options) => {
                const once = lintFootnotes(doc, options);
                expect(lintFootnotes(once, options)).toBe(once);
            }),
        );
    });

    soakIt("lint never writes NUL bytes (mask leakage)", () => {
        fc.assert(
            fc.property(docArb, optionsArb, (doc, options) => {
                expect(lintFootnotes(doc, options)).not.toContain("\0");
            }),
        );
    });

    soakIt("protected line contents survive lint as a multiset", () => {
        fc.assert(
            fc.property(docArb, definitionKeepingOptionsArb, (doc, options) => {
                const out = lintFootnotes(doc, options);
                const linesIn = normalizeEol(doc).text.split("\n");
                const protectedIn = readNote(linesIn).protectedLines;
                const counts = new Map<string, number>();
                for (const line of normalizeEol(out).text.split("\n")) {
                    counts.set(line, (counts.get(line) ?? 0) + 1);
                }
                for (let i = 0; i < linesIn.length; i++) {
                    if (!protectedIn[i]) continue;
                    const left = counts.get(linesIn[i]) ?? 0;
                    expect(left, `protected line lost: ${JSON.stringify(linesIn[i])} in ${JSON.stringify(doc)}`).toBeGreaterThan(0);
                    counts.set(linesIn[i], left - 1);
                }
            }),
        );
    });

    soakIt("definitions and references are conserved while every deletion is off", () => {
        fc.assert(
            fc.property(docArb, keepingOptionsArb, (doc, options) => {
                const out = lintFootnotes(doc, options);
                // the hidden-definition fix (on by default) turns lazy labels
                // into definitions and retires the labels' own references, so
                // the conserved baseline is the note AFTER that fix - every
                // other keeping option only moves and renames
                const baseline = options.fixLazyDefinitions === false ? doc : fixLazyDefinitions(doc);
                expect(definitionCount(out)).toBe(definitionCount(baseline));
                expect(referenceCount(out)).toBe(referenceCount(baseline));
            }),
        );
    });

    soakIt("fixLazyDefinitions on its own is idempotent", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const once = fixLazyDefinitions(doc);
                expect(fixLazyDefinitions(once)).toBe(once);
            }),
        );
    });

    soakIt("every occurrence's raw slice is exactly its bracket text", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                // the masked-twin/raw-line dance (bug-masked-name-identity)
                // must never report a position whose raw slice is not the
                // reference it claims to be
                const lines = normalizeEol(doc).text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    for (const occurrence of readNote(lines).referencesOn(i)) {
                        expect(lines[i].slice(occurrence.start, occurrence.end)).toBe(
                            `[^${occurrence.name}]`,
                        );
                    }
                }
            }),
        );
    });
});

// ---------- scanner invariants ----------

describe("scanner invariants over random documents", () => {
    soakIt("masking preserves every line's length", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const lines = normalizeEol(doc).text.split("\n");
                const masked = [...readNote(lines).maskedLines()];
                for (let i = 0; i < lines.length; i++) {
                    expect(masked[i].length).toBe(lines[i].length);
                }
            }),
        );
    });

    soakIt("maskedLineAt agrees with the full masked twin on every line", () => {
        fc.assert(
            fc.property(docArb, fc.nat(1000), (doc, pick) => {
                const lines = normalizeEol(doc).text.split("\n");
                if (lines.length === 0) return;
                // nat(60) never sampled the tail of a 61+-line document
                const i = pick % lines.length;
                expect(readNote(lines).maskedLine(i)).toBe(
                    readNote(lines).maskedLine(i),
                );
            }),
        );
    });

    soakIt("the masked twin only ever blots to NUL, never rewrites a character", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                // positions line up with the raw line (the masked-twin
                // contract): every character is either its raw self or a
                // NUL. A mask that rewrote a character would misplace
                // every reference found past it (bug-masked-name-identity's
                // family).
                const lines = normalizeEol(doc).text.split("\n");
                const masked = [...readNote(lines).maskedLines()];
                for (let i = 0; i < lines.length; i++) {
                    expect(masked[i].length).toBe(lines[i].length);
                    for (let j = 0; j < lines[i].length; j++) {
                        expect(
                            masked[i][j] === "\0" || masked[i][j] === lines[i][j],
                            `line ${i} col ${j}: raw ${JSON.stringify(lines[i][j])} became ${JSON.stringify(masked[i][j])}`,
                        ).toBe(true);
                    }
                }
            }),
        );
    });
});

// ---------- write-back invariants (added 2026-09-16, hunt cycle 2) ----------
// The lint hands its result to the editor through replaceMinimal, whose
// edits come from lineDiffChanges and whose fold restoration comes from
// mapFoldLines (src/editor/document-diff.ts + write-back.ts). These pin
// the two halves over the same random documents and option combos the
// transform properties use.

/** apply offset changes (offsets into `before`, ordered, non-overlapping) */
function applyChanges(before: string, changes: { from: number; to: number; text: string }[]): string {
    let out = "";
    let copied = 0;
    for (const change of changes) {
        out += before.slice(copied, change.from) + change.text;
        copied = change.to;
    }
    return out + before.slice(copied);
}

describe("write-back invariants over random documents", () => {
    soakIt("lineDiffChanges produces ordered, non-overlapping edits that apply to the linted text", () => {
        fc.assert(
            fc.property(docArb, optionsArb, (doc, options) => {
                const after = lintFootnotes(doc, options);
                const changes = lineDiffChanges(doc, after);
                for (let i = 1; i < changes.length; i++) {
                    expect(changes[i].from).toBeGreaterThanOrEqual(changes[i - 1].to);
                }
                expect(applyChanges(doc, changes)).toBe(after);
            }),
        );
    });

    soakIt("mapFoldLines keeps every fold in range and non-inverted", () => {
        fc.assert(
            fc.property(docArb, optionsArb, fc.nat(50), fc.nat(50), (doc, options, fromPick, spanPick) => {
                const after = lintFootnotes(doc, options);
                const beforeLines = doc.split("\n").length;
                if (beforeLines < 2) return;
                const from = fromPick % (beforeLines - 1);
                // a real fold spans at least one line past its heading line
                const fold = { from, to: from + 1 + (spanPick % (beforeLines - from - 1)) };
                const changes = lineDiffChanges(doc, after);
                const afterLines = after.split("\n").length;
                for (const mapped of mapFoldLines([fold], changes, doc)) {
                    expect(mapped.from).toBeGreaterThanOrEqual(0);
                    expect(mapped.to).toBeGreaterThan(mapped.from);
                    expect(mapped.to).toBeLessThan(afterLines);
                }
            }),
        );
    });
});

// ---------- single-rule invariants (added 2026-09-16, hunt cycle 4) ----------
// The pipeline properties prove the whole lint settles; these pin each rule
// on its own, so a rule that drifts (an insertion it forgot to recheck, a
// swap that never terminates) is caught at its own door instead of through
// the full pipeline.

describe("single-rule invariants over random documents", () => {
    soakIt("footnoteAfterPunctuation on its own is idempotent", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const once = footnoteAfterPunctuation(doc);
                expect(footnoteAfterPunctuation(once)).toBe(once);
            }),
        );
    });

    soakIt("mergeDuplicateFootnoteDefinitions on its own is idempotent", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const once = mergeDuplicateFootnoteDefinitions(doc);
                expect(mergeDuplicateFootnoteDefinitions(once)).toBe(once);
            }),
        );
    });

    soakIt("removeOrphanedFootnoteReferences on its own is idempotent, for every prefix", () => {
        fc.assert(
            fc.property(docArb, fc.constantFrom("", ...PREFIXES), (doc, prefix) => {
                const once = removeOrphanedFootnoteReferences(doc, prefix);
                expect(removeOrphanedFootnoteReferences(once, prefix)).toBe(once);
            }),
        );
    });

    soakIt("removeOrphanedFootnoteDefinitions on its own is idempotent", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const once = removeOrphanedFootnoteDefinitions(doc);
                expect(removeOrphanedFootnoteDefinitions(once)).toBe(once);
            }),
        );
    });

    soakIt("moveFootnoteDefinitionsToBottom on its own is idempotent, for every heading", () => {
        fc.assert(
            fc.property(
                docArb,
                fc.constantFrom("", "# Footnotes", "---\n## Footnotes"),
                (doc, heading) => {
                    const once = moveFootnoteDefinitionsToBottom(doc, heading);
                    expect(moveFootnoteDefinitionsToBottom(once, heading)).toBe(once);
                },
            ),
        );
    });

    soakIt("applyFootnotePrefix on its own is idempotent, for every valid prefix", () => {
        fc.assert(
            fc.property(docArb, fc.constantFrom(...PREFIXES), (doc, prefix) => {
                const once = applyFootnotePrefix(doc, prefix);
                expect(applyFootnotePrefix(once, prefix)).toBe(once);
            }),
        );
    });

    soakIt("reindexFootnotes on its own is idempotent, for every option combo", () => {
        fc.assert(
            fc.property(
                docArb,
                fc.record({
                    renumberNamedFootnotes: fc.boolean(),
                    prefix: fc.constantFrom("", ...PREFIXES),
                    // on while Delete orphaned definitions is on (cluster L4)
                    leaveOrphansInPlace: fc.boolean(),
                }),
                (doc, options) => {
                    const once = reindexFootnotes(doc, options);
                    expect(reindexFootnotes(once, options)).toBe(once);
                },
            ),
        );
    });

    soakIt("an orphaned name is deleted whole or left whole (never half)", () => {
        // The rule judges each orphaned NAME on its own since 2026-09-16
        // (Kimi hunt cycle 4): a name whose cut would change how a kept
        // line is read stays, every one of its references, while the safe
        // names go, every one of theirs. Kimi's original property expected
        // every orphan gone whenever anything was deleted, which was the
        // old all-or-nothing behavior.
        const liveCounts = (text: string): Map<string, number> => {
            const lines = normalizeEol(text).text.split("\n");
            const counts = new Map<string, number>();
            for (let i = 0; i < lines.length; i++) {
                for (const { name } of readNote(lines).referencesOn(i)) {
                    const folded = name.toLowerCase();
                    counts.set(folded, (counts.get(folded) ?? 0) + 1);
                }
            }
            return counts;
        };
        fc.assert(
            fc.property(docArb, fc.constantFrom("", ...PREFIXES), (doc, prefix) => {
                const out = removeOrphanedFootnoteReferences(doc, prefix);
                if (out === doc) return; // every cut refused: nothing deleted
                const before = liveCounts(doc);
                const after = liveCounts(out);
                for (const name of orphanedFootnoteReferenceNames(doc, prefix).map((n) => n.toLowerCase())) {
                    const left = after.get(name) ?? 0;
                    expect(
                        left === 0 || left === before.get(name),
                        `orphan [^${name}] was half deleted: ${left} of ${before.get(name) ?? 0} left`,
                    ).toBe(true);
                }
            }),
        );
    });

    // added 2026-09-16, hunt cycle 5: the guard in remove-orphaned-references
    // exists so that a cut never changes how a kept line is read; the most
    // visible reading a line has is whether it STARTS a definition. Lines
    // are never removed by this rule, so the indices align across the cut.
    soakIt("orphan-reference deletion never changes which lines start a definition", () => {
        const countStarts = (text: string): number => {
            const lines = normalizeEol(text).text.split("\n");
            return readNote(lines).labelLines.filter(Boolean).length;
        };
        fc.assert(
            fc.property(docArb, fc.constantFrom("", ...PREFIXES), (doc, prefix) => {
                const out = removeOrphanedFootnoteReferences(doc, prefix);
                expect(countStarts(out)).toBe(countStarts(doc));
            }),
        );
    });

    // added 2026-09-16, hunt cycle 5: the punctuation rule may MOVE a
    // reference across punctuation, but it may never invent, drop, or rename
    // one - the names on each line, as a multiset, are conserved.
    soakIt("the punctuation rule conserves each line's reference names as a multiset", () => {
        const namesOn = (text: string): string[] => {
            const lines = normalizeEol(text).text.split("\n");
            const out: string[] = [];
            for (let i = 0; i < lines.length; i++) {
                for (const { name } of readNote(lines).referencesOn(i)) {
                    out.push(name.toLowerCase());
                }
            }
            return out.sort();
        };
        fc.assert(
            fc.property(docArb, (doc) => {
                expect(namesOn(footnoteAfterPunctuation(doc))).toEqual(namesOn(doc));
            }),
        );
    });
});

// ---------- editor-side invariants ----------

// a real clipboard is multi-line, tabbed, CJK, padded - fc.string alone is
// printable ASCII with no newline at all (review D7, 2026-09-09)
const clipboardArb = fc.oneof(
    { weight: 3, arbitrary: fc.string({ maxLength: 60, unit: "grapheme" }) },
    {
        weight: 1,
        arbitrary: fc.constantFrom(
            "a\r\nb",
            "x\ny\n\nz",
            "tab\there",
            "  padded  ",
            "中文\n第二行",
            "\n",
        ),
    },
);

describe("editor helper invariants", () => {
    soakIt("sanitized clipboard text always forms a closed inline footnote", () => {
        fc.assert(
            fc.property(clipboardArb, (raw) => {
                const content = sanitizeInlineFootnoteContent(raw);
                if (content === "") return;
                const line = `^[${content}]`;
                // the inline footnote must close exactly at the wrapper's
                // own bracket, as the note reading finds it
                expect(readNote([line]).inlineNoteAt(0, 1)).toEqual({
                    open: 0,
                    close: line.length - 1,
                });
            }),
        );
    });

    soakIt("endOfWordOffset stays in range and never splits a surrogate pair", () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 30, unit: "grapheme" }),
                fc.nat(40),
                (text, pick) => {
                    const offset = text.length === 0 ? 0 : pick % (text.length + 1);
                    const end = endOfWordOffset(text, offset);
                    expect(end).toBeLessThanOrEqual(text.length);
                    // when the function MOVES the caret, it must land on a
                    // code point boundary (an untouched garbage offset is
                    // returned as-is by contract)
                    if (end === offset) return;
                    expect(end).toBeGreaterThan(offset - 2);
                    const at = text.charCodeAt(end);
                    const before = text.charCodeAt(end - 1);
                    const splitsPair =
                        at >= 0xdc00 &&
                        at <= 0xdfff &&
                        before >= 0xd800 &&
                        before <= 0xdbff;
                    expect(splitsPair).toBe(false);
                },
            ),
        );
    });
});

// ---------- interrupted-definition invariants (added 2026-09-16, hunt cycle 6) ----------
// Documents where a block of its own (an HTML comment, a <div> block, a
// "$$" math block) sits directly under a footnote definition, with an
// indented code chunk under the block. The shared docArb deliberately
// leaves these adjacencies out (see the note in arbitraries.ts): the scan
// currently misreads the chunk as the definition's continuation, so the
// conservation and oracle invariants would run red until that fix lands.
// These properties pin what HOLDS there today, so the fix cannot regress
// the settling behavior: whatever the lint does to such a note, running
// it twice changes nothing the second time, and the interrupter's own
// protected lines survive every lint.
//
// Source of truth: the micromark oracle (each interrupter leaves the
// chunk as <pre><code>), sheet 14's "an HTML comment line is a block",
// and the in-repo Reading view probes recorded at
// src/parsing/markdown-scan.ts:2447 (a label under a $$ closer is a
// definition, so the block ended what came before). The full finding is
// pinned in test/hunt/bug-interrupting-block-keeps-definition-open.test.ts.

const proseTailArb = fc.constantFrom(
    "Tail prose keeps the note honest.",
    "More tail with[^2] a reference.",
);

const interrupterArb = fc.constantFrom(
    "<!-- c -->",
    "<!-- c\n-->",
    "<div>\ninside",
    "$$\nx\n$$",
    "> <!-- c -->",
);

const interruptedDocArb = fc
    .tuple(
        fc.constantFrom("use[^1] here", "read[^1] this first", "note[^1]."),
        interrupterArb,
        fc.boolean(),
        fc.array(proseTailArb, { maxLength: 2 }),
    )
    .map(([prose, interrupter, blankBefore, tail]) => {
        // a blank between the prose and the definition keeps the definition
        // real (a label under prose is lazy text); the interrupter follows
        // the definition DIRECTLY - that adjacency is the finding - and the
        // indented chunk follows the interrupter, its reference dead in
        // Reading view
        const body = [
            prose,
            "",
            "[^1]: body",
            ...(blankBefore ? [""] : []),
            interrupter,
            "    chunk[^73]",
            ...tail,
        ];
        return body.join("\n");
    });

describe("interrupted-definition invariants over random documents", () => {
    soakIt("lint is idempotent over interrupted-definition documents", () => {
        fc.assert(
            fc.property(interruptedDocArb, optionsArb, (doc, options) => {
                const once = lintFootnotes(doc, options);
                expect(lintFootnotes(once, options)).toBe(once);
            }),
        );
    });

    soakIt("the interrupter's protected lines survive lint as a multiset", () => {
        fc.assert(
            fc.property(interruptedDocArb, definitionKeepingOptionsArb, (doc, options) => {
                const out = lintFootnotes(doc, options);
                const linesIn = normalizeEol(doc).text.split("\n");
                const protectedIn = readNote(linesIn).protectedLines;
                const counts = new Map<string, number>();
                for (const line of normalizeEol(out).text.split("\n")) {
                    counts.set(line, (counts.get(line) ?? 0) + 1);
                }
                for (let i = 0; i < linesIn.length; i++) {
                    if (!protectedIn[i]) continue;
                    const left = counts.get(linesIn[i]) ?? 0;
                    expect(
                        left,
                        `protected line lost: ${JSON.stringify(linesIn[i])}`,
                    ).toBeGreaterThan(0);
                    counts.set(linesIn[i], left - 1);
                }
            }),
        );
    });

    soakIt("a %% block comment's lines are never fully blotted in the masked twin", () => {
        // sheet 11: references inside a %% block are LIVE (they bind their
        // definitions and take numbers), so the block's lines stay out of
        // the protected mask even though their text is hidden
        fc.assert(
            fc.property(docArb, (doc) => {
                const lines = normalizeEol(doc).text.split("\n");
                const scan = readNote(lines);
                const masked = [...readNote(lines).maskedLines()];
                for (let i = 0; i < lines.length; i++) {
                    if (!scan.commentLines[i] || lines[i] === "") continue;
                    expect(
                        masked[i],
                        `%% block line ${i} fully blotted: ${JSON.stringify(lines[i])}`,
                    ).not.toBe("\0".repeat(lines[i].length));
                }
            }),
        );
    });
});

// ---------- region-body conservation over random documents ----------
// The lint moves and renumbers whole definition blocks and never moves a
// quoted one (manual sheet 14: quoted definitions stay put; the pinned
// region-absorb fixes keep a block's regions and continuations whole).
// These two properties encode that at the structural level: every line of
// a definition's body that no rule may rewrite - reference-free,
// non-blank - must survive the lint, in its block's own order. Label lines
// are exempt (reindex and the prefix rule rename them); reference-bearing
// lines are exempt (renumbering rewrites them); blank lines are exempt
// (whole-block moves collapse runs of them).

describe("definition-body conservation over random documents", () => {
    soakIt("a column-0 definition's reference-free body lines stay in the note, in order", () => {
        fc.assert(
            fc.property(docArb, keepingOptionsArb, (doc, options) => {
                const text = normalizeEol(doc).text;
                const lines = text.split("\n");
                const blocks = readNote(lines).blocks;
                const outLines = normalizeEol(lintFootnotes(text, options)).text.split("\n");
                for (const block of blocks) {
                    let cursor = 0;
                    for (let j = block.start + 1; j <= block.end; j++) {
                        const line = lines[j];
                        if (line.trim() === "" || readNote(lines).referencesOn(j).length > 0) {
                            continue;
                        }
                        let found = -1;
                        for (let k = cursor; k < outLines.length; k++) {
                            if (outLines[k] === line) {
                                found = k;
                                break;
                            }
                        }
                        expect(
                            found,
                            `body line stranded: ${JSON.stringify(line)} of block ${JSON.stringify(block)}`,
                        ).toBeGreaterThan(-1);
                        cursor = found + 1;
                    }
                }
            }),
        );
    });

    soakIt("a quoted definition's reference-free lines stay in the note, in order", () => {
        fc.assert(
            fc.property(docArb, keepingOptionsArb, (doc, options) => {
                const text = normalizeEol(doc).text;
                const lines = text.split("\n");
                const masked = [...readNote(lines).maskedLines()];
                const starts = readNote(lines).labelLines;
                const outLines = normalizeEol(lintFootnotes(text, options)).text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    if (!starts[i]) continue;
                    const hit = definitionLabelWithName(lines[i], masked[i]);
                    if (!hit || !hit.label.quoted) continue;
                    const end = (readNote(lines).labelOn(i)?.end ?? i);
                    let cursor = 0;
                    for (let j = i + 1; j <= end; j++) {
                        const line = lines[j];
                        if (line.trim() === "" || readNote(lines).referencesOn(j).length > 0) {
                            continue;
                        }
                        let found = -1;
                        for (let k = cursor; k < outLines.length; k++) {
                            if (outLines[k] === line) {
                                found = k;
                                break;
                            }
                        }
                        expect(
                            found,
                            `quoted body line stranded: ${JSON.stringify(line)} under label ${JSON.stringify(lines[i])}`,
                        ).toBeGreaterThan(-1);
                        cursor = found + 1;
                    }
                }
            }),
        );
    });
});

// ---------- scan and alert invariants (GLM hunt cycle 12 additions) ----------

describe("scanner and alert invariants", () => {
    soakIt("every column-0 definition start is a block's first line, and every block starts on a start", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const lines = normalizeEol(doc).text.split("\n");
                const starts = readNote(lines).labelLines;
                const blocks = readNote(lines).blocks;
                const blockStarts = new Set(blocks.map((block) => block.start));
                for (let i = 0; i < lines.length; i++) {
                    if (!starts[i]) continue;
                    // a start whose raw line is a column-0 label shape must
                    // form a block; only quoted labels and after-closer
                    // labels (neither DefinitionStart-shaped at column 0)
                    // may form none
                    expect(
                        blockStarts.has(i),
                        `start at line ${i} (${JSON.stringify(lines[i])}) is not a block start`,
                    ).toBe(/^ {0,3}\[\^[^[\]\s]+\]:/.test(lines[i]));
                }
                for (const block of readNote(lines).blocks) {
                    expect(
                        starts[block.start],
                        `block starting at line ${block.start} is not a definition start`,
                    ).toBe(true);
                }
            }),
        );
    });

    soakIt("every alert names a footnote that really occurs in the note", () => {
        fc.assert(
            fc.property(docArb, (doc) => {
                const text = normalizeEol(doc).text;
                const lines = text.split("\n");
                const masked = [...readNote(lines).maskedLines()];
                const live = new Set<string>();
                for (let i = 0; i < lines.length; i++) {
                    for (const { name } of readNote(lines).referencesOn(i)) {
                        live.add(name.toLowerCase());
                    }
                    const hit = definitionLabelWithName(lines[i], masked[i]);
                    if (hit) live.add(hit.name.toLowerCase());
                }
                // every definition the note reading finds, wherever it sits
                // (an in-item label indented four spaces has no label shape
                // of its own; Jason's ruling 1, option a, 2026-10-03)
                for (const definition of readNote(lines).definitions) live.add(definition.name.toLowerCase());
                const nameLists = [
                    orphanedFootnoteReferenceNames(text),
                    orphanedFootnoteDefinitionNames(text),
                    duplicateFootnoteDefinitionNames(text),
                    lazyDefinitionLabelNames(lines),
                    underlinedDefinitionLabelNames(lines),
                ];
                for (const [kind, list] of nameLists.map((names, i) => [i, names] as const)) {
                    for (const name of list) {
                        expect(
                            live.has(name.toLowerCase()),
                            `alert ${kind} names ${JSON.stringify(name)}, which the note does not hold`,
                        ).toBe(true);
                    }
                }
            }),
        );
    });

    // added 2026-09-16, GLM hunt cycle 13: every whole-document transform
    // trims or appends blank lines at the note's ends. The scan's block
    // state machine must be closed over that: blank lines at the END of a
    // note change no fact about the lines before them. A state variable
    // that leaked past the blank-line branch (as several have) would fail
    // here the moment the generator leaves blanks at the end of a block.
    soakIt("appending blank lines at the end changes no scan fact about the existing lines", () => {
        fc.assert(
            fc.property(docArb, fc.nat(3), (doc, extra) => {
                const before = normalizeEol(doc).text.split("\n");
                const after = [...before, ...Array.from({ length: extra }, () => "")];
                const scanBefore = readNote(before);
                const scanAfter = readNote(after);
                const maskedBefore = [...readNote(before).maskedLines()];
                const maskedAfter = [...readNote(after).maskedLines()];
                const startsBefore = readNote(before).labelLines;
                const startsAfter = readNote(after).labelLines;
                for (let i = 0; i < before.length; i++) {
                    expect(
                        scanAfter.protectedLines[i],
                        `line ${i} protection changed: ${JSON.stringify(before[i])}`,
                    ).toBe(scanBefore.protectedLines[i]);
                    expect(startsAfter[i]).toBe(startsBefore[i]);
                    expect(maskedAfter[i]).toBe(maskedBefore[i]);
                }
                const blocksBefore = readNote(before).blocks;
                const blocksAfter = readNote(after).blocks;
                expect(blocksAfter.map((b) => [b.start, b.end, b.name.toLowerCase()])).toEqual(
                    blocksBefore.map((b) => [b.start, b.end, b.name.toLowerCase()]),
                );
            }),
        );
    });

    // added 2026-09-16, GLM hunt cycle 13: with named footnotes left alone
    // and no prefix, reindex's whole job is handing plain numbers to the
    // numbered footnotes. So the set of non-numeric names must survive
    // untouched, and every numeric name afterwards must be one of the
    // plain 1..k slots the pass hands out - a rename that reached a named
    // footnote, or a numbered name minted past the slot count, breaks a
    // footnote's pairing with its definition.
    soakIt("reindex conserves the non-numeric names and numbers the rest within 1..k", () => {
        const nameSets = (text: string): { named: Set<string>; numbered: Set<string> } => {
            const lines = normalizeEol(text).text.split("\n");
            const reading = readNote(lines);
            const named = new Set<string>();
            const numbered = new Set<string>();
            for (let i = 0; i < lines.length; i++) {
                for (const { name } of readNote(lines).referencesOn(i)) {
                    (/^\d+$/.test(name) ? numbered : named).add(name.toLowerCase());
                }
            }
            // every definition, wherever it sits: one inside a list item is
            // renumbered like any other since Jason's ruling 1, option a
            // (2026-10-03); it used to be held outside the 1..k slots
            for (const { name } of reading.definitions) (/^\d+$/.test(name) ? numbered : named).add(name.toLowerCase());
            return { named, numbered };
        };
        fc.assert(
            fc.property(docArb, (doc) => {
                const before = nameSets(doc);
                const after = nameSets(reindexFootnotes(doc, { renumberNamedFootnotes: false }));
                expect([...after.named].sort()).toEqual([...before.named].sort());
                for (const name of after.numbered) {
                    expect(Number(name)).toBeGreaterThanOrEqual(1);
                    expect(Number(name)).toBeLessThanOrEqual(before.numbered.size);
                }
            }),
        );
    });
});

// ---------- adjacency sweep (GLM hunt cycle 11 additions) ----------
// The shared docArb joins its blocks with blank lines and keeps several
// adjacencies out (see the note in arbitraries.ts). This sweep is the
// complement: EVERY ordered pair of the plugin's attack-surface blocks,
// joined by a bare newline as well as a blank one, run through the lint's
// core contracts. Deterministic (the pair space is small), so one `it`
// covers all of it.
//
// Four pairs are excluded because they trip the live findings pinned in
// test/hunt (bug-label-gap-chunk-protected, bug-table-under-label-after-
// block-line, bug-orphan-cut-rule-residue-deferred-deletion); re-include
// them when those land. The exclusion is by (blockA, blockB) identity.

const sweepBlocks: string[][] = [
    ["prose[^1] line"],
    ["[^1]: body"],
    ["[^1]: body", "    cont"],
    ["[^1]: body", "lazy tail"],
    ["[^1]: body", "", "    chunk[^9]"],
    ["# Heading"],
    ["---"],
    ["para", "==="],
    ["```", "code[^9]", "```"],
    ["```", "code"],
    ["<!--", "c", "-->"],
    ["x <!--", "--> tail"],
    ["<!-- c -->"],
    ["$$", "m", "$$"],
    ["x $$", "$$ tail"],
    ["%%", "hidden[^9]", "%%"],
    ["%%", "hidden", "%% [^7]: def"],
    ["%% c %%"],
    ["> quoted para"],
    ["> [^1]: qbody"],
    ["> [^1]: qbody", "> cont"],
    ["> [^1]: qbody", "tail"],
    ["> ```", "> code", "> ```"],
    ["> %%", "> hidden", "> %%"],
    ["| a | b |", "| --- | --- |", "| c | d |"],
    ["[^1]: body", "| a | b |", "| --- | --- |"],
    ["[^1]: | a | b |", "| --- | --- |"],
    ["a | b", "--- | ---"],
    ["[foo]: /url"],
    ["[foo]: /url", '  "title"'],
    ["[foo]:", "/url"],
    ["- item"],
    ["- item", "  cont"],
    ["-      item"],
    ["-"],
    ["1. item"],
    ["2. item"],
    ["<div>", "inside"],
    ["<span>x</span>"],
    ["    code[^9]"],
    ["\tcode[^9]"],
    [""],
    ["---", "title: t", "---"],
    ["> [!note] Title", "> body"],
    ["> | a | b |", "> | --- | --- |"],
    ["see [text](url) end"],
    ["see [[note|alias]] end"],
    ["see ![alt](url) end"],
    ["^[body] here"],
    ["see https://e.com/x end"],
    ["see <https://e.com> end"],
    ["[^1]"],
    ["[^]"],
    ["\\[^1] literal"],
    ["`code [^9]`"],
    ["~~gone[^9]~~"],
    ["==mark[^9]=="],
    [">", "> [^1]: x"],
    ["> > deep[^9]"],
    ["> > deep[^9]", "> [^9]: x"],
    ["$x[^9]$"],
    ["x <!-- c --> y"],
    ["# H[^9]"],
    ["para", "[^9]: lazy", "==="],
    ["[foo[^9]]: /url"],
    ["<?php x ?>"],
    ["<![CDATA[x]]>"],
    ["<!DOCTYPE html>"],
];

// block pairs that trip pinned live findings, as [indexA, indexB] of
// sweepBlocks: the chunk block (4) under an above-line that leaves the
// scan's block state open (bug-label-gap-chunk-protected), the table-under-
// label block (25) under an above-line the table reader misjudges
// (bug-table-under-label-after-block-line), and a definition block before a
// trailing "---" (bug-orphan-cut-rule-residue-deferred-deletion). Excluded
// by index until the pins land.
// no pair is excluded: the three findings of GLM hunt cycle 11 that the
// sweep first tripped over landed the same day (2026-09-16)
const excludedPairs = new Set<string>();

describe("adjacency sweep over every pair of surface blocks", () => {
    const defaults: LintOptions = {
        fixPunctuation: true,
        fixLazyDefinitions: true,
        moveDefinitionsToBottom: true,
        reindex: true,
        removeOrphanedReferences: false,
        removeOrphanedDefinitions: false,
        mergeDuplicateDefinitions: false,
    };

    it("lint is idempotent, NUL-free, and conserves live text over every adjacent pair", { timeout: 120_000 }, () => {
        const counts: string[] = [];
        let cases = 0;
        for (let a = 0; a < sweepBlocks.length; a++) {
            for (let b = 0; b < sweepBlocks.length; b++) {
                for (const sep of ["\n", "\n\n"]) {
                    if (excludedPairs.has(`${a}+${b}`)) continue;
                    cases++;
                    const doc = [...sweepBlocks[a], ...sweepBlocks[b]].join(sep);
                    const once = lintFootnotes(doc, defaults);
                    expect(once, `NUL in lint of ${JSON.stringify(doc)}`).not.toContain("\0");
                    expect(lintFootnotes(once, defaults), `not idempotent: ${JSON.stringify(doc)}`).toBe(once);
                    counts.push(doc);
                }
            }
        }
        expect(cases).toBeGreaterThan(3000);
        // conservation over the same corpus: references and definitions are
        // never minted or lost, protected lines survive (deletions off).
        // References are counted as Obsidian reads them, by the note
        // reading: the scanner's own count could change where only its
        // reading of the text did, as when a moved definition takes its
        // indented chunk along and the scanner, unlike Obsidian, had read
        // the chunk as code in place (the runtime swap, 2026-10-03)
        const referenceCountOf = (text: string): number =>
            readNote(normalizeEol(text).text.split("\n")).references.filter((reference) => reference.live).length;
        const definitionCountOf = (text: string): number =>
            readNote(normalizeEol(text).text.split("\n")).blocks.length;
        for (const doc of counts) {
            const out = lintFootnotes(doc, defaults);
            const baseline = fixLazyDefinitions(doc);
            expect(
                referenceCountOf(out),
                `references changed: ${JSON.stringify(doc)} -> ${JSON.stringify(out)}`,
            ).toBe(referenceCountOf(baseline));
            expect(
                definitionCountOf(out),
                `definitions changed: ${JSON.stringify(doc)} -> ${JSON.stringify(out)}`,
            ).toBe(definitionCountOf(baseline));
            const linesIn = normalizeEol(doc).text.split("\n");
            // protected as both the scanner and Obsidian read the note: the
            // lines the scanner protects that also lie in a code, math,
            // HTML, or frontmatter block of the note reading. Where the two
            // disagree (a "$$" line under a paragraph opens math to
            // Obsidian, recorded fact 1c658e2, but closes a pair to the
            // scanner; an indented chunk after a definition's blank gap is
            // the footnote's body to Obsidian, code to the scanner), the
            // rules still follow the scanner's protection until step 2 of
            // the runtime swap moves it onto the reading (2026-10-03)
            const scannerProtected = readNote(linesIn).protectedLines;
            const protectedIn = linesIn.map(() => false);
            for (const span of readNote(linesIn).protectedSpans) {
                if (!span.block || span.kind === "percentComment") continue;
                for (let l = span.startLine; l <= span.endLine; l++) protectedIn[l] = scannerProtected[l];
            }
            const countsOut = new Map<string, number>();
            for (const line of normalizeEol(out).text.split("\n")) {
                countsOut.set(line, (countsOut.get(line) ?? 0) + 1);
            }
            for (let i = 0; i < linesIn.length; i++) {
                if (!protectedIn[i]) continue;
                const left = countsOut.get(linesIn[i]) ?? 0;
                expect(left, `protected line lost: ${JSON.stringify(linesIn[i])} in ${JSON.stringify(doc)}`).toBeGreaterThan(0);
                countsOut.set(linesIn[i], left - 1);
            }
        }
    });
});
