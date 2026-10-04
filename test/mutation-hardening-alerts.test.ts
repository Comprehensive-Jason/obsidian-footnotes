import { beforeEach, describe, expect, it } from "vitest";

import { noticeCalls } from "./mocks/obsidian";
import { messages, resetNotices } from "./helpers/notices";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

import FootnotePlugin from "../src/main";
import {
    countEmptyFootnoteReferences,
    invalidFootnoteNames,
    noticeLintAlerts,
    orphanSafePrefixFor,
} from "../src/linting/lint-alerts";
import { InvalidNameCharacters } from "../src/parsing/footnote-grammar";

// Mutation hardening for the post-lint alert tail (Stryker re-baseline
// 2026-08-12: lint-alerts scored 19.79% - the merge-duplicates work pinned
// the NAME lists but nobody asserted the notices themselves, so every
// gating condition and message literal survived). These pin the exact
// texts and the exact conditions each alert fires under.

function fakePlugin(settings: Partial<FootnotePlugin["settings"]>): FootnotePlugin {
    return sharedFakePlugin({
        enableFootnotePrefix: false,
        lintDeleteOrphanedReferences: false,
        lintDeleteOrphanedDefinitions: false,
        lintMergeDuplicateDefinitions: false,
        ...settings,
    });
}

beforeEach(() => {
    resetNotices();
});

const messageShown = (text: string) => messages().includes(text);
const anyMessageContaining = (part: string) =>
    messages().some((text) => text.includes(part));

describe("countEmptyFootnoteReferences", () => {
    it("counts every [^] occurrence, per line and per needle", () => {
        expect(countEmptyFootnoteReferences("a [^] b [^]\n[^] c")).toBe(3);
    });

    it("ignores [^] inside protected text", () => {
        expect(
            countEmptyFootnoteReferences("```\n[^]\n```\nlive [^] here"),
        ).toBe(1);
    });

    it("counts the bare-prefix placeholder only when a prefix is given", () => {
        expect(countEmptyFootnoteReferences("x [^3.] y", "3.")).toBe(1);
        expect(countEmptyFootnoteReferences("x [^3.] y")).toBe(0);
    });

    it("has no secret default needle", () => {
        // the prefix default is "" - a mutated default would count this
        expect(countEmptyFootnoteReferences("a [^Stryker was here!] b")).toBe(0);
    });
});

describe("orphanSafePrefixFor", () => {
    const withPrefix = '---\nfootnote-prefix: "3."\n---\nbody';

    it("returns the note's valid prefix while the feature is on", () => {
        expect(
            orphanSafePrefixFor(
                fakePlugin({ enableFootnotePrefix: true }),
                withPrefix,
            ),
        ).toBe("3.");
    });

    it("returns nothing while the feature is off", () => {
        expect(orphanSafePrefixFor(fakePlugin({}), withPrefix)).toBe("");
    });

    it("returns nothing for an invalid prefix", () => {
        // a trailing digit is invalid ("3" + autonumber "1" reads as 31)
        expect(
            orphanSafePrefixFor(
                fakePlugin({ enableFootnotePrefix: true }),
                '---\nfootnote-prefix: "3"\n---\nbody',
            ),
        ).toBe("");
    });

    it("returns nothing when the note has no prefix property", () => {
        expect(
            orphanSafePrefixFor(
                fakePlugin({ enableFootnotePrefix: true }),
                "plain body",
            ),
        ).toBe("");
    });
});

describe("the unnamed-reference alert", () => {
    it("singular, with the plain hint", () => {
        noticeLintAlerts(fakePlugin({}), "left [^] behind");
        expect(
            messageShown(
                'This note has an unnamed footnote reference ("[^]"). Give it a name or delete it.',
            ),
        ).toBe(true);
    });

    it("plural, with the count", () => {
        noticeLintAlerts(fakePlugin({}), "left [^] and [^] behind");
        expect(
            messageShown(
                'This note has 2 unnamed footnote references ("[^]"). Give them names or delete them.',
            ),
        ).toBe(true);
    });

    it("mentions the bare prefix in the hint while the feature is on", () => {
        noticeLintAlerts(
            fakePlugin({ enableFootnotePrefix: true }),
            '---\nfootnote-prefix: "3."\n---\nleft [^3.] behind',
        );
        expect(
            messageShown(
                'This note has an unnamed footnote reference ("[^]" or the bare prefix "[^3.]"). Give it a name or delete it.',
            ),
        ).toBe(true);
    });

    it("does not count the bare prefix while the feature is off", () => {
        noticeLintAlerts(
            fakePlugin({}),
            '---\nfootnote-prefix: "3."\n---\nfine [^3.] here\n\n[^3.]: named on purpose',
        );
        expect(anyMessageContaining("unnamed")).toBe(false);
    });

    it("stays silent when the note has none", () => {
        noticeLintAlerts(fakePlugin({}), "fine [^x] here\n\n[^x]: d");
        expect(anyMessageContaining("unnamed")).toBe(false);
    });
});

describe("the orphaned-reference alert", () => {
    it("singular, naming the reference", () => {
        noticeLintAlerts(fakePlugin({}), "see [^lost]");
        expect(
            messageShown(
                'This note has a footnote reference with no definition ("[^lost]"). Write its definition or delete the reference.',
            ),
        ).toBe(true);
    });

    it("plural, naming them all", () => {
        noticeLintAlerts(fakePlugin({}), "see [^a] [^b] [^c]");
        expect(
            messageShown(
                'This note has 3 footnote references with no definition ("[^a]", "[^b]", "[^c]"). Write their definitions or delete the references.',
            ),
        ).toBe(true);
    });

    it("names EVERY orphan, no ellipsis - the user needs the whole list to fix them (2026-09-08)", () => {
        noticeLintAlerts(fakePlugin({}), "see [^a] [^b] [^c] [^d] [^e]");
        expect(
            messageShown(
                'This note has 5 footnote references with no definition ("[^a]", "[^b]", "[^c]", "[^d]", "[^e]"). Write their definitions or delete the references.',
            ),
        ).toBe(true);
    });

    it("stays silent while the delete toggle is on (deletion owns it)", () => {
        noticeLintAlerts(
            fakePlugin({ lintDeleteOrphanedReferences: true }),
            "see [^lost]",
        );
        expect(anyMessageContaining("with no definition")).toBe(false);
    });
});

