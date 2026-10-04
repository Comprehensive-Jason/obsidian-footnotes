// Imported from the glm-cycle-10 hunt of 2026-09-16 (OpenCode worktree); rewritten to the probed reading 2026-09-16.
// PROBED 2026-09-16 (GLM hunt cycle 10, Reading view): a list marker followed by five or more spaces holds indented code ("-      item[^1]" renders a code block reading "item[^1]"), under prose and after a blank line alike, and a line indented to that code carries it on; a "10." with such a gap under prose is paragraph text (the marker cannot interrupt a paragraph) and its reference is live, while after a blank line it is code too; a gap of four spaces is ordinary item text. The scan now protects such lines.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


const refsIn = (doc: string): string[] => {
    const lines = doc.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const { name } of readNote(lines).referencesOn(i)) {
            out.push(name);
        }
    }
    return out;
};

const protectedIn = (doc: string): readonly boolean[] => readNote(doc.split("\n")).protectedLines;

describe("a list marker with a gap of five or more spaces holds code, not live text", () => {
    it("a bullet's wide-gap text is dead code under prose", () => {
        expect(refsIn("prose line\n-      item[^1]\n\n[^1]: d")).toEqual([]);
        expect(protectedIn("prose line\n-      item[^1]\n\n[^1]: d")).toEqual([false, true, false, false]);
    });

    it("and after a blank line", () => {
        expect(refsIn("prose line\n\n-      item[^1]\n\n[^1]: d")).toEqual([]);
    });

    it("a \"1.\" with a wide gap interrupts prose the same way", () => {
        expect(refsIn("prose line\n1.      item[^1]\n\n[^1]: d")).toEqual([]);
    });

    it("REFUTED for \"10.\" under prose: the marker cannot interrupt a paragraph, so the line is live text", () => {
        expect(refsIn("prose line\n10.      item[^1]\n\n[^1]: d")).toEqual(["1"]);
    });

    it("a \"10.\" with a wide gap after a blank line is code", () => {
        expect(refsIn("prose line\n\n10.      item[^1]\n\n[^1]: d")).toEqual([]);
    });

    it("a line indented to the code carries the code block on", () => {
        expect(protectedIn("-      item[^1]\n       more[^2]\n\n[^1]: d\n[^2]: e")).toEqual([true, true, false, false, false]);
        expect(refsIn("-      item[^1]\n       more[^2]\n\n[^1]: d\n[^2]: e")).toEqual([]);
    });

    it("control: a gap of four spaces is ordinary item text", () => {
        expect(refsIn("-    item[^1]\n\n[^1]: d")).toEqual(["1"]);
    });

    it("control: a normal two-space gap stays live under prose", () => {
        expect(refsIn("prose line\n-  item[^1]\n\n[^1]: d")).toEqual(["1"]);
    });
});
