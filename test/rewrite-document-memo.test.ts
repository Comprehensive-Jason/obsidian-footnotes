import { describe, expect, it } from "vitest";

import { DocumentScan } from "../src/parsing/markdown-scan";
import { rewriteDocument } from "../src/linting/rewrite-document";

// rewriteDocument keeps a one-entry memo while an outer call is running
// (Jason, 2026-09-09): views built for the identical text share their
// scan, masked twin, definition starts and blocks instead of each scanning
// again. These pins say exactly when the memo may and may not be used.
//
// A shared scan is observed by identity: two views served from the memo
// hand back the very same DocumentScan object, and a fresh scan is a
// different object. (Counting calls through a module mock does not work
// here: the vitest config shares workers across files, so a module another
// spec already loaded bypasses the mock.)

const doc = ["Prose[^1] here.", "", "[^1]: the definition", "    continued", "", ""].join("\n");

/** Runs `rule` on `text` inside the current composition and hands back what it saw. */
function view(text: string, rule?: (v: Parameters<Parameters<typeof rewriteDocument>[1]>[1]) => string) {
    const seen: { scan: DocumentScan; blocks: readonly { name: string; start: number; end: number }[] }[] = [];
    const out = rewriteDocument(text, (inner, v) => {
        const result = rule ? rule(v) : inner;
        seen.push({ scan: v.scan, blocks: v.blocks });
        return result;
    });
    if (seen.length !== 1) throw new Error("the rule ran " + String(seen.length) + " times");
    return { out, ...seen[0] };
}

describe("the rewriteDocument memo", () => {
    it("shares one scan between rules that receive identical text inside one composition", () => {
        rewriteDocument(doc, (text) => {
            const first = view(text);
            const second = view(text);
            expect(second.scan).toBe(first.scan);
            expect(second.blocks).toBe(first.blocks);
            expect(first.blocks.map((b) => b.start)).toEqual([2]);
            return text;
        });
    });

    it("scans afresh when a rule changed the text", () => {
        rewriteDocument(doc, (text) => {
            const first = view(text);
            const changed = text.replace("Prose", "Changed prose");
            const second = view(changed);
            expect(second.scan).not.toBe(first.scan);
            // and the unchanged text is still served from the memo afterwards
            expect(view(text).scan).not.toBe(first.scan); // the memo now holds `changed`
            return changed;
        });
    });

    it("forgets the memo once the outermost call returns", () => {
        const first = view(doc);
        const second = view(doc);
        expect(second.scan).not.toBe(first.scan);
    });

    it("lets a later rule trim first, and its reads then describe the trimmed note", () => {
        rewriteDocument(doc, (text) => {
            const first = view(text);
            expect(first.scan.isProtected).toHaveLength(6);
            const trimmed = view(text, (v) => {
                expect(v.trimTrailingBlankLines()).toBe(2);
                expect(v.lines).toHaveLength(4);
                return v.lines.join("\n");
            });
            expect(trimmed.scan).not.toBe(first.scan);
            expect(trimmed.scan.isProtected).toHaveLength(4);
            expect(trimmed.blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 2, end: 3 }]);
            // a third view for the same text must not inherit the trimmed
            // pieces; it gets the untrimmed ones the first view published
            const third = view(text);
            expect(third.scan).toBe(first.scan);
            expect(third.scan.isProtected).toHaveLength(6);
            return text;
        });
    });

    it("keeps the inherited pieces when a trim removes nothing", () => {
        const noTrailing = doc.replace(/\n+$/, "");
        rewriteDocument(noTrailing, (text) => {
            const first = view(text);
            const second = view(text, (v) => {
                expect(v.trimTrailingBlankLines()).toBe(0);
                return v.lines.join("\n");
            });
            expect(second.scan).toBe(first.scan);
            expect(second.blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 2, end: 3 }]);
            return text;
        });
    });

    it("still refuses a trim after anything was read through the same view", () => {
        rewriteDocument(doc, (text, v) => {
            void v.scan;
            expect(() => v.trimTrailingBlankLines()).toThrow(/before the view is scanned/);
            return text;
        });
    });

    it("hands the original bytes back when nothing changed, memo or not", () => {
        const crlf = doc.replace(/\n/g, "\r\n");
        const out = rewriteDocument(crlf, (text) => {
            view(text);
            return view(text).out;
        });
        expect(out).toBe(crlf);
    });
});
