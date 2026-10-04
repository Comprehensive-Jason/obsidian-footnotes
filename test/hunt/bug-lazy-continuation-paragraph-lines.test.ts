// Imported from the GLM 5.3 Flash cycle 5 hunt of 2026-09-16 (OpenCode worktree); 5 of 7 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// GLM 5.3 Flash cycle 9 hunt of 2026-09-16 (this worktree); 5 red tests carry it.fails.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { FootnotePluginSettings } from "../../src/settings";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { readNote } from "../../src/parsing/note-reading";

// The block walker's lazyContinuation (src/parsing/markdown-scan.ts:2912)
// decides which lines a definition block owns. The RESOLVED spec question
// (spec-unverified-reading-view-shapes, SPEC 3, probed in Reading view
// 2026-09-16) established that a PLAIN line directly under a column-0
// definition is the definition's lazy continuation and the walker owns it.
// But lazyContinuation still classifies several lines as BLOCK STARTS that
// the same probes established are paragraph text - so the walker ends the
// definition at them, and Obsidian keeps reading them as the footnote's
// body:
//
// - "``` `x`"  - a backtick fence whose info string holds a backtick is no
//   fence (cycle 5, probed in Reading view); it is paragraph text. The SCAN
//   got that refinement (isFenceOpener, paragraphGoesOn's
//   `{3,}[^`]*$`); lazyContinuation's plain `{3,}` arm did not.
// - "<3 heart" - "<3" is paragraph text, never an HTML block (cycle 5,
//   probed, for the table twin). lazyContinuation's `<` arm matches any
//   line starting with "<".
// - "%% c %%"  - an inline "%% ... %%" pair is an ordinary paragraph line
//   (sheet 11). paragraphGoesOn got that refinement in cycle 4 (a lone %%
//   block opener only); lazyContinuation's bare `%%` arm did not.
//
// What the user sees: with Move definitions to the bottom on (the
// default), the definition gathers at the bottom and the body line is
// STRANDED in the main text - the rendered footnote loses "``` `x` more"
// (it becomes visible raw text above), and the label under such a line is
// demoted to lazy (a false "reads as plain text" alert and a needless
// blank line from fix-lazy, where Reading view renders that label as a
// real definition: a label under a definition's LAZY continuation line is
// a definition - cycle 7, probed). A numbered press on such a note also
// lands its new "[^2]: " label directly after "[^1]: body", in front of
// the body lines, and the separator it adds cuts them off from footnote 1:
// the body text stops rendering inside the footnote, silently, and the
// new footnote is born empty where the stolen text used to be.
//
// Source of truth: the resolved SPEC 3 probe (a plain line under a
// definition is its body) plus the three paragraph-text probes above;
// micromark agrees with every step (probed for this hunt: each line
// lazily continues the footnoteDefinition's paragraph). The plain-lazy
// twin of every face here was fixed in cycles 1-3 ("the block walker, the
// scan, move-to-bottom, and the second named press all know"); only the
// walker's classification of THESE lines was left behind.
// Settings involved: `Move definitions to the bottom` (default ON),
// `Fix definitions hidden by a missing blank line` (default ON).

describe("the block walker ends a definition at paragraph lines Obsidian keeps inside it", () => {
    it("move-to-bottom keeps a backtick-info 'fence' line in the footnote body", () => {
        const doc = "text[^1] here\n\n[^1]: body\n``` `x`\nmore";
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });

    it("move-to-bottom keeps a '<3' line in the footnote body", () => {
        const doc = "text[^1] here\n\n[^1]: body\n<3 heart";
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });

    it("move-to-bottom keeps an inline %% pair line in the footnote body", () => {
        const doc = "text[^1] here\n\n[^1]: body\n%% c %%";
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });

    it("the label under such a line is not lazy: fix-lazy leaves the note alone", () => {
        const doc = "text[^2] here\n\n[^1]: body\n``` `x`\n[^2]: second\ntext[^2] tail";
        expect(fixLazyDefinitions(doc)).toBe(doc);
    });

    describe("the numbered press does not park its definition in front of the body lines", () => {
        beforeEach(resetNotices);

        it("a backtick-info 'fence' body line stays inside footnote 1", async () => {
            const doc = fakeEditor(
                ["use[^1].", "", "[^1]: body", "``` `x`", "more"],
                { cursor: { line: 0, ch: 3 }, edits: true, wholeDoc: true },
            );
            const settings: Partial<FootnotePluginSettings> = {
                insertAtEndOfWord: false,
                enablePopupEditor: false,
                enableFootnotePrefix: false,
                enableFootnoteSectionHeading: false,
                enableRemoveBlankLastLines: false,
                lintOnFootnoteCreation: false,
            };
            await insertAutonumFootnote(fakePlugin(settings, doc));
            expect(messages().some((m) => m.startsWith("No footnote was created"))).toBe(false);
            // the press happened; the new label must not sit between the
            // old definition and the body lines it stole
            expect(doc.lines.join("\n")).not.toContain("[^2]: \n\n``` `x`");
        });
    });

    it("control: a REAL fence line does end the block (the move strands it, correctly)", () => {
        const doc = "text[^1] here\n\n[^1]: body\n```js\ncode\n```";
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(
            "text[^1] here\n\n```js\ncode\n```\n\n[^1]: body",
        );
    });

    it("control: a plain lazy line IS owned (the resolved SPEC 3)", () => {
        const doc = "text[^1] here\n\n[^1]: body\nmore lazy";
        const lines = doc.split("\n");
        expect(readNote(lines).blocks.map((b) => [b.start, b.end])).toEqual([[2, 3]]);
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });
});
