import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../src/commands/carry-footnotes-hooks";
import { deleteFootnote } from "../src/commands/delete-footnote";
import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../src/linting/linter";
import { removeEmptySectionHeading } from "../src/linting/rules/remove-empty-section-heading";

// A section heading that holds a comment, inline code, or HTML ("%%
// footnotes %%", "## `Notes`") is the settings' text, which the plugin
// writes and takes out on purpose. The result gate is told so, and does not
// take it for protected text an action changed (hunt 2026-10-08, cycle 6,
// cluster Z9). The press, the selection, Convert inline to normal, and the
// lint's gather are pinned by bug-section-heading-with-protected-text-refuses;
// these are the other actions that write the heading, and the tidy that
// takes an emptied one out (Remove empty section heading, Jason's ask,
// 2026-09-25), found while fixing. Each has the "# Footnotes" control.

const headings = [["# Footnotes"], ["%% footnotes %%"], ["## `Notes`"]];

function settings(heading: string) {
    return {
        insertAtEndOfWord: false,
        enablePopupEditor: false,
        enableFootnotePrefix: false,
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: heading,
        enableRemoveBlankLastLines: true,
        lintOnFootnoteCreation: false,
        carryFootnotesOnCopy: true,
        removeEmptySectionHeading: true,
    };
}

/** A clipboard event holding `text`, recording what a cut writes into it. */
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe.each(headings)("the actions that write the section heading '%s'", (heading) => {
    it("the numbered key at two carets writes it above the first footnote", async () => {
        const doc = fakeEditor(["alpha bravo", "delta echo"], { carets: [{ line: 0, ch: 5 }, { line: 1, ch: 5 }], edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(settings(heading), doc));
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["alpha[^1] bravo", "delta[^1] echo", "", heading, "", "[^1]: "]);
    });

    it("a paste carrying a definition writes it above the first footnote", () => {
        const doc = editor(["p"], { line: 0, ch: 1 });
        handlePaste(fakePlugin(settings(heading), doc), clipboardEvent("c[^7]\n\n[^7]: seven") as never, doc);
        expect(doc.lines).toEqual(["pc[^7]", "", heading, "", "[^7]: seven"]);
    });
});

describe.each(headings)("the tidy that takes the emptied section heading '%s' out", (heading) => {
    it("the rule itself", () => {
        expect(removeEmptySectionHeading(`Text here.\n\n${heading}\n`, heading)).toBe("Text here.");
    });

    it("after Delete footnote everywhere takes the last footnote", async () => {
        const doc = editor(["a[^n] b", "", heading, "", "[^n]: n"], { line: 0, ch: 3 });
        await deleteFootnote(fakePlugin(settings(heading), doc));
        expect(doc.lines).toEqual(["a b"]);
    });

    it("at the end of a lint that deletes the last orphaned definition", () => {
        const note = `Body.\n\n${heading}\n\n[^1]: orphan`;
        expect(lintFootnotes(note, { sectionHeading: heading, removeOrphanedDefinitions: true, removeEmptySectionHeading: true })).toBe("Body.");
    });
});

/** Cuts "a[^1] " out of a note whose only footnote sits under the section heading `heading`. */
function cutLastFootnote(heading: string) {
    const doc = editor(["a[^1] b", "", heading, "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 6 });
    handleCut(fakePlugin(settings(heading), doc), clipboardEvent() as never);
    return doc;
}

describe("the tidy after a cut takes the last footnote", () => {
    it("control: '# Footnotes' goes with it", () => {
        expect(cutLastFootnote("# Footnotes").lines).toEqual(["b"]);
    });

    // Not fixed here: the cut judges its whole result, the tidy's included,
    // without saying it takes the heading out (planCut in
    // src/commands/carry-footnotes.ts, another fix group's file in this
    // cycle), so the whole cut is refused and nothing is cut.
    it.fails.each([["%% footnotes %%"], ["## `Notes`"]])("'%s' goes with it", (heading) => {
        expect(cutLastFootnote(heading).lines).toEqual(["b"]);
    });
});
