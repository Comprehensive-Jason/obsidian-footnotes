import type { Editor, EditorChange, EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../src/main";
import {
    adjustFootnotePosition,
    endOfWordOffset,
    moveCursorAndSetJumpPoint,
} from "../src/editor/cursor-motion";
import {
    caretInsideMaskedSpan,
    safeInsertionCh,
    simulateChanges,
    simulatedContext,
} from "../src/editor/insertion-liveness";

// Kills Stryker survivors from the 2026-08-12 re-baseline on the two editor
// leaves the architecture refactor left thinly covered: cursor-motion.ts
// (60%) and insertion-liveness.ts (69%). The caret-placement primitive was
// only ever exercised THROUGH the commands, so its transaction/scroll/vim
// contracts had no direct assertions at all; the liveness kit's boundary
// arithmetic had the same gap. Each test below is built to diverge between
// the original code and specific listed mutations; grouped by function,
// then by source line. See the trailing comment block for the mutants
// judged equivalent (not targeted).

// ---------- moveCursorAndSetJumpPoint harness ----------

interface MotionRecord {
    focusCalls: number;
    transactions: {
        changes?: EditorChange[];
        selection?: { from: EditorPosition };
    }[];
    setCursorCalls: EditorPosition[];
    scrollCalls: { range: unknown; center: unknown }[];
}

/** The CM5-compatibility editor the vim jumplist is handed ("SIC two levels deep"): identity is all that matters. */
const CM_FIVE = { id: "cm5-compat" };

/**
 * A main editor that records every call the primitive can make. `focus`
 * chooses what nestedSubEditorOwnsFocus will see: no `cm` at all, a cell
 * sub-editor holding focus (a nested, contained element), or the main
 * editor holding it itself (activeElement IS contentDOM).
 */
function motionEditor(
    focus: "no-cm" | "cell-owns-focus" | "main-owns-focus" = "main-owns-focus",
): { doc: Editor; record: MotionRecord } {
    const record: MotionRecord = {
        focusCalls: 0,
        transactions: [],
        setCursorCalls: [],
        scrollCalls: [],
    };
    const nestedEl = {};
    const contentDOM: {
        ownerDocument: { activeElement: unknown };
        contains: (el: unknown) => boolean;
    } = {
        ownerDocument: { activeElement: null },
        contains: (el: unknown) => el === nestedEl,
    };
    contentDOM.ownerDocument.activeElement =
        focus === "cell-owns-focus" ? nestedEl : contentDOM;
    const cm = {
        contentDOM,
        cm: CM_FIVE,
        focus() {
            record.focusCalls++;
        },
    };
    const doc = {
        cm: focus === "no-cm" ? undefined : cm,
        transaction(spec: {
            changes?: EditorChange[];
            selection?: { from: EditorPosition };
        }) {
            record.transactions.push(spec);
        },
        setCursor(pos: EditorPosition) {
            record.setCursorCalls.push(pos);
        },
        scrollIntoView(range: unknown, center: unknown) {
            record.scrollCalls.push({ range, center });
        },
    };
    return { doc: doc as unknown as Editor, record };
}

function motionPlugin(vimMode = false): FootnotePlugin {
    return {
        app: {
            vault: {
                // only the real key reports vim mode - a mutated key literal
                // reads as "off"
                getConfig: (key: string) => key === "vimMode" && vimMode,
            },
        },
    } as unknown as FootnotePlugin;
}

const OLD_POS: EditorPosition = { line: 1, ch: 2 };
const NEW_POS: EditorPosition = { line: 4, ch: 0 };
const CHANGES: EditorChange[] = [{ from: { line: 0, ch: 0 }, text: "[^1]" }];

// `activeWindow` is an Obsidian-supplied global with no stand-in under
// vitest; the vim tests install a fake and (isolate: false) put the slot
// back exactly as they found it so no other file in the worker sees it.
const globalSlot = globalThis as unknown as { activeWindow?: unknown };
let hadActiveWindow = false;
let savedActiveWindow: unknown;
const vimJumps: { cm: unknown; from: EditorPosition; to: EditorPosition }[] = [];

beforeEach(() => {
    hadActiveWindow = "activeWindow" in globalSlot;
    savedActiveWindow = globalSlot.activeWindow;
    vimJumps.length = 0;
});

afterEach(() => {
    if (hadActiveWindow) globalSlot.activeWindow = savedActiveWindow;
    else delete globalSlot.activeWindow;
});

function installVimAdapter(withAdapter = true): void {
    globalSlot.activeWindow = withAdapter
        ? {
              CodeMirrorAdapter: {
                  Vim: {
                      getVimGlobalState_: () => ({
                          jumpList: {
                              add(
                                  cm: unknown,
                                  from: EditorPosition,
                                  to: EditorPosition,
                              ) {
                                  vimJumps.push({ cm, from, to });
                              },
                          },
                      }),
                  },
              },
          }
        : // vim mode on, but a future Obsidian without the CM5 adapter
          {};
}

describe("moveCursorAndSetJumpPoint: sub-editor focus handoff", () => {
    // line 31 BlockStatement -> {} and ConditionalExpression -> false: both
    // skip the handoff, leaving keystrokes going to the abandoned cell
    // editor after the jump.
    it("hands focus back to the main editor when a cell sub-editor owns it", () => {
        const { doc, record } = motionEditor("cell-owns-focus");
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin());
        expect(record.focusCalls).toBe(1);
    });

    // line 31 LogicalOperator "&&" -> "||": the mere PRESENCE of a cm would
    // then re-focus the main editor on every ordinary press.
    it("does not re-focus when the main editor already owns focus", () => {
        const { doc, record } = motionEditor("main-owns-focus");
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin());
        expect(record.focusCalls).toBe(0);
    });
});

