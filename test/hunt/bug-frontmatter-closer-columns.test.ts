import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { planFootnoteRename } from "../../src/commands/rename-footnote";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a block that starts on the frontmatter's closing
// line, right after its "---", has every column on that line placed 3
// characters too early.
//
// What the user would see: the frontmatter (the "---" fenced properties
// block at the top of a note) closes with a line such as "---[^1]: body
// [^2] tail" or "---> quoted [^1] text". Obsidian reads what follows the
// "---" as a block of its own (rule D2). The plugin reads the block too,
// but places everything in it 3 columns to the left. So a rename of
// [^2] is refused as if the footnote were dead, a press inside the quoted
// "[^1]" does not jump to its definition, and a press with the caret in
// front of "- item" writes "---[^1]- item" into the closer.
//
// Hunt 2026-10-05, round 1, lens reading. Cluster RD1.
//
// Source of truth: rule D2 ("---[^2]: two" closes the frontmatter and
// defines [^2]); Obsidian's answers night:d2c-10 and night:d2c-11 in
// overnight-probes.json (a task item's definition on the closer line,
// "---- [ ] [^2]: two", is a definition to Obsidian).
//
// Cause: the frontmatter tokenizer in obsidian-markdown.ts eats the "---"
// at the start of the closer line but never adds those 3 characters to
// parser.offset (the running column the parser adds to every position on
// a line). The comment-closer path does add them, which is why a block
// after a "%%" closer is placed right.

describe("columns on the frontmatter closer line", () => {
    it.fails("a reference inside a definition that starts on the closer line is where the reading says", () => {
        const lines = ["---", "a: 1", "---[^1]: body [^2] tail", "", "x[^1]", "", "[^2]: two"];
        const reading = readNote(lines);
        const refs = reading.referencesOn(2);
        // Today: ["dy ["], the slice 3 characters left of "[^2]".
        expect(refs.map((r) => lines[2].slice(r.start, r.end))).toEqual(["[^2]"]);
        expect(reading.referenceAt(2, lines[2].indexOf("[^2]") + 1)?.name).toBe("2");
    });

    it.fails("the label of a task item's definition on the closer line is where the reading says", () => {
        // night:d2c-11 in overnight-probes.json: Obsidian reads [^2] as a definition.
        const lines = ["---", "title: x", "---- [ ] [^2]: two", "", "use[^2]"];
        const reading = readNote(lines);
        const def = reading.labelOn(2);
        expect(def?.name).toBe("2");
        // Today: "] [^2", the slice 3 characters left of the label.
        expect(lines[2].slice(def?.labelStart, def?.labelEnd)).toBe("[^2]:");
        expect(reading.labelsOn(2).map((l) => lines[2].slice(l.start, l.end))).toEqual(["[^2]"]);
    });

    it.fails("a reference in a quote that starts on the closer line is where the reading says", () => {
        const lines = ["---", "a: 1", "---> quoted [^1] text", "", "[^1]: d"];
        const reading = readNote(lines);
        expect(reading.referencesOn(2).map((r) => lines[2].slice(r.start, r.end))).toEqual(["[^1]"]);
    });

    it.fails("a reference in a list item that starts on the closer line is where the reading says", () => {
        const lines = ["---", "a: 1", "---- item [^1] text", "", "[^1]: d"];
        const reading = readNote(lines);
        expect(reading.referencesOn(2).map((r) => lines[2].slice(r.start, r.end))).toEqual(["[^1]"]);
    });

    it.fails("rename of a footnote referenced inside a closer-line definition rewrites exactly the name", () => {
        const lines = ["---", "a: 1", "---[^1]: body [^2] tail", "", "x[^1]", "", "[^2]: two"];
        const doc = fakeEditor(lines, { wholeDoc: true, cursor: { line: 6, ch: 2 } });
        const plan = planFootnoteRename(doc, "2", "renamed");
        // Today: "dead", the rename is refused.
        expect(plan.kind).toBe("renamed");
        if (plan.kind === "renamed") {
            const onLine2 = plan.changes.filter((c) => c.from.line === 2);
            expect(onLine2.map((c) => lines[2].slice(c.from.ch, (c.to ?? c.from).ch))).toEqual(["2"]);
        }
    });

    it.fails("a press with the caret inside a quoted reference on the closer line jumps to its definition and writes nothing", async () => {
        const lines = ["---", "a: 1", "---> quoted [^1] text", "", "[^1]: d"];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 2, ch: lines[2].indexOf("[^1]") + 2 } });
        await insertAutonumFootnote(fakePlugin({}, doc));
        expect(doc.lines).toEqual(lines);
        expect(doc.moves.at(-1)?.line).toBe(4);
    });

    it.fails("a code span in a quote on the closer line is masked where it is", () => {
        const lines = ["---", "a: 1", "---> quoted `[^1]` text [^2]", "", "[^2]: d"];
        const reading = readNote(lines);
        expect(reading.referencesOn(2).map((r) => r.name)).toEqual(["2"]);
        // The masked line blots code with "\0" characters so they read as no reference.
        expect(reading.maskedLine(2)).toBe("---> quoted \0\0\0\0\0\0 text [^2]");
    });

    it.fails("blockSyntaxEnd on the closer line counts the '---' before the block's syntax", () => {
        // blockSyntaxEnd is the column where a line's block syntax (quote
        // marker, list marker, label) ends and its text begins.
        const at = (line: string) => readNote(["---", "a: 1", line]).blockSyntaxEnd(2);
        // The text starts after "---> ", "---- ", and "---[^1]: ". Today: [2, 2, 6].
        expect([at("---> quoted"), at("---- item"), at("---[^1]: x")]).toEqual([5, 5, 9]);
    });

    it.fails("a press with the caret in front of the list marker on the closer line is refused like any list marker", async () => {
        // A control outside the frontmatter: ["a: 1", "", "- item"] at ch 0 is
        // refused with the block-syntax notice.
        const lines = ["---", "a: 1", "---- item"];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 2, ch: 3 } });
        await insertAutonumFootnote(fakePlugin({}, doc));
        expect(doc.lines).toEqual(lines);
    });
});
