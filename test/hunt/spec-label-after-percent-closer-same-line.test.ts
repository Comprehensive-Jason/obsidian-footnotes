import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { renameTargetAtCursor } from "../../src/commands/rename-footnote";
import { lazyDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// spec question: when a "%%" block closer and a definition label share a
// line ("%% [^1]: freed label"), is that label a definition, or is it
// ordinary paragraph text?
//
// Reading one, a definition. The rulings in spec-obsidian-comments say a
// mid-line closer frees the rest of its line, and that a label directly
// under a bare closer is a definition. On that reading the freed label is
// no different: the comment block above it is what separates it from the
// prose further up, which is the same separation that makes a label on the
// NEXT line count. The block readers would report it as "1@4".
//
// Reading two, paragraph text. This is what the code does today: no
// definition block and no lazy label on that line, because a definition
// has to start at the beginning of its line and the "%%" is in the way.
//
// Answered: Obsidian's parser reads it as a definition on line 4, which is
// reading one (the saved answer
// pin:spec-label-after-percent-closer-same-line#1 in
// test/obsidian-answers/pins.json). The note reading agrees. It is not
// "movable", though, because the closer sits in front of its label, so it is
// not among the blocks the lint may move (GLOSSARY.md, "Container"). The first
// test below was it.fails until 2026-11-05: it looked for the definition among
// those blocks.
//
// Hunt: 2026-09-13. Lens: regressions.

const DOC = "x[^1]\n\n%%\nhidden\n%% [^1]: freed label";

const definitionsOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).definitions.map((d) => `${d.name}@${String(d.start)}:${d.movable ? "movable" : "stays"}`);
};

const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).blocks.map(
        (b) => `${b.name}@${b.start}`,
    );
};

const lazyOf = (doc: string) => {
    const lines = doc.split("\n");
    return lazyDefinitionLabelLines(lines);
};

describe("a definition label after a %% closer on the same line", () => {
    it("it is a definition on line 4, one the lint does not move", () => {
        expect(definitionsOf(DOC)).toEqual(["1@4:stays"]);
    });

    it("so it is no block the lint may move, and no lazy label", () => {
        expect(blocksOf(DOC)).toEqual([]);
        expect(lazyOf(DOC)).toEqual([]);
    });

    it("the rename command reads it as a footnote too", () => {
        const doc = fakeEditor(DOC.split("\n"), { wholeDoc: true });
        expect(renameTargetAtCursor(doc, { line: 4, ch: 6 })).toBe("1");
    });
});
