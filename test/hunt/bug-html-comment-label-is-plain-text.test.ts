import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnote } from "../../src/commands/delete-footnote";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A "[^k]: text" line inside an HTML comment is plain text to the plugin. Jason's
// ruling of 2026-11-05 on commented definitions named "%%" comments only.
//
// What the user sees: a stale "<!-- [^1]: old -->" in a note has no effect on the
// numbering, and it brings no alert telling them to move it out. A reference to that
// name still reads as having no definition, and the alert says so. For a time the
// comment's label counted like one in a "%%" comment, and that left gaps in the
// numbering, took away the "no definition" alert, and asked the user to bring back
// a comment they had just deleted the footnote from.
//
// Hunt 2026-11-06, cycle 10, on the back-out of cycle 9's H14 (2b34c0a); the lint
// hunter's findings 8 and 9. Source of truth: the ruling of 2026-11-05 ("%%" only)
// and the code at 0fb8ac3, where each row here passes. Severity: annoyance. Origin:
// regression from 2b34c0a.

type Extra = Partial<typeof DEFAULT_SETTINGS>;
const lint = (note: string, extra: Extra = {}) => {
    const settings = { ...DEFAULT_SETTINGS, ...extra };
    return lintFootnotes(note, lintOptionsFromSettings(fakePlugin(settings), "", note));
};

beforeEach(resetNotices);

describe("a label in an HTML comment", () => {
    it("brings no alert asking to move it out", () => {
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), "text[^k] here\n\n<!-- [^k]: hidden -->");
        expect(messages().join(" ")).not.toContain("Move it out of the comment");
        expect(messages().join(" ")).toContain("no definition");
    });

    it("leaves a reference to its name reported as having no definition, after the number lands on it", () => {
        const after = lint("a[^9]\n\n<!-- [^1]: old -->");
        expect(after).toBe("a[^1]\n\n<!-- [^1]: old -->");
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), after);
        expect(messages().join(" ")).toContain("no definition");
    });

    it("does not hold its name out of the numbering, so no gap opens", () => {
        expect(lint("b[^7] a[^1]\n\n<!-- [^1]: old -->\n\n[^7]: real")).toBe("b[^1] a[^2]\n\n<!-- [^1]: old -->\n\n[^1]: real");
    });

    it("does not keep its footnote's reference from being numbered", () => {
        expect(lint("x[^b] y[^5]\n\n<!-- [^5]: hidden -->\n\n[^b]: real")).toBe("x[^b] y[^1]\n\n<!-- [^5]: hidden -->\n\n[^b]: real");
    });

    it("does not stop Delete orphaned references", () => {
        expect(lint("text[^k] here\n\n<!-- [^k]: hidden -->", { lintDeleteOrphanedReferences: true })).toBe("text here\n\n<!-- [^k]: hidden -->");
    });

    it("brings no alert after Delete footnote everywhere took its reference", async () => {
        const doc = fakeEditor(["text[^k] here", "", "<!-- [^k]: hidden -->"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 6 } });
        await deleteFootnote(fakePlugin({ ...DEFAULT_SETTINGS }, doc));
        expect(messages().filter((message) => message.includes("Move it out of the comment"))).toEqual([]);
    });
});

describe('a label in a "%%" comment keeps its alert', () => {
    it("names the comment by its kind", () => {
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), "text[^k] here\n\n%%\n[^k]: hidden\n%%");
        expect(messages()).toContain('This note has a footnote definition inside a %% comment ("[^k]:"), where Obsidian never shows it. Move it out of the comment.');
    });

    it("names several of them by the same words", () => {
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), "%%\n[^j]: one\n[^k]: two\n%%");
        expect(messages()).toContain('This note has 2 footnote definitions inside %% comments ("[^j]:", "[^k]:"), where Obsidian never shows them. Move them out of the comments.');
    });

    it("keeps the reference from Delete orphaned references", () => {
        const note = "text[^k] here\n\n%%\n[^k]: hidden\n%%";
        expect(lint(note, { lintDeleteOrphanedReferences: true })).toContain("text[^");
    });
});