describe("moveCursorAndSetJumpPoint: one transaction, never two dispatches", () => {
    // The issue-#28 corruption class: text edits and the caret move must
    // leave as a SINGLE transaction, the selection resolved against the
    // post-change document.
    it("sends the changes and the selection in one transaction, with no setCursor", () => {
        const { doc, record } = motionEditor();
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin(), CHANGES);
        expect(record.transactions).toEqual([
            { changes: CHANGES, selection: { from: NEW_POS } },
        ]);
        expect(record.setCursorCalls).toEqual([]);
    });

    // line 35 ConditionalExpression "changes.length > 0" -> true and
    // EqualityOperator ">" -> ">=": an EMPTY change list would dispatch an
    // empty transaction instead of a plain cursor move.
    it("moves with setCursor when the change list is empty", () => {
        const { doc, record } = motionEditor();
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin(), []);
        expect(record.transactions).toEqual([]);
        expect(record.setCursorCalls).toEqual([NEW_POS]);
    });

    it("moves with setCursor when no changes are passed at all", () => {
        const { doc, record } = motionEditor();
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin());
        expect(record.transactions).toEqual([]);
        expect(record.setCursorCalls).toEqual([NEW_POS]);
    });
});

describe("moveCursorAndSetJumpPoint: centering", () => {
    // line 49 (BlockStatement -> {} / ConditionalExpression -> false) plus
    // line 50's ObjectLiteral -> {} and BooleanLiteral true -> false: the
    // jump must scroll the TARGET into view, CENTERED (an edge-parked
    // cursor is nearly off screen on mobile).
    it("center=true scrolls the target range into view, centered", () => {
        const { doc, record } = motionEditor();
        moveCursorAndSetJumpPoint(
            doc,
            OLD_POS,
            NEW_POS,
            motionPlugin(),
            undefined,
            true,
        );
        expect(record.scrollCalls).toEqual([
            { range: { from: NEW_POS, to: NEW_POS }, center: true },
        ]);
    });

    it("center=false (the default) leaves the viewport alone", () => {
        const { doc, record } = motionEditor();
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin());
        expect(record.scrollCalls).toEqual([]);
    });
});

describe("moveCursorAndSetJumpPoint: vim jump list", () => {
    // line 55 StringLiteral "vimMode" -> "", BlockStatement -> {} and
    // ConditionalExpression -> false: all three drop the jump-list entry,
    // so vim's "''" / Ctrl-o would forget where the jump came from.
    it("records the jump with the CM5 editor and both positions while vim mode is on", () => {
        installVimAdapter();
        const { doc } = motionEditor();
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin(true));
        expect(vimJumps).toEqual([
            { cm: CM_FIVE, from: OLD_POS, to: NEW_POS },
        ]);
    });

    it("records nothing while vim mode is off", () => {
        installVimAdapter();
        const { doc } = motionEditor();
        moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin(false));
        expect(vimJumps).toEqual([]);
    });

    // line 56 OptionalChaining "CodeMirrorAdapter?." -> "CodeMirrorAdapter.":
    // vim mode on with no CM5 adapter (a future Obsidian dropping it) must
    // degrade to a no-op, not a TypeError that kills the whole press.
    it("survives vim mode without a CodeMirrorAdapter", () => {
        installVimAdapter(false);
        const { doc } = motionEditor();
        expect(() =>
            { moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin(true)); },
        ).not.toThrow();
        expect(vimJumps).toEqual([]);
    });

    // line 57 OptionalChaining "cm?.cm" -> "cm.cm": an editor with no `cm`
    // (every unit/table-less harness, and Obsidian's own non-CM editors)
    // must still reach the jumplist with an undefined editor handle.
    it("passes an undefined CM5 editor rather than throwing when the editor has no cm", () => {
        installVimAdapter();
        const { doc } = motionEditor("no-cm");
        expect(() =>
            { moveCursorAndSetJumpPoint(doc, OLD_POS, NEW_POS, motionPlugin(true)); },
        ).not.toThrow();
        expect(vimJumps).toEqual([
            { cm: undefined, from: OLD_POS, to: NEW_POS },
        ]);
    });
});

