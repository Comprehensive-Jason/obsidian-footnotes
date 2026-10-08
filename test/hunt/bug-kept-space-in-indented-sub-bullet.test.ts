import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (annoyance): Jason's ruling Q26 (keep the space in front of the new
// reference where dropping it would make the reference dead) does not
// apply in a sub-bullet indented with a tab or four spaces.
//
// What the user would see: a list "- Sources" with the sub-bullet
// "Smith [2020] argues this." under it, indented with a tab, as Obsidian
// indents a nested bullet when "Indent using tabs" is on. They select
// "argues this." and press the numbered key. The press is refused with
// "No footnote was created: Obsidian would read it as part of a link." The
// same selection at the top level, in a sub-bullet indented with two
// spaces, in a quote, and in a callout converts as ruled:
// "Smith [2020] [^1]", with "[^1]: argues this." at the end. The same
// refusal comes in a sub-bullet indented with four spaces, and in a
// numbered item's second paragraph indented with a tab.
//
// A "reference" is the "[^1]" in the text. A reference glued to the "]"
// of bracketed text ("Smith [2020][^1]") is "dead": Obsidian reads the two
// as a link and shows no footnote.
//
// Hunt 2026-10-08, cycle 7. Cluster Y9.
//
// Origin: red at 97abeac, this cycle's origin, which came before the
// ruling. Q26's change, 350d2af (2026-10-08), left these lines out: it was
// never right for them.
//
// Source of truth: Jason's ruling Q26 (sprout-c6-rulings.md 3,
// 2026-10-08): "Smith [2020] argues this.", selecting "argues this.",
// gives "Smith [2020] [^1]". docs/obsidian-reading-rules.md D7 (a
// reference glued after the "]" of bracketed text is dead, answers
// swap34:br-*). Rule B2 there: a line indented with a tab or four spaces
// under a "- " or "1. " item is inside the item, not code.
//
// Cause: absorbLeadingSpace in src/commands/selection-footnote.ts decides
// whether to keep the space by asking whether a reference at the end of
// the line is live with the space and without it. It reads the line alone
// (liveAtEnd, readNote([line])), without the list above it. Alone, a line
// that starts with a tab or four spaces reads as indented code, where no
// reference is live, so neither answer is live and the space goes. The
// result gate then sees "Smith [2020][^1]" read as a link, and refuses.

const Settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

/** Selects `selected` (its first occurrence on line `line`) and presses the numbered key. */
async function select(lines: string[], line: number, selected: string) {
    const from = lines[line].indexOf(selected);
    const to = from + selected.length;
    const doc = fakeEditor(lines, { cursor: { line, ch: to }, selection: { anchor: { line, ch: from }, head: { line, ch: to } }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe("Q26's kept space in an indented line", () => {
    it("control: at the top level the space stays", async () => {
        const doc = await select(["Smith [2020] argues this.", "", "After."], 0, "argues this.");
        expect(doc.lines).toEqual(["Smith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("control: in a two-space sub-bullet the space stays", async () => {
        const doc = await select(["- Sources", "  - Smith [2020] argues this.", "", "After."], 1, "argues this.");
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["- Sources", "  - Smith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("control: in a quote the space stays", async () => {
        const doc = await select(["> Smith [2020] argues this.", "", "After."], 0, "argues this.");
        expect(doc.lines).toEqual(["> Smith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("control: in a callout's body the space stays", async () => {
        const doc = await select(["> [!quote] Sources", "> Smith [2020] argues this.", "", "After."], 1, "argues this.");
        expect(doc.lines).toEqual(["> [!quote] Sources", "> Smith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("control: after '[2020],' the space goes, as the 2026-09-08 ruling has it", async () => {
        const doc = await select(["Smith [2020], argues this.", "", "After."], 0, "argues this.");
        expect(doc.lines).toEqual(["Smith [2020],[^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("control: after '(Smith 2020)' the space goes", async () => {
        const doc = await select(["As (Smith 2020) argues here.", "", "After."], 0, "argues here.");
        expect(doc.lines).toEqual(["As (Smith 2020)[^1]", "", "After.", "", "[^1]: argues here."]);
    });

    it("control: after a reference the space goes", async () => {
        const doc = await select(["Smith[^a] argues this.", "", "After.", "", "[^a]: one"], 0, "argues this.");
        expect(doc.lines[0]).toBe("Smith[^a][^1]");
    });

    it("control: after an image the space goes", async () => {
        const doc = await select(["![oyster](oyster.png) caption text", "", "After."], 0, "caption text");
        expect(doc.lines[0]).toBe("![oyster](oyster.png)[^1]");
    });

    // Before the fix each of these three was refused with "No footnote was
    // created: Obsidian would read it as part of a link.", and the note was
    // unchanged. absorbLeadingSpace now reads the line in its place in the
    // note.
    it("in a tab-indented sub-bullet the space stays", async () => {
        const doc = await select(["- Sources", "\t- Smith [2020] argues this.", "", "After."], 1, "argues this.");
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["- Sources", "\t- Smith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("in a four-space sub-bullet the space stays", async () => {
        const doc = await select(["- Sources", "    - Smith [2020] argues this.", "", "After."], 1, "argues this.");
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["- Sources", "    - Smith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });

    it("in a numbered item's second paragraph, indented with a tab, the space stays", async () => {
        const doc = await select(["1. Sources", "", "\tSmith [2020] argues this.", "", "After."], 2, "argues this.");
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["1. Sources", "", "\tSmith [2020] [^1]", "", "After.", "", "[^1]: argues this."]);
    });
});
