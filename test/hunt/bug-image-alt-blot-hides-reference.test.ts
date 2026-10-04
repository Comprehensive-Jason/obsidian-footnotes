// Imported from the glm-cycle-9 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 9, all four shapes probed in Reading view: the footnote renders beside the image, the math, the code span, and the closed comment). The image's alt blot is kept apart in the reference-shape index and counts only for questions asked past its start.
// Imported from the GLM 5.3 Flash cycle 13 hunt of 2026-09-16 (OpenCode worktree); 4 of 5 tests carry it.fails: all marked by this hunt.
import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// BUG (GLM hunt cycle 13, 2026-09-16): the image-alt pre-blot in
// maskLineRegions runs BEFORE the reading head reaches anything, and it feeds
// the same blot() that drives ReferenceShapeIndex.lastBlotted. The index's
// own contract ("Every blot so far lies behind i") is thereby broken: after
// an image on the line, lastBlotted sits AHEAD of the head, so inside(i)
// returns false for every reference opener the image sits after. A "$", a
// backtick, or a "<!--" inside such a reference's NAME is then no longer
// recognized as name text, opens the construct it looks like, and the
// construct's blot range covers the reference's own "]" - the reference
// disappears from the masked twin.
//
// Obsidian reads the bracket construct first, so a "$" inside a reference
// is name text that never opens math (Jason verified live 2026-08-10; the
// scanner's own documented rule), a backtick inside a name is footnote-id
// text (the manual lint-alerts tests: "[^aa`a] [^bb#b] [^cc`c]" renders three footnotes), and
// "[^a<!--b]" renders as a live footnote (Kimi sweep 2026-09-13, verified
// in Reading view). An image's alt text is dead, but only the ALT is
// (cycle 8): the reference after the image must stay live.
//
// What the user sees: the reference renders in Reading view, but the
// plugin cannot see it. With `Delete orphaned definitions` ON, the lint
// judges "[^a$b]: def" unreferenced and EATS it while the superscript
// still renders. With the toggle off, the orphaned-definition alert names
// it falsely on every lint. Reindex, apply-prefix, and rename all skip the
// invisible reference, so a renumbered definition stops pairing with it.
//
// Source of truth: the plugin's own recorded Reading-view probes (the
// dollar-in-name and comment-in-name verifications cited above) + the
// ReferenceShapeIndex invariant stated at
// src/parsing/markdown-reading.ts ("Every blot so far lies behind i"), which
// the image pre-blot violates.
//
// Settings involved: `Delete orphaned definitions` (the eating), Reindex
// and `Renumber named footnotes` (the skipped reference).

const ctxOf = (doc: string) => {
    const lines = doc.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { lines, reading, masked, starts };
};

const namesOn = (doc: string, line: number): string[] => {
    const { lines } = ctxOf(doc);
    return readNote(lines).referencesOn(line).map(
        (occurrence) => occurrence.name,
    );
};

const deleteOrphans: LintOptions = {
    fixPunctuation: false,
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: false,
    reindexOptions: { renumberNamedFootnotes: false, keepOrphanedDefinitions: true },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
};

describe("an image on the line poisons the reference-shape index", () => {
    it("control: a dollar-in-name reference beside math, with no image, stays visible", () => {
        // the scanner's own documented rule: a "$" inside "[^...]" is name
        // text; only the "$m$" pair is masked
        expect(namesOn("see [^a$b]$m$ tail", 0)).toEqual(["a$b"]);
    });

    it("a dollar-in-name reference after an image is not blotted away by a math pair", () => {
        // "see [^a$b]![i](u)$m$ tail": the name's "$" opens a phantom math
        // span whose blot range covers the reference's "]", so the
        // reference vanishes from the masked twin
        expect(namesOn("see [^a$b]![i](u)$m$ tail", 0)).toEqual(["a$b"]);
    });

    it("a backtick-in-name reference after an image is not swallowed by a code span", () => {
        expect(namesOn("see [^a`b]![i](u) tail `c` end", 0)).toEqual(["a`b"]);
    });

    it("the definition of the hidden reference is not eaten by Delete orphaned definitions", () => {
        const doc = "see [^a$b]![i](u)$m$ tail\n\n[^a$b]: def";
        expect(lintFootnotes(doc, deleteOrphans)).toContain("[^a$b]: def");
    });

    it("a comment-in-name reference whose paragraph closes with --> stays live", () => {
        // with a closer later in the same paragraph the unclosed "<!--" is
        // NOT treated as literal text, so the phantom comment blots the
        // reference's tail and runs on to the next line
        const doc = "body [^c<!--d] ![i](u) tail\n--> end\n\n[^c<!--d]: def";
        const { reading } = ctxOf(doc);
        expect(namesOn(doc, 0)).toEqual(["c<!--d"]);
        // the phantom comment must not swallow the following line either
        expect(reading.protectedLines[1]).toBe(false);
    });
});
