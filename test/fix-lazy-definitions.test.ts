import { readNote } from "../src/parsing/note-reading";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { docArb } from "./arbitraries";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../src/settings";
import { lintFootnotes, lintOptionsFromSettings, lintRulesAllDisabled } from "../src/linting/linter";
import { fixLazyDefinitions, fixLazyDefinitionsRule } from "../src/linting/rules/fix-lazy-definitions";
import { lazyDefinitionLabelNames } from "../src/linting/rules/remove-orphaned-references";
import { footnoteRules } from "../src/linting/rules";
import {
    definitionStartLines,
    lazyDefinitionLabelLines,
    maskProtectedLines,
    scanDocument,
} from "../src/parsing/markdown-scan";

// "Fix definitions hidden by a missing blank line" (Jason, 2026-09-09): a
// "[^x]:" directly under a prose line is lazy paragraph text to Obsidian
// (the prose-label rule). While the toggle is on, linting inserts the one
// blank line the definition needs (a bare ">" inside a quote or callout)
// and the rest of the pipeline then treats it as the definition it was
// meant to be: gathered when move-to-bottom is on, left in place when it
// is off. While the toggle is off, the lazy-definition alert speaks instead.

const lazyIn = (doc: string): string[] => {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    return lazyDefinitionLabelNames(lines, scan, masked, definitionStartLines(lines, scan, (i) => masked[i]));
};

