import { describe, expect, it } from "vitest";

import { footnoteFacts } from "../src/parsing/footnote-facts";
import { normalizeLineBreaks } from "../src/parsing/obsidian-markdown";

// The positions footnoteFacts derives on top of the tree, which the referee
// suite (obsidian-referee.test.ts) does not check: the column of a label,
// the end of a reference, and the exact stretch of each protected span.
// Which labels are definitions and which references are live is the
// referee's job, against Obsidian's saved answers.

/** Each protected span as [kind, block, the text it covers]. */
function spans(text: string): [string, boolean, string][] {
    const doc = normalizeLineBreaks(text);
    return footnoteFacts(text).protectedSpans.map((s) => [s.kind, s.block, doc.slice(s.from, s.to)]);
}

describe("footnoteFacts: definitions", () => {
    it("gives the column of the label's bracket, after a container's prefix or the line's indentation", () => {
        const facts = footnoteFacts("> [^q]: quoted\n\n   [^i]: indented\n\n- [^l]: in an item\n\n-\t[^t]: after a tab\n");
        expect(facts.definitions.map((d) => [d.name, d.start, d.labelStart])).toEqual([
            ["q", 0, 2],
            ["i", 2, 3],
            ["l", 4, 2],
            // a tab counts as one column, as everywhere in the plugin
            ["t", 6, 2],
        ]);
    });

    it("ends a definition on its last line holding text, its continuation included", () => {
        const facts = footnoteFacts("[^a]: first\n    continued\n\n    second paragraph\n\nafter[^a]\n");
        expect(facts.definitions.map((d) => [d.name, d.start, d.end])).toEqual([["a", 0, 3]]);
    });

    it("keeps the name as written", () => {
        expect(footnoteFacts("[^Note]: x\n").definitions[0].name).toBe("Note");
    });
});

describe("footnoteFacts: references", () => {
    it("gives a reference's start and end column (the end is exclusive)", () => {
        expect(footnoteFacts("text[^ab] more\n").references).toEqual([{ name: "ab", line: 0, start: 4, end: 9, live: true }]);
    });

    it("marks a reference inside an inline footnote as not live (rule E3)", () => {
        const refs = footnoteFacts("x^[inline [^1] note] [^2]\n").references;
        expect(refs.map((r) => [r.name, r.live])).toEqual([
            ["1", false],
            ["2", true],
        ]);
    });

    it("counts a reference inside a %% comment as live (Jason's ruling, 2026-10-03)", () => {
        expect(footnoteFacts("%%\nhidden [^1]\n%%\n").references.map((r) => [r.name, r.line, r.live])).toEqual([["1", 1, true]]);
    });

    it("reports lines of the note with Windows line breaks as the plugin counts them", () => {
        const facts = footnoteFacts("a[^1]\r\n\r\n[^1]: d\r\n");
        expect(facts.references.map((r) => [r.line, r.start])).toEqual([[0, 1]]);
        expect(facts.definitions.map((d) => [d.start, d.end])).toEqual([[2, 2]]);
    });
});

describe("footnoteFacts: protected spans", () => {
    it("covers code, math, HTML, comments, and frontmatter, block and inline", () => {
        const note = [
            "---",
            "a: [^1]",
            "---",
            "text `code [^2]` $m$ $$ a [^3] $$ <!-- c [^4] --> <span>[^5]</span> %% in [^6] %%",
            "",
            "<div>",
            "[^7]",
            "</div>",
            "",
            "    indented [^8]",
            "",
            "```",
            "fence [^9]",
            "```",
            "",
            "$$",
            "math",
            "$$",
            "",
            "%%",
            "block [^10]",
            "%%",
            "",
        ].join("\n");
        expect(spans(note)).toEqual([
            ["frontmatter", true, "---\na: [^1]\n---"],
            ["inlineCode", false, "`code [^2]`"],
            ["inlineMath", false, "$m$"],
            ["inlineMath", false, "$$ a [^3] $$"],
            ["htmlComment", false, "<!-- c [^4] -->"],
            ["percentComment", false, "%% in [^6] %%"],
            ["html", true, "<div>\n[^7]\n</div>"],
            ["code", true, "    indented [^8]"],
            ["code", true, "```\nfence [^9]\n```"],
            ["math", true, "$$\nmath\n$$"],
            ["percentComment", true, "%%\nblock [^10]\n%%"],
        ]);
    });

    it("covers a link's destination and title, an autolink, a link definition's URL, and a wikilink's inside", () => {
        const note = '[link](http://x.com/[^2] "t[^3]") ![img](a.png) <http://y.com> [[note|[^4]]] ![[e.png]]\n\n[ref]: http://z.com/a "t"\n';
        expect(spans(note)).toEqual([
            ["linkDestination", false, '(http://x.com/[^2] "t[^3]")'],
            ["linkDestination", false, "(a.png)"],
            ["linkDestination", false, "<http://y.com>"],
            // a wikilink ends at the first "]]" (rule D1), leaving one "]" over
            ["wikilink", false, "note|[^4"],
            ["wikilink", false, "e.png"],
            ["linkDestination", false, ': http://z.com/a "t"'],
        ]);
    });

    it("finds a link's label end past nested and escaped brackets", () => {
        expect(spans("[a [b] \\] c](dest) ![x [y]](img.png)\n")).toEqual([
            ["linkDestination", false, "(dest)"],
            ["linkDestination", false, "(img.png)"],
        ]);
    });

    it("reads frontmatter after a byte order mark (recorded fact, commit bca376c)", () => {
        const note = String.fromCharCode(0xfeff) + "---\nalias: see[^1] here\n---\n\nbody\n";
        expect(spans(note).map(([kind]) => kind)).toEqual(["frontmatter"]);
        expect(footnoteFacts(note).references).toEqual([]);
    });

    it("gives each span's first and last line", () => {
        const [fence] = footnoteFacts("para\n\n```\nx\ny\n```\n").protectedSpans;
        expect([fence.startLine, fence.endLine]).toEqual([2, 5]);
    });
});
