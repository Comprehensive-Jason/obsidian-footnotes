import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// The MAIN-editor end-of-word hop on CJK text. The plugin has two
// end-of-word implementations: endOfWordOffset (cells and selection
// expansion, unicode-aware and well covered) and adjustFootnotePosition,
// which asks Editor.wordAt - and the shared fake's wordAt was ASCII-only,
// so under it a CJK caret returned null and this branch was skipped
// entirely; nothing could observe the two paths diverging (review D2,
// 2026-09-09). The fake is unicode-aware now, and this spec pins the hop:
// mid-word in 中文句子 lands the reference after the word AND past the
// fullwidth stop, exactly like the Latin case (the manual numbered-footnotes tests).

describe("end-of-word insertion on CJK text through the main editor", () => {
    it("hops to the end of the word and past the fullwidth stop", async () => {
        const doc = fakeEditor(["中文句子。 more"], {
            cursor: { line: 0, ch: 2 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: true,
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    enableFootnoteSectionHeading: false,
                    enableRemoveBlankLastLines: true,
                },
                doc,
            ),
        );
        expect(doc.lines[0]).toBe("中文句子。[^1] more");
    });
});
