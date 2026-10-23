// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";
import { MultiCaretNestedNotice } from "../helpers/toasts";

// The multi-caret guards refuse a press that would land a footnote inside
// another footnote's definition (ADR-0001: nesting is prevented
// plugin-wide). They do it through warnDefinitionCaretIfInside, which asks
// ctx.blocks() - the COLUMN-0 definition blocks - whether the caret sits
// inside one. A QUOTED definition ("> [^q]: body") never forms a block
// (the C22 ruling: it is a real definition on its own line), and its
// continuation lines, which Reading view folds into the footnote's body
// (pinned ground truth 2026-09-16: "> [^1]: quoted" then "> cont line"
// renders as one footnote), belong to no block either. So a caret inside
// a quoted definition is invisible to the multi-caret claim, and the
// press inserts right there: a nested footnote the single-caret cascade
// never produces, because its definition-jump step (navigation.ts,
// quotedDefinitionAbove) owns every one of those same lines first.
//
// What the user sees: Alt-click one caret in prose and one inside a
// quoted footnote's body, press the numbered key, and the note gains a
// footnote nested inside the quoted one - the exact shape the plugin
// refuses everywhere else and the lint then alerts about forever.
//
// Source of truth: ADR-0001 (no nested footnotes, prevented plugin-wide),
// the single-caret behavior on the same lines (jumps or refuses, never
// inserts), and the cycle-2 soak pin
// (bug-multi-caret-continuation-nests-in-definition), which closed the
// same hole for a column-0 definition's lazy continuation.
//
// Settings involved: none; the multi-caret claim is always on.

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

const QUOTED = ["plain", "", "> [^q]: quoted body", "> continuation here"];

describe("the multi-caret claim inside a quoted definition", () => {
    beforeEach(() => {
        resetNotices();
    });

    it("the numbered press refuses a caret on a quoted continuation line", async () => {
        const doc = sharedFakeEditor(QUOTED, {
            carets: [
                { line: 0, ch: 3 },
                { line: 3, ch: 5 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(QUOTED.join("\n"));
        expect(noticeCalls.some((call) => call[0] === MultiCaretNestedNotice)).toBe(true);
    });

    it("the numbered press refuses a caret on the quoted label line's body", async () => {
        const doc = sharedFakeEditor(QUOTED, {
            carets: [
                { line: 0, ch: 3 },
                { line: 2, ch: 12 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(QUOTED.join("\n"));
    });

    it("the named second press refuses when any caret's reference sits inside a quoted definition", async () => {
        // "> [^z]" directly under "> [^q]: quoted body" is the quoted
        // definition's lazy continuation (quotedDefinitionEnd), so giving
        // [^z] a definition nests one footnote inside the other
        const lines = ["text[^z]", "", "> [^q]: quoted body", "> [^z]"];
        const doc = sharedFakeEditor(lines, {
            carets: [
                { line: 0, ch: 6 },
                { line: 3, ch: 4 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(lines.join("\n"));
        expect(noticeCalls.some((call) => call[0] === MultiCaretNestedNotice)).toBe(true);
    });

    it("the numbered press refuses a caret at column 0 of the quoted label line (the insert destroys the label)", async () => {
        // "[^1]" at character 0 of "> [^q]: quoted body" pushes the quote
        // marker over: the label dies mid-line, [^q]'s definition is gone
        // (found by the two-caret property's shrinker, cycle 3)
        const doc = sharedFakeEditor(QUOTED, {
            carets: [
                { line: 2, ch: 0 },
                { line: 0, ch: 3 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(QUOTED.join("\n"));
    });

    it("control: a caret on a COLUMN-0 definition's continuation line refuses (already pinned)", async () => {
        const lines = ["plain", "", "[^q]: body", "    continuation"];
        const doc = sharedFakeEditor(lines, {
            carets: [
                { line: 0, ch: 3 },
                { line: 3, ch: 6 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(lines.join("\n"));
    });

    it("control: both carets in plain prose insert normally", async () => {
        const doc = sharedFakeEditor(["plain text here", "", "more plain text"], {
            carets: [
                { line: 0, ch: 3 },
                { line: 2, ch: 6 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.filter((line) => line.includes("[^1]"))).toHaveLength(3);
    });
});
