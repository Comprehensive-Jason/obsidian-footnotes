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
// Only live Obsidian can settle it. "%%" is Obsidian's own comment syntax,
// not CommonMark, so there is no written spec to read and no reference
// parser to run. It needs a Reading view check on the real editor.
//
// Hunt: 2026-09-13. Lens: regressions.
//
// Worth knowing before anyone spends time on it: under either reading
// Obsidian renders the line as the literal text "[^1]: freed label", not as
// a rendered footnote, so settling this question does not change the
// verdicts pinned in bug-label-after-comment-closer-mangled. The
// punctuation rule must not rewrite that label and orphan deletion must not
// cut its brackets either way.

const DOC = "x[^1]\n\n%%\nhidden\n%% [^1]: freed label";

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
    it.fails("reading one: it is a definition block on line 4", () => {
        expect(blocksOf(DOC)).toEqual(["1@4"]);
    });

    it("reading two, what the code does today: no definition, no lazy label", () => {
        expect(blocksOf(DOC)).toEqual([]);
        expect(lazyOf(DOC)).toEqual([]);
    });

    it("the rename command already reads it as a footnote, so the two halves disagree", () => {
        // rename offers "1" on that line while every definition reader
        // sees nothing there. Whichever reading wins, the plugin should
        // not hold both at once
        const doc = fakeEditor(DOC.split("\n"), { wholeDoc: true });
        expect(renameTargetAtCursor(doc, { line: 4, ch: 6 })).toBe("1");
    });
});
