import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../src/editor/document-diff";

// Jason's report (2026-09-11): a folded heading whose section the lint
// edits still unfolded. Probed live: Obsidian drops a heading fold on ANY
// edit inside it, even one character, so this is not about the shape of
// the edit. The plugin keeps the folds itself: it reads the view's fold
// list before the rewrite, maps each fold's line numbers through the
// edits, and puts the list back afterwards. mapFoldLines is the mapping.

describe("mapFoldLines carries fold line numbers through the lint's edits", () => {
    const folds = [{ from: 0, to: 4 }, { from: 6, to: 9 }];

    it("an edit inside a fold leaves its lines where they are", () => {
        const before = "# A\n\nline a[^1].\nline b\n\n# B\n\ntail\n\n[^1]: one";
        const after = "# A\n\nline a.[^1]\nline b\n\n# B\n\ntail\n\n[^1]: one";
        expect(mapFoldLines(folds, lineDiffChanges(before, after), before)).toEqual(folds);
    });

    it("lines removed above a fold shift it up, lines inserted above shift it down", () => {
        const before = "x\ny\n# A\n\nbody\n\n# B\n\ntail";
        const removed = "# A\n\nbody\n\n# B\n\ntail";
        expect(mapFoldLines([{ from: 2, to: 4 }, { from: 6, to: 8 }], lineDiffChanges(before, removed), before)).toEqual([
            { from: 0, to: 2 },
            { from: 4, to: 6 },
        ]);
        const inserted = "x\ny\nz\nw\n# A\n\nbody\n\n# B\n\ntail";
        expect(mapFoldLines([{ from: 2, to: 4 }], lineDiffChanges(before, inserted), before)).toEqual([{ from: 4, to: 6 }]);
    });

    it("a definition moved out of a folded section shrinks the fold instead of dropping it", () => {
        // the fold ran through the definition (line 4); with those lines
        // gone it ends on the blank line before "# B", as Obsidian reports
        // a heading fold (the last line before the next heading)
        const before = "# A\n\nbody[^1]\n\n[^1]: one\n\n# B\n\ntail";
        const after = "# A\n\nbody[^1]\n\n# B\n\ntail\n\n[^1]: one";
        const mapped = mapFoldLines([{ from: 0, to: 5 }], lineDiffChanges(before, after), before);
        expect(mapped).toEqual([{ from: 0, to: 3 }]);
    });

    it("a folded list item that loses a reference and the space before it, right under a definition moved away, keeps its fold", () => {
        // Delete orphaned references takes out "[^9]" with the space
        // before it, so the item's text without references reads
        // "- item  more" before and "- item more" after. Lines are lined up
        // with each run of spaces counted as one, so the item is still
        // the same line (hunt 2026-10-05 round 2, cluster D5).
        const before = "Intro[^1]\n\n[^1]: alpha\n\n- item [^9] more\n  - child\n\ntail";
        const after = "Intro[^1]\n\n- item more\n  - child\n\ntail\n\n[^1]: alpha";
        expect(mapFoldLines([{ from: 4, to: 5 }], lineDiffChanges(before, after), before)).toEqual([{ from: 2, to: 3 }]);
    });

    it("a fold whose heading line is deleted is dropped", () => {
        const before = "# A\n\nbody\n\n# B\n\ntail";
        const after = "# B\n\ntail";
        expect(mapFoldLines([{ from: 0, to: 2 }, { from: 4, to: 6 }], lineDiffChanges(before, after), before)).toEqual([
            { from: 0, to: 2 },
        ]);
    });
});
