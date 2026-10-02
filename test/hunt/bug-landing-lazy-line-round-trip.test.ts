import { beforeEach, describe, expect, it } from "vitest";

import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
} from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): when a definition ends on a lazy continuation line, the
// press that jumped to it cannot jump back.
//
// What the user would see: the note has "Text[^1] here." and the
// definition "[^1]: body" with the line "lazy line" right under it, no
// blank line between. They press the key on the reference, and the caret
// lands at the end of "lazy line", as it should. They press again to go
// back, and get the "can't be nested" toast instead of a jump to the
// reference. With an indented continuation line the same round trip works.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R4.
//
// Source of truth: the round-trip bug of 2026-07-17 (a second press where
// the jump landed goes back to the reference), and Reading view: a plain
// line directly under a column-0 label is that definition's lazy
// continuation (c346ad6, 2026-09-16), so the jump lands on it.
//
// Cause: shouldJumpFromDefinitionToReference in src/commands/navigation.ts
// first runs a cheap check on the raw line, and only lets through a label
// line, an indented line, or a quoted line. An unindented, unquoted lazy
// line fails that check, so the press falls through to creating a
// footnote, and the creation guard refuses it as nested.

// The note: a definition whose block ends on an unindented lazy line.
const NOTE = ["Text[^1] here.", "", "[^1]: body", "lazy line"];

beforeEach(resetNotices);

describe("the round trip through a definition that ends on a lazy line", () => {
    for (const [name, cmd] of [
        ["numbered", insertAutonumFootnote],
        ["named", insertNamedFootnote],
        ["inline", insertInlineFootnote],
    ] as const) {
        it.fails(`${name} key: press on the reference, then again where it landed, comes back to the reference`, async () => {
            const doc = fakeEditor(NOTE, { cursor: { line: 0, ch: 6 }, edits: true, wholeDoc: true, words: true });
            const plugin = fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc);
            await cmd(plugin);
            expect(doc.cursor).toEqual({ line: 3, ch: "lazy line".length });
            resetNotices();
            await cmd(plugin);
            // Today: the toast "No footnote was created: footnotes can't be
            // nested inside other footnotes."
            expect(messages()).toEqual([]);
            expect(doc.cursor).toEqual({ line: 0, ch: "Text[^1]".length });
        });
    }

    it("control: the same round trip through an indented continuation line comes back", async () => {
        const lines = ["Text[^1] here.", "", "[^1]: body", "    indented line"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 6 }, edits: true, wholeDoc: true, words: true });
        const plugin = fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc);
        await insertAutonumFootnote(plugin);
        await insertAutonumFootnote(plugin);
        expect(doc.cursor).toEqual({ line: 0, ch: "Text[^1]".length });
    });
});
