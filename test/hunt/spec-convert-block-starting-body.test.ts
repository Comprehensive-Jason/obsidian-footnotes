import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal, convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// spec question: what should the convert commands do with a footnote whose
// text starts like a block, such as a heading ("# ") or a list item ("- ")?
//
// What it does now: normal to inline flattens it. "[^h]: # A heading
// starts this body" becomes "^[# A heading starts this body]", and the
// heading turns into plain text with a "#" in front. Inline to normal does
// the opposite: "^[# not a heading]" becomes "[^1]: # not a heading", and
// the plain text turns into a heading inside the footnote.
// What a user might expect: a conversion keeps the text looking the same.
// Normal to inline could skip such a footnote with a reason, as it skips
// others that cannot be written inline. Inline to normal could escape the
// "#" ("\#") so the text stays plain.
// Why it is a question and not a bug: the converters' contract covers
// what can be expressed inline, and nobody has ruled on whether a
// leading "#" or "-" in a footnote's text counts as structure worth
// keeping, or as a rare shape not worth a refusal.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V7.
//
// Source of truth: manual sheet 04 records "[^h]: # A heading starts this
// definition's body" rendering as a heading inside the footnote. Inline
// content has no headings, so "^[# A heading]" is plain text.
//
// Hunt 2026-10-08, cycle 6, cluster Z7, added two cases with an ordered
// list: a German citation "2. Aufl., S. 34" ("2nd edition, page 34") put on
// a new definition's label line reads as a numbered list starting at 2,
// from Convert inline to normal and from the selection conversion alike.
// Source of truth for those: live answer c6:z7-ordered ("[^1]: 2. Aufl., S.
// 34" draws footnote 1 as an ordered list starting at 2, Obsidian 1.14.4
// on sprout, 2026-10-08) and docs/obsidian-reading-rules.md E2 (text on
// the label line is read as a block start like any other).

const convert = (lines: string[]) => convertNormalFootnotesToInline(lines.join("\n"));

// Runs the inline-to-normal command on a fake editor holding `lines`.
function run(lines: string[]) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
    return doc;
}

beforeEach(resetNotices);

describe("spec question: a footnote whose text starts like a block", () => {
    it.fails("normal to inline: a body that starts with a heading has no inline form and is skipped", () => {
        const r = convert(["x[^h]", "", "[^h]: # A heading starts this body"]);
        expect(r.converted).toBe(0);
    });

    it.fails("inline to normal: an inline body that starts with '# ' does not become a heading in the definition", () => {
        const doc = run(["a^[# not a heading]"]);
        const label = doc.lines.find((l) => l.startsWith("[^1]:")) ?? "";
        expect(label).not.toMatch(/^\[\^1\]: #+ /);
    });
});

// The cases below came from hunt cycle 6, cluster Z7. They add a numbered
// list to the heading above, and the selection conversion to the convert
// command. Either outcome passes: the footnote left as it was, or the
// text written so that its label line does not start like a block (for
// example "2\. Aufl.", with the period escaped).

/** A label line whose text starts with block syntax: an ordered or bullet list item, a quote, or a heading. */
const BlockOnLabelLine = /^\[\^[^\]]+\]:[ \t]+(?:\d{1,9}[.)][ \t]|[-+*][ \t]|>|#{1,6}[ \t])/;

describe("spec question: text that starts like a numbered list, moved onto a label line", () => {
    // Now: "[^1]: 2. Aufl., S. 34", a numbered list starting at 2.
    it.fails("inline to normal: a German edition citation keeps reading as plain text in its footnote", () => {
        const line = "Vgl. die Neuausgabe^[2. Aufl., S. 34] dazu.";
        const doc = run([line]);
        const unchanged = doc.lines.length === 1 && doc.lines[0] === line;
        if (!unchanged) {
            for (const written of doc.lines) expect(written).not.toMatch(BlockOnLabelLine);
        }
    });

    // Now: "[^1]: 2. Aufl., S. 34", as above.
    it.fails("the selection conversion: selecting '2. Aufl., S. 34' out of a sentence keeps it plain text in the footnote", async () => {
        const line = "Siehe dazu die 2. Aufl., S. 34 hier.";
        const selected = "2. Aufl., S. 34";
        const from = line.indexOf(selected);
        const doc = fakeEditor([line], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: from },
            selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: from + selected.length } },
        });
        await insertAutonumFootnote(fakePlugin({ enablePopupEditor: false, expandSelectionToWholeWords: false, lintOnFootnoteCreation: false }, doc));
        const unchanged = doc.lines.length === 1 && doc.lines[0] === line;
        if (!unchanged) {
            for (const written of doc.lines) expect(written).not.toMatch(BlockOnLabelLine);
        }
    });

    it("control: selecting 'S. 34' converts as plain text", async () => {
        const line = "Siehe dazu S. 34 hier.";
        const selected = "S. 34";
        const from = line.indexOf(selected);
        const doc = fakeEditor([line], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: from },
            selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: from + selected.length } },
        });
        await insertAutonumFootnote(fakePlugin({ enablePopupEditor: false, expandSelectionToWholeWords: false, lintOnFootnoteCreation: false }, doc));
        expect(doc.lines.at(-1)).toBe("[^1]: S. 34");
    });
});
