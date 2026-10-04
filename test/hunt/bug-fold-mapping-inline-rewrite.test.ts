import { describe, expect, it } from "vitest";

import { FoldRange, lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// Scenario: a note with a folded heading or a folded list, linted with the
// default settings. The lint only rewrites characters inside lines, but
// because two lines next to each other both change, the write-back turns
// them into one edit spanning both, and the fold that ends (or begins) in
// that span comes back a line short or does not come back at all.
//
// What the user would see: exactly Jason's original complaint from his manual
// lint pass of 2026-09-11, back again in a narrower form. They fold a heading or a list,
// press Ctrl+S, and the lint runs. The heading is still folded but one line
// of what was hidden is now showing under it, or the fold is gone entirely
// and the whole section is open again. Nothing was deleted; every line is
// still there.
//
// Hunt: 2026-09-13
// Lens: the minimal write-back and the fold restore (attack-surface row 4).
//
// Source of truth: manual sheet 12 line 19 ("Fold a heading and a bulleted
// list in this note (any of them, including one the lint will edit
// inside), put the caret on an unchanged line, and Ctrl+S: the note is
// linted, every fold is still folded, and the caret is still where it
// was"); Jason's original fold complaint from that pass ("after
// the lint the section is still folded and the caret is still on that line
// at the same column"); and the module comment on mapFoldLines itself,
// which licenses exactly one kind of loss and no other: "A fold whose
// heading line the edits removed is dropped; a fold whose last line was
// removed ends on the line before the removal." Nothing here is removed.
//
// Two mechanisms, both in mapFoldLines:
//
// 1. Every fold line is mapped by the offset its line STARTS at, and
//    mapOffset collapses any offset that falls strictly inside an edit back
//    to where that edit begins. When the lint rewrites two lines that sit
//    next to each other, lineDiffChanges emits them as ONE replacement
//    covering both, for example {from:19, to:30, text:"1]: two\n[^2"} for a
//    reindex that swaps the names on two adjacent definition lines. The
//    second line's start is inside that edit, so it collapses onto the
//    first line and the fold loses a line. If the edit covers the fold's
//    whole range, the fold ends where it starts and is thrown away.
//
// 2. The removed(line) predicate asks whether any edit covers a line's
//    whole span. A multi-line replacement covers the whole span of every
//    line in its middle, so a surviving line inside one is treated as
//    deleted. A fold whose last line is such a line is pulled back a line
//    and can collapse to nothing.
//
// The folded-list case below fails for a further reason on top of these:
// the line comparison pairs up repeated lines by position, so a renumbered
// child in a list of identical-looking children reads as one line deleted
// and another inserted, which shortens the fold.
//
// Header note: whether Obsidian's applyFoldInfo honours the "to" we hand it
// or re-derives a heading fold's range from the heading itself is a
// question only a live editor can answer, so the one-line shrink may or may
// not be visible for a HEADING fold. The outright drops reproduce the
// complaint either way, and a list fold has no heading to re-derive from.
//
// Settings: the defaults, and any lint trigger (the command, on save, or on
// footnote creation). The fixtures below are real lintFootnotes output.

const mapped = (before: string, after: string, folds: FoldRange[]): FoldRange[] =>
    mapFoldLines(folds, lineDiffChanges(before, after), before);

describe("a lint that only rewrites characters inside lines still moves folds", () => {
    it("a heading fold over the whole note ends one line early", () => {
        // reindex swaps two names, one on line 1 and one across lines 3 and
        // 4. Nothing is inserted or deleted, so the fold must come back
        // exactly as it went in. It comes back 0..3, which leaves the last
        // definition line showing under the collapsed heading.
        const before = "# H\nx[^2] y[^1]\n\n[^2]: two\n[^1]: one";
        const after = lintFootnotes(before, {});
        expect(after).toBe("# H\nx[^1] y[^2]\n\n[^1]: two\n[^2]: one");
        expect(mapped(before, after, [{ from: 0, to: 4 }])).toEqual([{ from: 0, to: 4 }]);
    });

    it("a folded list whose last child is renumbered loses that child", () => {
        const before = "# H\n- parent\n    - child[^2]\n    - child[^1]\ntail\n\n[^2]: two\n[^1]: one";
        const after = lintFootnotes(before, {});
        expect(mapped(before, after, [{ from: 1, to: 3 }])).toEqual([{ from: 1, to: 3 }]);
    });
});

describe("a surviving line inside one replacement is treated as deleted", () => {
    it("a fold whose last line sits inside the replacement is dropped altogether", () => {
        // The lint renumbers "[^20]" to "[^1]" on lines 0, 1 and 2, which
        // becomes one edit swallowing lines 1 and 2 whole. The fold over
        // lines 0 to 1 disappears: the folded list is wide open again, with
        // nothing removed from the note.
        const before = "- child[^20]\n- item [^20]\n- item [^20]\ntail\n- child[^20]";
        const after = lintFootnotes(before, {});
        expect(after).toBe("- child[^1]\n- item [^1]\n- item [^1]\ntail\n- child[^1]");
        expect(mapped(before, after, [{ from: 0, to: 1 }])).toEqual([{ from: 0, to: 1 }]);
    });

    it("a second fold in the same note has its start pulled up a line", () => {
        // Two folds here: lines 0 to 1 and lines 1 to 2. The first is
        // dropped and the second comes back as 0..2, so it now hides a line
        // the user never folded.
        const before = "1. numbered [^10]\n- child[^20]\n\n- item [^20]\ntail";
        const after = lintFootnotes(before, {});
        expect(after).toBe("1. numbered [^1]\n- child[^2]\n\n- item [^2]\ntail");
        expect(
            mapped(before, after, [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
            ]),
        ).toEqual([
            { from: 0, to: 1 },
            { from: 1, to: 2 },
        ]);
    });
});

describe("the boundary: folds the write-back does get right", () => {
    it("an edit strictly below the fold leaves it alone", () => {
        const before = "# A\nbody\nmore\n\n# B\nx[^1].\n\n[^1]: one";
        const after = "# A\nbody\nmore\n\n# B\nx.[^1]\n\n[^1]: one";
        expect(mapped(before, after, [{ from: 0, to: 2 }])).toEqual([{ from: 0, to: 2 }]);
    });

    it("an edit strictly above the fold shifts it by the number of lines gained or lost", () => {
        const before = "[^1]: moved\nbody[^1]\n\n# A\nfold me\nmore";
        const after = "body[^1]\n\n# A\nfold me\nmore\n\n[^1]: moved";
        expect(mapped(before, after, [{ from: 3, to: 5 }])).toEqual([{ from: 2, to: 4 }]);
    });

    it("one rewritten line inside the fold, with unchanged lines either side, is fine", () => {
        // the single-line case is the one the write-back handles: the edit
        // does not reach the start of the line below it
        const before = "# H\nx[^2] y[^1]\ntail\n\n[^1]: one\n\n[^2]: two";
        const after = "# H\nx[^1] y[^2]\ntail\n\n[^1]: two\n\n[^2]: one";
        expect(mapped(before, after, [{ from: 0, to: 2 }])).toEqual([{ from: 0, to: 2 }]);
    });
});
