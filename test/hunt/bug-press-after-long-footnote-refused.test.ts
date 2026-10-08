import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (annoyance): in a note whose last footnote is longer than 1,024
// characters, every press of the numbered key is refused, with a notice
// that blames protected text.
//
// What the user would see: a note with one footnote of about 170 words,
// an ordinary discursive footnote in academic writing. They put the caret
// in the text and press the numbered key. Nothing is created, and the
// notice says "No footnote was created: footnotes can't go inside code,
// math, or other protected text.", though the caret is in plain prose.
// The same happens after a footnote of three shorter paragraphs that add
// up to more than 1,024 characters. Convert inline footnotes to normal
// refuses the whole note.
//
// A "definition" is the "[^1]: ..." entry that holds a footnote's text,
// and its "label" is the "[^1]:" at its head. "Protected text" is code,
// math, comments, and frontmatter, where footnote syntax is plain text.
//
// Hunt 2026-10-08, cycle 6. Cluster Z8.
//
// Origin: pre-existing. At 10d599d the press was refused too, and Convert
// inline to normal wrote a definition that Obsidian did not read as one.
//
// Source of truth: docs/obsidian-reading-rules.md E4 (live Obsidian and
// stock remark-footnotes, 2026-10-03, 185 notes): what may end a
// definition is looked for only within its first 1,024 characters, so a
// label that starts at or after that point is more text of the definition
// above, while a blank line ends a definition at any length. The README
// says an ordinary press creates a footnote.
//
// Cause: buildDefinitionAppend in src/commands/definition-append.ts writes
// the new label on the line right under the last definition, with no
// blank line between. Under a footnote that long, Obsidian reads the new
// label as more of that footnote, so the new footnote is not created. The
// result gate (the one check every edit passes before it is written) sees
// this and refuses the press. That refusal is right, but the append should
// have put a blank line in front of the label, as it already does when the
// last definition ends in a lazy line (a line that carries the paragraph
// above it on without the indentation it would normally need). The notice blames protected text
// because refusedCreation in src/commands/create-footnote.ts tells every
// new footnote that is not live for a reason the gate cannot name (its
// reason "dead") with the protected-text notice.

const settings = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
    expandSelectionToWholeWords: false,
};

const sentence =
    "Marx develops this point at length in the third volume, where the falling rate of profit is treated not as a law that acts directly but as a tendency, checked by counteracting causes such as the cheapening of the elements of constant capital, the relative surplus population, and foreign trade. ";
// Four sentences: about 1,170 characters on the label line.
const longBody = sentence.repeat(4).trim();

/**
 * Whether the label of `name` is one Obsidian reads as a definition: it is
 * the note's first line, or the line above it is blank, or the line above
 * it is well short of 1,024 characters (rule E4).
 */
function liveLabelLine(lines: readonly string[], name: string): boolean {
    const at = lines.findIndex((line) => line.startsWith(`[^${name}]:`));
    if (at === -1) return false;
    return at === 0 || lines[at - 1].trim() === "" || lines[at - 1].length < 1000;
}

beforeEach(resetNotices);

describe("a press in a note whose last footnote is longer than 1,024 characters", () => {
    it("control: the long footnote's label line is longer than 1,024 characters (the shape's premise)", () => {
        expect(`[^1]: ${longBody}`.length).toBeGreaterThan(1100);
    });

    // Before the fix (2026-10-08): nothing changes, and the notice blames protected text.
    it("the numbered key creates footnote 2 with a live definition and no protected-text notice", async () => {
        const lines = ["The tendency of the rate of profit to fall[^1] is contested, and so is its cause.", "", `[^1]: ${longBody}`];
        const ch = lines[0].indexOf(" and so");
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines[0]).toContain("[^2]");
        expect(liveLabelLine(doc.lines, "2")).toBe(true);
        expect(messages().join(" ")).not.toContain("protected text");
    });

    // Before the fix (2026-10-08): nothing changes. Each paragraph is well under the limit, but the
    // footnote as a whole is over it.
    it("the numbered key creates footnote 2 after a footnote of three paragraphs, about 1,170 characters in all", async () => {
        const lines = [
            "The tendency of the rate of profit to fall[^1] is contested, and so is its cause.",
            "",
            `[^1]: ${sentence.trim()}`,
            "",
            `    ${sentence.repeat(2).trim()}`,
            "",
            `    ${sentence.trim()}`,
        ];
        const ch = lines[0].indexOf(" and so");
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines[0]).toContain("[^2]");
        const at = doc.lines.findIndex((line) => line.startsWith("[^2]:"));
        expect(at).toBeGreaterThan(0);
        // Rule E4: the label must not sit right under the long footnote's last line.
        expect(doc.lines[at - 1].trim()).toBe("");
    });

    // Before the fix (2026-10-08): the inline footnote stays as it is, and the command is refused.
    it("Convert inline to normal appends a live definition after it", () => {
        const lines = ["The tendency[^1] is contested^[see Heinrich 2013] today.", "", `[^1]: ${longBody}`];
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        convertInlineFootnotesToNormal(fakePlugin(settings, doc), doc);
        expect(doc.lines[0]).toBe("The tendency[^1] is contested[^2] today.");
        expect(liveLabelLine(doc.lines, "2")).toBe(true);
    });

    it("control: with a short last footnote the numbered key appends right under it", async () => {
        const lines = ["The tendency of the rate of profit to fall[^1] is contested, and so is its cause.", "", "[^1]: Capital, vol. 3."];
        const ch = lines[0].indexOf(" and so");
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch } });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(["The tendency of the rate of profit to fall[^1] is contested,[^2] and so is its cause.", "", "[^1]: Capital, vol. 3.", "[^2]: "]);
    });
});