describe("fixLazyDefinitions inserts the blank line a hidden definition needs", () => {
    it.each([
        ["under a paragraph line", "prose\n[^1]: a\n\nx[^1]", "prose\n\n[^1]: a\n\nx[^1]"],
        ["under a list item", "- item\n[^1]: a\n\nx[^1]", "- item\n\n[^1]: a\n\nx[^1]"],
        // a label under a table row is a definition, not a lazy label (ruling
        // A2, 2026-09-15): that case lives in test/hunt/spec-fix-lazy-label-mid-table
        ["on the last line of the note", "x[^1]\n\ntail prose\n[^1]: a", "x[^1]\n\ntail prose\n\n[^1]: a"],
        ["inside a quote, with a bare quote line", "> prose\n> [^1]: a\n\nx[^1]", "> prose\n>\n> [^1]: a\n\nx[^1]"],
        [
            "inside a callout body, with a bare quote line",
            "> [!note] T\n> body\n> [^1]: a\n\nx[^1]",
            "> [!note] T\n> body\n>\n> [^1]: a\n\nx[^1]",
        ],
        ["inside a nested quote, with the nested marker", "> > prose\n> > [^1]: a", "> > prose\n> >\n> > [^1]: a"],
        [
            "once above a run of labels: the second sits under a definition then",
            "prose\n[^d2]: first\n[^d1]: second\n\nx[^d1] y[^d2]",
            "prose\n\n[^d2]: first\n[^d1]: second\n\nx[^d1] y[^d2]",
        ],
        [
            "above each separate run",
            "prose\n[^1]: a\n\nprose2\n[^2]: b\n\nx[^1] y[^2]",
            "prose\n\n[^1]: a\n\nprose2\n\n[^2]: b\n\nx[^1] y[^2]",
        ],
    ])("%s", (_name, before, after) => {
        expect(lazyIn(before)).not.toEqual([]);
        expect(fixLazyDefinitions(before)).toBe(after);
        expect(lazyIn(after)).toEqual([]);
    });

    it("is idempotent and returns a clean note byte-identical, mixed endings included", () => {
        const fixed = fixLazyDefinitions("prose\n[^1]: a\n\nx[^1]");
        expect(fixLazyDefinitions(fixed)).toBe(fixed);
        const clean = "x[^1]\r\n\r\n[^1]: def\nplain[^2]\n\n[^2]: two";
        expect(fixLazyDefinitions(clean)).toBe(clean);
        // the note's own endings come back on the inserted line's neighbors
        expect(fixLazyDefinitions("prose\r\n[^1]: a\r\n\r\nx[^1]")).toBe("prose\r\n\r\n[^1]: a\r\n\r\nx[^1]");
    });

    it("leaves label-shaped lines inside protected regions alone", () => {
        const fenced = "prose\n```\n[^1]: not a definition\n```\n\nx[^1]";
        expect(fixLazyDefinitions(fenced)).toBe(fenced);
        const commented = "prose\n<!--\n[^1]: hidden\n-->\n\nx[^1]";
        expect(fixLazyDefinitions(commented)).toBe(commented);
        const math = "prose\n$$\n[^1]: hidden\n$$\n\nx[^1]";
        expect(fixLazyDefinitions(math)).toBe(math);
        const inline = "prose\n`[^1]: code` text";
        expect(fixLazyDefinitions(inline)).toBe(inline);
    });

    it("never leaves a lazy label behind, and only ever inserts blank or bare-quote lines", { timeout: 30_000 }, () => {
        const isInsertable = (line: string) => /^ {0,3}(?:>[ \t]?)*$/.test(line) && line.trimEnd() === line;
        // the protected lines of a note, as a sorted list of their text: the
        // swallow guard's own measure of "the blank line would change how
        // Obsidian reads the note"
        const protectedTexts = (text: string): string => {
            const lines = text.split(/\r?\n/);
            const scan = scanDocument(lines);
            return lines.filter((_, i) => scan.isProtected[i]).sort().join("\u0000");
        };
        fc.assert(
            fc.property(docArb, (doc) => {
                const fixed = fixLazyDefinitions(doc);
                // A lazy label may only be left behind when the blank line
                // it needs would make the definition swallow protected text
                // below it (the swallow guard, 2026-09-15), or would not make
                // it a definition at all in Obsidian's reading (the runtime
                // swap, 2026-10-03): for every label still lazy, inserting
                // its blank line must change the set of protected lines or
                // leave the label undefined.
                const fixedLines = fixed.split(/\r?\n/);
                const fixedScan = scanDocument(fixedLines);
                const fixedMasked = maskProtectedLines(fixedLines, fixedScan);
                const leftover = lazyDefinitionLabelLines(
                    fixedLines,
                    fixedScan,
                    fixedMasked,
                    definitionStartLines(fixedLines, fixedScan, (i) => fixedMasked[i]),
                );
                for (const at of leftover) {
                    const markers = (/^((?: {0,3}>[ \t]?)*)/.exec(fixedLines[at])?.[1] ?? "").trimEnd();
                    const trialLines = [...fixedLines.slice(0, at), markers, ...fixedLines.slice(at)];
                    const trial = trialLines.join("\n");
                    if (!readNote(trialLines).labelLines[at + 1]) continue;
                    expect(protectedTexts(trial)).not.toBe(protectedTexts(fixed));
                }
                // every input line survives, in order; the extra lines are insertable
                const input = doc.split(/\r?\n/);
                const output = fixed.split(/\r?\n/);
                let j = 0;
                for (const line of output) {
                    if (j < input.length && line === input[j]) {
                        j++;
                        continue;
                    }
                    expect(isInsertable(line)).toBe(true);
                }
                expect(j).toBe(input.length);
            }),
            { numRuns: 200 },
        );
    });

    it("is in the rule registry, first, with runnable examples", () => {
        expect(footnoteRules[0]).toBe(fixLazyDefinitionsRule);
        for (const example of fixLazyDefinitionsRule.examples) {
            expect(fixLazyDefinitionsRule.apply(example.before)).toBe(example.after);
        }
    });
});

