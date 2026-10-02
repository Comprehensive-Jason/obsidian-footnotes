import { beforeEach, describe, expect, it } from "vitest";

import { convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question (UI text): should the normal-to-inline toast read in the
// singular when one footnote is converted?
//
// What it does now: converting a note with one definition cited once
// toasts "Converted 1 footnote into inline footnotes at 1 reference."
// What a user might expect: "Converted 1 footnote into an inline footnote."
// or similar, with "inline footnotes" in the singular.
// Why it is a question and not a bug: the toast is accurate and the
// grammar is a matter of wording. Jason owns UI text; offer drafts, for
// example "Converted 1 footnote into an inline footnote." or "Converted 1
// footnote to inline at 1 reference."
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR10. Round 3's
// bug-convert-toast-plural-bodys pinned a plural slip in the same family.
//
// Source of truth: the toast's own wording; AGENTS.md (UI text gets drafts
// to pick from).

beforeEach(resetNotices);

describe("spec question: the normal-to-inline toast's grammar", () => {
    it.fails("one definition at one reference reads in the singular", async () => {
        const d = fakeEditor(["a[^1] b", "", "[^1]: one"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 0 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
        });
        await convertNormalToInlineCommand(fakePlugin({}, d));
        const toast = messages().find((m) => m.startsWith("Converted")) as string;
        // Today: "Converted 1 footnote into inline footnotes at 1 reference."
        expect(toast).not.toMatch(/1 footnote into inline footnotes/);
    });
});
