import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineToNormalCommand, convertNormalToInlineCommand } from "../src/commands/convert-footnotes";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The Convert toasts in the shared vocabulary (Jason's choice, 2026-10-22,
// run toast-consolidate): "Nothing was converted:" opens every refusal,
// one sentence says a note has nothing to convert, and both directions
// skip with the same reason words. Written out in full.

beforeEach(resetNotices);

const editor = (lines: string[]) =>
    fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } } });

async function toInline(lines: string[]): Promise<string[]> {
    await convertNormalToInlineCommand(fakePlugin({}, editor(lines)));
    return messages();
}

async function toNormal(lines: string[], settings: Record<string, unknown> = {}): Promise<string[]> {
    await convertInlineToNormalCommand(fakePlugin(settings, editor(lines)));
    return messages();
}

describe("nothing to convert", () => {
    it("inline to normal, in a note with no inline footnote", async () => {
        expect(await toNormal(["plain text"])).toEqual(["This note has no inline footnotes to convert."]);
    });
    it("normal to inline, in a note with no definition", async () => {
        expect(await toInline(["plain text"])).toEqual(["This note has no footnotes to convert."]);
    });
});

describe("every footnote skipped", () => {
    it("inline to normal counts each reason", async () => {
        expect(await toNormal(["a^[] b^[]"])).toEqual(["Nothing was converted: every footnote was skipped: empty (2)."]);
    });
    it("normal to inline names each footnote with its reason", async () => {
        expect(await toInline(["text", "", "[^o]: orphan", "", "> [^q]: quoted"])).toEqual([
            'Nothing was converted: every footnote was skipped: "[^o]" (not referenced), "[^q]" (in a quote).',
        ]);
    });
});

describe("the shared skip reasons", () => {
    it("inline to normal: an inline footnote inside a definition, and one whose text holds a footnote", async () => {
        const said = await toNormal(["a[^1] ^[keep] ^[see [^1]]", "", "[^1]: one ^[inner]"]);
        expect(said[0]).toBe("Converted 1 inline footnote into 1 normal footnote. Skipped: its text holds a footnote (1), inside another footnote (1).");
    });
    it("normal to inline: a definition in a list item", async () => {
        const said = await toInline(["a[^1] b[^i]", "", "[^1]: one", "", "- [^i]: in the item"]);
        expect(said[0]).toBe('Converted 1 footnote into an inline footnote at 1 reference. Skipped: "[^i]" (in a list item).');
    });
});

describe("the refusals", () => {
    it("a conversion the result gate refuses", async () => {
        expect(await toInline(["Intro[^2].", "", "- a[^1]", "", "[^1]: one", "", "- b", "", "[^2]: two"])).toEqual([
            "Nothing was converted: it would change how Obsidian reads the text around a footnote. Convert it by hand.",
        ]);
    });
    it("a refused conversion still ends with what it skipped", async () => {
        expect(await toInline(["Intro[^2].", "", "- a[^1]", "", "[^1]: one", "", "- b", "", "[^2]: two", "", "[^o]: orphan"])).toEqual([
            'Nothing was converted: it would change how Obsidian reads the text around a footnote. Convert it by hand. Skipped: "[^o]" (not referenced).',
        ]);
    });
    it("inline to normal under an invalid footnote-prefix", async () => {
        expect(await toNormal(["---", "footnote-prefix: 10", "---", "a^[one]"], { enableFootnotePrefix: true })).toEqual([
            `Nothing was converted: this note's footnote-prefix ("10") is invalid. The footnote prefix can't end in a number. Its footnotes would be indistinguishable from plain numbered ones.`,
        ]);
    });
});
