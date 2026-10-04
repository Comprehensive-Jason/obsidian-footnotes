// Imported from the GLM 5.3 Flash cycle 3 hunt of 2026-09-16 (OpenCode worktree); 1 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (GLM hunt cycle 3, probed in Reading view): "![^1](url)" and "![alt[^1]](url)" render an embed with no footnote reference and no definition entry, so an image's alt text is dead and the masker blots it.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: is a "[^1]" inside an IMAGE's alt text - "![^1](url)" -
// a live footnote reference in Reading view?
//
// micromark (probed for this hunt): no. The document "![^1](url)\n\n[^1]:
// one" parses to an <img alt="^1"> and NO footnote section at all - the
// reference inside the alt is never resolved, so the definition is not
// emitted either. Image alt text is stringified, not rendered as inline
// content the way LINK text is (the pinned contrast: "[x[^1]](url)" keeps
// its reference live because link text renders).
//
// The plugin reads it live: the masker blots only a link's "(destination)"
// and a wikilink's interior, so the alt text survives masking and
// referenceOccurrences counts the reference. Every rule then treats it as
// a real footnote: it reserves and takes a number in reindex, the
// missing-definition alert tells the user to write a definition for it
// when none exists, and a definition referenced ONLY from an image alt
// survives Delete orphaned definitions.
//
// What the user would see if Reading view follows micromark: a "[^1]"
// inside an image alt is dead text, but the plugin numbers around it and
// alerts about it as if it rendered - and with `Delete orphaned
// references` on, an alt-text reference keeps a definition alive that
// Obsidian shows as orphaned. If Obsidian instead renders alt-text
// references live (its renderer has diverged from micromark before, e.g.
// sheet 14's footnote-interruption ruling and the one-line setext rule),
// the code is right and this pin should be deleted.
//
// NEEDS A LIVE CHECK: does "![^1](url)" with "[^1]: one" in the note show
// a footnote reference (and the "one" entry) in Reading view?
//
// Source of truth: micromark 4.0 output for the exact document (this
// hunt); Obsidian unprobed; the link-text contrast pinned by hunt cycle 1.
// Settings involved: none (the scan feeds every rule).

const refsOf = (doc: string): string[] => {
    const lines = doc.split("\n");
    return lines.flatMap((_, i) =>
        readNote(lines).referencesOn(i).map((o) => o.name),
    );
};

describe("spec: a reference inside an image's alt text", () => {
    it("is dead text, as micromark and Reading view render it", () => {
        expect(refsOf("![^1](url)\n\n[^1]: one")).toEqual([]);
    });

    it("control: a reference in link TEXT stays live (pinned contrast)", () => {
        expect(refsOf("[x[^1]](url)\n\n[^1]: one")).toEqual(["1"]);
    });
});
