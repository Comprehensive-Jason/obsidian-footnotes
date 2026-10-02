import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal, convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

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
