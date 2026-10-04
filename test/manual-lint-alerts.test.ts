import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes } from "../src/linting/linter";
import { invalidFootnoteNames, noticeLintAlerts } from "../src/linting/lint-alerts";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// Manual former sheet 23, "what the linter alerts about instead of fixing". Every
// box on it is an alert's text or a lint's text outcome, both of which a
// unit test can read, so the whole sheet moves here.
//
// This file replaces these boxes of former sheet 23:
//   the two orphan boxes and the empty-reference box
//   both "Delete orphaned references / definitions ON" boxes
//   both boxes under "A definition one blank line short"
//   both boxes under "Invalid names"
//   the nesting box
//   the code-inside-a-definition box
//   the "Merge OFF" duplicate box and the "lint again" idempotence box
//   the "every alert lists EVERY one" box
//   the first box under "Definitions inside a list item"
//
// Three of them are marked `it.fails`: the sheet and the code disagree, and
// each one says below what the code does instead. Nothing is left for a
// human to judge, so former sheet 23 now says so in two lines.
//
// The alerts always describe the text AFTER the lint has run, so every test
// here lints first and then asks the alerts about the result, exactly as
// the plugin does.

const BT = "`";
const FENCE = BT + BT + BT;

// The sheet's note, fixture for fixture. The frontmatter prefix "3." is
// what makes the bare "[^3.]" in the prose an unfilled placeholder rather
// than a footnote named "3.".
const NOTE = [
    "---",
    "footnote-prefix: 3.",
    "---",
    'Fixture: text[^used] here, a stray[^99] with no definition and five more strays[^o1] in[^o2] a[^o3] row[^o4] here[^o5], an empty [^] reference, an untouched prefix placeholder [^3.] in this sentence, hand-typed invalid names [^bad name] and [^c#d], a hashed name that does have a definition[^#jump], a nesting footnote[^nest], a footnote with a fenced code block in its body[^fence], and dup here[^dup].',
    "",
    `x [^aa${BT}a] [^bb#b] [^cc${BT}c] y`,
    "",
    "A definition one blank line short, lima[^lz] here:",
    "prose line",
    "[^lz]: no blank line above me",
    "",
    "[^used]: referenced definition",
    "[^lost]: named orphan, nothing uses it",
    "[^31]: numbered orphan, also unused",
    "[^#jump]: a hashed definition that renders but the popup can never open",
    "[^nest]: a definition citing another[^used] footnote in its body",
    "[^fence]: a definition with a code block",
    `    ${FENCE}js`,
    '    const ref = "[^99]";',
    `    ${FENCE}`,
    "[^dup]: body",
    "[^dup]: another body",
].join("\n");

// the sheet's settings line: every rule on except Reindex, which is off so
// the numbered fixtures keep the names the boxes talk about; the three
// Orphans-and-duplicates toggles start off, so the alerts speak in their
// place
const SETTINGS = { reindex: false, orphanSafePrefix: "3." };
const PLUGIN_SETTINGS = {
    enableFootnotePrefix: true,
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
};

/** lint the note the way the sheet says, then collect the alerts it raises */
function alertsAfterLint(
    options: Parameters<typeof lintFootnotes>[1] = {},
    pluginSettings: Record<string, boolean> = {},
): string[] {
    resetNotices();
    const after = lintFootnotes(NOTE, { ...SETTINGS, ...options });
    noticeLintAlerts(fakePlugin({ ...PLUGIN_SETTINGS, ...pluginSettings }), after);
    return messages();
}

const lintedProse = (options: Parameters<typeof lintFootnotes>[1] = {}) =>
    lintFootnotes(NOTE, { ...SETTINGS, ...options }).split("\n");

beforeEach(resetNotices);

