// Found by the subtraction pass's carry job (sub-carry, 2026-10-08, "needs
// Jason's eyes" 1) and ruled by Jason on 2026-10-09 (ruling 3). Origin:
// 7298fc7, which took out the blank line the first footnote's append put
// at the top of such a note and left the result gate to refuse the press.
//
// With the Section heading setting set to "---" / "## Footnotes", a note
// that opens with a bare "---" (a horizontal rule, closed by nothing) would
// read as frontmatter once the heading's "---" is written under it: the top
// of the note would turn into note properties. The result gate refuses the
// edit, which is right, but it gave the reason as protected text, so a
// press with the caret in plain prose said "footnotes can't go inside code,
// math, or other protected text." Frontmatter that appears out of nothing
// is the note's formatting changing, so the gate now reports it as a line's
// formatting: the press shows the block-syntax notice, and a carried paste
// its own notice for text that reads differently.
//
// A selection showed its own formatting notice, "the selection takes part
// of the line's formatting. Select the whole line, or only its text.",
// whose advice does not help, since the selection takes none of a line's
// formatting. Jason's wording ruling of 2026-10-09: it shows the general
// notice, "No footnote was created: it would change how Obsidian reads the
// text around it." (fix job c8fix-B, hunt 2026-10-09 cycle 8).
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { judgeEdit } from "../../src/editor/result-gate";

const HEADING = "---\n## Footnotes";

const settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: true,
    footnoteSectionHeading: HEADING,
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
    carryFootnotesOnCopy: true,
};

// A stand-in for the browser's clipboard event: it reads `text`.
function clipboardEvent(text: string) {
    return {
        defaultPrevented: false,
        clipboardData: { types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? text : ""), setData: () => {} },
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {},
    };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("frontmatter that an edit would make out of nothing is reported as formatting", () => {
    it("the gate gives the reason as a line's formatting", () => {
        const verdict = judgeEdit(["---", "", "alpha"], ["---", "", "alpha[^1]", "", "---", "## Footnotes", "", "[^1]: "], {
            created: [{ kind: "footnote", name: "1", references: [{ line: 2, ch: 5 }], definition: { line: 7, lines: 1 } }],
            insertedText: [{ from: { line: 4, ch: 0 }, to: { line: 5, ch: 12 } }],
        });
        expect(verdict).toMatchObject({ pass: false, reason: "formatting", check: 3 });
    });

    it("a numbered press at the end of the prose is refused with the block-syntax notice", async () => {
        const note = ["---", "", "alpha"];
        const doc = fakeEditor([...note], { wholeDoc: true, edits: true, words: true, cursor: { line: 2, ch: 5 } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(note);
        expect(messages()).toEqual(["No footnote was created: a footnote here would break the line's formatting. Move the caret into the text."]);
    });

    it("a carried paste is refused with the paste's formatting notice", () => {
        const doc = fakeEditor(["---", "Text"], { wholeDoc: true, edits: true, cursor: { line: 1, ch: 4 }, selection: { anchor: { line: 1, ch: 4 }, head: { line: 1, ch: 4 } } });
        handlePaste(fakePlugin(settings, doc), clipboardEvent("c[^7]\n\n[^7]: seven") as never, doc);
        expect(doc.lines).toEqual(["---", "Text"]);
        expect(messages()).toEqual(["Nothing was pasted: it would change how Obsidian reads the text around it."]);
    });

    // Until Jason's wording ruling of 2026-10-09 these two expected the
    // selection's formatting notice, "No footnote was created: the
    // selection takes part of the line's formatting. Select the whole line,
    // or only its text."
    it("a selection turned into a footnote is refused with the general notice", async () => {
        const note = ["---", "", "alpha beta"];
        const doc = fakeEditor([...note], { wholeDoc: true, edits: true, cursor: { line: 2, ch: 6 }, selection: { anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 10 } } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(note);
        expect(messages()).toEqual(["No footnote was created: it would change how Obsidian reads the text around it."]);
    });

    it("the named key on a selection is refused with the general notice before its name modal opens", async () => {
        const note = ["---", "", "alpha beta"];
        const doc = fakeEditor([...note], { wholeDoc: true, edits: true, cursor: { line: 2, ch: 6 }, selection: { anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 10 } } });
        await insertNamedFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(note);
        expect(messages()).toEqual(["No footnote was created: it would change how Obsidian reads the text around it."]);
    });

    it("control: a selection that takes part of a line's formatting still gets the selection's formatting notice", async () => {
        const note = ["> The sky is blue today."];
        const doc = fakeEditor([...note], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 9 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 9 } } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(note);
        expect(messages()).toEqual(["No footnote was created: the selection takes part of the line's formatting. Select the whole line, or only its text."]);
    });

    it("control: protected text an edit hides still gives the protected-text reason", () => {
        // a reference written inside a code span
        const verdict = judgeEdit(["a `code` b"], ["a `co[^1]de` b", "", "[^1]: "], {
            created: [{ kind: "footnote", name: "1", references: [{ line: 0, ch: 5 }], definition: { line: 2, lines: 1 } }],
        });
        expect(verdict).toMatchObject({ pass: false, reason: "protected" });
    });
});
