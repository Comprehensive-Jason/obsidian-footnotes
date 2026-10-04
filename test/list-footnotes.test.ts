import { describe, expect, it } from "vitest";

import { listExistingFootnoteDefinitions } from "../src/editor/doc-context";


import { fakeEditor } from "./helpers/fake-editor";
import { readNote } from "../src/parsing/note-reading";

// The document-scanning behavior the navigation cascade is built on:
// definition names, and reference occurrences with positions. Includes the
// 2026-07-14 regression pin: definitions only count at the start of a line.

// The old listExistingFootnoteReferencesAndLocations died production-dead
// (2026-08-11 review cleanliness); its pins now exercise the primitives the
// cascade actually composes: referenceOccurrences over the masked twin.
function referenceLocations(lines: string[]) {
    const references: { footnote: string; lineNum: number; startIndex: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of readNote(lines).referencesOn(i)) {
            references.push({
                footnote: lines[i].slice(occurrence.start, occurrence.end),
                lineNum: i,
                startIndex: occurrence.start,
            });
        }
    }
    return references;
}

describe("listExistingFootnoteDefinitions", () => {
    it("returns definition names in line order", () => {
        const doc = fakeEditor([
            "alpha[^1] bravo[^note]",
            "",
            "[^1]: one",
            "[^note]: a named one",
        ]);
        expect(listExistingFootnoteDefinitions(doc)).toEqual(["1", "note"]);
    });

    it("ignores references without the definition colon", () => {
        expect(listExistingFootnoteDefinitions(fakeEditor(["alpha[^1] bravo"]))).toEqual([]);
    });

    it("returns an empty list for an empty document", () => {
        expect(listExistingFootnoteDefinitions(fakeEditor([""]))).toEqual([]);
    });

    it("takes only the first definition on a line", () => {
        // definitions normally sit one per line; two on one line is malformed
        // markdown, and the current behavior is to record just the first
        expect(
            listExistingFootnoteDefinitions(fakeEditor(["[^1]: one [^2]: two"])),
        ).toEqual(["1"]);
    });

    it("ignores a definition reference that is not at the start of the line", () => {
        // regression (reported 2026-07-14): mid-line "[^x]:" is not a real
        // footnote definition in markdown and must not be treated as one
        expect(
            listExistingFootnoteDefinitions(fakeEditor(["prose then [^x]: rest"])),
        ).toEqual([]);
    });
});

describe("reference occurrences with positions (via NoteReading.referencesOn)", () => {
    it("records each reference with its line number and start index", () => {
        expect(referenceLocations(["alpha[^1] bravo[^note]"])).toEqual([
            { footnote: "[^1]", lineNum: 0, startIndex: 5 },
            { footnote: "[^note]", lineNum: 0, startIndex: 15 },
        ]);
    });

    it("excludes definition lines", () => {
        expect(referenceLocations(["[^1]: one"])).toEqual([]);
    });

    it("tracks references across multiple lines", () => {
        expect(referenceLocations(["alpha[^1]", "bravo", "charlie[^2]"])).toEqual([
            { footnote: "[^1]", lineNum: 0, startIndex: 5 },
            { footnote: "[^2]", lineNum: 2, startIndex: 7 },
        ]);
    });

    it("records the same reference each time it is used", () => {
        expect(referenceLocations(["alpha[^1] bravo[^1]"])).toEqual([
            { footnote: "[^1]", lineNum: 0, startIndex: 5 },
            { footnote: "[^1]", lineNum: 0, startIndex: 15 },
        ]);
    });

    it("keeps a mid-line reference followed by a literal colon", () => {
        // hunt 2026-07-17: only a column-0 "[^id]:" is a definition; a
        // mid-paragraph "noted[^3]: prose" is a live reference the old
        // (?!:) lookahead used to drop (grammar spec: reference-regexes
        // tests). The definition sits after a blank line: directly under
        // the prose it would be a lazy label, paragraph text whose "[^3]"
        // is a live reference too (the note reading, as Obsidian reads it,
        // since the runtime swap of 2026-10-03)
        expect(
            referenceLocations(["as noted[^3]: more prose", "", "[^3]: the definition"]),
        ).toEqual([{ footnote: "[^3]", lineNum: 0, startIndex: 8 }]);
    });
});
