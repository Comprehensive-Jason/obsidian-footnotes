import { describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import {
    adjustFootnotePosition,
    endOfWordForSelection,
    endOfWordOffset,
} from "../src/editor/cursor-motion";
import FootnotePlugin from "../src/main";
import { lintFootnotes } from "../src/linting/linter";
import { readNote } from "../src/parsing/note-reading";
import { footnoteAfterPunctuation } from "../src/linting/rules/footnote-after-punctuation";
import { ClosingMarkChars, FootnotePlacement, referenceLandingAfter, TrailingPunctuationChars } from "../src/parsing/landing";

// Footnote reference placement relative to punctuation (T5 of the 2026-09
// feature round; Jason's ruling 2026-09-20: one global three-way setting,
// after / before / don't move, default after). "After" is the convention
// English, Taiwanese, Korean and Dutch writing share; "before" is mainland
// Chinese, Japanese, French, Italian, Portuguese, Polish and the EU style
// guide; "don't move" is for Russian, Polish per-mark placement, German and
// mixed-script notes placed by hand. Every convention found puts the marker
// AFTER a closing quotation bracket, so "after" and "before" step over
// closing marks, and in "before" mode a punctuation run that a closing mark
// follows is stepped over together with it. "Don't move" steps over nothing
// at all, closing marks included (Jason, 2026-09-22: the value must mean
// what it says, so a user who wants no automation has one value to pick).
// Research saved in the project's "Footnote placement research 2026-09-20.md".

/** Where a reference lands after the word that ends `word.length` characters into `text`. */
function landing(text: string, wordLength: number, placement?: FootnotePlacement): number {
    return referenceLandingAfter(text, wordLength, placement);
}

describe("referenceLandingAfter, after punctuation (the default and today's behaviour)", () => {
    it("steps past punctuation and closing marks, with no placement given", () => {
        expect(landing("word.", 4)).toBe(5);
        expect(landing('"word".', 5)).toBe(7);
    });

    it("steps past punctuation and closing marks when asked for 'after'", () => {
        expect(landing("word.", 4, "after")).toBe(5);
        expect(landing("「句子。」", 3, "after")).toBe(5);
    });
});

describe("referenceLandingAfter, before punctuation", () => {
    it("stops at the end of the word in front of punctuation", () => {
        expect(landing("word.", 4, "before")).toBe(4);
        expect(landing("word... next", 4, "before")).toBe(4);
        expect(landing("句子。", 2, "before")).toBe(2);
    });

    it("still steps past a closing mark", () => {
        expect(landing('"word"', 5, "before")).toBe(6);
        expect(landing("**bold**", 6, "before")).toBe(8);
    });

    it("steps over punctuation that sits inside a closing quote, together with the quote", () => {
        // the marker goes after the closing bracket in every convention found
        expect(landing("「句子。」", 3, "before")).toBe(5);
        expect(landing('"quoted."', 7, "before")).toBe(9);
        expect(landing("word.”", 4, "before")).toBe(6);
        expect(landing("(see this.) next", 10, "before")).toBe(11);
    });

    it("stops in front of punctuation that follows a closing mark", () => {
        expect(landing('"word".', 5, "before")).toBe(6);
        expect(landing("word.”.", 4, "before")).toBe(6);
    });
});

describe("referenceLandingAfter, don't move", () => {
    it("stops at the end of the word in front of punctuation", () => {
        expect(landing("word.", 4, "none")).toBe(4);
    });

    it("steps over nothing, not even a closing quote or bracket (Jason, 2026-09-22)", () => {
        expect(landing('"word".', 5, "none")).toBe(5);
        expect(landing("word)", 4, "none")).toBe(4);
        expect(landing("**word**.", 6, "none")).toBe(6);
    });

    it("does not step over punctuation inside a closing quote either", () => {
        expect(landing('"quoted."', 7, "none")).toBe(7);
    });
});

describe("the fourteen marks added on 2026-09-21 (the CJK coverage audit of 2026-09-19)", () => {
    it("adds the fullwidth and halfwidth stops, the two ellipses and the doubled marks to the trailing set", () => {
        for (const mark of "．｡､⋯‥‼⁇⁈⁉") {
            expect(TrailingPunctuationChars.includes(mark), mark).toBe(true);
        }
    });

    it("adds the halfwidth and fullwidth closing brackets and the prime quotes to the closing set", () => {
        for (const mark of "｣］｝｠〗〙〛〞〟") {
            expect(ClosingMarkChars.includes(mark), mark).toBe(true);
        }
    });

    it("keeps the word-internal marks out of both sets", () => {
        for (const mark of "ー・･－〜～") {
            expect(TrailingPunctuationChars.includes(mark), mark).toBe(false);
            expect(ClosingMarkChars.includes(mark), mark).toBe(false);
        }
    });

    it("walks over them like any other mark", () => {
        expect(landing("word．", 4)).toBe(5);
        expect(landing("word⋯⋯", 4)).toBe(6);
        expect(landing("word｣.", 4)).toBe(6);
        expect(landing("word.｣", 4, "before")).toBe(6);
        expect(landing("word‼", 4, "none")).toBe(4);
    });
});

describe("the end-of-word hop follows the placement", () => {
    it("after: past the punctuation, as before", () => {
        expect(endOfWordOffset("Sit, dolor", 1)).toBe(4);
        expect(endOfWordOffset("Sit, dolor", 1, "after")).toBe(4);
    });

    it("before: at the end of the word, still past a closing quote", () => {
        expect(endOfWordOffset("Sit, dolor", 1, "before")).toBe(3);
        expect(endOfWordOffset('say "hello". next', 6, "before")).toBe('say "hello"'.length);
    });

    it("none: at the end of the word, inside a closing quote if that is where the word ends", () => {
        expect(endOfWordOffset("wait... what", 2, "none")).toBe(4);
        expect(endOfWordOffset('say "hello". next', 6, "none")).toBe('say "hello'.length);
    });

    it("none: a link is still one word, and nothing after it is stepped over", () => {
        expect(endOfWordOffset("see [x](http://a.b/c). next", 6, "none")).toBe("see [x](http://a.b/c)".length);
    });

    it("a link is still one word, and the hop after it follows the placement", () => {
        expect(endOfWordOffset("see [x](http://a.b/c). next", 6, "before")).toBe("see [x](http://a.b/c)".length);
        expect(endOfWordOffset("see [x](http://a.b/c). next", 6, "after")).toBe("see [x](http://a.b/c).".length);
    });
});

describe("the selection grab follows the placement", () => {
    it("after: one trailing punctuation mark comes along, as before", () => {
        expect(endOfWordForSelection("word. next", 2)).toBe(5);
        expect(endOfWordForSelection("word. next", 2, "after")).toBe(5);
    });

    it("before and none: no trailing mark, so the reference lands in front of it", () => {
        expect(endOfWordForSelection("word. next", 2, "before")).toBe(4);
        expect(endOfWordForSelection("word. next", 2, "none")).toBe(4);
    });
});

describe("the caret adjustment reads the setting", () => {
    function adjusted(placement: FootnotePlacement, line = "word. next") {
        const doc = fakeEditor([line], { cursor: { line: 0, ch: 2 } });
        const plugin = fakePlugin({ insertAtEndOfWord: true, footnotePlacement: placement }, doc);
        return adjustFootnotePosition({ line: 0, ch: 2 }, readNote(doc.lines), line, plugin).ch;
    }

    it("lands after the punctuation under 'after' and before it under 'before' and 'none'", () => {
        expect(adjusted("after")).toBe(5);
        expect(adjusted("before")).toBe(4);
        expect(adjusted("none")).toBe(4);
    });
});

describe("the lint rule under 'before': references move back in front of punctuation", () => {
    const before = (text: string) => footnoteAfterPunctuation(text, "before");

    it("moves a reference that sits after punctuation back in front of it", () => {
        expect(before("word.[^1]")).toBe("word[^1].");
        expect(before("句子。[^1]")).toBe("句子[^1]。");
        expect(before("word...[^1] next")).toBe("word[^1]... next");
    });

    it("leaves a reference already in front of punctuation, so the rule is idempotent", () => {
        expect(before("word[^1].")).toBe("word[^1].");
        const once = before("a.[^1] b[^2].” c,[^3][^4]! d[^5]");
        expect(before(once)).toBe(once);
    });

    it("still moves a reference out past a closing quote, together with the punctuation inside it", () => {
        expect(before("word[^1].”")).toBe("word.”[^1]");
        expect(before("「句子[^1]。」")).toBe("「句子。」[^1]");
        expect(before("**bold[^1]**")).toBe("**bold**[^1]");
    });

    it("leaves a reference after a closing quote where it is, punctuation before the quote or not", () => {
        expect(before("word.”[^1]")).toBe("word.”[^1]");
        expect(before('"word"[^1].')).toBe('"word"[^1].');
    });

    it("moves a run of references and inline footnotes back as one", () => {
        expect(before("word.[^1][^2]")).toBe("word[^1][^2].");
        expect(before("word.^[n]")).toBe("word^[n].");
        expect(before("word[^1]^[n].")).toBe("word[^1]^[n].");
    });

    it("never touches a definition's own label, and moves the references in its body", () => {
        expect(before("[^1]: word.[^2]")).toBe("[^1]: word[^2].");
        expect(before("> [^1]: quoted.[^2]")).toBe("> [^1]: quoted[^2].");
    });

    it("leaves protected text alone", () => {
        const text = "use `x.[^1]` and\n```\ncode.[^2]\n```";
        expect(before(text)).toBe(text);
    });
});

describe("the lint rule under 'none' does nothing", () => {
    it("moves nothing in either direction", () => {
        for (const text of ["word[^1].", "word.[^1]", "word[^1]”.", "句子。[^1]"]) {
            expect(footnoteAfterPunctuation(text, "none")).toBe(text);
        }
    });
});

describe("the saved setting is trusted only when it names one of the three placements", () => {
    function pluginWithSavedData(data: Record<string, unknown>): FootnotePlugin {
        const plugin = new (FootnotePlugin as unknown as new () => FootnotePlugin)();
        plugin.loadData = () => Promise.resolve(data);
        plugin.saveData = () => Promise.resolve();
        return plugin;
    }

    it("keeps a known value and drops an unknown one for the default", async () => {
        const kept = pluginWithSavedData({ settingsVersion: 2, footnotePlacement: "before" });
        await kept.loadSettings();
        expect(kept.settings.footnotePlacement).toBe("before");
        // a hand edit or a sync merge can leave any string here; a value
        // that is not one of the three would make every reader misbehave
        const dropped = pluginWithSavedData({ settingsVersion: 2, footnotePlacement: "sideways" });
        await dropped.loadSettings();
        expect(dropped.settings.footnotePlacement).toBe("after");
    });
});

describe("the lint pipeline threads the placement", () => {
    it("defaults to after and honours before", () => {
        expect(lintFootnotes("word[^1].\n\n[^1]: one")).toBe("word.[^1]\n\n[^1]: one");
        expect(lintFootnotes("word.[^1]\n\n[^1]: one", { placement: "before" })).toBe("word[^1].\n\n[^1]: one");
        const untouched = "word.[^1]\n\n[^1]: one";
        expect(lintFootnotes(untouched, { placement: "none" })).toBe(untouched);
    });
});