describe("the orphaned-definition alert", () => {
    it("singular, naming the definition", () => {
        noticeLintAlerts(fakePlugin({}), "[^unused]: nothing points here");
        expect(
            messageShown(
                'This note has a footnote definition nothing references ("[^unused]"). Add a "[^unused]" reference in the text, or delete the definition.',
            ),
        ).toBe(true);
    });

    it("plural, naming them", () => {
        noticeLintAlerts(fakePlugin({}), "[^u1]: a\n[^u2]: b");
        expect(
            messageShown(
                'This note has 2 footnote definitions nothing references ("[^u1]", "[^u2]"). Add their references in the text, or delete the definitions.',
            ),
        ).toBe(true);
    });

    it("stays silent while the delete toggle is on", () => {
        noticeLintAlerts(
            fakePlugin({ lintDeleteOrphanedDefinitions: true }),
            "[^unused]: nothing points here",
        );
        expect(anyMessageContaining("nothing references")).toBe(false);
    });
});

describe("the duplicate-definition alert", () => {
    it("singular, naming the footnote", () => {
        noticeLintAlerts(fakePlugin({}), "see [^d]\n\n[^d]: one\n\n[^d]: two");
        expect(
            messageShown(
                'This note defines "[^d]" more than once. Obsidian renders only the last definition. Merge them, or turn on "Merge duplicate definitions".',
            ),
        ).toBe(true);
    });

    it("plural, naming them", () => {
        noticeLintAlerts(
            fakePlugin({}),
            "see [^d] and [^e]\n\n[^d]: one\n\n[^d]: two\n\n[^e]: one\n\n[^e]: two",
        );
        expect(
            messageShown(
                'This note defines 2 footnotes more than once ("[^d]", "[^e]"). Obsidian renders only each one\'s last definition. Merge them, or turn on "Merge duplicate definitions".',
            ),
        ).toBe(true);
    });

    it("stays silent while the merge toggle is on (merging owns it)", () => {
        noticeLintAlerts(
            fakePlugin({ lintMergeDuplicateDefinitions: true }),
            "see [^d]\n\n[^d]: one\n\n[^d]: two",
        );
        expect(anyMessageContaining("more than once")).toBe(false);
    });
});

describe("the shared gate", () => {
    it("a note without any [^ raises no alert at all", () => {
        noticeLintAlerts(fakePlugin({}), "plain prose, nothing here");
        expect(noticeCalls).toEqual([]);
    });

    it("a note whose footnotes are all healthy raises no alert either", () => {
        // kills the empty-names early-return mutants: without them the
        // plural branches would toast "This note has 0 …"
        noticeLintAlerts(fakePlugin({}), "fine [^x] here\n\n[^x]: d");
        expect(noticeCalls).toEqual([]);
    });
});

// The invalid-name alert (Jason's L-series pass 2026-09-08): creation and
// rename refuse spaces, backticks, brackets, and "#", but a hand-typed or
// pre-existing name slips past every rule and used to stay silent - the
// orphan rules skip such names on purpose (they read as prose).
describe("the invalid-name alert", () => {
    const names = (markdown: string) => {
        const lines = markdown.split("\n");
        return invalidFootnoteNames(lines);
    };

    it("finds spaced, backticked, and hashed names in references and definition labels, one entry per name", () => {
        expect(
            names("see [^bad name] and [^#tag] and [^Bad Name]\n\n[^#tag]: def\n[^tick`y]: def"),
        ).toEqual(["bad name", "#tag", "tick`y"]);
    });

    it("ignores valid names and masked fakes", () => {
        expect(names("see [^ok] and `[^a b]` here\n\n[^ok]: def\n\n```\n[^x y]: fenced\n```")).toEqual([]);
    });

    it("alerts once, naming the footnote and the rule", () => {
        noticeLintAlerts(fakePlugin({}), "see [^bad name] here\n\n[^bad name]: def");
        expect(
            messageShown(
                `This note has a footnote with an invalid name ("[^bad name]"). ${InvalidNameCharacters}`,
            ),
        ).toBe(true);
    });

    it("plural, listing every name", () => {
        noticeLintAlerts(fakePlugin({}), "see [^a b] [^c#d] [^e`f]");
        expect(
            messageShown(
                `This note has 3 footnotes with invalid names ("[^a b]", "[^c#d]", "[^e\`f]"). ${InvalidNameCharacters}`,
            ),
        ).toBe(true);
    });

    it("stays silent for a clean note", () => {
        noticeLintAlerts(fakePlugin({}), "see [^ok]\n\n[^ok]: def");
        expect(anyMessageContaining("invalid name")).toBe(false);
    });

    it("two backticked names on one line are two names, not one merged span (Jason's page, 2026-09-08)", () => {
        noticeLintAlerts(fakePlugin({}), "x [^aa`a] [^bb#b] [^cc`c] y");
        expect(
            messageShown(
                `This note has 3 footnotes with invalid names ("[^aa\`a]", "[^bb#b]", "[^cc\`c]"). ${InvalidNameCharacters}`,
            ),
        ).toBe(true);
    });
});

