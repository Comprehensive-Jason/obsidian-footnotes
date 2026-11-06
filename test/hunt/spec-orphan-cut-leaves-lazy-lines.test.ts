import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnote } from "../../src/commands/delete-footnote";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// When Delete orphaned definitions cuts a definition, the lines under its label
// that are not indented stay behind as prose. Only the label and the indented
// lines, which the user wrote as the footnote's text, go.
//
// What the user lost: "Prose above.", "[^7]: typed here", "Next line of prose."
// is one paragraph to Obsidian. Fix definitions gives the label its blank line, the
// next line reads as more of the footnote, and the orphan rule deleted it with the
// label, in one lint and with no alert. The same happened when the only citation was
// a lazy label further down, and when the user added the blank line themselves.
//
// Hunt 2026-11-06, cycle 10, the replacement for cycle 9's H13; the lint hunter's
// findings 3 and 6. Severity: data loss, rare. Origin: pre-existing.
//
// Source of truth: the decision made for Jason in the cycle 10 triage, under the
// scope rule of 2026-10-07 (data loss in any shape). It reverses an older ruling
// that orphan deletion takes a definition's lazy lines, listed for Jason to confirm.

const On = { lintDeleteOrphanedDefinitions: true };
const lint = (note: string, extra: Partial<typeof DEFAULT_SETTINGS> = On) => {
    const settings = { ...DEFAULT_SETTINGS, ...extra };
    return lintFootnotes(note, lintOptionsFromSettings(fakePlugin(settings), "", note));
};

beforeEach(resetNotices);

describe("the lines under a cut definition's label that are not indented stay", () => {
    it.each([
        ["one line, under a paragraph", "Prose above.\n[^7]: typed here\nNext line of prose.", "Prose above.\n\nNext line of prose."],
        ["the blank line the alert asks for already there", "Prose above.\n\n[^k]: typed here\nNext line of prose.", "Prose above.\n\nNext line of prose."],
        ["several lines", "Prose above.\n[^7]: typed here\nNext line.\nAnd one more.", "Prose above.\n\nNext line.\nAnd one more."],
        ["a label of a stack, the prose under the last", "Prose above.\n[^7]: one\n[^8]: two\nNext line.", "Prose above.\n\nNext line."],
        ["cited only by a lazy label further down", "More.\n[^k]: typed\nTail line.\n\nProse.\n[^a]: see[^k]", "More.\n\nTail line.\n\nProse."],
        ["two lazy labels of one name", "Prose.\n[^2]: first\nTail line.\n\nMore.\n[^2]: second", "Prose.\n\nTail line.\n\nMore."],
        ["in a quote", "> Prose above.\n> [^7]: typed here\n> Next line.", "> Prose above.\n>\n> Next line."],
        ["in a quote, cited only by a lazy label", "> More.\n> [^k]: typed\n> Tail line.\n\nProse.\n[^a]: see[^k]", "> More.\n>\n> Tail line.\n\nProse."],
        ["a line with no quote marker under a quoted label", "> [^7]: typed here\nNext line.\n\nAfter.", "Next line.\n\nAfter."],
        ["a comment that opens and closes on lines that stay", "Prose.\n\n[^7]: typed\ntail <!-- open\nhidden\n-->\n\nAfter.", "Prose.\n\ntail <!-- open\nhidden\n-->\n\nAfter."],
        ["in a list item", "- Prose above.\n  [^7]: typed here\n  Next line.", "- Prose above.\n\n  Next line."],
        ["a line indented by less than the footnote's own column", "Prose above.\n\n[^7]: typed here\n   Next line.", "Prose above.\n\n   Next line."],
        ["after an indented line", "Prose above.\n\n[^7]: typed here\n    more of it\nNext line.", "Prose above.\n\nNext line."],
    ])("%s", (_label, note, after) => {
        const once = lint(note);
        expect(once).toBe(after);
        expect(lint(once)).toBe(once);
    });

    it.each(["2-", "2~", "3=", "4_", "ch2*", "a$", "2."])("with the prefix %s", (prefix) => {
        const note = `Prose above.\n[^${prefix}7]: typed here\nNext line.`;
        const once = lint(note, { ...On, enableFootnotePrefix: true });
        expect(once).toBe("Prose above.\n\nNext line.");
        expect(messages()).toEqual([]);
    });

    it("says nothing, since nothing is held back", () => {
        const once = lint("Prose above.\n[^7]: typed here\nNext line of prose.");
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, ...On }), once);
        expect(messages()).toEqual([]);
    });
});

