import { describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes, LintOptions } from "../src/linting/linter";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";

// Checks lifted off the retired manual sheet "Section heading already in the
// note" (prune of 2026-09-20). The sheet's shape: the user typed their own
// "# Footnotes" heading in the MIDDLE of a note, with a definition under
// it, prose after it, and a stray definition sitting above it (issue #55,
// fixed 2026-08-05).
//
// Replaced here: all four checkboxes. A new footnote's definition joins
// the section instead of starting a second one at the end of the file, a
// blank line keeps the prose below out of the footnote, the lint pulls the
// stray definition DOWN under the heading and renumbers it on the way, and
// a second lint finds nothing left to do.

const NOTE = [
    /* 0 */ "Insert into this sentence for the insertion checks.",
    /* 1 */ "",
    /* 2 */ "[^9]: nine",
    /* 3 */ "",
    /* 4 */ "# Footnotes",
    /* 5 */ "",
    /* 6 */ "[^1]: an existing definition under the user's own heading",
    /* 7 */ "",
    /* 8 */ "Prose after the section, so the heading is not at the end of the note. A reference to the existing footnote[^1] keeps it alive, and a stray reference here[^9] has its definition above the heading.",
];

const AFTER_THIS = NOTE[0].indexOf("this") + "this".length;

const SETTINGS = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: true,
    footnoteSectionHeading: "# Footnotes",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

/** the sheet's "all lint rules ON", as the pure linter's options */
const ALL_RULES_ON: LintOptions = {
    sectionHeading: "# Footnotes",
    fixPunctuation: true,
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: true },
    removeOrphanedReferences: true,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: true,
    applyNotePrefix: false,
};

describe("inserting while the heading sits mid-note", () => {
    it("the new definition joins the section under the heading, and the prose below keeps its blank line", async () => {
        const doc = fakeEditor(NOTE, {
            cursor: { line: 0, ch: AFTER_THIS },
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(SETTINGS, doc));
        expect(doc.lines).toEqual([
            "Insert into this[^10] sentence for the insertion checks.",
            "",
            "[^9]: nine",
            "",
            "# Footnotes",
            "",
            "[^1]: an existing definition under the user's own heading",
            "[^10]: ",
            "",
            NOTE[8],
        ]);
        // no second "# Footnotes" was added anywhere, least of all at the end
        expect(doc.lines.filter((line) => line === "# Footnotes")).toHaveLength(1);
    });
});

describe("linting the fixture", () => {
    it("the stray definition moves down under the heading and is renumbered on the way", () => {
        expect(lintFootnotes(NOTE.join("\n"), ALL_RULES_ON).split("\n")).toEqual([
            "Insert into this sentence for the insertion checks.",
            "",
            "# Footnotes",
            "",
            "[^1]: an existing definition under the user's own heading",
            "[^2]: nine",
            "",
            "Prose after the section, so the heading is not at the end of the note. A reference to the existing footnote[^1] keeps it alive, and a stray reference here[^2] has its definition above the heading.",
        ]);
    });

    it("a second lint leaves the note alone, which is what 'No linting needed.' means", () => {
        const once = lintFootnotes(NOTE.join("\n"), ALL_RULES_ON);
        expect(lintFootnotes(once, ALL_RULES_ON)).toBe(once);
    });
});