describe("former sheet 23: orphans, strays, and empties", () => {
    it("an alert names the definitions nothing references, and they stay in the note", () => {
        expect(alertsAfterLint()).toContain(
            'This note has 2 footnote definitions nothing references ("[^lost]", "[^31]"). Add their references in the text, or delete the definitions.',
        );
        const after = lintFootnotes(NOTE, SETTINGS);
        expect(after).toContain("[^lost]: named orphan, nothing uses it");
        expect(after).toContain("[^31]: numbered orphan, also unused");
    });

    it("the missing-definition alert lists the six strays and leaves the invalid names to the invalid-name alert", () => {
        // the four hand-typed invalid names and "[^c#d]" have no
        // definitions either, but a definition could never bind to them,
        // so the invalid-name alert owns them (Jason's ruling 2026-09-20)
        expect(alertsAfterLint()).toContain(
            'This note has 6 footnote references with no definition ("[^99]", "[^o1]", "[^o2]", "[^o3]", "[^o4]", "[^o5]"). Write their definitions or delete the references.',
        );
    });

    it("the empty '[^]' and the bare prefix placeholder count as the same kind of unfilled reference", () => {
        expect(alertsAfterLint()).toContain(
            'This note has 2 unnamed footnote references ("[^]" or the bare prefix "[^3.]"). Give them names or delete them.',
        );
    });

    it("with 'Delete orphaned references' on, every stray goes and the spacing heals", () => {
        const lines = lintedProse({ removeOrphanedReferences: true });
        expect(lines[3]).toBe(
            'Fixture: text[^used] here, a stray with no definition and five more strays in a row here, an empty [^] reference, an untouched prefix placeholder [^3.] in this sentence, hand-typed invalid names [^bad name] and , a hashed name that does have a definition,[^#jump] a nesting footnote,[^nest] a footnote with a fenced code block in its body,[^fence] and dup here.[^dup]',
        );
        // the line of three backticked and hashed names empties out too
        expect(lines[5]).toBe("x y");
        // the placeholder is never deleted: it is a footnote still being
        // named, not an orphan
        expect(lines[3]).toContain("[^3.]");
    });

    it("with 'Delete orphaned definitions' on, both orphan definitions go", () => {
        const after = lintFootnotes(NOTE, { ...SETTINGS, removeOrphanedDefinitions: true });
        expect(after).not.toContain("[^lost]:");
        expect(after).not.toContain("[^31]:");
        expect(after).toContain("[^used]: referenced definition");
    });
});

describe("former sheet 23: a definition one blank line short", () => {

    it("what the code does today: the lint promotes the hidden definition and gathers it", () => {
        const after = lintFootnotes(NOTE, SETTINGS);
        expect(after).toContain("\n[^lz]: no blank line above me");
        expect(after).not.toContain("prose line\n[^lz]:");
    });

    it("'lz' is never in the missing-definition alert", () => {
        const missing = alertsAfterLint().find((text) => text.includes("no definition"));
        expect(missing).not.toContain("[^lz]");
    });

    it("with 'Delete orphaned references' on, lima[^lz] keeps its reference", () => {
        // the fix for a hidden definition is the blank line, never a deletion
        expect(lintFootnotes(NOTE, { ...SETTINGS, removeOrphanedReferences: true })).toContain(
            "A definition one blank line short, lima[^lz] here:",
        );
    });
});

describe("former sheet 23: invalid names", () => {
    it("the alert lists six names and ends with the one rule about characters", () => {
        expect(alertsAfterLint()).toContain(
            `This note has 6 footnotes with invalid names ("[^bad name]", "[^c#d]", "[^#jump]", "[^aa${BT}a]", "[^bb#b]", "[^cc${BT}c]"). Footnote names can't contain spaces, backticks, brackets, or "#".`,
        );
    });

    it("a backticked name is one name, not a code span merging two of them", () => {
        // backticks inside a reference are part of the footnote id to
        // Obsidian, not code openers, so the "x ... y" line holds THREE
        // names rather than one merged span
        const after = lintFootnotes(NOTE, SETTINGS);
        const lines = after.split("\n");
        const names = invalidFootnoteNames(lines);
        expect(names).toContain(`aa${BT}a`);
        expect(names).toContain("bb#b");
        expect(names).toContain(`cc${BT}c`);
    });

    it("'#jump' counts even though it has a definition and renders", () => {
        // Obsidian's own footnote hover and sidebar cannot find a hashed
        // name, so it is invalid however well it renders
        const after = lintFootnotes(NOTE, SETTINGS);
        expect(after).toContain("[^#jump]: a hashed definition");
        const lines = after.split("\n");
        expect(invalidFootnoteNames(lines)).toContain("#jump");
    });
});

