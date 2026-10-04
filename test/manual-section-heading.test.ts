import { describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes, LintOptions } from "../src/linting/linter";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";

// Checks lifted off the retired manual sheet "Section heading" (prune of
// 2026-09-20). The sheet had a note with no footnotes at all, inserted
// twice, and then linted twice, once with the single-line heading
// "# Footnotes" and once with the two-line "---" + "## Footnotes".
//
// Replaced here: every checkbox on that sheet. The first footnote's
// heading was already pinned by test/section-header.test.ts; what was
// missing, and is written below, is the SECOND footnote (no second
// heading, the definition joins the first) and the two lints (the first
// changes nothing, so the second says "No linting needed.", which is what
// the plugin shows when a lint leaves the text alone).

// the sentence the sheet asks you to insert into, twice
const SENTENCE = "Insert into this sentence twice.";
const AFTER_THIS = SENTENCE.indexOf("this") + "this".length; // caret after "this"

/** the sheet's settings: heading on, blank-line trimming on, popup off */
function settings(heading: string) {
    return {
        insertAtEndOfWord: false,
        enablePopupEditor: false,
        enableFootnotePrefix: false,
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: heading,
        enableRemoveBlankLastLines: true,
        lintOnFootnoteCreation: false,
    };
}

/** the sheet's "all lint rules ON", as the pure linter's options */
function allRulesOn(heading: string): LintOptions {
    return {
        sectionHeading: heading,
        fixPunctuation: true,
        fixLazyDefinitions: true,
        moveDefinitionsToBottom: true,
        reindex: true,
        reindexOptions: { renumberNamedFootnotes: true },
        removeOrphanedReferences: true,
        removeOrphanedDefinitions: true,
        mergeDuplicateDefinitions: true,
        // the per-note prefix feature is off on this sheet, so the
        // apply-prefix rule cannot arm whatever its own toggle says
        applyNotePrefix: false,
    };
}

/** press the numbered hotkey twice, the way the sheet asks, and hand back the note */
async function insertTwice(heading: string): Promise<string[]> {
    const doc = fakeEditor([SENTENCE], {
        cursor: { line: 0, ch: AFTER_THIS },
        edits: true,
        wholeDoc: true,
    });
    const plugin = fakePlugin(settings(heading), doc);
    await insertAutonumFootnote(plugin);
    // the second press goes right after the reference the first one left
    doc.setCursor({ line: 0, ch: AFTER_THIS + "[^1]".length });
    await insertAutonumFootnote(plugin);
    return doc.lines;
}

describe("the single-line heading # Footnotes", () => {
    it("the first footnote makes the heading, the second joins it without a twin", async () => {
        expect(await insertTwice("# Footnotes")).toEqual([
            "Insert into this[^1][^2] sentence twice.",
            "",
            "# Footnotes",
            "",
            "[^1]: ",
            "[^2]: ",
        ]);
    });

    it("linting that note changes nothing, so a second lint has nothing to say", async () => {
        const note = (await insertTwice("# Footnotes")).join("\n");
        const options = allRulesOn("# Footnotes");
        const once = lintFootnotes(note, options);
        expect(once).toBe(note);
        expect(lintFootnotes(once, options)).toBe(once);
        // exactly one heading, ever (the bug of 2026-07-17 added one per lint)
        expect(once.split("\n").filter((line) => line === "# Footnotes")).toHaveLength(1);
    });
});

describe("the divider heading --- + ## Footnotes", () => {
    const HEADING = "---\n## Footnotes";

    it("the first footnote makes a blank line, the divider and the heading; the second joins it", async () => {
        expect(await insertTwice(HEADING)).toEqual([
            "Insert into this[^1][^2] sentence twice.",
            "",
            "---",
            "## Footnotes",
            "",
            "[^1]: ",
            "[^2]: ",
        ]);
    });

    it("linting that note changes nothing, so a second lint has nothing to say", async () => {
        const note = (await insertTwice(HEADING)).join("\n");
        const options = allRulesOn(HEADING);
        const once = lintFootnotes(note, options);
        expect(once).toBe(note);
        expect(lintFootnotes(once, options)).toBe(once);
        expect(once.split("\n").filter((line) => line === "---")).toHaveLength(1);
        expect(once.split("\n").filter((line) => line === "## Footnotes")).toHaveLength(1);
    });
});
