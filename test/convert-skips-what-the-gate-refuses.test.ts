import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal, convertInlineToNormalCommand, convertNormalFootnotesToInline, convertNormalToInlineCommand } from "../src/commands/convert-footnotes";
import { readNote } from "../src/parsing/note-reading";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import { noticeCalls } from "./mocks/obsidian";

// Convert skips just the footnote the result gate refuses, in both directions,
// and the rest convert (Jason's ruling, 2026-11-06). The result gate is the one
// check every edit passes before it is written (ADR 0003). The toast names what
// was skipped with the usual Skipped sentence, and when every footnote is
// refused, nothing is converted and the toast says so.
//
// "^[note]: more text" is the shape the gate refuses here: as "[^1]: more text"
// the line would become a definition. The normal to inline direction's shape,
// a definition between two lists, is in
// test/hunt/spec-convert-to-inline-refusal-between-lists.test.ts.

beforeEach(resetNotices);

const Reason = "would change how Obsidian reads the text around it";
const NoLint = { lintOnFootnoteCreation: false };

const editor = (lines: string[]) =>
    fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } } });

function toNormal(lines: string[], settings: Record<string, unknown> = {}) {
    const doc = editor(lines);
    const result = convertInlineFootnotesToNormal(fakePlugin({ ...NoLint, ...settings }, doc), doc);
    return { doc, result };
}

describe("inline to normal", () => {
    it("skips the footnote the gate refuses and converts the rest, in one transaction", () => {
        const { doc, result } = toNormal(["^[note]: more text", "", "and^[other] fine"]);
        expect(doc.lines).toEqual(["^[note]: more text", "", "and[^1] fine", "", "[^1]: other"]);
        expect(doc.transactions).toBe(1);
        expect(result).toEqual({ converted: 1, definitions: 1, merged: 0, skipped: [{ reason: Reason, count: 1 }] });
        expect(messages()).toEqual([`Converted 1 inline footnote into 1 normal footnote. Skipped: ${Reason} (1).`]);
    });

    it("every footnote refused: nothing is converted and the toast says so", () => {
        const { doc, result } = toNormal(["^[one]: first", "", "^[two]: second"]);
        expect(doc.lines).toEqual(["^[one]: first", "", "^[two]: second"]);
        expect(doc.transactions).toBe(0);
        expect(result.converted).toBe(0);
        expect(messages()).toEqual([`Nothing was converted. Every footnote was skipped: ${Reason} (2).`]);
    });

    it("skips one copy of a body, and the other copy still converts", () => {
        const { doc, result } = toNormal(["^[same]: first", "", "and^[same] second"]);
        expect(doc.lines).toEqual(["^[same]: first", "", "and[^1] second", "", "[^1]: same"]);
        expect(result).toMatchObject({ converted: 1, definitions: 1, merged: 0 });
    });

    it("still merges the copies it converts", () => {
        const { doc, result } = toNormal(["^[same]: first", "", "a^[same] b^[same] c^[else]"]);
        expect(doc.lines).toEqual(["^[same]: first", "", "a[^1] b[^1] c[^2]", "", "[^1]: same", "[^2]: else"]);
        expect(result).toMatchObject({ converted: 3, definitions: 2, merged: 1 });
    });

    it("a skipped footnote takes no number, and numbering carries on past the note's own", () => {
        const { doc } = toNormal(["^[note]: more", "", "x[^4] and^[other]", "", "[^4]: four"]);
        expect(doc.lines).toEqual(["^[note]: more", "", "x[^4] and[^5]", "", "[^4]: four", "[^5]: other"]);
    });

    it("a skipped footnote takes no name under the Named style", () => {
        const { doc } = toNormal(["^[smith 1999]: more", "", "and^[jones 2001]"], { footnoteNaming: "named" });
        expect(doc.lines).toEqual(["^[smith 1999]: more", "", "and[^jones]", "", "[^jones]: jones 2001"]);
    });

    it("joins the other reasons in the Skipped sentence", () => {
        toNormal(["^[note]: more", "", "a^[] b^[fine]"]);
        expect(messages()).toEqual([`Converted 1 inline footnote into 1 normal footnote. Skipped: empty (1), ${Reason} (1).`]);
    });

    it("a footnote the skips already took out and one the gate refuses: every footnote was skipped", () => {
        toNormal(["^[note]: more", "", "a^[]"]);
        expect(messages()).toEqual([`Nothing was converted. Every footnote was skipped: empty (1), ${Reason} (1).`]);
    });

    it("a toast with something skipped stays up as long as the refusal did", () => {
        toNormal(["^[note]: more", "", "and^[other]"]);
        expect(noticeCalls[0][1]).toBe(8000);
    });

    it("the note after a partial conversion converts no further by itself: the refused one is skipped again", () => {
        const { doc } = toNormal(["^[note]: more", "", "and^[other]"]);
        resetNotices();
        const again = convertInlineFootnotesToNormal(fakePlugin(NoLint, doc), doc);
        expect(again.converted).toBe(0);
        expect(messages()).toEqual([`Nothing was converted. Every footnote was skipped: ${Reason} (1).`]);
    });

    it("the command lints what it converted, under the setting, and leaves the skipped one", async () => {
        const doc = editor(["^[note]: more", "", "and^[other]"]);
        await convertInlineToNormalCommand(fakePlugin({ lintOnFootnoteCreation: true }, doc));
        expect(doc.lines).toEqual(["^[note]: more", "", "and[^1]", "", "[^1]: other"]);
    });
});

