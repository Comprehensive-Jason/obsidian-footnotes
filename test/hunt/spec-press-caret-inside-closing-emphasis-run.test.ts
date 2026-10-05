import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { adjustFootnotePosition } from "../../src/editor/cursor-motion";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { readNote } from "../../src/parsing/note-reading";

// spec question: when the caret sits BETWEEN the characters of a closing
// emphasis run ("**bold*|* next"), should the press carry the reference
// past the whole run?
//
// What it does now: the press writes the reference exactly where the caret
// is, splitting the run: "**bold*[^1]* next". The same happens with
// "==mark=|=", "~~gone~|~" and "***both*|**", under both placements. The
// underscore spelling, "__bold_|_ next", lands after the run, because "_"
// counts as a word character. Under Before placement with a full stop
// after the run, the lint later moves the reference out again
// ("**bold*[^1]*." becomes "**bold**[^1]."), so the press and the lint
// disagree there; under After the lint leaves the split run alone.
//
// What a user might expect: "**bold**[^1] next", the reference after the
// whole run, as b32cbd5 (B14) does for a caret at the end of the word
// ("a run like ** is judged as one").
//
// Why it is a question and not a bug: the landing rulings cover a caret in
// or just after a word. A caret between two characters of a delimiter run
// touches no word, and the press's rule for that case is to write where
// the caret is. Whether a caret inside a closing run should count as "just
// after the word" is a product decision for Jason. One representative case
// is pinned; the others listed above behave the same.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E8.
//
// Source of truth: bug-reference-before-closing-delimiter's convention ("a
// note number follows the closing quotation mark or bracket and any
// punctuation") and b32cbd5 ("a run like ** is judged as one").

/** The line after a press at `ch` with the given placement: the reference written where the end-of-word walk puts it. */
function pressAt(line: string, ch: number, placement: FootnotePlacement): string {
    const doc = fakeEditor([line], { cursor: { line: 0, ch } });
    const plugin = fakePlugin({ insertAtEndOfWord: true, footnotePlacement: placement }, doc);
    const at = adjustFootnotePosition({ line: 0, ch }, readNote(doc.lines), line, plugin).ch;
    return line.slice(0, at) + "[^1]" + line.slice(at);
}

describe("spec question: a caret between the two characters of a closing emphasis run", () => {
    it.fails("after: a press in '**bold*|* next' keeps the ** run whole", () => {
        // Today: "**bold*[^1]* next".
        expect(pressAt("**bold** next", 7, "after")).toBe("**bold**[^1] next");
    });

    it("control: the underscore spelling already lands after the run", () => {
        expect(pressAt("__bold__ next", 7, "after")).toBe("__bold__[^1] next");
    });

    it("control: under before, the lint puts a reference written inside the run after it", () => {
        expect(footnoteAfterPunctuation("**bold*[^1]*. next\n\n[^1]: d", "before")).toBe("**bold**[^1]. next\n\n[^1]: d");
    });
});