describe("a reference on a line that stays", () => {
    it("keeps the footnote it cites", () => {
        const note = "Prose above.\n\n[^a]: typed here\nNext[^k] line.\n\n[^k]: kay";
        const once = lint(note);
        expect(once).toBe("Prose above.\n\nNext[^k] line.\n\n[^k]: kay");
        expect(readNote(once.split("\n")).definitions.map((definition) => definition.name)).toEqual(["k"]);
        expect(lint(once)).toBe(once);
    });

    it("a link on a line that stays does not stop the cut", () => {
        const once = lint("Prose above.\n\n[^a]: typed here\n[link](x) and **bold** tail.");
        expect(once).toBe("Prose above.\n\n[link](x) and **bold** tail.");
        expect(lint(once)).toBe(once);
    });

    it("a reference on an indented line goes with the definition, and takes its footnote along", () => {
        expect(lint("Prose above.\n\n[^a]: typed here\n    more[^k] of it\n\n[^k]: kay")).toBe("Prose above.");
    });
});

describe("indented lines are the definition's and go with it", () => {
    it.each([
        ["four spaces", "Prose.\n\n[^7]: typed\n    more\n\nAfter."],
        ["a tab", "Prose.\n\n[^7]: typed\n\tmore\n\nAfter."],
        ["a second paragraph", "Prose.\n\n[^7]: typed\n\n    second\n\nAfter."],
        ["a list item's own column", "- Prose.\n\n  [^7]: typed\n      more\n\nAfter."],
        ["in a quote", "> Prose.\n>\n> [^7]: typed\n>     more\n\nAfter."],
    ])("%s", (_label, note) => {
        const once = lint(note);
        expect(once).toContain("After.");
        expect(once).not.toContain("more");
        expect(once).not.toContain("second");
        expect(once).not.toContain("typed");
        expect(lint(once)).toBe(once);
    });
});

describe("controls", () => {
    it("with the setting off, the definition keeps its lines", () => {
        expect(lint("Prose above.\n[^7]: typed here\nNext line.", {})).toBe("Prose above.\n\n[^1]: typed here\nNext line.");
    });

    it("a label something references keeps the rest of its paragraph as its text (ruling Q24, list B)", () => {
        expect(lint("Prose[^k] above.\n[^k]: typed here\nNext line.")).toBe("Prose[^k] above.\n\n[^k]: typed here\nNext line.");
    });

    it("Delete footnote everywhere still takes the definition's lazy lines", async () => {
        const doc = fakeEditor(["text[^k] here", "", "[^k]: typed", "Next line."], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 6 } });
        await deleteFootnote(fakePlugin({ ...DEFAULT_SETTINGS }, doc));
        expect(doc.lines.join("\n")).toBe("text here");
    });
});

// Characterization, flagged for Jason's review: a cut that would part a comment or
// inline code, taking its indented lines and leaving the rest, is not made. The orphan
// stays with every line, and the alert names it.
describe("characterization: a cut that would part protected text", () => {
    it.each([
        ["a comment with an indented middle", "Text.\n\n[^2]: def\ntail <!-- open\n    hidden\n-->\n\nAfter."],
        ["a comment with a line that is not indented in the middle", "Text.\n\n[^2]: def\n    tail <!-- open\n  hidden\n    -->\n\nAfter."],
        ["inline code over a line that stays and an indented one", "Text.\n\n[^2]: def\ntail `one\n    two`\n\nAfter."],
        ["a comment in a quote", "> [^2]: def\n>     tail <!-- open\n> hidden [^9]\n> -->\n\nAfter."],
    ])("%s: the note keeps every line", (_label, note) => {
        const once = lint(note);
        for (const word of ["def", "tail", "After."]) expect(once).toContain(word);
        expect(lint(once)).toBe(once);
    });
});

// Characterization, flagged for Jason's review: a stacked label whose lazy line would
// read as more of the kept footnote above it once the label goes. The result gate
// refuses that, so the orphan stays with its lines and the alert names it.
describe("characterization: a kept definition right above the cut label", () => {
    const note = "Text[^1] here.\n\n[^1]: kept\n[^2]: orphan\nTail line.";

    it("the orphan stays, and no line is lost", () => {
        expect(lint(note)).toBe(note);
    });

    it("the alert names it", () => {
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, ...On }), lint(note));
        expect(messages().join(" ")).toContain('"[^2]"');
    });
});
