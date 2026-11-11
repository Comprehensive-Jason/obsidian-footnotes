import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { convertInlineToNormalCommand, convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { sanitizeInlineFootnoteContent } from "../../src/commands/inline-footnotes";
import { insertInlineFootnote, pasteInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output): the text that goes into an inline footnote loses its
// no-break, narrow no-break, and ideographic spaces.
//
// What the user would see: a French writer's "voir\u00a0: Dupont" comes out of
// Convert normal to inline as "voir : Dupont", with a plain space, and the
// colon can then wrap onto a line of its own. A Japanese writer's "\u7b2c\u4e00\u3000\u7b2c\u4e8c" loses
// its wide space. Converting back does not restore them. The same happens when
// a selection is pressed into an inline footnote and when the clipboard is
// pasted as one, since all three read the one sanitizer.
//
// Hunt 2026-11-06, cycle 9, finding H23. Severity: wrong output. Origin:
// pre-existing. Source of truth: the live answer H23 (Obsidian draws the
// no-break space as "&nbsp;", so it is text the user sees), and the sanitizer's
// own reason for collapsing, that an inline footnote lives on one line, which
// these spaces do nothing to.

const NoBreak = "\u00a0";
const NarrowNoBreak = "\u202f";
const Ideographic = "\u3000";

const editor = (lines: string[]) =>
    fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } } });

beforeEach(resetNotices);
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("special spaces survive going into an inline footnote", () => {
    for (const [name, space] of [["no-break", NoBreak], ["narrow no-break", NarrowNoBreak], ["ideographic", Ideographic]] as const) {
        it(`Convert normal to inline keeps the ${name} space`, async () => {
            const doc = editor(["a[^1]", "", `[^1]: x${space}y`]);
            await convertNormalToInlineCommand(fakePlugin({}, doc));
            expect(doc.lines).toEqual([`a^[x${space}y]`]);
        });

        it(`the round trip gives the ${name} space back, at the end of the text too`, async () => {
            const start = ["a[^1]", "", `[^1]: x${space}y${space}`];
            const doc = editor(start);
            await convertNormalToInlineCommand(fakePlugin({}, doc));
            await convertInlineToNormalCommand(fakePlugin({}, doc));
            expect(doc.lines).toEqual(start);
        });

        it(`a selection pressed into an inline footnote keeps the ${name} space`, async () => {
            const line = `say x${space}y now`;
            const doc = fakeEditor([line], {
                wholeDoc: true,
                edits: true,
                cursor: { line: 0, ch: 9 },
                selection: { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 7 } },
            });
            await insertInlineFootnote(fakePlugin({}, doc));
            expect(doc.lines[0]).toContain(`^[x${space}y]`);
        });

        it(`the inline paste keeps the ${name} space`, async () => {
            vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.resolve(`x${space}y`) } });
            const doc = editor(["a"]);
            doc.setCursor({ line: 0, ch: 1 });
            await pasteInlineFootnote(fakePlugin({}, doc));
            expect(doc.lines).toEqual([`a^[x${space}y]`]);
        });
    }

    it("ASCII whitespace and line breaks still collapse and trim", () => {
        expect(sanitizeInlineFootnoteContent(" \t a \t\r\n b\n\f\vc\u2028d\u2029e  ")).toBe("a b c d e");
    });

    // Changed 2026-11-11: spaces on one line are no longer squeezed
    // (bug-inline-key-squeezes-spaces-in-code), so those beside a special
    // space stay as written; a line break beside one still becomes a space.
    it("spaces beside a special space stay as written, and so does the special space", () => {
        expect(sanitizeInlineFootnoteContent(`a  ${NoBreak}  b`)).toBe(`a  ${NoBreak}  b`);
        expect(sanitizeInlineFootnoteContent(`a \n ${NoBreak}\nb`)).toBe(`a ${NoBreak} b`);
    });

    it("text of nothing but whitespace, special spaces included, is still empty", () => {
        expect(sanitizeInlineFootnoteContent(` ${NoBreak}${Ideographic} `)).toBe("");
    });
});