describe("endOfWordOffset: the code point touching the offset from the left", () => {
    // A surrogate pair whose LOW half is 0xdc00 (U+10000, a Linear B
    // letter) and one whose low half is 0xdfff (U+1D7FF, a mathematical
    // monospace DIGIT) pin both ends of the low-surrogate range; a plane-1
    // letter's HIGH half is 0xd800, pinning the low end of that range.
    const LINEAR_B = String.fromCodePoint(0x10000); // "𐀀"
    const MATH_NINE = String.fromCodePoint(0x1d7ff); // "𝟿"

    // line 90: "prev >= 0xd800" -> "prev > 0xd800" - an offset sitting
    // mid-pair of a word whose high surrogate is exactly 0xd800 would stop
    // recognizing itself as inside a word at all, returning the raw offset
    // instead of walking to the word's end.
    it("treats an offset mid-pair of a 0xd800-leading astral letter as inside the word", () => {
        expect(endOfWordOffset(LINEAR_B, 1)).toBe(2);
    });

    // line 90: dropping "prev <= 0xdbff" (-> true), forcing the whole
    // condition true, or ORing the two halves all make a LOW surrogate take
    // the high-surrogate branch, which reads the lone low half instead of
    // the pair's own code point.
    // line 93 (same input): "prev >= 0xdc00" -> "<" / ">", "prev <= 0xdfff"
    // -> ">", "i >= 2" -> ">" / "<", the emptied block, "-> false", and
    // line 94's "i - 2" -> "i + 2" - every one of them loses the astral
    // word sitting just left of the offset, so the trailing "." is never
    // consumed.
    it("sees the astral word left of the offset and hops its trailing punctuation", () => {
        expect(endOfWordOffset(LINEAR_B + ".", 2)).toBe(3);
    });

    // line 93: "prev <= 0xdfff" -> "prev < 0xdfff" - the top of the low
    // surrogate range, reached only by a code point whose low half is
    // exactly 0xdfff.
    it("recognizes a word whose low surrogate is exactly 0xdfff", () => {
        expect(endOfWordOffset(MATH_NINE + ".", 2)).toBe(3);
    });

    // line 93: dropping "prev <= 0xdfff" (-> true) sends any BMP character
    // at or above 0xdc00 down the low-surrogate branch, which reads the
    // character TWO back (a space) instead of the letter itself. U+F900 (a
    // CJK compatibility ideograph, category Lo) is written as a CODE POINT,
    // not a literal: as a literal it is prone to NFC-normalizing to the
    // unified ideograph U+8C48, which sits below the range and would
    // quietly stop testing anything.
    it("does not mistake a high BMP letter for a low surrogate", () => {
        expect(
            endOfWordOffset(" " + String.fromCodePoint(0xf900) + ".", 2),
        ).toBe(3);
    });

    // line 93: forcing the guard true (whole condition, "true && i >= 2",
    // or "true && prev <= 0xdfff && i >= 2"), and either LogicalOperator
    // "||" rewrite, all make an ORDINARY ascii character read the character
    // two back instead of itself.
    it("reads the ordinary character directly left of the offset, not the one before it", () => {
        expect(endOfWordOffset(" a.", 2)).toBe(3);
    });
});

describe("endOfWordOffset: offsets no word touches", () => {
    // line 98 BlockStatement -> {} and ConditionalExpression -> false: with
    // the early return gone, an offset sitting on trailing punctuation with
    // no word anywhere near it would still hop that punctuation - inserting
    // a reference on the far side of a stray period.
    it("leaves an offset on lone punctuation exactly where it is", () => {
        expect(endOfWordOffset(" . ", 1)).toBe(1);
    });
});

