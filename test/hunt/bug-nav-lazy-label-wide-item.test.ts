import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { addReferenceOrDeleteDefinition } from "../../src/editor/notice";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// bug: a press on a lazy label at the content column of a nested or wide
// list item does not navigate, as it does for a lazy label in a plain item.
//
// Scenario: "- parent", "  - child", "    [^b]: lazy in child", or
// "10. item", "    [^b]: lazy", with "Use[^b] here." above. The label is a
// lazy one: Obsidian reads it as more of the item's paragraph, and a blank
// line above would make it a definition in its item.
//
// What it does now: a press inside the label's brackets appends a new
// "[^b]: " definition at the bottom of the note, and a press at the end of
// the label's text writes a new footnote there, "lazy in child[^1]".
// What it should do: what it does for "- item", "  [^b]: lazy": the press
// treats the label as the definition the user meant and jumps to the
// footnote's reference in the text, or, when nothing references it, says
// so and changes nothing (Jason's ruling, 2026-09-15; spec
// spec-lazy-label-press-navigates).
//
// Cause: shouldJumpFromDefinitionToReference (src/commands/navigation.ts)
// read a lazy label's shape from the note's margin (definitionLabelWithName),
// where a label four spaces in is no label. Since 9dc04b1, labelShapedLines
// reads it from where the line's containers end.
//
// Hunt 2026-10-05, cluster CN3 (follow-up to 9dc04b1 and 1338f03).
//
// Source of truth: the plain-item controls below, and the ruling above.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

const Notes = [
    { item: "a plain item (control)", lines: ["Use[^b] here.", "", "- item", "  [^b]: lazy in item"] },
    { item: "a nested item", lines: ["Use[^b] here.", "", "- parent", "  - child", "    [^b]: lazy in child"] },
    { item: "a wide ordered item", lines: ["Use[^b] here.", "", "10. item", "    [^b]: lazy in a wide ordered item"] },
];

const Keys = [
    ["the numbered key", insertAutonumFootnote],
    ["the named key", insertNamedFootnote],
] as const;

beforeEach(() => {
    resetNotices();
});

describe.each(Notes)("a lazy label in $item", ({ lines }) => {
    const labelLine = lines.length - 1;
    const carets = [
        ["inside the label's brackets", { line: labelLine, ch: lines[labelLine].indexOf("[^b]") + 2 }],
        ["at the end of the label's text", { line: labelLine, ch: lines[labelLine].length }],
    ] as const;

    for (const [where, cursor] of carets) {
        for (const [key, press] of Keys) {
            it(`${key}, caret ${where}: jumps to the reference and writes nothing`, async () => {
                const doc = fakeEditor([...lines], { cursor, edits: true, wholeDoc: true, words: true });
                await press(fakePlugin(Settings, doc));
                expect(doc.lines).toEqual(lines);
                expect(doc.moves).toEqual([{ line: 0, ch: "Use[^b]".length }]);
                expect(messages()).toEqual([]);
            });
        }
    }

    it("with nothing referencing it, the press says so and writes nothing", async () => {
        const alone = lines.slice(2);
        const doc = fakeEditor([...alone], {
            cursor: { line: alone.length - 1, ch: alone[alone.length - 1].length },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines).toEqual(alone);
        expect(doc.moves).toEqual([]);
        expect(messages()).toEqual([`Nothing references this footnote. ${addReferenceOrDeleteDefinition("b")}`]);
    });
});
