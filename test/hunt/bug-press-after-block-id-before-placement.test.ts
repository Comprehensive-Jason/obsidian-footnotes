import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import type { FootnotePlacement } from "../../src/parsing/landing";

// BUG (wrong output): under Before, a press at the very end of a line that
// ends with a block id, "Oysters filter water. ^water1|" (where End puts the
// caret), landed after the sentence's stop: "Oysters filter water.[^1]
// ^water1", and the next lint moved it. The block-id step ran after the
// hop-back, so the hop-back looked behind a caret that touched no
// punctuation. A caret just in front of the id already hopped.
//
// What the user sees now: "Oysters filter water[^1]. ^water1", the same as a
// press in front of the id, and the lint leaves it. The abbreviation rule
// still holds there: "the U.S. ^id1|" gives "the U.S.[^1] ^id1".
//
// Hunt 2026-11-06, cycle 9, finding H19. Source of truth: Jason's hop-back
// ruling of 2026-11-05 ("A word.|" gives "A word[^1]." under Before) and
// pin bug-press-after-block-id (the id stays at the line's end). Severity:
// wrong output. Origin: pre-existing.

const Settings = { insertAtEndOfWord: true, enablePopupEditor: false, enableFootnotePrefix: false, enableFootnoteSectionHeading: false, lintOnFootnoteCreation: false };

/** The first line after the numbered key at "|" of `marked`, under `placement`. */
async function press(marked: string, placement: FootnotePlacement) {
    const ch = marked.indexOf("|");
    const doc = fakeEditor([marked.replace("|", "")], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...Settings, footnotePlacement: placement }, doc));
    return doc;
}

describe("Before: a press after a block id hops back over the sentence's stop", () => {
    beforeEach(resetNotices);

    it.each([
        ["Oysters filter water. ^water1|", "Oysters filter water[^1]. ^water1"],
        ["这是句子。 ^id1|", "这是句子[^1]。 ^id1"],
        ["- A word. ^id1|", "- A word[^1]. ^id1"],
        ["Vraiment ? ^id1|", "Vraiment[^1] ? ^id1"],
        // the caret at the id's own characters lands the same way
        ["Oysters filter water. ^wat|er1", "Oysters filter water[^1]. ^water1"],
        // an abbreviation's own dot keeps the reference behind it
        ["in the U.S. ^id1|", "in the U.S.[^1] ^id1"],
        // a line with no punctuation in front of the id: in front of the id, as before
        ["Oysters filter water ^water1|", "Oysters filter water[^1] ^water1"],
    ])("%s gives %s, and the lint leaves it", async (marked, expected) => {
        const doc = await press(marked, "before");
        expect(doc.lines[0]).toBe(expected);
        expect(footnoteAfterPunctuation(doc.lines.join("\n"), "before").split("\n")[0]).toBe(expected);
    });

    it("control: a caret in front of the id already hopped", async () => {
        expect((await press("Oysters filter water.| ^water1", "before")).lines[0]).toBe("Oysters filter water[^1]. ^water1");
    });

    it("control: After and Don't move land in front of the id, after the stop", async () => {
        expect((await press("Oysters filter water. ^water1|", "after")).lines[0]).toBe("Oysters filter water.[^1] ^water1");
        expect((await press("Oysters filter water. ^water1|", "none")).lines[0]).toBe("Oysters filter water.[^1] ^water1");
    });
});
