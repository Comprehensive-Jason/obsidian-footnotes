import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (annoyance): a press is refused as if it would make a definition
// label where none can form.
//
// What the user would see: a heading starts with an emoji shortcode,
// "# :rocket: Launch plan". With the caret at the start of the heading's
// text, the numbered key (or the named key) is refused with the
// block-syntax notice, because "[^1]:" would start the line's text. But
// a heading is no place for a definition: "# [^1]:rocket: Launch plan" is
// a heading with a live reference. The same false refusal happens on a
// paragraph's second line indented 4 spaces ("para" / "    :x done"):
// "    [^1]:x done" there is paragraph text with a live reference.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P5.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: "# [^1]:rocket:
// Launch plan" is a heading with a live [^1] at column 2. For the
// 4-space line, Obsidian's saved answers probe:h1|dash|lazy|s4 (a
// "[^1]: def" 4 spaces in on a lazy line is a live reference, no
// definition) and fuzz:20261003-314. The ruling in force (round-2 hunt
// brief, Jason 2026-10-05): a press refuses with the block-syntax notice
// when its new reference would read as a definition label; these would
// not. Each test first checks that the plugin's reader and the lint read
// the written result the same way.
//
// Cause: the "label" verdict (pressLineVerdict and startsLabel in
// src/editor/insertion-liveness.ts) refuses any "[^1]" followed by ":" at
// the line's text start, measured with blockSyntaxEnd, which for a
// heading is after "# ", and it takes any indent, where a label line
// takes at most 3 spaces (label-shapes.ts).

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

describe("a heading's text starting with ':'", () => {
    it.fails("numbered key at the heading's text start writes the footnote", async () => {
        // The written result is a heading with a live reference, which the lint leaves alone.
        const written = ["# [^1]:rocket: Launch plan", "", "[^1]: "];
        const reading = readNote(written);
        expect(reading.referencesOn(0).map((r) => [r.name, r.start])).toEqual([["1", 2]]);
        expect(reading.definitions.map((d) => d.name)).toEqual(["1"]);
        expect(fixLazyDefinitions(written.join("\n"))).toBe(written.join("\n"));

        const lines = ["# :rocket: Launch plan"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 2 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        // Today: unchanged, with the block-syntax notice.
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("# [^1]:rocket: Launch plan");
    });

    it.fails("named key at the heading's text start writes the placeholder", async () => {
        const lines = ["## :rocket: Launch plan"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 3 }, edits: true, wholeDoc: true, words: true });
        await insertNamedFootnote(fakePlugin(Settings, doc));
        // Today: unchanged, with the block-syntax notice.
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("## [^]:rocket: Launch plan");
    });
});

describe("a 4-space-indented lazy line", () => {
    it.fails("numbered key at column 4 writes the footnote", async () => {
        // The written result reads a live reference, and the lint leaves it alone.
        const written = ["para", "    [^1]:x done", "", "[^1]: "];
        expect(readNote(written).referencesOn(1).map((r) => r.name)).toEqual(["1"]);
        expect(fixLazyDefinitions(written.join("\n"))).toBe(written.join("\n"));

        const lines = ["para", "    :x done"];
        const doc = fakeEditor([...lines], { cursor: { line: 1, ch: 4 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        // Today: unchanged, with the block-syntax notice.
        expect(messages()).toEqual([]);
        expect(doc.lines[1]).toBe("    [^1]:x done");
    });
});