describe("endOfWordOffset: mid-pair snapping before the walk", () => {
    const MATH_NINE = String.fromCodePoint(0x1d7ff); // low half 0xdfff

    // line 106: "unitAtEnd <= 0xdfff" -> "< 0xdfff" - an offset landing
    // mid-pair of a 0xdfff-tailed code point would fail to snap back, so
    // the walk starts on a lone surrogate, breaks immediately, and returns
    // a caret INSIDE the pair.
    it("snaps back from mid-pair when the pair's low half is exactly 0xdfff", () => {
        expect(endOfWordOffset(MATH_NINE, 1)).toBe(2);
    });

    // line 106 UpdateOperator "end--" -> "end++": snapping must go LEFT to
    // the code point boundary. A stray lone low surrogate between two words
    // exposes the direction - stepping right would walk into and consume
    // the NEXT word ("b"), which the caret was never touching.
    it("snaps left, not right, at a lone low surrogate between two words", () => {
        expect(endOfWordOffset("a\udfffb", 1)).toBe(1);
    });
});

describe("adjustFootnotePosition", () => {
    // wordAt as Obsidian implements it: the word-character run around the
    // caret (or just left of it), else null. Copied from the press
    // generator's fake editor (command-properties.test.ts).
    function wordEditor(lineText: string): Editor {
        return {
            wordAt(pos: EditorPosition) {
                const isWord = (c: string | undefined) =>
                    !!c && /[\p{L}\p{N}_]/u.test(c);
                let start = pos.ch;
                if (!isWord(lineText[start]) && isWord(lineText[start - 1]))
                    start--;
                if (!isWord(lineText[start])) return null;
                let end = start;
                while (isWord(lineText[start - 1])) start--;
                while (isWord(lineText[end])) end++;
                return {
                    from: { line: pos.line, ch: start },
                    to: { line: pos.line, ch: end },
                };
            },
        } as unknown as Editor;
    }

    function wordPlugin(insertAtEndOfWord: boolean): FootnotePlugin {
        return { settings: { insertAtEndOfWord } } as unknown as FootnotePlugin;
    }

    const adjust = (lineText: string, ch: number, endOfWord: boolean) =>
        adjustFootnotePosition(
            { line: 3, ch },
            wordEditor(lineText),
            lineText,
            wordPlugin(endOfWord),
        );

    // line 123 BlockStatement -> {} / -> false, and line 125's pair (the
    // word is always found here, so an emptied inner block or a false
    // guard also leaves the caret unmoved). line 128 ConditionalExpression
    // -> true would instead swallow the SPACE after the word.
    it("moves a mid-word caret to the word's end while the setting is on", () => {
        expect(adjust("word here", 1, true)).toEqual({ line: 3, ch: 4 });
    });

    it("leaves a mid-word caret alone while the setting is off", () => {
        expect(adjust("word here", 1, false)).toEqual({ line: 3, ch: 1 });
    });

    // line 127 MethodExpression "lineText.charAt(ch)" -> "lineText": the
    // whole line is never a single punctuation mark, so the hop would never
    // happen. line 128 "-> false" drops it too, and "ch++" -> "ch--" hops
    // BACKWARD into the word. The second "." also pins that exactly ONE
    // mark is consumed, not the run.
    // the landing convention (2026-09-09): the whole run of punctuation and
    // closing marks after the word is consumed, so a "ch++" -> "ch--"
    // mutant still hops backward into the word, and a dropped walk leaves
    // the caret at the word's end
    it("hops the whole run of trailing punctuation past the word's end", () => {
        expect(adjust("word.. rest", 1, true)).toEqual({ line: 3, ch: 6 });
    });

    it("hops a closing quote and the full stop after it", () => {
        expect(adjust('"word". rest', 2, true)).toEqual({ line: 3, ch: 7 });
    });

    it("does not hop a non-punctuation character after the word", () => {
        expect(adjust("word here", 3, true)).toEqual({ line: 3, ch: 4 });
    });

    it("leaves a caret touching no word where it is (wordAt finds nothing)", () => {
        expect(adjust("  ", 1, true)).toEqual({ line: 3, ch: 1 });
    });

    // the safeInsertionCh handoff (line 132): a caret directly after an
    // escaping backslash, or after an unescaped "^", must step left or the
    // inserted reference is born dead.
    it("nudges left off an escaped insertion point", () => {
        expect(adjust("ab\\", 3, false)).toEqual({ line: 3, ch: 2 });
    });

    it("nudges left off an inline-footnote opener", () => {
        expect(adjust("a^", 2, false)).toEqual({ line: 3, ch: 1 });
    });

    // line 133 ConditionalExpression -> true: when nothing needs adjusting
    // the caret object is returned AS IS. The end-of-word branch hands back
    // wordAt's own `to` object (which it mutates in place), so needless
    // reallocation here would quietly change what callers share.
    it("returns the very caret object it was given when no adjustment applies", () => {
        const cursor = { line: 3, ch: 1 };
        expect(
            adjustFootnotePosition(
                cursor,
                wordEditor("abc"),
                "abc",
                wordPlugin(false),
            ),
        ).toBe(cursor);
    });
});

