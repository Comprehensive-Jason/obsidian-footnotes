import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";

// spec question: in "It was free!(sic)", should a press with the caret in
// "free" create a footnote, rather than refuse?
//
// What it does now: the press is refused with the protected-text toast,
// though the caret sits in plain prose. With placement "after", the
// landing spot is past the "!", where "![^1](sic)" would be an image, so
// the guard refuses.
// What a user might expect: a footnote that works, for example landing in
// front of the "!" ("free[^1]!(sic)"), which is live.
// Why it is a question and not a bug: refusing is safe, and the guard did
// stop the press from building an image (the lint does build one, which
// is the bug in bug-placement-after-builds-image). Where the press should
// land instead is a design choice.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L8.
//
// Source of truth: spec-image-alt-reference (resolved in Reading view
// 2026-09-16: a reference inside an image's alt text is dead).

// The names of the live references on `line` of `text`, as the plugin reads them.
function liveNames(text: string, line = 0): string[] {
    const lines = text.split("\n");
    const masked = maskProtectedLines(lines, scanDocument(lines));
    return referenceOccurrences(lines[line], masked[line]).map((o) => o.name);
}

describe("spec question: a press next to '!(...)'", () => {
    it.fails("press in 'free' of 'It was free!(sic)' creates a live footnote", async () => {
        const doc = fakeEditor(["It was free!(sic)"], { cursor: { line: 0, ch: 9 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(
            fakePlugin({ insertAtEndOfWord: true, enablePopupEditor: false, enableFootnotePrefix: false, enableFootnoteSectionHeading: false }, doc),
        );
        expect(liveNames(doc.lines.join("\n"))).toEqual(["1"]);
    });
});
