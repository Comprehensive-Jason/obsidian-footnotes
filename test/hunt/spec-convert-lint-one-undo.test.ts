import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineToNormalCommand, convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { codeMirrorEditor } from "../helpers/codemirror-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// SPEC (annoyance): with Lint on footnote creation on, a Convert command and the
// lint that follows it are one undo step, in both directions.
//
// What the user would see: Convert normal to inline wrote the conversion, then
// the lint renumbered, and one undo brought back only the unlinted conversion.
// Inline to normal took one undo only because CodeMirror happened to join two
// edits that touched.
//
// Hunt 2026-11-06, cycle 9, finding H31. Severity: annoyance. Origin: normal to
// inline, a regression from 2dc5233; inline to normal, pre-existing. Source of
// truth: the triage's ruling, for Jason's objection, and the live answers H31a
// and H31b, whose notes are the first row in each direction here. The test runs
// on a real CodeMirror state, and a smoke scenario does the real undo.

const LintOn = { ...DEFAULT_SETTINGS, lintOnFootnoteCreation: true };

/** The offset of the "|" in `marked`, with the "|" taken out. */
function caret(marked: string) {
    const at = marked.indexOf("|");
    return { text: marked.slice(0, at) + marked.slice(at + 1), at };
}

async function run(command: typeof convertNormalToInlineCommand, marked: string, settings: Record<string, unknown> = LintOn) {
    const { text, at } = caret(marked);
    const cm = codeMirrorEditor(text, [{ anchor: at, head: at }]);
    await command(fakePlugin(settings, cm.editor));
    const place = cm.selections()[0].head;
    const lines = cm.text().split("\n");
    const offset = lines.slice(0, place.line).reduce((n, line) => n + line.length + 1, 0) + place.ch;
    return { cm, start: text, startCaret: at, after: cm.text().slice(0, offset) + "|" + cm.text().slice(offset) };
}

beforeEach(resetNotices);

describe("Convert normal to inline and the lint are one undo step", () => {
    const rows: [string, string, string][] = [
        ["the caret on the text (the live answer H31b's note)", "a[^1] b|[^2]\n\n[^1]: one\n[^2]: two\n    more\n", "a^[one] b|[^1]\n\n[^1]: two\n    more\n"],
        ["the caret on the first line", "|a[^1] b[^2]\n\n[^1]: one\n[^2]: two\n    more", "|a^[one] b[^1]\n\n[^1]: two\n    more"],
        ["the caret in the definition the lint renames", "a[^1] b[^2]\n\n[^1]: one\n[^2]: two|\n    more", "a^[one] b[^1]\n\n[^1]: two|\n    more"],
        ["the caret on its continuation line", "a[^1] b[^2]\n\n[^1]: one\n[^2]: two\n    mo|re", "a^[one] b[^1]\n\n[^1]: two\n    mo|re"],
    ];
    for (const [name, marked, expected] of rows) {
        it(name, async () => {
            const { cm, start, startCaret, after } = await run(convertNormalToInlineCommand, marked);
            expect(after).toBe(expected);
            expect(cm.transactions()).toBe(1);
            cm.undo();
            expect(cm.text()).toBe(start);
            const undone = cm.selections()[0].head;
            expect(cm.editor.posToOffset(undone)).toBe(startCaret);
        });
    }

    it("the toasts still come in order: the conversion, then the lint", async () => {
        await run(convertNormalToInlineCommand, "a[^1] b|[^2]\n\n[^1]: one\n[^2]: two\n    more");
        expect(messages()[0]).toMatch(/^Converted 1 footnote into an inline footnote at 1 reference\./);
        expect(messages()[1]).toBe("Footnotes linted.");
        expect(messages()).toHaveLength(2);
    });

    it("control: a lint with nothing to change says nothing, and it is still one transaction", async () => {
        const { cm } = await run(convertNormalToInlineCommand, "a[^1]|\n\n[^1]: one");
        expect(cm.text()).toBe("a^[one]");
        expect(cm.transactions()).toBe(1);
        expect(messages()).toEqual(["Converted 1 footnote into an inline footnote at 1 reference."]);
    });

    it("control: with the setting off there is no lint", async () => {
        const { cm } = await run(convertNormalToInlineCommand, "a[^1] b|[^2]\n\n[^1]: one\n[^2]: two\n    more", { ...DEFAULT_SETTINGS, lintOnFootnoteCreation: false });
        expect(cm.text()).toBe("a^[one] b[^2]\n\n[^2]: two\n    more");
        expect(cm.transactions()).toBe(1);
    });
});

describe("Convert inline to normal and the lint are one undo step", () => {
    const rows: [string, string, string][] = [
        ["the caret on the text (the live answer H31a's note)", "a^[x] b|[^5]\n\n[^5]: five\n", "a[^1] b|[^2]\n\n[^1]: x\n[^2]: five\n"],
        ["the caret on the first line", "|a^[x] b[^5]\n\n[^5]: five", "|a[^1] b[^2]\n\n[^1]: x\n[^2]: five"],
        ["the caret at the end of an inline footnote's text stays in what took its place", "a^[x|] b[^5]\n\n[^5]: five", "a[^1|] b[^2]\n\n[^1]: x\n[^2]: five"],
        ["the caret inside an inline footnote's text goes to the front of what took its place", "a^[ab|c] b[^5]\n\n[^5]: five", "a|[^1] b[^2]\n\n[^1]: abc\n[^2]: five"],
        ["the caret in the definition the lint moves and renames", "a^[x] b[^5]\n\n[^5]: fi|ve", "a[^1] b[^2]\n\n[^1]: x\n[^2]: fi|ve"],
    ];
    for (const [name, marked, expected] of rows) {
        it(name, async () => {
            const { cm, start, startCaret, after } = await run(convertInlineToNormalCommand, marked);
            expect(after).toBe(expected);
            expect(cm.transactions()).toBe(1);
            cm.undo();
            expect(cm.text()).toBe(start);
            expect(cm.editor.posToOffset(cm.selections()[0].head)).toBe(startCaret);
        });
    }

    it("the toasts still come in order: the conversion, then the lint", async () => {
        await run(convertInlineToNormalCommand, "a^[x] b|[^5]\n\n[^5]: five");
        expect(messages()).toEqual(["Converted 1 inline footnote into 1 normal footnote.", "Footnotes linted."]);
    });

    it("control: with the setting off there is no lint", async () => {
        const { cm } = await run(convertInlineToNormalCommand, "a^[x] b|[^5]\n\n[^5]: five", { ...DEFAULT_SETTINGS, lintOnFootnoteCreation: false });
        expect(cm.text()).toBe("a[^6] b[^5]\n\n[^5]: five\n[^6]: x");
        expect(cm.transactions()).toBe(1);
    });
});
