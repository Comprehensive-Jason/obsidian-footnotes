import { describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes, LintOptions } from "../src/linting/linter";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";

// Checks lifted off the retired manual sheet "Divider heading already in the
// note" (prune of 2026-09-20). Same shape as the heading-already-in-the-note tests, but the user's own
// footnote section is a two-line pair: a "---" divider and a "## Footnotes"
// heading, sitting in the MIDDLE of the note with prose after it and a
// stray definition above it.
//
// Replaced here: all four checkboxes. A new footnote's definition joins
// the section instead of starting a second pair at the end of the file, a
// blank line keeps the prose below out of the footnote, the lint pulls the
// stray definition DOWN under the pair and renumbers it on the way, and a
// second lint finds nothing left to do.

const HEADING = "---\n## Footnotes";

const NOTE = [
    /* 0 */ "Insert into this sentence for the insertion checks.",
    /* 1 */ "",
    /* 2 */ "[^9]: nine",
    /* 3 */ "",
    /* 4 */ "---",
    /* 5 */ "## Footnotes",
    /* 6 */ "",
    /* 7 */ "[^1]: an existing definition under the user's own pair",
    /* 8 */ "",
    /* 9 */ "Prose after the section, so the pair is not at the end of the note. A reference to the existing footnote[^1] keeps it alive, and a stray reference here[^9] has its definition above the pair.",
];

const AFTER_THIS = NOTE[0].indexOf("this") + "this".length;

const SETTINGS = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: true,
    footnoteSectionHeading: HEADING,
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

/** the sheet's "all lint rules ON", as the pure linter's options */
const ALL_RULES_ON: LintOptions = {
    sectionHeading: HEADING,
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

describe("inserting while the divider pair sits mid-note", () => {
    it("the new definition joins the section under the pair, and the prose below keeps its blank line", async () => {
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
            "---",
            "## Footnotes",
            "",
            "[^1]: an existing definition under the user's own pair",
            "[^10]: ",
            "",
            NOTE[9],
        ]);
        // no second divider and no second heading, least of all at the end
        expect(doc.lines.filter((line) => line === "---")).toHaveLength(1);
        expect(doc.lines.filter((line) => line === "## Footnotes")).toHaveLength(1);
    });
});

describe("linting the fixture", () => {
    it("the stray definition moves down under the pair and is renumbered on the way", () => {
        expect(lintFootnotes(NOTE.join("\n"), ALL_RULES_ON).split("\n")).toEqual([
            "Insert into this sentence for the insertion checks.",
            "",
            "---",
            "## Footnotes",
            "",
            "[^1]: an existing definition under the user's own pair",
            "[^2]: nine",
            "",
            "Prose after the section, so the pair is not at the end of the note. A reference to the existing footnote[^1] keeps it alive, and a stray reference here[^2] has its definition above the pair.",
        ]);
    });

    it("a second lint leaves the note alone, which is what 'No linting needed.' means", () => {
        const once = lintFootnotes(NOTE.join("\n"), ALL_RULES_ON);
        expect(lintFootnotes(once, ALL_RULES_ON)).toBe(once);
    });
});
