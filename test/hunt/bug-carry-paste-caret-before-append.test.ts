import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): after a paste that carries footnotes, the caret lands
// one line too high when the definition is added ABOVE the place where
// the text was pasted.
//
// What the user would see: their note keeps its definitions in the middle
// (issue #55's layout: text, then definitions, then more text). They paste
// "c[^7]" with its definition at the end of the last paragraph. The text
// and the definition land correctly, but the caret jumps to the line above
// the pasted text instead of sitting right after it, so the next thing
// they type goes in the wrong place.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C8.
//
// Source of truth: docs/agents/dev-setup.md, "Bundle every mutation into
// one Editor.transaction({changes, selection}); Obsidian resolves the
// selection against the post-change document." The caret belongs right
// after the pasted body, as it does after a plain paste.
//
// Cause: landCarriedText works out the caret position `end` from the
// pasted body alone, in the line numbers of the note BEFORE the change.
// The transaction reads that position against the note AFTER the change,
// where the definition line added above has pushed the body down one
// line.

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

// A fake editor holding `lines`, with the selection running from `from`
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("the caret after a paste whose definition lands above the paste point", () => {
    it("lands after the pasted body when the definition is appended ABOVE the paste point (definitions mid-note, issue #55 layout)", () => {
        const dest = editor(["Intro[^1]", "", "[^1]: one", "", "More text here"], { line: 4, ch: 14 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // The text itself lands right: the definition joins the others,
        // the pasted body ends the last paragraph.
        expect(dest.lines).toEqual(["Intro[^1]", "", "[^1]: one", "[^7]: seven", "", "More text herec[^7]"]);
        // The caret belongs right after "c[^7]", which is now on line 5.
        expect(dest.cursor).toEqual({ line: 5, ch: 19 });
    });

    it("lands after the pasted body when the first-footnote append adds a line at the top", () => {
        const heading = { enableFootnoteSectionHeading: true, footnoteSectionHeading: "---\n# Footnotes" };
        const dest = editor(["---", "Text"], { line: 1, ch: 4 });
        handlePaste(fakePlugin({ ...on, ...heading }, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // The heading starts with "---", so a blank line is added at the
        // top of the note to keep the note's first "---" from reading as
        // frontmatter. That line lands above the paste too, so the body
        // moves from line 1 to line 2, and the caret is left on the "---".
        const at = dest.cursor;
        expect(dest.lines[at.line].slice(0, at.ch)).toBe("Textc[^7]");
    });
});