describe("safeInsertionCh", () => {
    it("steps left of an escaping backslash", () => {
        expect(safeInsertionCh("a\\", 2)).toBe(1);
    });

    it("stays put after an EVEN run of backslashes (they escape each other)", () => {
        expect(safeInsertionCh("a\\\\", 3)).toBe(3);
    });

    it("steps left of an unescaped inline-footnote opener", () => {
        expect(safeInsertionCh("a^", 2)).toBe(1);
    });

    it("stays put after an ESCAPED caret - it opens nothing", () => {
        expect(safeInsertionCh("a\\^", 3)).toBe(3);
    });

    it("walks left past a run of carets", () => {
        expect(safeInsertionCh("a^^^", 4)).toBe(1);
    });

    it("walks left past a backslash and the caret behind it, in one call", () => {
        // "a^\" - the backslash escapes the insertion, and the "^" it lands
        // on would swallow it in turn
        expect(safeInsertionCh("a^\\", 3)).toBe(1);
    });

    it("column 0 is always safe, even on a line that starts with a caret", () => {
        expect(safeInsertionCh("^x", 0)).toBe(0);
    });
});

// simulatedMaskedLine became simulatedContext on 2026-10-03 (the inline
// and placeholder presses now also ask the simulated note whether the
// line landed inside a definition); these read its masked line. Its
// `toCh` replacement form had no caller left and went with it, and so did
// the test of that form.
describe("simulatedContext", () => {
    const docOf = (lines: string[]): Editor =>
        ({
            lineCount: () => lines.length,
            getLine: (n: number) => lines[n],
        }) as unknown as Editor;

    const NUL = (n: number) => "\0".repeat(n);

    // line 66 MethodExpression "lineText.slice(toCh)" -> "lineText": the
    // tail would be the WHOLE line instead of the part after the caret.
    it("splices an insertion at the caret and keeps only the tail after it", () => {
        expect(simulatedContext(docOf(["ab"]), { line: 0, ch: 1 }, "X").maskedLine(0)).toBe(
            "aXb",
        );
    });

    it("reports an insertion that COMPLETES a math pair as masked at birth", () => {
        const doc = docOf(["$a $"]);
        // untouched, the trailing space keeps "$a $" out of math…
        expect(simulatedContext(doc, { line: 0, ch: 3 }, "").maskedLine(0)).toBe("$a $");
        // …but filling that space closes the pair, and the insertion lands
        // inside it
        expect(simulatedContext(doc, { line: 0, ch: 3 }, "b").maskedLine(0)).toBe(NUL(5));
    });

    it("honors whole-document region state: a line inside a fence masks fully", () => {
        const doc = docOf(["```", "code", "```"]);
        expect(simulatedContext(doc, { line: 1, ch: 0 }, "[^1]").maskedLine(1)).toBe(
            NUL("[^1]code".length),
        );
    });
});

describe("simulateChanges", () => {
    // line 78: "i < lines.length" -> "i <= lines.length" and dropping the
    // bound entirely (-> true) both read lines[lines.length].length on a
    // change addressed past the last line, which throws instead of
    // clamping to the document's end.
    it("does not walk off the end for a change addressed past the last line", () => {
        expect(
            simulateChanges(["a"], [{ from: { line: 5, ch: 0 }, text: "X" }]),
        ).toEqual(["aX"]);
    });

    // the documented CodeMirror tie-break: same-offset insertions
    // concatenate in CHANGE order, which is how a reference and its
    // EOF-appended definition share one offset when the caret sits at line
    // end. Reversing the tie would emit them backwards.
    it("concatenates same-offset insertions in change order", () => {
        expect(
            simulateChanges(
                ["xy"],
                [
                    { from: { line: 0, ch: 1 }, text: "A" },
                    { from: { line: 0, ch: 1 }, text: "B" },
                ],
            ),
        ).toEqual(["xABy"]);
    });

    it("applies back-to-front so earlier changes keep their ORIGINAL offsets", () => {
        expect(
            simulateChanges(
                ["one", "two"],
                [
                    { from: { line: 0, ch: 3 }, text: "[^1]" },
                    { from: { line: 1, ch: 3 }, text: "\n[^1]: d" },
                ],
            ),
        ).toEqual(["one[^1]", "two", "[^1]: d"]);
    });
});

