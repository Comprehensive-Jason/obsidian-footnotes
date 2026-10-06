import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { labelShapedLines, underlinedDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss): Delete footnote everywhere on a lazy label with a "---"
// under it cuts the "---" too, though Obsidian reads that "---" as a
// horizontal rule of its own.
//
// What the user would see: "para[^1] text", then "[^1]: def", then "---",
// with no blank line between them. Reading view draws one paragraph and a
// horizontal rule under it. The user runs Delete footnote everywhere on
// [^1]. The reference and the "[^1]: def" line go, as asked, but the
// horizontal rule goes with them. The same happens inside a quote and at a
// list item's content column.
//
// A "lazy label" is a "[^1]:" line directly under a line of prose, one
// blank line short of being a definition, so Obsidian reads it as more of
// the paragraph. The plugin files such a label "underlined" when the line
// under it would underline it as a heading once that blank line went in.
// Delete footnote everywhere cuts an underlined label together with its
// underline, because there the underline is only paragraph text.
//
// Hunt 2026-10-06, cycle 5, lens reader. Cluster X35.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-06): "para[^1] text",
// "[^1]: def", "---", "", "after" has no definition, and line 2 is a
// thematic break (a horizontal rule). docs/obsidian-reading-rules.md D3:
// under a continuation line, "---" is a thematic break. The pins
// bug-underline-regex-too-wide and bug-underline-sibling-list-item hold
// that cutting a horizontal rule or a list item of its own with the label
// is data loss, and that a refusal would do instead. The README promises
// that Delete footnote everywhere never changes text it was not asked to
// touch.
//
// Not part of this bug: the lint alert calls such a label a heading. That
// wording was approved on 2026-09-20.
//
// Cause: underlinedAt in src/parsing/label-shapes.ts asks whether the line
// under the label would underline it once a blank line went in above the
// label, which is the right question for fix-lazy. deleteFootnoteEverywhere
// in src/commands/delete-footnote.ts reuses that answer to decide whether
// the line under the label goes with it, but never asks whether that line
// is a block of its own in the note as it is now.

const Cases = [
    { what: "one prose line above", lines: ["para[^1] text", "[^1]: def", "---", "", "after"] },
    { what: "two prose lines above", lines: ["para[^1] text", "more", "[^1]: def", "---", "", "after"] },
    { what: "in a quote", lines: ["> para[^1] text", "> [^1]: def", "> ---", "", "after"] },
    { what: "at a list item's content column", lines: ["- item[^1] text", "  [^1]: def", "  ---", "", "after"] },
];

describe("a lazy label over a '---' that is a horizontal rule of its own", () => {
    for (const { what, lines } of Cases) {
        const label = lines.findIndex((line) => line.includes("[^1]:"));

        // The note reading (the plugin's model of how Obsidian reads the
        // note) agrees with Obsidian: the "---" starts a thematic break of
        // its own, and the label line is no definition. The plugin still
        // files the label as underlined, which is what sends the "---" to
        // the cut.
        it(`control (${what}): the reading says the '---' is a thematic break of its own and the label is no definition`, () => {
            const reading = readNote(lines);
            expect(reading.lineBlocks[label + 1]).toMatch(/\^thematicBreak$/);
            expect(reading.labelLines[label]).toBe(false);
            expect(underlinedDefinitionLabelLines(lines)).toEqual([label]);
        });

        // Now the "---" is gone from the result. Keeping it, or refusing
        // the deletion, would both be acceptable.
        it(`${what}: Delete footnote everywhere keeps the horizontal rule (or refuses)`, () => {
            const plan = deleteFootnoteEverywhere(lines.join("\n"), "1") as { kind: string; markdown?: string };
            expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes(lines[label + 1])).toBe(true);
        });
    }
});

// ---------- the same root across containers, as a property ----------
//
// A property test (fast-check) builds many random notes from the pieces
// below and checks one rule on each. When the rule breaks, fast-check
// shrinks the note to the smallest one that still breaks it. Today the
// smallest is "Text here", "[^1]: def", "---".

const SEED = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
const RUNS = Number(process.env.FC_NUM_RUNS ?? 1000);
const params = { numRuns: RUNS, ...(SEED !== undefined ? { seed: SEED } : {}) };

interface Shape {
    lines: string[];
    name: string;
}