describe("the lint pipeline with the toggle", () => {
    const doc = "Alpha[^1] here.\n[^1]: def\n\nTail.";

    it("on (the default): the promoted definition is gathered when move-to-bottom is on", () => {
        expect(lintFootnotes(doc)).toBe("Alpha[^1] here.\n\nTail.\n\n[^1]: def");
    });

    it("on, move-to-bottom off: the definition stays where it is, one blank line up", () => {
        expect(lintFootnotes(doc, { moveDefinitionsToBottom: false })).toBe("Alpha[^1] here.\n\n[^1]: def\n\nTail.");
    });

    it("off: the label stays lazy and untouched", () => {
        expect(lintFootnotes(doc, { fixLazyDefinitions: false })).toBe(doc);
    });

    it("runs before the orphan and duplicate rules, which then judge the promoted definition", () => {
        // a hidden definition nothing references is an orphaned definition once
        // fixed; deleting the note's last block takes its separator blank
        // line with it (2026-09-16), so nothing dangles at the end
        expect(lintFootnotes("prose\n[^9]: nobody", { removeOrphanedDefinitions: true })).toBe("prose");
        expect(lintFootnotes("prose\n[^9]: nobody", { removeOrphanedDefinitions: false, reindex: false })).toBe(
            "prose\n\n[^9]: nobody",
        );
        // a hidden copy next to a real one is a duplicate once fixed
        expect(lintFootnotes("x[^1]\nprose\n[^1]: hidden\n\n[^1]: real", { mergeDuplicateDefinitions: true })).toBe(
            "x[^1]\nprose\n\n[^1]: hidden\n    real",
        );
    });

    it("is idempotent for the pipeline on the sheet shapes", () => {
        for (const options of [{}, { moveDefinitionsToBottom: false }, { removeOrphanedDefinitions: true }]) {
            const once = lintFootnotes(doc, options);
            expect(lintFootnotes(once, options)).toBe(once);
        }
    });

    it("maps from the setting and counts toward 'all rules off'", () => {
        expect(lintOptionsFromSettings(fakePlugin({ lintFixLazyDefinitions: false }), "", "").fixLazyDefinitions).toBe(false);
        expect(lintOptionsFromSettings(fakePlugin({ ...DEFAULT_SETTINGS }), "", "").fixLazyDefinitions).toBe(true);
        expect(DEFAULT_SETTINGS.lintFixLazyDefinitions).toBe(true);
        const allOff = {
            lintFixPunctuation: false,
            lintMoveToBottom: false,
            lintReindex: false,
            lintApplyPrefix: false,
            lintDeleteOrphanedReferences: false,
            lintDeleteOrphanedDefinitions: false,
            lintMergeDuplicateDefinitions: false,
            lintFixLazyDefinitions: false,
        };
        expect(lintRulesAllDisabled(fakePlugin(allOff))).toBe(true);
        expect(lintRulesAllDisabled(fakePlugin({ ...allOff, lintFixLazyDefinitions: true }))).toBe(false);
    });
});

describe("the lazy-definition alert and the toggle", () => {
    beforeEach(resetNotices);
    const doc = "Alpha[^1] here.\n[^1]: def\n\nTail.";
    const lazyAlert = () => messages().some((m) => m.includes("reads as plain text"));

    it("stays quiet once the lint has fixed the line", () => {
        const plugin = fakePlugin({});
        noticeLintAlerts(plugin, lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc)));
        expect(lazyAlert()).toBe(false);
    });

    it("speaks while the toggle is off", () => {
        const plugin = fakePlugin({ lintFixLazyDefinitions: false });
        noticeLintAlerts(plugin, lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc)));
        expect(lazyAlert()).toBe(true);
    });
});

describe("a lazy label whose blank line would swallow code stays lazy (lint property find, 2026-09-15)", () => {
    // "%% c %%" is a paragraph line, so the label under it is lazy; the
    // tab-indented line two lines below is CODE while the label is prose.
    // Give the label its blank line and that chunk becomes the definition's
    // continuation (indented, after a blank line), and the code is gone.
    // The rule leaves such a label alone; the lazy alert still names it.
    const doc = "%% c %%\n[^94]: lazy under a comment line\n\n\tcode-shaped[^89]";

    it("inserts nothing", () => {
        expect(fixLazyDefinitions(doc)).toBe(doc);
    });

    it("the label is still reported as lazy", () => {
        expect(lazyIn(doc)).toEqual(["94"]);
    });

    it("but a label with plain prose below it is still fixed", () => {
        const plain = "%% c %%\n[^94]: lazy under a comment line\n\nplain[^94] prose";
        expect(fixLazyDefinitions(plain)).toBe("%% c %%\n\n[^94]: lazy under a comment line\n\nplain[^94] prose");
    });
});
