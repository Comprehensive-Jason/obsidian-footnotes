import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { FootnotePlacement } from "../../src/parsing/landing";
import { DEFAULT_SETTINGS } from "../../src/settings";

// Bug (wrong place, default settings): in Chinese or Japanese text, a
// footnote on a sentence that another sentence follows lands in front of
// the "。" although Placement relative to punctuation is After, and the
// lint leaves a reference typed there where it is.
//
// The note, one line: 中文，英文。第三句。
// Caret: inside "英文" (column 4). Settings at their defaults (After), the
// numbered key.
//
// What happens: 中文，英文[^1]。第三句。 The reference is in front of the
// full stop. With the caret in the LAST sentence, "第三句", the same press
// gives 第三句。[^1], after the full stop. So within one paragraph the
// first sentences get the Before convention and the last one After.
// The lint, under After, leaves 英文[^1]。第三句。 unchanged, where it moves
// "word[^1]. Next" to "word.[^1] Next".
//
// What should happen: 中文，英文。[^1]第三句。 from the press, and the same
// from the lint.
//
// Why: the setting. README, the linter's first rule: "to the side of the
// punctuation your Placement relative to punctuation setting says: after it
// by default". The ruling of 2026-08-10 pinned in
// test/hunt/spec-cjk-trailing-punctuation ("CJK trailing punctuation hops
// like ASCII") and test/hunt/spec-cjk-end-of-word-press, whose examples end
// the line or put a space after the "。", which Chinese and Japanese do not
// write. The same fault was fixed for closing brackets on 2026-10-06
// (test/hunt/bug-placement-cjk-glued-closing-bracket: "Chinese and Japanese
// have no spaces, so a closing mark almost always touches the next
// character"), and for a selection's end on 2026-11-06 (EndsSelectionGrowth
// in src/editor/cursor-motion.ts, finding H36).
//
// Cause: src/parsing/landing.ts:349, markRunEnd. A punctuation character
// with a letter right after it is taken for punctuation inside a word, as
// the "." of "U.S." and the "'" of "Marx's" are, so the walk stops in front
// of it. A fullwidth "。", "，", "、", "；", "：", "！", or "？" is never
// inside a word, and in text without spaces a letter always follows it.
//
// Found by the Fable 5.2 review (2026-11-11). Jason ruled that After steps
// over every one of them (。，、；：！？), as it does over Latin punctuation.

/** Presses the numbered key with the caret at `ch` of a one-line note. */
async function press(line: string, ch: number, placement: FootnotePlacement) {
    const doc = fakeEditor([line], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false, footnotePlacement: placement }, doc));
    return doc.lines[0];
}

describe("CJK punctuation with the next sentence right after it", () => {
    it("After: a press lands after the full stop that ends its sentence", async () => {
        // Today: "中文，英文[^1]。第三句。"
        expect(await press("中文，英文。第三句。", 4, "after")).toBe("中文，英文。[^1]第三句。");
    });

    it("After: a press lands after a fullwidth comma", async () => {
        // Today: "中文[^1]，英文。第三句。"
        expect(await press("中文，英文。第三句。", 1, "after")).toBe("中文，[^1]英文。第三句。");
    });

    it("After: Japanese, the same", async () => {
        // Today: "これは文[^1]。次の文。"
        expect(await press("これは文。次の文。", 2, "after")).toBe("これは文。[^1]次の文。");
    });

    it("After: the lint moves a reference typed in front of the full stop past it", () => {
        // Today: unchanged.
        expect(footnoteAfterPunctuation("中文，英文[^1]。第三句。\n\n[^1]: note", "after").split("\n")[0]).toBe("中文，英文。[^1]第三句。");
    });

    // Characterization: what already works.
    it("After: the last sentence of the line lands after its full stop (as it is today)", async () => {
        expect(await press("中文，英文。第三句。", 7, "after")).toBe("中文，英文。第三句。[^1]");
    });

    it("After: a Latin sentence lands after its period (as it is today)", async () => {
        expect(await press("First word. Next one.", 8, "after")).toBe("First word.[^1] Next one.");
    });

    it("Before: a press lands in front of the full stop (as it is today)", async () => {
        expect(await press("中文，英文。第三句。", 4, "before")).toBe("中文，英文[^1]。第三句。");
    });

    it("Before: the lint moves a reference typed after a glued full stop in front of it", () => {
        // The mirror of the After case; it shows whether the lint reads the
        // glued "。" as punctuation at all.
        expect(footnoteAfterPunctuation("中文，英文。[^1]第三句。\n\n[^1]: note", "before").split("\n")[0]).toBe("中文，英文[^1]。第三句。");
    });
});
