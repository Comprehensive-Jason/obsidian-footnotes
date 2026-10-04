import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../src/parsing/footnote-grammar";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { orphanedFootnoteReferenceNames } from "../src/linting/rules/remove-orphaned-references";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import { readNote } from "../src/parsing/note-reading";

// A code span that wraps across lines (B30, Jason's check in Obsidian
// 2026-09-16). CommonMark lets a backtick run close on a later line of the
// same paragraph, and Reading view renders the whole stretch as one grey
// code span with a "[^7]" inside it shown literally; the footnote never
// renders. Live Preview reads line by line and shows a live "[^7]", but the
// plugin matches Reading view, as it does everywhere else (the ruling).

const twin = (text: string) => {
    const lines = text.split("\n");
    return [...readNote(lines).maskedLines()];
};

describe("a code span that wraps across lines", () => {
    it("is masked from its opener to its closer, the lines between included", () => {
        const masked = twin("use of a `code\nspan[^7] that wraps` onto the next line.\nreal[^1]");
        expect(masked[0]).toBe("use of a \0\0\0\0\0");
        expect(masked[1]).toBe("\0".repeat("span[^7] that wraps`".length) + " onto the next line.");
        expect(masked[2]).toBe("real[^1]");
    });

    it("a whole line inside the span is protected, and the closer line is not", () => {
        const lines = ["a `one", "two[^7]", "three` b"];
        const scan = readNote(lines);
        expect(scan.protectedLines).toEqual([false, true, false]);
        // the span is open at the start of the two lines after its opener
        const reading = readNote(lines);
        expect(lines.map((_, i) => reading.regionOpenAt(i))).toEqual([false, true, true]);
    });

    it("the reference inside reserves no number and is no orphan", () => {
        const doc = "use of a `code\nspan[^7] that wraps` onto the next line.\nreal[^1]\n\n[^1]: def";
        expect(computeNextFootnoteNumber(doc)).toBe(2);
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
        resetNotices();
        noticeLintAlerts(fakePlugin({}), doc);
        expect(messages().some((m) => m.includes("[^7]"))).toBe(false);
    });

    it("a label line inside the span is code, not a definition", () => {
        const lines = ["text `open", "[^x]: not a definition", "close` tail"];
        expect(readNote(lines).labelLines).toEqual([false, false, false]);
    });

    it("a run with no closer anywhere in the paragraph stays literal", () => {
        const masked = twin("a `lonely tick[^7]\nstill prose[^8]");
        expect(masked).toEqual(["a `lonely tick[^7]", "still prose[^8]"]);
    });

    it("a blank line ends the search: the next paragraph cannot close it", () => {
        const masked = twin("a `open[^7]\n\nclose` here[^8]");
        expect(masked).toEqual(["a `open[^7]", "", "close` here[^8]"]);
    });

    it("a fence, a heading, or a rule ends the search too", () => {
        expect(twin("a `open[^7]\n```\nclose`\n```")[0]).toBe("a `open[^7]");
        expect(twin("a `open[^7]\n# close`")[0]).toBe("a `open[^7]");
        expect(twin("a `open[^7]\n---\nclose`")[0]).toBe("a `open[^7]");
    });

    it("the closing run must be the opener's exact length", () => {
        const masked = twin("a ``open[^7]\nnot ` this\nbut `` this[^8]");
        expect(masked[0]).toBe("a \0".repeat(1) + "\0".repeat("`open[^7]".length));
        expect(masked[1]).toBe("\0".repeat("not ` this".length));
        expect(masked[2]).toBe("\0".repeat("but ``".length) + " this[^8]");
    });

    it("the first unclosed run that closes ahead wins, and swallows a later run on its line", () => {
        const masked = twin("a `` b ` c[^7]\nd `` e[^8]");
        expect(masked[0]).toBe("a " + "\0".repeat("`` b ` c[^7]".length));
        expect(masked[1]).toBe("\0".repeat("d ``".length) + " e[^8]");
    });

    it("text after the closer is live again, and can open a comment of its own", () => {
        const lines = ["a `open", "close` live[^1] <!-- hidden[^9]", "still hidden --> back[^2]"];
        const masked = [...readNote(lines).maskedLines()];
        expect(masked[1]).toBe("\0".repeat("close`".length) + " live[^1] " + "\0".repeat("<!-- hidden[^9]".length));
        expect(readNote(lines).regionOpenAt(2)).toBe(true);
        expect(masked[2]).toBe("\0".repeat("still hidden -->".length) + " back[^2]");
    });

    it("a comment opened before the run claims the run, so nothing carries over", () => {
        const masked = twin("a <!-- x `y --> z\nw` v[^8]");
        expect(masked[1]).toBe("w` v[^8]");
    });
});
