import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnote } from "../../src/commands/delete-footnote";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// Delete footnote everywhere, a conversion, and a carried paste run no lint, and
// the alerts after them are told so. Two alerts did not listen.
//
// What the user saw, after Delete footnote everywhere with Lint on footnote
// creation off: "The lint left "[^1]:" as it is, because changing it would change
// how Obsidian reads the text around it. Fix it by hand." and "The lint did not add
// the footnote section heading", when no lint had run. The next lint says either
// one truly, so nothing goes unreported.
//
// Hunt 2026-11-06, cycle 9, finding H18. Severity: annoyance. Origin: pre-existing.
//
// Source of truth: the comment on noticeLintAlerts' afterLint parameter and the
// choice the orphan alert already makes (pin bug-lint-delete-everywhere-orphan-unreported).

beforeEach(resetNotices);

describe("alerts after a command that runs no lint", () => {
    it("Delete footnote everywhere does not report what 'the lint' left", async () => {
        const lines = ["gone[^9] here", "", "- a[^1]", "", "[^1]: one", "", "- b[^2]", "", "[^2]: two", "[^9]: nine"];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 6 }, selection: { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 6 } } });
        await deleteFootnote(fakePlugin({ ...DEFAULT_SETTINGS, lintOnFootnoteCreation: false }, doc));
        expect(doc.lines).not.toContain("[^9]: nine");
        expect(messages().filter((m) => m.startsWith("The lint "))).toEqual([]);
    });

    it("the section heading alert keeps quiet too", () => {
        noticeLintAlerts(
            fakePlugin({ ...DEFAULT_SETTINGS, enableFootnoteSectionHeading: true, footnoteSectionHeading: "---\n## Footnotes" }),
            "---\nbody[^1]\n\n[^1]: one",
            false,
        );
        expect(messages().filter((m) => m.startsWith("The lint "))).toEqual([]);
    });

    it("control: after a lint the alert speaks", () => {
        noticeLintAlerts(fakePlugin(DEFAULT_SETTINGS), "- a[^1]\n\n[^1]: one\n\n- b[^1]", true);
        expect(messages().filter((m) => m.startsWith("The lint "))).toHaveLength(1);
    });
});
