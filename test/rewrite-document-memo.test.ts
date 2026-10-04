import { describe, expect, it } from "vitest";

import { rewriteDocument } from "../src/linting/rewrite-document";

// Views built for the identical text share their work (Jason, 2026-09-09:
// "if it's free, do it"). Since step 2 of the runtime swap (2026-10-03)
// the view keeps no memo of its own: every piece comes from the note
// reading, which reads each distinct text once and remembers it, so two
// views of the same text hand back the very same reading. These pins say
// when the work is shared, and that a trim still reads the trimmed note.

const doc = ["Prose[^1] here.", "", "[^1]: the definition", "    continued", "", ""].join("\n");

/** Runs `rule` on `text` and hands back what it saw. */
function view(text: string, rule?: (v: Parameters<Parameters<typeof rewriteDocument>[1]>[1]) => string) {
    const seen: { reading: object; protectedCount: number; blocks: readonly { name: string; start: number; end: number }[] }[] = [];
    const out = rewriteDocument(text, (inner, v) => {
        const result = rule ? rule(v) : inner;
        seen.push({ reading: v.reading, protectedCount: v.reading.protectedLines.length, blocks: v.blocks });
        return result;
    });
    if (seen.length !== 1) throw new Error("the rule ran " + String(seen.length) + " times");
    return { out, ...seen[0] };
}

describe("views of the same text share the note reading", () => {
    it("shares one reading between rules that receive identical text", () => {
        const first = view(doc);
        const second = view(doc);
        expect(second.reading).toBe(first.reading);
        expect(second.blocks).toBe(first.blocks);
        expect(first.blocks.map((b) => b.start)).toEqual([2]);
    });

    it("reads afresh when a rule changed the text", () => {
        const first = view(doc);
        const second = view(doc.replace("Prose", "Changed prose"));
        expect(second.reading).not.toBe(first.reading);
        // and the unchanged text still gets the reading it had
        expect(view(doc).reading).toBe(first.reading);
    });

    it("lets a later rule trim first, and its reads then describe the trimmed note", () => {
        const first = view(doc);
        expect(first.protectedCount).toBe(6);
        const trimmed = view(doc, (v) => {
            expect(v.trimTrailingBlankLines()).toBe(2);
            expect(v.lines).toHaveLength(4);
            return v.lines.join("\n");
        });
        expect(trimmed.reading).not.toBe(first.reading);
        expect(trimmed.protectedCount).toBe(4);
        expect(trimmed.blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 2, end: 3 }]);
        // a third view of the untrimmed text reads the untrimmed note
        const third = view(doc);
        expect(third.reading).toBe(first.reading);
        expect(third.protectedCount).toBe(6);
    });

    it("still refuses a trim after anything was read through the same view", () => {
        rewriteDocument(doc, (text, v) => {
            void v.reading;
            expect(() => v.trimTrailingBlankLines()).toThrow(/before the view is read/);
            return text;
        });
    });

    it("hands the original bytes back when nothing changed", () => {
        const crlf = doc.replace(/\n/g, "\r\n");
        const out = rewriteDocument(crlf, (text) => {
            view(text);
            return view(text).out;
        });
        expect(out).toBe(crlf);
    });
});
