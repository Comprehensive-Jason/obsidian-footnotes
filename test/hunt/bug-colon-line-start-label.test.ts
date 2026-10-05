import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";

// BUG (wrong output): a press at the start of a line that begins with ":"
// writes a definition label instead of a reference.
//
// What the user would see: a line starts with a colon, such as an emoji
// shortcode ":smile: done". With the caret at column 0 there is no word
// to land after, so the press writes there, and "[^x]" followed by ":"
// is a definition's label (its "[^x]:" head), not a reference. With the
// named key, the "[^]" placeholder is written, and once the user types a
// name the line becomes the definition "[^x]: smile: done", with no
// reference anywhere. Under a paragraph, the numbered key writes
// "[^1]: smile: done" as a lazy line (a line Obsidian folds into the
// paragraph above, so its "[^1]" reads as a reference); the next lint's
// Fix lazy definitions rule, on by default, then turns it into a second
// "[^1]:" definition, and the footnote has no reference left.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF6.
//
// Source of truth: sheet 14 (a label directly under a line of prose is
// lazy, and live to Obsidian as a reference); the promise that a press
// makes a footnote, which is a reference with its definition.
//
// Cause: the check that a new footnote is born live looks at the
// reference the press writes, but an empty "[^]" placeholder is no label
// yet, and a lazy "[^1]:" line counts as live. Neither check sees that
// the ":" already on the line turns the reference into a label.
//
// The refusal the numbered key gives after a blank line, with the
// protected-text toast, is pinned on its own as a wording question
// (spec-colon-line-start-notice).

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

describe("a press at column 0 in front of a line-initial colon", () => {
    it.fails("the named key's placeholder, once named, reads as a reference (it is refused like the numbered key otherwise)", async () => {
        const lines = [":smile: done"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertNamedFootnote(fakePlugin(Settings, doc));
        if (doc.lines[0] === lines[0]) return; // refused: fine
        // The user types a name into the placeholder.
        const named = [doc.lines[0].replace("[^]", "[^x]"), ...doc.lines.slice(1)];
        const reading = readNote(named);
        // Today: ["x"], the line is a definition.
        expect(reading.definitions.map((d) => d.name)).toEqual([]);
        expect(reading.referencesOn(0).map((r) => r.name)).toEqual(["x"]);
    });

    it.fails("under a paragraph the reference survives the default lint's Fix lazy definitions", async () => {
        const lines = ["para", ":smile: done"];
        const doc = fakeEditor([...lines], { cursor: { line: 1, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        if (doc.lines[1] === lines[1]) return; // refused: fine
        const linted = fixLazyDefinitions(doc.lines.join("\n")).split("\n");
        const reading = readNote(linted);
        // Today: [], no live reference is left.
        expect(reading.references.filter((r) => r.live).map((r) => r.name)).toEqual(["1"]);
        expect(reading.definitions.map((d) => d.name)).toEqual(["1"]);
    });
});