describe("caretInsideMaskedSpan", () => {
    //          0123456
    const SPAN = "ab\0\0cd";

    // line 108 BlockStatement -> {} (returns undefined) and line 111
    // "return false"; plus, on this input, every mutant that swaps a
    // ternary's branches or blanks a comparison: ch 3 has NULs on both
    // sides while BOTH off-line stand-ins are false, so anything that
    // consults them instead reports the opposite answer.
    it("returns true (not undefined) strictly inside a masked span", () => {
        expect(caretInsideMaskedSpan(SPAN, 3, false, false)).toBe(true);
    });

    it("just before the opener is OUTSIDE the span", () => {
        expect(caretInsideMaskedSpan(SPAN, 2, false, false)).toBe(false);
    });

    it("just after the closer is OUTSIDE the span", () => {
        expect(caretInsideMaskedSpan(SPAN, 4, false, false)).toBe(false);
    });

    // line 109: "ch > 0" -> true / ">= 0" - at column 0 there is no
    // character to the left, so the off-line neighbor stands in for it.
    it("column 0 consults openAtStart for the left side", () => {
        expect(caretInsideMaskedSpan("\0\0cd", 0, true, false)).toBe(true);
        expect(caretInsideMaskedSpan("\0\0cd", 0, false, false)).toBe(false);
    });

    // line 110: "ch < masked.length" -> true / ">=" / "<=" - at end of
    // line the right-hand neighbor is off-line too.
    it("end of line consults openAtEnd for the right side", () => {
        expect(caretInsideMaskedSpan("ab\0\0", 4, false, true)).toBe(true);
        expect(caretInsideMaskedSpan("ab\0\0", 4, false, false)).toBe(false);
    });
});

// Equivalent mutants (not targeted above), with the reason each cannot be
// distinguished by any input:
//
// cursor-motion.ts
//
// - line 90 EqualityOperator "prev <= 0xdbff" -> "prev < 0xdbff": the only
//   value that separates them is a high surrogate of exactly 0xdbff, whose
//   pairs are the code points U+10FC00–U+10FFFF - all of plane 16 is
//   Private Use (category Co), so neither the pair's code point nor the
//   lone surrogate the mutant returns instead is a word character.
//   cpBefore's result is consumed ONLY through isWordCp, so the two answers
//   are indistinguishable.
//
// - line 90 ConditionalExpression "true && prev <= 0xdbff": for prev below
//   0xd800 the mutant takes the high-surrogate branch and returns
//   text.codePointAt(i - 1), which for a non-surrogate unit is exactly the
//   `prev` the original returns; for prev in the low-surrogate range or
//   above 0xdfff the added clause is false and the branch is skipped, as in
//   the original. No input separates them.
//
// - line 93 ConditionalExpression "prev >= 0xdc00 && prev <= 0xdfff &&
//   true" (dropping "i >= 2"): reaching this branch with i < 2 means i is
//   exactly 1 (i <= 0 returned earlier), and text.codePointAt(-1) is always
//   undefined - non-word, exactly like the lone low surrogate the original
//   returns instead. Again only word-ness is observable.
//
// - line 110 EqualityOperator "(cp as number) > 0xffff" -> ">= 0xffff":
//   only cp === 0xffff separates them, and U+FFFF is a permanent
//   noncharacter (category Cn), so the loop always breaks on isWordCp
//   before line 110 ever sees it.
//
// insertion-liveness.ts
//
// - line 36 EqualityOperator "ch > 0" -> "ch >= 0" and ConditionalExpression
//   -> "true": both only matter when ch <= 0, and the very next clause
//   reads lineText[ch - 1], which is `undefined` for any such ch and never
//   equals "^". The guard is a defensive short-circuit with no reachable
//   effect on the result.
//
// No mutant in either file was judged unit-unreachable: the vim/CodeMirror
// tail (lines 55-57) is reachable by installing a fake `activeWindow`
// global, as the vim describe above does, so no Stryker-disable region is
// warranted.