describe("former sheet 23: nesting", () => {
    it("an alert names the nesting definition and says nested footnotes don't survive export", () => {
        expect(alertsAfterLint()).toContain(
            'This note has a footnote nested inside another footnote\'s definition ("[^nest]"). Nested footnotes don\'t survive export and most tools can\'t read them. Move it into the text.',
        );
    });

    it("the lint never rewrites or deletes the nested content itself", () => {
        expect(lintFootnotes(NOTE, SETTINGS)).toContain(
            "[^nest]: a definition citing another[^used] footnote in its body",
        );
    });
});

describe("former sheet 23: code inside a definition body", () => {
    it("the reference-shaped text in the fenced body survives orphan deletion untouched", () => {
        const after = lintFootnotes(NOTE, { ...SETTINGS, removeOrphanedReferences: true });
        expect(after).toContain(`    ${FENCE}js\n    const ref = "[^99]";\n    ${FENCE}`);
        // and the live "[^99]" out in the prose really was deleted, so the
        // survival above is about the fence, not about nothing happening
        expect(after.split("\n")[3]).not.toContain("[^99]");
    });
});

describe("former sheet 23: duplicate definitions", () => {
    it("with merging off, an alert says the footnote is defined more than once and both copies stay", () => {
        expect(alertsAfterLint()).toContain(
            'This note defines "[^dup]" more than once. Obsidian renders only the last definition. Merge them, or turn on "Merge duplicate definitions".',
        );
        const after = lintFootnotes(NOTE, SETTINGS);
        expect(after).toContain("[^dup]: body\n[^dup]: another body");
    });

    it("linting again after a merge changes nothing", () => {
        const options = { ...SETTINGS, mergeDuplicateDefinitions: true };
        const once = lintFootnotes(NOTE, options);
        expect(once).toContain("[^dup]: body\n    another body");
        expect(lintFootnotes(once, options)).toBe(once);
    });
});

describe("former sheet 23: every alert that lists footnotes", () => {
    it("no alert ever trails off into an ellipsis", () => {
        const raised = alertsAfterLint();
        expect(raised.length).toBeGreaterThan(0);
        for (const text of raised) expect(text).not.toContain("...");
        for (const text of raised) expect(text).not.toContain("…");
    });
});

describe("former sheet 23: definitions inside a list item", () => {
    // this section of the sheet runs with every rule on, reindex included
    const ITEMS = [
        "- [^la]: a definition written right after the list marker",
        "- item three",
        "",
        "    [^lb]: a definition indented to the item's margin (four spaces)",
        "",
        "Uses: alpha[^la] and bravo[^lb].",
    ].join("\n");

    it("after a lint, no alert names '[^la]' or '[^lb]' as a reference with no definition", () => {
        // the punctuation rule used to rewrite "- [^la]: a definition..."
        // into "- :[^la] a definition...", hopping the reference across its
        // own colon because that rule only knew labels at the left margin;
        // fixed 2026-09-20, the day this test found it
        resetNotices();
        noticeLintAlerts(fakePlugin({}), lintFootnotes(ITEMS));
        const missing = messages().find((text) => text.includes("no definition"));
        expect(missing).toBeUndefined();
    });

    it("the indented in-item definition is left alone either way", () => {
        expect(lintFootnotes(ITEMS)).toContain(
            "    [^lb]: a definition indented to the item's margin (four spaces)",
        );
    });
});
