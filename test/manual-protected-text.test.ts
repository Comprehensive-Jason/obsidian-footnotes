import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { ProtectedCreationNotice } from "../src/editor/insertion-liveness";
import { lintFootnotes } from "../src/linting/linter";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { computeNextFootnoteNumber } from "../src/parsing/footnote-grammar";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import { messages, noticed, resetNotices } from "./helpers/notices";

// Manual sheet 11 ("Protected text and read-only views"), moved down into
// units on 2026-09-20. The sheet's creation guards, its lint fixture, its
// "%%" comment section and its wrapped code span are all text outcomes, so
// they belong here. What stays on the sheet is the Reading-view RENDERING
// of the "%%" section and the command palette's contents, neither of which
// a fake editor can see.
//
// Sheet checks replaced here:
//   - the inline code span, the "$$" block, inline math, and the
//     frontmatter line, each pressed with all four insert hotkeys
//   - navigation past a guard, the "$5 or [^n]$6" spot, the lone backslash
//   - Reading view: every hotkey silent AND toast-free
//   - the lint fixture: protected regions byte-for-byte, only "[^s1]"
//     swapping, and the numbered command reserving nothing from them
//   - the "%%" comment section: the press inside a hidden reference, the
//     lint's alert and gathering, and orphan deletion sparing definitions
//     that only commented references use
//   - the wrapped code span: the next number, and what a blank line does
//
// The fence in the fixtures below is the sheet's own text, with the
// checklist prose around it left out.

// ---------------------------------------------------------------- helpers

function editorAt(lines: string[], cursor: { line: number; ch: number }, words = true): FakeEditor {
    return sharedFakeEditor(lines, { cursor, edits: true, wholeDoc: true, words });
}

