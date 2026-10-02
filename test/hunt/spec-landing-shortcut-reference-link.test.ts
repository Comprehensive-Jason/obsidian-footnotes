import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { endOfWordOffset } from "../../src/editor/cursor-motion";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: where should a press on the last word of a shortcut
// reference link land, when every spot touching the link breaks it?
//
// A shortcut reference link is a bare "[text]" whose address sits in a
// "[text]: http://u" line elsewhere in the note.
//
// What it does now: the press writes "see [text][^1] now". CommonMark then
// reads "[text][^1]" as a full reference link whose label "^1" matches
// nothing, so the link dies: Reading view shows the literal "[text]"
// followed by the footnote number.
// What a user might expect: the link keeps working and the footnote sits
// after it.
// Why it is a question and not a bug: no landing spot that touches the
// link keeps it alive. Straight after "]" breaks it as above, and inside
// the brackets changes the link's text so it no longer matches its
// address line. Only a spot after a space works ("see [text] [^1] now",
// checked with micromark), which detaches the footnote from its word. The
// plugin would also have to know that a matching "[text]: ..." line
// exists, since a bare "[text]" with none is ordinary bracketed prose,
// where landing after the "]" is right. The collapsed "[text][]" and full
// "[text][ref]" forms do have a clean spot, after the whole construct, and
// are pinned as a bug: bug-landing-reference-style-link.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G2.
//
// Source of truth: CommonMark 0.31.2, section 6.3 (shortcut reference
// links), with micromark plus micromark-extension-gfm-footnote as referee,
// and Jason's landing ruling (2026-09-15) that a reference never breaks a
// link.

/** The text of every working reference-style link in the note's first paragraph, read the way micromark with GFM footnotes reads it. */
function linkTexts(md: string): string[] {
    const tree = fromMarkdown(md, { extensions: [gfmFootnote()], mdastExtensions: [gfmFootnoteFromMarkdown()] });
    const paragraph = tree.children[0] as { children?: { type: string; children?: { value?: string }[] }[] };
    return (paragraph.children ?? [])
        .filter((node) => node.type === "linkReference")
        .map((node) => (node.children ?? []).map((child) => child.value ?? "").join(""));
}

const LinkAddress = "[text]: http://u";

/** The line after a press with the caret one character into `word`: "[^1]" written where the landing walk puts it. */
const pressAt = (line: string, word: string) => {
    const at = endOfWordOffset(line, line.indexOf(word) + 1);
    return line.slice(0, at) + "[^1]" + line.slice(at);
};

describe("spec question: a press on the last word of a shortcut reference link", () => {
    it.fails("shortcut link: the link still renders after the press", () => {
        const out = pressAt("see [text] now", "text");
        // Today: "see [text][^1] now", read as the text "see [text]" plus the footnote
        expect(linkTexts(`${out}\n\n${LinkAddress}\n[^1]: n`)).toContain("text");
    });

    it.fails("the whole numbered press (insert at end of word on) keeps the link", async () => {
        const lines = ["see [text] now", "", LinkAddress];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 6 }, edits: true, wholeDoc: true });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: true,
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    enableFootnoteSectionHeading: false,
                    footnoteSectionHeading: "",
                    enableRemoveBlankLastLines: true,
                    lintOnFootnoteCreation: false,
                },
                doc,
            ),
        );
        // Today: line 0 reads "see [text][^1] now" and the link is gone
        expect(linkTexts(doc.lines.join("\n"))).toContain("text");
    });
});