// The containers a note can start with: quotes, list items, a task, a callout.
const prefixes = ["", "> ", "- ", "1. ", "10. ", "> - ", "- - ", "> > ", "- [ ] ", "> [!note] "];

// Lines that look more or less like a setext underline (a line of "=" or
// "-" marks that can turn the line above it into a heading).
const underlines = ["===", "---", "--", "-", "=", "  ---", "   ===", "=== ", "--- ", "- ===", "> ===", "***", "\t===", "2. ---", "- - -", ">==="];

/** The column where text starts inside the prefix's innermost container. */
const contentColumn = (prefix: string): number => {
    if (prefix === "> [!note] ") return 2;
    return prefix.length;
};

/** A note: a line of prose in some container, a label line under it, a line of marks under that, and optional extras. */
const shapeArb: fc.Arbitrary<Shape> = fc
    .tuple(
        fc.constantFrom(...prefixes),
        fc.constantFrom("margin", "content", "content+2", "markers"),
        fc.constantFrom(...underlines),
        fc.constantFrom("same", "margin", "markers"),
        fc.constantFrom("1", "note", "x"),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
    )
    .map(([prefix, labelAt, underline, underlineAt, name, cite, tail, defineElsewhere]) => {
        // the quote markers the prefix starts with: ">" for "> - ", "> >" for "> > "
        const markers = (/^((?:> ?)*)/.exec(prefix)?.[1] ?? "").trimEnd();
        const column = contentColumn(prefix);
        const indent = (n: number) => " ".repeat(Math.max(0, n));
        const labelLine =
            labelAt === "margin"
                ? `[^${name}]: def`
                : labelAt === "content"
                  ? `${markers ? `${markers} ` : ""}${indent(column - (markers ? markers.length + 1 : 0))}[^${name}]: def`
                  : labelAt === "content+2"
                    ? `${markers ? `${markers} ` : ""}${indent(column + 2 - (markers ? markers.length + 1 : 0))}[^${name}]: def`
                    : `${markers ? `${markers} ` : ""}[^${name}]: def`;
        const underLine =
            underlineAt === "margin"
                ? underline
                : underlineAt === "markers"
                  ? `${markers ? `${markers} ` : ""}${underline}`
                  : `${markers ? `${markers} ` : ""}${indent(column - (markers ? markers.length + 1 : 0))}${underline}`;
        const lines = [`${prefix}Text${cite ? `[^${name}]` : ""} here`, labelLine, underLine];
        if (tail) lines.push("", "More text.");
        if (defineElsewhere) lines.push("", `[^${name}]: elsewhere`);
        return { lines, name };
    });

describe("properties over container-heavy label shapes", () => {
    // A line Obsidian reads as a block of its own (a list item, a quote
    // line of its own, a thematic break, a paragraph after a table) is
    // never cut by Delete footnote everywhere, unless it is the label's
    // own line or holds the footnote. An underline that is only paragraph
    // text (no block starts on it) may go with its label, so this check
    // leaves such lines out.
    it("Delete footnote everywhere keeps every line that starts a block of its own, other than the label's line and lines holding the footnote", { timeout: 600_000 }, () => {
        fc.assert(
            fc.property(shapeArb, ({ lines, name }) => {
                const reading = readNote(lines);
                const plan = deleteFootnoteEverywhere(lines.join("\n"), name) as { kind: string; markdown?: string };
                if (plan.kind !== "deleted") return;
                const out = (plan.markdown ?? "").split("\n");
                const folded = name.toLowerCase();
                // whether line i holds the footnote: a reference to it, a
                // line of its definition, or a label line with its name
                const holds = (i: number) =>
                    reading.referencesOn(i).some((r) => r.name.toLowerCase() === folded) ||
                    reading.definitions.some((d) => d.name.toLowerCase() === folded && d.start <= i && i <= d.end) ||
                    labelShapedLines(lines).some((l) => l.line === i && l.name.toLowerCase() === folded);
                for (let i = 0; i < lines.length; i++) {
                    if (holds(i) || lines[i].trim() === "") continue;
                    // a "^" in a line's blocks marks a block starting on it
                    if (!(reading.lineBlocks[i] ?? "").includes("^")) continue;
                    expect(out, `line ${i} ${JSON.stringify(lines[i])} of ${JSON.stringify(lines)} was cut`).toContain(lines[i]);
                }
            }),
            params,
        );
    });
});
