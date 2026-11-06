import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { applyFootnotePrefix } from "../../src/linting/rules/apply-footnote-prefix";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A definition commented out with an HTML comment, under a reference that still
// points at it: "text[^k] here" above "<!-- [^k]: hidden -->".
//
// What the user saw: with Delete orphaned references on, "text here", with no
// alert. With it off, "Write its definition or delete the reference", about a
// definition the user wrote.
//
// Hunt 2026-11-06, cycle 9, finding H14. Severity: wrong output. Origin:
// pre-existing.
//
// Source of truth: the live answer on Obsidian 1.15.0 (H14), which draws "textk
// here", an undefined reference with its definition hidden, as a "%%" comment does;
// Jason's ruling of 2026-11-05 on the "%%" case (pin
// spec-lint-orphan-cut-commented-label): the user wrote the definition, so deleting
// the reference would throw that work away. The triage of cycle 9 extends it to HTML
// comments.

const ALERT = 'This note has a footnote definition inside a comment ("[^k]:"), where Obsidian never shows it. Move it out of the comment.';

const pluginWith = (extra: Record<string, unknown> = {}) => fakePlugin({ ...DEFAULT_SETTINGS, ...extra });
const lint = (note: string, extra: Record<string, unknown>) => lintFootnotes(note, lintOptionsFromSettings(pluginWith(extra), "", note));

beforeEach(resetNotices);

describe.each([
    ["on several lines", "text[^k] here\n\n<!--\n[^k]: hidden\n-->\n"],
    ["on one line", "text[^k] here\n\n<!-- [^k]: hidden -->\n"],
    ["with no space after the opener", "text[^k] here\n\n<!--[^k]: hidden-->\n"],
    ["indented", "text[^k] here\n\n  <!--\n  [^k]: hidden\n  -->\n"],
    ["with the label on the opener's line", "text[^k] here\n\n<!-- [^k]: hidden\nmore -->\n"],
    ["with the label on the closer's line", "text[^k] here\n\n<!--\n[^k]: hidden -->\n"],
    ["behind a list marker", "text[^k] here\n\n<!--\n- [^k]: hidden\n-->\n"],
    ["in a quote", "text[^k] here\n\n> <!--\n> [^k]: hidden\n> -->\n"],
])("a definition in an HTML comment, %s", (_label, note) => {
    it("Delete orphaned references keeps the reference", () => {
        expect(lint(note, { lintDeleteOrphanedReferences: true })).toBe(note);
    });

    it("the alert that says to move it out of the comment speaks alone, with the setting off", () => {
        noticeLintAlerts(pluginWith(), note);
        expect(messages()).toEqual([ALERT]);
    });

    it("the alert speaks alone with the setting on too", () => {
        noticeLintAlerts(pluginWith({ lintDeleteOrphanedReferences: true }), note);
        expect(messages()).toEqual([ALERT]);
    });
});

// The rename rules cannot rewrite an HTML comment's text. Renaming the reference
// alone would part it from its label, and the next lint would cut it.
describe("the rules that rename leave a footnote whose only definition is in a comment", () => {
    const Numbered = { footnoteNaming: "numbered", lintDeleteOrphanedReferences: true };

    it.each([
        ["a named one under Numbered", "text[^k] here\n\n<!-- [^k]: hidden -->\n"],
        ["a numbered one out of order", "a[^7] b[^3]\n\n<!-- [^3]: hidden -->\n\n[^7]: real\n"],
    ])("%s keeps its reference over two lints", (_label, note) => {
        const once = lint(note, Numbered);
        expect(once).toContain("<!-- [^");
        expect(once).toMatch(note.includes("[^k]") ? /text\[\^k\] here/ : /b\[\^3\]/);
        expect(lint(once, Numbered)).toBe(once);
    });

    it("no other footnote is numbered onto its name", () => {
        const note = "a[^7] b[^1]\n\n<!-- [^1]: hidden -->\n\n[^7]: real\n";
        expect(lint(note, Numbered)).toBe("a[^2] b[^1]\n\n<!-- [^1]: hidden -->\n\n[^2]: real\n");
    });

    it("the prefix rule leaves it too", () => {
        expect(applyFootnotePrefix("a[^k] b[^j]\n\n<!-- [^k]: hidden -->\n\n[^j]: real\n", "p.")).toBe("a[^k] b[^p.j]\n\n<!-- [^k]: hidden -->\n\n[^p.j]: real\n");
    });

    it("control: with a real definition as well, the footnote is numbered as usual", () => {
        const note = "x[^5] a[^1]\n\n<!-- [^1]: old -->\n\n[^1]: one\n[^5]: five\n";
        expect(lint(note, {})).toBe("x[^1] a[^2]\n\n<!-- [^1]: old -->\n\n[^1]: five\n[^2]: one\n");
    });

    it("control: a commented-out definition nothing references does not hold its number", () => {
        const note = "a[^7]\n\n<!-- [^1]: old -->\n\n[^7]: real\n";
        expect(lint(note, {})).toBe("a[^1]\n\n<!-- [^1]: old -->\n\n[^1]: real\n");
    });
});

describe("what counts", () => {
    it("the plural", () => {
        noticeLintAlerts(pluginWith(), "a[^j] b[^k]\n\n<!-- [^j]: one -->\n\n%%\n[^k]: two\n%%\n");
        expect(messages()).toEqual(['This note has 2 footnote definitions inside comments ("[^j]:", "[^k]:"), where Obsidian never shows them. Move them out of the comments.']);
    });

    it("the %% twin says the same words", () => {
        noticeLintAlerts(pluginWith(), "text[^k] here\n\n%%\n[^k]: hidden\n%%\n");
        expect(messages()).toEqual([ALERT]);
    });

    it("control: a reference with no definition anywhere is still deleted beside one", () => {
        expect(lint("text[^k] here[^gone]\n\n<!-- [^k]: hidden -->\n", { lintDeleteOrphanedReferences: true })).toBe("text[^k] here\n\n<!-- [^k]: hidden -->\n");
    });

    it("control: a label-shaped line in another HTML block is no comment, so the reference is an orphan", () => {
        expect(lint("text[^k] here\n\n<div>\n[^k]: hidden\n</div>\n", { lintDeleteOrphanedReferences: true })).toBe("text here\n\n<div>\n[^k]: hidden\n</div>\n");
    });

    it("control: prose in an HTML comment that mentions a footnote names no definition", () => {
        noticeLintAlerts(pluginWith(), "text\n\n<!-- see [^k]: hidden -->\n");
        expect(messages()).toEqual([]);
    });

    it("control: a label below the comment's line is a real definition", () => {
        const note = "text[^k] here\n\n<!-- note -->\n[^k]: real\n";
        expect(lint(note, { lintDeleteOrphanedReferences: true })).toContain("text[^k] here");
        noticeLintAlerts(pluginWith(), note);
        expect(messages()).toEqual([]);
    });
});