describe("normal to inline, the command", () => {
    const refusedFirst = ["Intro[^2].", "", "- a[^1]", "", "[^1]: one", "", "- b", "", "[^2]: two"];

    it("names the footnote it skipped and converts the rest, in one transaction", async () => {
        const doc = editor(refusedFirst);
        await convertNormalToInlineCommand(fakePlugin(NoLint, doc));
        expect(doc.lines).toEqual(["Intro^[two].", "", "- a[^1]", "", "[^1]: one", "", "- b"]);
        expect(doc.transactions).toBe(1);
        expect(messages()).toEqual([`Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (${Reason}).`]);
        expect(noticeCalls[0][1]).toBe(8000);
    });

    it("joins the other reasons in the Skipped sentence, in the note's order", async () => {
        const doc = editor([...refusedFirst, "", "[^o]: orphan"]);
        await convertNormalToInlineCommand(fakePlugin(NoLint, doc));
        expect(messages()[0]).toBe(`Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^1]" (${Reason}), "[^o]" (not referenced).`);
    });

    it("every footnote refused: nothing is written and the toast says so", async () => {
        const lines = ["- a[^1]", "", "[^1]: one", "", "- b"];
        const doc = editor(lines);
        await convertNormalToInlineCommand(fakePlugin(NoLint, doc));
        expect(doc.lines).toEqual(lines);
        expect(doc.transactions).toBe(0);
        expect(messages()).toEqual([`Nothing was converted. Every footnote was skipped: "[^1]" (${Reason}).`]);
        expect(noticeCalls[0][1]).toBe(8000);
    });
});

// A note must never end up with a half-applied footnote, whatever the gate
// refuses (Jason's ruling, 2026-11-06). These notes are put together from lines
// the gate often refuses, between lines it passes.
const RunOptions = { numRuns: Number(process.env.FC_NUM_RUNS ?? 200) };
// How long each property below may run, in milliseconds. The default limit of 5 seconds fails at 4,000 runs.
const PropertyTimeLimit = 120_000;
const noteArb = fc
    .array(
        fc.constantFrom(
            "- a[^1]",
            "- b[^2]",
            "- c",
            "[^1]: one",
            "[^2]: two",
            "[^3]: three",
            "c[^3] d[^1]",
            "text",
            "^[note]: more",
            "and^[other] fine",
            "^[same]: first",
            "a^[same] b^[same]",
            "[l^[m]](https://x.y)",
            "    indented",
            "> quoted^[z]",
        ),
        { minLength: 1, maxLength: 9 },
    )
    .chain((pieces) => fc.array(fc.constantFrom("\n", "\n\n"), { minLength: pieces.length, maxLength: pieces.length }).map((gaps) => pieces.map((piece, i) => (i === 0 ? piece : gaps[i] + piece)).join("")));

/** How many times each name is defined and referenced in `lines`, by lower-case name. */
function footnoteCounts(lines: string[]) {
    const reading = readNote(lines);
    const counts = new Map<string, { definitions: number; references: number }>();
    const entry = (name: string) => {
        const folded = name.toLowerCase();
        const found = counts.get(folded) ?? { definitions: 0, references: 0 };
        counts.set(folded, found);
        return found;
    };
    for (const { name } of reading.definitions) entry(name).definitions++;
    for (const { name } of reading.references) entry(name).references++;
    return counts;
}

/** How many inline footnotes `lines` holds, each wholly on one line. */
const inlineCount = (lines: string[]) => {
    const reading = readNote(lines);
    return lines.reduce((n, _, i) => n + reading.inlineNotesOn(i).length, 0);
};

describe("never a half-applied footnote", () => {
    it("normal to inline: each defined name is converted whole or left whole", () => {
        fc.assert(
            fc.property(noteArb, (note) => {
                const result = convertNormalFootnotesToInline(note);
                const before = footnoteCounts(note.split("\n"));
                const after = footnoteCounts(result.markdown.split("\n"));
                const skipped = new Set(result.skipped.map(({ name }) => name.toLowerCase()));
                for (const [name, counts] of before) {
                    if (counts.definitions === 0) continue;
                    expect(after.get(name) ?? { definitions: 0, references: 0 }).toEqual(skipped.has(name) ? counts : { definitions: 0, references: 0 });
                }
                if (result.converted === 0) expect(result.markdown).toBe(note);
            }),
            RunOptions,
        );
    }, PropertyTimeLimit);

    it("inline to normal: a footnote converted has its reference and definition, the others stay inline, and it is one transaction", () => {
        fc.assert(
            fc.property(noteArb, (note) => {
                resetNotices();
                const lines = note.split("\n");
                const doc = editor(lines);
                const result = convertInlineFootnotesToNormal(fakePlugin(NoLint, doc), doc);
                expect(doc.transactions).toBe(result.converted === 0 ? 0 : 1);
                expect(inlineCount(doc.lines)).toBe(inlineCount(lines) - result.converted);
                const before = footnoteCounts(lines);
                const added = [...footnoteCounts(doc.lines)].filter(([name]) => !before.has(name)).map(([, counts]) => counts);
                expect(added.reduce((n, counts) => n + counts.references, 0)).toBe(result.converted);
                expect(added.every((counts) => counts.definitions === 1)).toBe(true);
                expect(added.length).toBe(result.definitions);
            }),
            RunOptions,
        );
    }, PropertyTimeLimit);
});