function pluginFor(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: true,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

/** the same fake, but the view reports Reading view the way Obsidian does */
function readingViewPluginFor(doc: FakeEditor): FootnotePlugin {
    return {
        settings: {
            insertAtEndOfWord: true,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
        },
        app: {
            workspace: {
                getActiveViewOfType: () => ({ editor: doc, getMode: () => "preview" }),
            },
            vault: {},
        },
    } as unknown as FootnotePlugin;
}

const HOTKEYS: [string, (plugin: FootnotePlugin) => Promise<void>][] = [
    ["numbered", insertAutonumFootnote],
    ["named", insertNamedFootnote],
    ["inline", insertInlineFootnote],
    ["paste", pasteInlineFootnote],
];

beforeEach(() => {
    resetNotices();
    // the paste hotkey reads the clipboard; give it one so that a refusal
    // is a real refusal and not a missing browser API
    vi.stubGlobal("navigator", {
        clipboard: { readText: () => Promise.resolve("pasted") },
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
});

// ------------------------------------- creation is blocked in protected text

// the sheet's protected-text fixtures, one note
const GUARD_NOTE = [
    "---",
    "decoy: mentions [^1] and must never be touched",
    "---",
    "an `inline code span` on this line",
    "and $x + y$ inline math",
    "",
    "$$",
    "E = mc^2",
    "$$",
];

const SPOTS: [string, { line: number; ch: number }][] = [
    ["inside the inline code span", { line: 3, ch: 10 }],
    ["inside the $$ math block", { line: 7, ch: 4 }],
    ["inside inline math", { line: 4, ch: 8 }],
    ["on the frontmatter line", { line: 1, ch: 10 }],
];

describe("sheet 11: every insert hotkey refuses in protected text", () => {
    for (const [where, cursor] of SPOTS) {
        it.each(HOTKEYS)(`the %s hotkey ${where}`, async (_name, command) => {
            const doc = editorAt(GUARD_NOTE, { ...cursor });
            await command(pluginFor(doc));
            expect(doc.lines).toEqual(GUARD_NOTE);
            expect(doc.cursor).toEqual(cursor);
            expect(noticed(ProtectedCreationNotice)).toBe(true);
        });
    }
});

describe("sheet 11: the two spots where the footnote IS inserted", () => {
    const LINE = "pay $5 or $6 now, and a lone backslash \\ right here.";

    it("between `$5 or ` and `$6` the reference lands, with no toast", () => {
        // a closing dollar followed by a digit does not close math, so
        // "$5 or [^1]$6" is not a math span and nothing is swallowed
        const doc = editorAt([LINE], { line: 0, ch: LINE.indexOf("$6") });
        return insertAutonumFootnote(pluginFor(doc)).then(() => {
            expect(doc.lines[0]).toBe("pay $5 or [^1]$6 now, and a lone backslash \\ right here.");
            expect(messages()).toEqual([]);
        });
    });

    it("right after the lone backslash the footnote goes BEFORE it", async () => {
        const doc = editorAt([LINE], { line: 0, ch: LINE.indexOf("\\") + 1 });
        await insertAutonumFootnote(pluginFor(doc));
        expect(doc.lines[0]).toBe("pay $5 or $6 now, and a lone backslash [^1]\\ right here.");
        expect(messages()).toEqual([]);
    });
});

describe("sheet 11: navigation is unaffected by the creation guards", () => {
    it("a press on a live reference still jumps to its definition", async () => {
        const lines = ["Real refs to lint: swap me[^s1].", "", "[^s1]: swap definition"];
        const doc = editorAt(lines, { line: 0, ch: 29 });
        await insertAutonumFootnote(pluginFor(doc));
        expect(doc.lines).toEqual(lines);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^s1]: swap definition".length });
    });
});

// ------------------------------------------------------------ Reading view

describe("sheet 11: Reading view", () => {
    it.each(HOTKEYS)("the %s hotkey changes nothing and says nothing", async (_name, command) => {
        const lines = ["alpha bravo charlie"];
        const doc = editorAt(lines, { line: 0, ch: 2 });
        await command(readingViewPluginFor(doc));
        expect(doc.lines).toEqual(lines);
        expect(doc.appliedChanges).toEqual([]);
        expect(messages()).toEqual([]);
    });
});

// ------------------------------------------- the lint leaves protected text

// the sheet's lint fixture, verbatim
const LINT_NOTE = [
    "---",
    "decoy: this note's own frontmatter mentions [^1] and must never be touched",
    "---",
    "Math inline $x[^9].$ stays, display too:",
    "",
    "$$",
    "[^8]: mathematical label",
    "y[^7]",
    "$$",
    "",
    "    indented code[^90] block, standalone",
    "",
    "Comment boundaries: live[^c1] <!-- hidden [^c2]",
    "--> live again[^c3].",
    "",
    "> ```",
    "> quoted fence[^f1]",
    "",
    "- ```",
    "  listed fence[^f2]",
    "  ```",
    "",
    "Inline code fakes `[^88]` and `[^55]: nope`, an escaped literal \\[^9], an inline footnote ^[^inline-content] here, and a quoted live ref:",
    "",
    "> quoted text[^q1] renumbers like any live text",
    "",
    "Real refs to lint: swap me[^s1].",
    "",
    "[^c1]: one",
    "[^c3]: three",
    "[^s1]: swap definition",
    "[^q1]: quoted-reference definition",
].join("\n");

describe("sheet 11: the lint and the protected regions", () => {
    it("leaves every protected line byte-for-byte", () => {
        const after = lintFootnotes(LINT_NOTE, {}).split("\n");
        const untouched = [
            "decoy: this note's own frontmatter mentions [^1] and must never be touched",
            "Math inline $x[^9].$ stays, display too:",
            "[^8]: mathematical label",
            "y[^7]",
            "    indented code[^90] block, standalone",
            "Comment boundaries: live[^c1] <!-- hidden [^c2]",
            "> quoted fence[^f1]",
            "  listed fence[^f2]",
            "Inline code fakes `[^88]` and `[^55]: nope`, an escaped literal \\[^9], an inline footnote ^[^inline-content] here, and a quoted live ref:",
        ];
        for (const line of untouched) expect(after).toContain(line);
    });

    it("swaps the live references across their punctuation, definitions in reading order", () => {
        // Both "[^c1]" and "[^c3]" sit outside the comment, so they are
        // ordinary live text; only "[^c3]" has a full stop to cross. The
        // quoted "[^q1]" is live too, which is why its definition sorts
        // ahead of "[^s1]"'s.
        expect(lintFootnotes(LINT_NOTE, {})).toBe(
            LINT_NOTE.replace("swap me[^s1].", "swap me.[^s1]")
                .replace("live again[^c3].", "live again.[^c3]")
                .replace(
                    "[^s1]: swap definition\n[^q1]: quoted-reference definition",
                    "[^q1]: quoted-reference definition\n[^s1]: swap definition",
                ),
        );
    });

    it("the numbered command reserves nothing from any protected shape", () => {
        // [^9], [^8], [^7], [^90], [^c2], [^f1], [^f2], [^88], the escaped
        // [^9] and the inline footnote's content are all dead text
        expect(computeNextFootnoteNumber(LINT_NOTE)).toBe(1);
    });
});

// ------------------------------------------------ Obsidian "%%" comments

const COMMENT_NOTE = [
    "Hidden reference, live definition: november[^n1] here.",
    "%%",
    "A commented paragraph with a hidden reference[^n2] in it.",
    "%%",
    "",
    "Dead definition: oscar[^o1] here.",
    "%%",
    "[^o1]: this definition sits inside a comment and never renders",
    "%%",
    "",
    "Inline comment with a hidden reference: papa %%hidden[^n3]%% here.",
    "",
    "Numbering counts hidden references: romeo[^1] %%hidden[^2]%% sierra[^3] here.",
    "",
    "A comment-only line is still a paragraph line, tango[^p9] here:",
    "%% a comment-only line %%",
    "[^p9]: a label right under a comment line (lazy)",
    "",
    "An HTML comment line is a block, uniform[^h1] here:",
    "<!-- an HTML comment line -->",
    "[^h1]: a label right under an HTML comment line (a definition)",
    "",
    "[^n1]: november",
    "[^n2]: the hidden reference's definition: it renders, with no visible marker",
    "[^n3]: papa's hidden reference's definition",
    "[^1]: romeo",
    "[^2]: the hidden second reference's definition",
    "[^3]: sierra",
];

describe('sheet 11: Obsidian "%%" comments', () => {
    it("a press inside the hidden [^n2] navigates like a visible reference", async () => {
        const doc = editorAt(COMMENT_NOTE, { line: 2, ch: 47 });
        await insertAutonumFootnote(pluginFor(doc));
        expect(doc.lines).toEqual(COMMENT_NOTE);
        expect(doc.cursor).toEqual({
            line: 23,
            ch: "[^n2]: the hidden reference's definition: it renders, with no visible marker".length,
        });
    });

    it("the lint alerts about o1, gathers the two labels, and leaves the comments alone", () => {
        const before = COMMENT_NOTE.join("\n");
        const after = lintFootnotes(before, {});
        // the commented definition never moves and never wakes up
        expect(after).toContain(
            ["%%", "[^o1]: this definition sits inside a comment and never renders", "%%"].join("\n"),
        );
        // the hidden references stay put and hold their numbers
        expect(after).toContain(
            "Numbering counts hidden references: romeo[^1] %%hidden[^2]%% sierra[^3] here.",
        );
        expect(after).toContain("A commented paragraph with a hidden reference[^n2] in it.");
        expect(after).toContain("papa %%hidden[^n3]%% here.");
        // both labels end up in the definition group at the bottom
        expect(after).toContain("[^p9]: a label right under a comment line (lazy)");
        expect(after).toContain("[^h1]: a label right under an HTML comment line (a definition)");
        expect(after.split("\n").indexOf("[^p9]: a label right under a comment line (lazy)")).toBeGreaterThan(
            after.split("\n").indexOf("An HTML comment line is a block, uniform[^h1] here:"),
        );

        resetNotices();
        noticeLintAlerts(sharedFakePlugin({}), after);
        expect(messages().some((message) => message.includes("[^o1]"))).toBe(true);
    });

    it("deleting orphaned definitions spares the ones only commented references use", () => {
        const after = lintFootnotes(COMMENT_NOTE.join("\n"), {
            removeOrphanedDefinitions: true,
        });
        expect(after).toContain("[^n2]: the hidden reference's definition");
        expect(after).toContain("[^n3]: papa's hidden reference's definition");
        expect(after).toContain("[^2]: the hidden second reference's definition");
    });
});

// ------------------------------------- a code span that wraps across lines

describe("sheet 11: a code span that wraps across lines", () => {
    const WRAPPED = ["Use of a `code", "span[^7] that wraps` onto the next line."];

    it("the next footnote is [^1], because [^7] is inside the span", async () => {
        const doc = editorAt(WRAPPED, { line: 1, ch: WRAPPED[1].length });
        await insertAutonumFootnote(pluginFor(doc));
        expect(doc.lines[1]).toBe("span[^7] that wraps` onto the next line.[^1]");
    });

    it("a blank line between the two lines brings [^7] back to life", async () => {
        const split = [WRAPPED[0], "", WRAPPED[1]];
        const doc = editorAt(split, { line: 2, ch: split[2].length });
        await insertAutonumFootnote(pluginFor(doc));
        expect(doc.lines[2]).toBe("span[^7] that wraps` onto the next line.[^8]");

        resetNotices();
        noticeLintAlerts(sharedFakePlugin({}), split.join("\n"));
        expect(messages().some((message) => message.includes("[^7]"))).toBe(true);
    });
});
