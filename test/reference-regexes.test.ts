import { describe, expect, it } from "vitest";

import { referenceShapes } from "../src/parsing/footnote-grammar";
import { readNote } from "../src/parsing/note-reading";

// What counts as a reference. Since the runtime swap (step 3, 2026-10-03)
// the note reading says so, as Obsidian's parser reads it
// (NoteReading.referencesOn); these were the tests of the regular
// expressions that used to stand in for it, kept on the reading. The one
// shape reader left, referenceShapes, finds text shaped like a reference
// whatever Obsidian makes of it, only so the plugin can say why a name
// cannot work.

/** The names of the live references on the one-line note `line`. */
const names = (line: string): string[] => readNote([line]).referencesOn(0).map((reference) => reference.name);

describe("references on a line, as the note reading finds them", () => {
    it("finds numbered and named references", () => {
        expect(names("alpha[^1] bravo[^note]")).toEqual(["1", "note"]);
    });

    it("finds a reference at the very start and end of a line", () => {
        expect(names("[^a] middle [^b]")).toEqual(["a", "b"]);
    });

    it("gives the name as written: numbers, and names", () => {
        expect(names("[^note]")).toEqual(["note"]);
        expect(names("[^12]")).toEqual(["12"]);
    });

    it("finds no empty reference", () => {
        // [^] is the just-inserted named-footnote shell awaiting a name
        expect(names("alpha[^] bravo")).toEqual([]);
    });

    it("reads a name up to the first ']', a '[' inside included", () => {
        // remark-footnotes' reference reader stops only at a "]" or
        // whitespace, and Obsidian reads it so (rule E5 in
        // docs/obsidian-reading-rules.md; saved answer
        // probe:e3-caret-ref-name, "a[^^[x]]" holds a live reference named
        // "^[x"). The old regular expression refused such a name.
        expect(names("alpha[^a[b] bravo")).toEqual(["a[b"]);
    });

    it("excludes a definition's own label", () => {
        expect(names("[^1]: the definition")).toEqual([]);
    });

    it("keeps a mid-line reference that happens to precede a colon", () => {
        // "noted[^3]: prose" renders as a live reference plus a literal
        // colon; only a label that starts a definition is one
        expect(names("as noted[^3]: more prose")).toEqual(["3"]);
    });

    it("keeps references in a definition body after the label", () => {
        expect(names("[^1]: see also[^2]")).toEqual(["2"]);
    });
});

describe("referenceShapes: text shaped like a reference, for explaining a name that cannot work", () => {
    it("finds a spaced name, which Obsidian reads as plain text, so the plugin can warn about it", () => {
        // spaced names don't render as footnotes, so the reading holds no
        // reference there; the shape reader stays permissive so the
        // invalid-name warning can find them (see invalid-footnote-name
        // tests), rather than silently treating them as plain text
        const line = "alpha[^my note!] bravo";
        expect(names(line)).toEqual([]);
        expect(referenceShapes(line, line).map((shape) => shape.name)).toEqual(["my note!"]);
    });

    it("finds no shape in an escaped reference or an inline footnote's caret", () => {
        expect(referenceShapes("\\[^x] and ^[^y]", "\\[^x] and ^[^y]")).toEqual([]);
    });
});
