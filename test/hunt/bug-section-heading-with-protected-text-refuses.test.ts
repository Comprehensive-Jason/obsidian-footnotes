import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output): with Enable section heading on, a heading text that
// holds a comment, inline code, or HTML stops every first footnote of a
// note from being created.
//
// What the user would see: the section heading set to "%% footnotes %%",
// "# Footnotes <!-- fn -->", "## `Notes`", or "# Footnotes %%fn%%". In a
// note with no footnotes yet, a press of the numbered key with the caret
// in plain prose is refused with "No footnote was created: footnotes
// can't go inside code, math, or other protected text." A selection
// converted with the numbered key is refused with "No footnote was
// created: the selection cuts through code, math, or other protected text.
// Select all of it or none of it.", Convert inline footnotes to normal
// refuses the note, and the lint leaves a definition where it is instead
// of gathering it under the heading. With
// "# Footnotes" all of these work.
//
// "Protected text" is code, math, comments, HTML, and frontmatter, where
// footnote syntax is plain text. The "result gate" is the one check every
// edit passes before it is written: the note after must read the same as
// the note before, except for what the edit meant to change.
//
// Hunt 2026-10-08, cycle 6. Cluster Z9.
//
// Origin: regression. The press and the selection from 99d4e6d, Convert
// inline to normal from 728d226, and the lint's gather from 7790b9f, the
// three commits where the result gate took over each of them.
//
// Source of truth: README, Enable section heading ("automatically adds a
// heading (e.g. `# Footnotes`) above your footnote definitions. The heading
// text is fully customizable, can span multiple lines"); and the README's
// list of where footnotes are never created, which the caret here is in
// none of. The controls with "# Footnotes" show the intended result.
//
// Cause: the gate's check 3 asks that the protected text reads the same
// before and after. The heading's own comment, code, or HTML is protected
// text the edit writes, but the edit does not tell the gate it writes it,
// so check 3 counts it as protected text that changed and refuses.
//
// The probe's "<!-- footnotes -->" heading is left out: it fails for a
// different reason, and that failure is pre-existing.

const note = ["Text with a word here", "", "Last paragraph."];

function settings(heading: string) {
    return {
        insertAtEndOfWord: true,
        footnotePlacement: "after" as const,
        enablePopupEditor: false,
        enableFootnotePrefix: false,
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: heading,
        enableRemoveBlankLastLines: true,
        lintOnFootnoteCreation: false,
    };
}

/** Presses the numbered key at the end of "here" with the section heading `heading`. */
async function press(heading: string) {
    const doc = fakeEditor(note, { cursor: { line: 0, ch: 21 }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(settings(heading), doc));
    return doc;
}

beforeEach(resetNotices);

describe("a press under a section heading that holds protected text", () => {
    it("control: '# Footnotes' takes the first footnote", async () => {
        const doc = await press("# Footnotes");
        expect(doc.lines).toEqual(["Text with a word here[^1]", "", "Last paragraph.", "", "# Footnotes", "", "[^1]: "]);
        expect(messages()).toEqual([]);
    });

    // Now: the note is unchanged and the protected-text notice shows.
    it.fails.each([["# Footnotes <!-- fn -->"], ["%% footnotes %%"], ["## `Notes`"], ["# Footnotes %%fn%%"]])(
        "'%s' takes the first footnote too, with no notice",
        async (heading) => {
            const doc = await press(heading);
            expect(messages()).toEqual([]);
            expect(doc.lines).toEqual(["Text with a word here[^1]", "", "Last paragraph.", "", heading, "", "[^1]: "]);
        },
    );
});

describe("the other commands that write the section heading", () => {
    // Now: the note is unchanged, and the notice says the selection cuts
    // through protected text.
    it.fails("a selection converted with the numbered key, under '%% footnotes %%'", async () => {
        const doc = fakeEditor(note, {
            cursor: { line: 0, ch: 21 },
            selection: { anchor: { line: 0, ch: 17 }, head: { line: 0, ch: 21 } },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(settings("%% footnotes %%"), doc));
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["Text with a word[^1]", "", "Last paragraph.", "", "%% footnotes %%", "", "[^1]: here"]);
    });

    // Now: the command is refused and the inline footnote stays.
    it.fails("Convert inline footnotes to normal, under '%% footnotes %%'", () => {
        const lines = ["Text^[a note] here", "", "Last paragraph."];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 0 }, edits: true, wholeDoc: true });
        const result = convertInlineFootnotesToNormal(fakePlugin({ ...settings("%% footnotes %%"), footnoteNaming: "keep" }, doc), doc);
        expect(result.refused).toBeFalsy();
        expect(doc.lines).toEqual(["Text[^1] here", "", "Last paragraph.", "", "%% footnotes %%", "", "[^1]: a note"]);
    });
});

describe("the lint's gather under the section heading", () => {
    const linted = "Text[^1] here.\n\n[^1]: one\n\nMore text.";

    it("control: '# Footnotes' gathers the definition under it", () => {
        expect(lintFootnotes(linted, { sectionHeading: "# Footnotes" })).toBe("Text[^1] here.\n\nMore text.\n\n# Footnotes\n\n[^1]: one");
    });

    // Now: the lint changes nothing; the definition stays above "More text."
    // and no heading is written.
    it.fails.each([["%% footnotes %%"], ["# Footnotes <!-- fn -->"], ["## `Notes`"]])("'%s' gathers it too", (heading) => {
        expect(lintFootnotes(linted, { sectionHeading: heading })).toBe(`Text[^1] here.\n\nMore text.\n\n${heading}\n\n[^1]: one`);
    });
});
