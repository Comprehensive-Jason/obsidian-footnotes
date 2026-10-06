import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): definition lines pasted inside a code block or a
// math block are pulled out of the block and landed as live footnotes,
// when the pasted text holds no "[^" outside its definition lines.
//
// What the user would see: the user pastes a few lines such as
// "[^1]: one" and "[^2]: two" inside a code fence (a block of code opened
// and closed by three backticks), for example to show footnote syntax in
// a code sample. Instead of landing in the code as typed, the lines
// vanish from the code and turn up at the bottom of the note as real
// footnote definitions that nothing references, renamed if the note
// already uses the name. The same happens with prose followed by its
// definition lines, through a phone keyboard's clipboard history, and
// when the plugin's own copy of a definition line is pasted inside a
// "$$" math block.
//
// Hunt 2026-10-06, cycle 3, lens carry. Clusters K1 and K2.
//
// Origin: K1 pre-existing (the code fence and phone keyboard faces);
// K2 regression (since cec4352, from 00cb07e: the plugin's own copy of a
// definition line now carries that definition, so it reaches the paste
// planner too).
//
// Source of truth: the pin bug-carry-paste-in-protected-text (a paste
// inside a code fence is literal, nothing is pulled out of the code), and
// landCarriedText's own docstring in src/commands/carry-footnotes-hooks.ts
// ("the editor pastes the text as it is, definition lines and all, as
// plain text inside the block").
//
// Cause: planCarriedPaste reports landsInProtectedText from
// landedFootnoteSyntax in src/commands/carry-footnotes.ts, which looks
// only at the "[^" openings in the pasted body, the text before the
// definition lines. A body with no "[^" at all (empty, or prose without a
// reference) never counts as landing in protected text, so the paste is
// taken over and the definitions are appended to the note.

type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clip(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                event.written[t] = v;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

/** A fake editor holding `lines`, with the selection running from `from` to `to` (the same place when nothing is selected). */
function ed(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("bug: definition lines pasted into a code fence or math block stay in the block", () => {
    it.fails("a clipboard of definition lines alone, pasted inside a code fence, is left to the editor", () => {
        const doc = ed(["Text[^1].", "", "```md", "", "```", "", "[^1]: mine"], { line: 3, ch: 0 });
        const took = handlePaste(fakePlugin(on, doc), clip("[^1]: one\n[^2]: two") as never, doc);
        // Today the paste is taken over and the two lines land at the bottom as definitions.
        expect({ took, lines: doc.lines }).toEqual({ took: false, lines: ["Text[^1].", "", "```md", "", "```", "", "[^1]: mine"] });
    });

    it.fails("a clipboard of prose with no reference and its definition lines, pasted inside a code fence, is left to the editor", () => {
        const doc = ed(["```md", "", "```", "", "after"], { line: 1, ch: 0 });
        const took = handlePaste(fakePlugin(on, doc), clip("Last paragraph.\n\n[^1]: one") as never, doc);
        expect({ took, lines: doc.lines }).toEqual({ took: false, lines: ["```md", "", "```", "", "after"] });
    });

    it.fails("the same through the phone keyboard's clipboard history", () => {
        // The keyboard's clipboard history inserts text through the input
        // method, with no paste event, so the plugin's input handler sees it.
        const doc = ed(["```md", "", "```"], { line: 1, ch: 0 });
        const at = doc.posToOffset({ line: 1, ch: 0 });
        const took = carriedInputHandler(fakePlugin(on, doc), () => doc)({} as never, at, at, "[^1]: one\n[^2]: two");
        expect({ took, lines: doc.lines }).toEqual({ took: false, lines: ["```md", "", "```"] });
    });

    it.fails("the plugin's own copy of a definition line, pasted into a math block, stays in the math block", () => {
        const src = ed(["See[^1].", "", "[^1]: one"], { line: 2, ch: 0 }, { line: 2, ch: 9 });
        const ev = clip();
        handleCopy(fakePlugin(on, src), ev as never);
        // When the plugin leaves the copy to the editor, the editor's own copy holds the plain text.
        const text = ev.written["text/plain"] ?? "[^1]: one";
        const doc = ed(["$$", "", "$$"], { line: 1, ch: 0 });
        const took = handlePaste(fakePlugin(on, doc), clip(text) as never, doc);
        // Today the paste is taken over and "[^1]: one" lands after the closing "$$".
        expect({ took, lines: doc.lines }).toEqual({ took: false, lines: ["$$", "", "$$"] });
    });
});
