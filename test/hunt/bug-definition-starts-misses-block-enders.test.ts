import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";
import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// BUG: two kinds of line that end a paragraph in Markdown are not counted as
// paragraph enders, so a perfectly real definition sitting under one of them
// is mistaken for a lazy label (paragraph text that only looks like a
// definition).
//
// (1) A setext underline of one or two dashes: "Heading", then "-", then
//     "[^1]: real". Three or more dashes get the right answer by accident,
//     because they also look like a thematic break; one and two dashes fall
//     through to "this is still a paragraph".
// (2) An ATX heading, a thematic break, or a setext underline indented by one
//     to three spaces: "para", then "   # Heading", then "[^1]: real". The
//     branch that claims indented lines as continuation of whatever is open
//     runs first, so those spellings never reach the heading, break, or
//     setext tests below it, even though those tests carry their own
//     allowance for up to three spaces.
//
// What the user would see: their footnote renders fine in Obsidian, but the
// plugin thinks the definition is not a definition. The fix-lazy rule then
// "helps" by inserting a blank line above it, which in case (1) breaks the
// heading apart: "Heading" becomes ordinary paragraph text and the lone "-"
// becomes an empty bullet. And a press on the reference, instead of jumping
// to the definition the user already wrote, appends a second, EMPTY
// definition with the same name at the bottom. Obsidian renders the LAST
// definition of a name, so the footnote goes blank.
//
// Hunt: 2026-09-13. Lens: the prose-label rule (attack-surface row 1).
//
// Source of truth: CommonMark 0.31.2 sections 4.1 (ATX headings), 4.2
// (setext headings) and 4.3 (thematic breaks), checked against micromark:
// "Foo" then "-" is an h2, and the setext reading beats the empty-list-item
// reading; " # H", "  ***" and "   ___" all interrupt a paragraph; "H" then
// "  ===" is a heading. The repo already agrees with itself here: the setext
// guard in removeLineRanges is /^\s{0,3}(-+|=+)\s*$/, pinned in
// test/mutation-hardening-scan.test.ts, which counts one or two dashes and
// one to three spaces of indent as a setext underline. The heading, break and
// setext tests inside this branch carry "{0,3}" allowances of their own that
// the earlier indented-content branch makes unreachable.
//
// Still owed before a fix lands: no manual-test sheet pins the dash spelling
// of a setext underline in Obsidian itself, so someone should confirm in
// Reading view that "Heading" / "-" / "[^1]: real" renders the footnote.

const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).blocks.map((b) => `${b.name}@${b.start}`);
};
const startsOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
};
const lastLineStarts = (doc: string) => startsOf(doc).at(-1);
const lazyNames = (doc: string) => {
    const lines = doc.split("\n");
    return lazyDefinitionLabelNames(lines);
};

describe("a setext underline of dashes ends the paragraph", () => {
    it("the spellings the start rule already knows all work", () => {
        // the "=" spelling, as manual sheet 14 pinned it
        expect(blocksOf("t[^1]\n\nH\n===\n[^1]: real")).toEqual(["1@4"]);
        expect(blocksOf("t[^1]\n\nH\n=\n[^1]: real")).toEqual(["1@4"]);
        // three dashes, by way of the thematic-break test
        expect(blocksOf("t[^1]\n\nH\n---\n[^1]: real")).toEqual(["1@4"]);
    });

    it("one or two dashes are a setext underline too", () => {
        expect(blocksOf("t[^1]\n\nH\n--\n[^1]: real")).toEqual(["1@4"]);
        expect(blocksOf("t[^1]\n\nH\n-\n[^1]: real")).toEqual(["1@4"]);
    });

    it("so the definition under one is not called a lazy label", () => {
        expect(lazyNames("use[^1] here\n\nHeading\n-\n[^1]: real definition")).toEqual([]);
    });

    it("and the lint leaves the heading whole", () => {
        const doc = "use[^1] here\n\nHeading\n-\n[^1]: real definition";
        // the fix-lazy rule leaves the definition alone: it is a definition
        expect(lintFootnotes(doc, { moveDefinitionsToBottom: false })).toBe(doc);
        // move-to-bottom puts its usual blank line between the last block
        // and the definitions it gathers, which leaves the heading whole (a
        // blank line under a setext underline changes nothing), and a
        // second lint changes nothing more
        const out = lintFootnotes(doc);
        expect(out).toBe("use[^1] here\n\nHeading\n-\n\n[^1]: real definition");
        expect(lintFootnotes(out)).toBe(out);
    });

    it("and a press on the reference jumps instead of appending an empty duplicate", async () => {
        const lines = ["use[^1] here", "", "Heading", "-", "[^1]: real definition"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 5 }, wholeDoc: true, edits: true });
        await insertAutonumFootnote(
            fakePlugin({ insertAtEndOfWord: false, enablePopupEditor: false, lintOnFootnoteCreation: false }, doc),
        );
        // Obsidian renders only the LAST definition of a name, so a second,
        // empty "[^1]: " at the bottom hides the body the user wrote
        expect(doc.lines).toEqual(lines);
    });
});

describe("a block start indented one to three spaces still ends the paragraph", () => {
    it("the unindented spellings all work", () => {
        expect(lastLineStarts("t[^1]\npara\n# H\n[^1]: real")).toBe(true);
        expect(lastLineStarts("t[^1]\npara\n## H ##\n[^1]: real")).toBe(true);
        expect(lastLineStarts("t[^1]\npara\n___\n[^1]: real")).toBe(true);
        expect(lastLineStarts("t[^1]\npara\n***\n[^1]: real")).toBe(true);
    });

    it("an ATX heading indented one to three spaces", () => {
        expect(lastLineStarts("t[^1]\npara\n # H\n[^1]: real")).toBe(true);
        expect(lastLineStarts("t[^1]\npara\n   # H\n[^1]: real")).toBe(true);
    });

    it("a thematic break indented one to three spaces", () => {
        expect(lastLineStarts("t[^1]\npara\n   ___\n[^1]: real")).toBe(true);
        expect(lastLineStarts("t[^1]\npara\n  ***\n[^1]: real")).toBe(true);
    });

    // Corrected 2026-10-03 (the runtime swap): Obsidian does not read an
    // indented "  ===" as a setext underline, so the label under it is lazy
    // paragraph text. Evidence: recorded fact c8bdf46 in
    // test/obsidian-answers/recorded-facts.json, where Obsidian's own
    // answer for "H" / "  ===" / "[^3]: three" lists [^3] as a reference
    // on the label line and no definition.
    it("a setext underline indented one to three spaces is no underline to Obsidian: the label stays lazy", () => {
        expect(lastLineStarts("t[^1]\n\nH\n  ===\n[^1]: real")).toBe(false);
    });

    it("so the lint does not insert a blank line into a note that already renders", () => {
        const doc = "use[^1]\npara\n   # Heading\n[^1]: real";
        expect(lazyNames(doc)).toEqual([]);
        expect(lintFootnotes(doc, { fixLazyDefinitions: true, moveDefinitionsToBottom: false })).toBe(doc);
    });
});
