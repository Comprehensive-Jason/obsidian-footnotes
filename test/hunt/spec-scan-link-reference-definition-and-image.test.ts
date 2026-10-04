import { describe, expect, it } from "vitest";

import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { definitionStartLines, maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";

// spec question: should a "[^1]" inside a link reference definition's
// title or address, or inside a reference-style image's alt text, count
// as a live reference?
//
// What it does now: in "[foo]: /url "a [^1] b"" (a link reference
// definition: a line that names a link's address once so the text can
// use "[foo]"), the "[^1]" in the title is read as live. So is the one
// in "[foo]: /u[^1]", where it is part of the address, and the one in
// "![alt[^1]][img]", a reference-style image's alt text.
// What a user might expect: all three are dead, the way a "[^1]" inside
// an inline link's address or an inline image's alt text already is.
// Why it is a question and not a bug: Reading view has not been checked
// for any of the three. In micromark the title and address are attribute
// text and the alt text is plain text, so no footnote shows; whether
// Obsidian agrees, and whether these shapes turn up in real notes, is
// open.
//
// Since step 2 of the runtime swap (2026-10-03) the masked twin comes from
// the note reading, Obsidian's own parser rebuilt: it reads the title and
// the alt text as text no footnote lives in, so those two now read dead,
// and the address one still reads live (the parser takes "/u" as the
// address and "[^1]" as text after it, or no definition at all). Reading
// view has still not been checked for any of the three.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X14.
//
// Source of truth: CommonMark 4.7 (link reference definitions) and 6.4
// (images), and spec-image-alt-reference (resolved in Reading view
// 2026-09-16: a reference inside an inline image's alt text is dead).

// Every live reference in `doc`, as "line:name".
function liveReferences(doc: string): string[] {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    return lines.flatMap((l, i) => referenceOccurrences(l, masked[i], starts[i]).map((o) => `${i}:${o.name}`));
}

describe("spec question: link reference definitions and reference-style images", () => {
    it("a title of a link reference definition is attribute text, its [^1] dead", () => {
        expect(liveReferences('[foo]: /url "a [^1] b"\n\nsee [foo]')).toEqual([]);
    });

    it.fails("an address '/u[^1]' of a link reference definition is URL text", () => {
        expect(liveReferences("[foo]: /u[^1]\n\nsee [foo]")).toEqual([]);
    });

    it("a reference-style image's alt text is dead like an inline image's", () => {
        expect(liveReferences("![alt[^1]][img]\n\n[img]: /x.png")).toEqual([]);
    });
});
