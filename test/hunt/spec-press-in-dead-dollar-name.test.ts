import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { simulateChanges } from "../../src/editor/insertion-liveness";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question: when the caret sits in reference-shaped text that reads
// dead because a "$" in the typed name pairs into math, should a press
// refuse with a notice instead of writing a new footnote into its
// brackets?
//
// What it does now: two carets, one between "$" and "5" of "$5 or $6
// alpha", one on the blank line under it. The named key plants "[^]" at
// both, and the user types the name "$start" (a "$" is a legal name
// character). The "$" already in front of the first "[^" now pairs with the
// typed "$" into inline math, so neither "[^$start]" is a footnote any
// more (live Obsidian 1.14.4: no references there). A second press finds
// no reference at either caret and plants a fresh "[^]" inside each dead
// shape: "$[^$start[^]]5 or $6 alpha" and "[^$start[^]]", with no notice.
// A single caret before the "]" of "$[^$start]" and the numbered key give
// "$[^$start[^1]]5 or more", again with no notice.
// What a user might expect: the press says why the name cannot work, as
// it does for other reference-shaped text that cannot work, and writes
// nothing into the brackets.
// Why it is a question and not a bug: the text is not a footnote, as far
// as Obsidian reads it, so writing one there is not plainly wrong; and the
// trouble starts with a legal name the user typed.
//
// This is the random case behind seed -581674678 of
// test/command-properties.test.ts's "FULL MULTI-CARET NAMED flow", which
// keeps failing the full suite now and then. That property expects "edits
// nothing" from the second press, but it foresaw only one dead reference;
// here both are dead.
//
// Options:
//   (a) refuse with the born-dead notice when the caret sits in a
//       reference shape with a valid name that reads dead (recommended:
//       the cascade already says why a name cannot work rather than
//       writing into its brackets);
//   (b) keep the plugin as it is and widen the property to allow a press
//       in a shape it reads as dead.
// The tests below take option (a).
//
// Hunt 2026-10-06, cycle 3, lens press. Cluster P1.
//
// Origin: pre-existing (cec4352 does the same).
//
// Source of truth: referenceOccurrenceAtCursor in src/parsing/doc-context.ts
// ("the user plainly meant one, and the cascade says why the name cannot
// work rather than writing a new footnote into its brackets"); CONTEXT.md,
// "Nested footnote: prevented plugin-wide".

const Settings = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

describe("spec question: a typed name whose '$' pairs with a '$' in front of the reference", () => {
    it.fails("multi-caret named flow: the second press does not write a placeholder into the typed references", async () => {
        const lines = ["$5 or $6 alpha", "", "end"];
        const doc = fakeEditor([...lines], { carets: [{ line: 0, ch: 1 }, { line: 1, ch: 0 }], edits: true, wholeDoc: true, words: true });
        await insertNamedFootnote(fakePlugin(Settings, doc));
        expect(doc.lines.slice(0, 2)).toEqual(["$[^]5 or $6 alpha", "[^]"]);
        // Typing "$start" once: CodeMirror repeats it at every caret.
        const typed = simulateChanges(doc.lines, [
            { from: { line: 0, ch: 3 }, text: "$start" },
            { from: { line: 1, ch: 2 }, text: "$start" },
        ]);
        expect(typed.slice(0, 2)).toEqual(["$[^$start]5 or $6 alpha", "[^$start]"]);
        const doc2 = fakeEditor([...typed], { carets: [{ line: 0, ch: 9 }, { line: 1, ch: 8 }], edits: true, wholeDoc: true, words: true });
        await insertNamedFootnote(fakePlugin(Settings, doc2));
        // Whatever the press does, it never writes a new "[^" inside the
        // brackets of the name the user just typed.
        expect(doc2.lines.join("\n")).not.toContain("[^$start[^");
    });

    // Now: "$[^$start[^1]]5 or more" plus "[^1]: ", no notice.
    it.fails("single caret: a press before the ']' of '$[^$start]' does not write a footnote into its brackets", async () => {
        const lines = ["$[^$start]5 or more", ""];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 9 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines[0]).not.toContain("[^$start[^");
        expect(messages().length === 0 && doc.lines[0] !== lines[0]).toBe(false);
    });
});
