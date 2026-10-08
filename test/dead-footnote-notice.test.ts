import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "./helpers/notices";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { selectionPressHandled } from "../src/commands/selection-footnote";
import { refusedCreation } from "../src/commands/create-footnote";
import { DeadFootnoteNotice } from "../src/editor/notice";
import { ProtectedCreationNotice } from "../src/editor/insertion-liveness";

// The result gate's reason "dead" (something the press meant to create
// that Obsidian would not read as a footnote, for no reason a more
// particular notice names: not protected text, not a link) gets its own
// notice (Jason's ruling 7, cycle 6 rulings, 2026-10-08). It borrowed the
// protected-text notice, which named code or math that was not there:
// in a note whose last footnote ran over 1,024 characters, every press was
// refused as "protected text" (hunt 2026-10-08, cycle 6, cluster Z8).

beforeEach(resetNotices);

describe("the notice for a creation Obsidian would not read as a footnote", () => {
    it("says so in its own words", () => {
        expect(DeadFootnoteNotice).toBe("No footnote was created: Obsidian wouldn't read it as a footnote here.");
    });

    it("is what a press refused for the reason dead shows", () => {
        expect(refusedCreation({ pass: false, reason: "dead", check: 6, detail: "" })).toBe(true);
        expect(messages()).toEqual([DeadFootnoteNotice]);
    });

    it("is what a selection gets when an escape would swallow its inline footnote", () => {
        // "x\^[abc]": the backslash escapes the caret, so no inline
        // footnote is read; there is no code or math in the way
        const before = ["x\\abc"];
        const doc = fakeEditor(before, { cursor: { line: 0, ch: 5 }, selection: { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 5 } }, edits: true, wholeDoc: true });
        selectionPressHandled(fakePlugin({}, doc), doc, null, "inline");
        expect(doc.lines).toEqual(before);
        expect(messages()).toEqual([DeadFootnoteNotice]);
    });

    it("control: a press refused for protected text keeps the protected-text notice", () => {
        expect(refusedCreation({ pass: false, reason: "protected", check: 6, detail: "" })).toBe(true);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });
});
