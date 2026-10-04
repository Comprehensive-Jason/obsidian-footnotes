import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { findDefinitionBlocks, scanDocument } from "../../src/parsing/markdown-scan";

// BUG (wrong output): when the last definition's body opens a code block,
// math block, or comment that never closes, a new footnote's definition is
// written between that definition's label and its body, so the body moves
// to the new, empty footnote.
//
// What the user would see: the note ends with "[^1]: one" and an indented
// "    ```" (or "    $$", or "    <!--") with "    hidden" under it, all
// part of footnote 1. They create footnote 2. The new "[^2]: " is written
// right under "[^1]: one" with a blank line on each side, and the
// indented region after it now continues [^2]: Reading view shows the
// hidden block inside footnote 2, and footnote 1 is just "one".
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E10.
//
// Source of truth: the plugin's own block reader (findDefinitionBlocks
// says [^1] owns lines 2 to 4 before the press and only line 2 after it,
// while the new [^2] owns the region), and micromark with the footnote
// extension, which renders the region inside footnote 1 before the append
// and inside footnote 2 after it. The pin
// bug-append-after-last-block-ignores-unclosed-region asserts only that the
// new label lands outside the region and is recognized, which this shape
// satisfies too.
//
// Cause: buildDefinitionAppend's walk above an unclosed region (e0c0587,
// B18, and the 2026-08-11 bug #10 guard) climbs to the last line a
// definition can follow, which here is the label line of [^1] itself, and
// inserts there. An indented chunk after a definition's blank gap is that
// definition's continuation, so the region is handed to the new label.

/** The name of the definition block that owns the line holding `text`, or undefined when no block does. */
function owner(lines: string[], text: string): string | undefined {
    const at = lines.findIndex((l) => l.includes(text));
    return findDefinitionBlocks(lines, scanDocument(lines)).find((b) => b.start <= at && at <= b.end)?.name;
}

describe("the append above an unclosed region keeps the region with its own footnote", () => {
    for (const [name, opener] of [
        ["a code fence", "    ```"],
        ["a math block", "    $$"],
        ["an HTML comment", "    <!--"],
    ] as [string, string][]) {
        it(`${name}: the region still belongs to [^1] after [^2] is appended`, () => {
            const lines = ["alpha[^1].", "", "[^1]: one", opener, "    hidden"];
            expect(owner(lines, "hidden")).toBe("1");
            const doc = fakeEditor([...lines], { edits: true });
            const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
            doc.transaction({ changes: [change] });
            // Today: "2", the region now continues the new definition.
            expect(owner(doc.lines, "hidden")).toBe("1");
        });
    }
});
