// Imported from the GLM 5.3 Flash cycle 6 hunt of 2026-09-16 (OpenCode worktree), then REFUTED in Reading view the same day and rewritten as controls.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// GLM claimed a "[^9]" inside a link reference definition's destination
// ("[foo]: [^9]") is dead text, as micromark reads it. Reading view
// disagrees (probed 2026-09-16): Obsidian does not take "[foo]: [^9]" or
// "[foo]: <[^9]>" as a link reference definition at all; the line renders
// literally and the reference in it is live, with its footnote. So the
// plugin's reading (a live reference) is right, and these controls pin it.
const refs = (doc: string): string[] => {
    const lines = doc.split("\n");
    return lines.flatMap((_, i) => readNote(lines).referencesOn(i).map((o) => o.name));
};

describe("REFUTED: a reference-shaped destination in a link reference definition is live text", () => {
    it("a bare destination keeps its reference live", () => {
        expect(refs("[foo]: [^9]\n\nuse[^9]\n\n[^9]: nine")).toEqual(["9", "9"]);
    });

    it("an angle-bracketed destination too", () => {
        expect(refs("[foo]: <[^9]>\n\nuse[^9]\n\n[^9]: nine")).toEqual(["9", "9"]);
    });
});
