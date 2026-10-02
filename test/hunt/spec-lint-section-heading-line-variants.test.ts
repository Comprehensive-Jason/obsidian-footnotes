import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// spec question: should a section heading line written slightly
// differently from the setting, but rendering the same, count as the
// existing heading?
//
// What it does now: with Section heading "# Footnotes", a note whose
// heading line is "# Footnotes " (a trailing space) or "# Footnotes #" (a
// closing hash) is not recognised. A new definition appended by a press, a
// conversion, or a carried paste brings a second "# Footnotes" heading
// with it.
// What a user might expect: the README says an existing heading "is reused
// instead of duplicated", and both lines render exactly as "# Footnotes"
// (CommonMark 4.2: trailing spaces and a closing run of "#" are not part
// of an ATX heading's text).
// Why it is a question and not a bug: the setting is a line of text, and
// matching it exactly is a defensible reading; a trailing space is
// invisible in the editor, which argues for trimming it, while a closing
// hash is a deliberate spelling. How loose the match should be is Jason's
// call. The setting-side twin (a setting value ending in a line break) is
// a confirmed bug: bug-settings-section-heading-trailing-newline.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster S2 (the note-line half).
//
// Source of truth: the README ("if it already exists in the note it's
// reused instead of duplicated") and CommonMark 4.2.

/** Convert the inline footnotes in `lines` with `settings`, returning the editor afterwards. */
function runInline(lines: string[], settings: Record<string, unknown>) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    convertInlineFootnotesToNormal(fakePlugin(settings, doc), doc);
    return doc;
}

const heading = { enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes" };

beforeEach(resetNotices);

describe("spec question: an existing section heading spelled slightly differently", () => {
    it.fails("a heading line with a trailing space is reused", () => {
        const doc = runInline(["a^[one]", "", "# Footnotes "], heading);
        // Today: ["a[^1]", "", "# Footnotes ", "", "# Footnotes", "", "[^1]: one"].
        expect(doc.lines.filter((l) => l.trim() === "# Footnotes")).toHaveLength(1);
    });

    it.fails("a heading with a closing hash sequence is reused", () => {
        const doc = runInline(["a^[one]", "", "# Footnotes #"], heading);
        // Today: "# Footnotes #" and a second "# Footnotes".
        expect(doc.lines.filter((l) => l.startsWith("# Footnotes"))).toHaveLength(1);
    });
});
