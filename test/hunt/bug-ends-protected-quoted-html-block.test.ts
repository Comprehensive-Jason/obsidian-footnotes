// Imported from the GLM 5.3 Flash cycle 7 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (GLM hunt cycle 7, probed in Reading view): "> <div>", "> more html" followed by "[^1]: def" at column 0 renders NO footnote (the appended line is lazily swallowed by the quote's HTML block), and the list-item twin behaves the same, so endsProtected is right to be true there and the append walks above the block. micromark's container reading does not hold in Obsidian here.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-7). 2 of 4 tests carry it.fails; the controls do not.
import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// BUG: `endsProtectedNow` in markdown-scan.ts returns `htmlBlock !== null`
// with no container check - the ONE region state without one. Every other
// region gates on its container: a fence needs `depth === 0 && listColumn
// === null`, a %% block `commentBlock.depth === 0`, an inline comment or
// math region `regionDepth === 0`, and the module's own comment says why:
// "An unclosed region inside a blockquote can't reach a line appended at
// the end of the note: that appended line ends the quote, exactly as it
// does for a fence inside a blockquote ... a fence inside a LIST ITEM
// can't reach it either". An HTML block is container-bounded everywhere
// else in the same scanner - the htmlBlock branch's own `inContainer` test
// ends the block at the first line shallower than its container (the same
// shape the fence branch implements), and CommonMark says the same (a
// leaf block inside a container ends with the container). So a note whose
// LAST line sits inside a quoted or list-item HTML block reports
// `endsProtected` true, and:
//
//   - move-to-bottom refuses to gather definitions at all (the rule's own
//     contract: "A note that ends inside an unclosed code fence or comment
//     comes back untouched"), even though Reading view renders an appended
//     "[^1]: def" as a live footnote there - the container, quote or item,
//     ends at the appended column-0 line and the HTML block dies with it
//     (micromark oracle: "> <div>\n> more html\n[^1]: def\n\nuse [^1]"
//     parses the definition and renders the footnote; the blockquote
//     closes before it).
//   - the definition append walks the new definition ABOVE the quoted
//     block instead of to the bottom, via the same endsProtectedAt flags.
//
// What the user sees: on a note that ends with an HTML fragment inside a
// quote or a list item (a pasted `<div>` card, say), every lint leaves the
// definitions where they are, scattered mid-note, and reports
// "Footnotes linted." - the never-silent posture never applies because no
// rule can see the problem. The document-level control (an unclosed
// `<div>` at the column-0 end of the note) is correctly refused.
//
// Source of truth: CommonMark 4.6/4.8 container semantics + micromark
// ("--- quoted html block then appended definition:" renders the footnote)
// + the plugin's own A3 ruling recorded in endsProtectedNow's comment (an
// appended line ends the quote/item, probed for fences) + the plugin's own
// inContainer logic, which already says the block dies with its container.
// Residual doubt flagged honestly: Obsidian is recorded to let a `%%`
// comment or `$$` math block opened in a CONTAINER run on past the append
// (the endsProtectedNow comment), so a live Reading-view probe of the
// exact HTML shape would settle it; the internal inconsistency (four
// region states checked, one not) stands either way.
//
// Settings involved: `Gather definitions` (move-to-bottom), and every
// creation press that appends a definition (buildDefinitionAppend).

const quotedDoc = "text[^1]\n\n[^1]: def\n\npara\n\n> <div>\n> more html";
const itemDoc = "text[^1]\n\n[^1]: def\n\npara\n\n- <div>\n  more html";

// Revised in step 2 of the runtime swap (2026-10-03). The 2026-09-16
// probe put "[^1]: def" DIRECTLY under the quoted "<div>" block, where it
// is swallowed as a lazy line. What the plugin writes at the end of a note
// goes after a blank line (move-to-bottom always puts one in, and so does
// the append), and a blank line ends a "<div>" HTML block (CommonMark's
// type 6, stock in Obsidian's parser) and the quote or list item around
// it. So whether a note "ends protected" is now asked exactly that way,
// with a definition appended after a blank line (NoteReading.openRegionFrom),
// and a "<div>" block at the end of a note no longer holds the
// definitions back. An HTML block that a blank line does not end ("<pre>",
// "<!--", and the other CommonMark types 1 to 5) still does. Settled
// against the live app with Reading view on 2026-10-03 (the runtime swap,
// step 4): after a blank line, "[^1]: def" is a definition under a quoted
// "<div>" block, under one in a list item, and under one at the top level,
// and Reading view renders it; under "<pre>" it is swallowed
// (swap34:html-quoted-div-blank, swap34:html-item-div-blank,
// swap34:html-div-blank-top, swap34:html-pre-blank-top in
// test/obsidian-answers/swap34-probes.json).
describe("a note that ends inside an HTML block opened inside a container", () => {
    it("a definition appended after a blank line is not swallowed by the quoted HTML block", () => {
        expect(readNote(quotedDoc.split("\n")).openRegionFrom !== -1).toBe(false);
    });

    it("nor by the list-item HTML block", () => {
        expect(readNote(itemDoc.split("\n")).openRegionFrom !== -1).toBe(false);
    });

    it("move-to-bottom gathers the definition under the block, after a blank line", () => {
        expect(moveFootnoteDefinitionsToBottom(quotedDoc, "")).toBe("text[^1]\n\npara\n\n> <div>\n> more html\n\n[^1]: def");
    });

    it("control: a blank line ends a \"<div>\" block at the column-0 end of the note too", () => {
        expect(readNote("text[^1]\n\n<div>\nmore html".split("\n")).openRegionFrom !== -1).toBe(false);
    });

    it("control: a \"<pre>\" block, which no blank line ends, runs on over an appended definition", () => {
        expect(readNote("text[^1]\n\n<pre>\nmore html".split("\n")).openRegionFrom !== -1).toBe(true);
    });

    it("control: an unclosed DOCUMENT-LEVEL fence still refuses (pinned behavior)", () => {
        expect(readNote("text[^1]\n\n```\ncode".split("\n")).openRegionFrom !== -1).toBe(true);
    });
});