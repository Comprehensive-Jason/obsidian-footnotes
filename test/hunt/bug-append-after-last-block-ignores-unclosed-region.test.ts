import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { findDefinitionBlocks, scanDocument } from "../../src/parsing/markdown-scan";

// BUG: when the note already has a definition, the append goes straight
// after the last definition block and never checks whether the note ends
// inside a comment or a fence that was never closed.
//
// What the user would see: a note whose last definition has a continuation
// line that opens a comment or a code fence and never closes it. Creating
// another footnote writes the new definition at the end of that hidden run,
// so it is hidden too. The footnote renders as plain text, and because lint
// can no longer see the definition, the next run reports the brand new
// reference as an orphan.
//
// Why it happens: buildDefinitionAppend has a guard for exactly this, the
// bug #10 walk that climbs above an unclosed region. But the guard sits
// below the "blocks.length > 0" early return, and that early return never
// looks at endsProtected. The three openers below all produce the same
// definition block, lines 2 to 4, with endsProtected true, so the append
// lands on line 4 inside the hidden run every time. It is the same root
// cause as the sibling pin about a definition block owning an opener
// without its closer.
//
// Hunt: 2026-09-13. Lens: comments.
// Source of truth: definition-append.ts's own bug #10 comment ("A
// definition added at the very end would be born inside it as dead text,
// and the next lint would then delete its live reference as an orphan");
// attack-surface "%% comments" row ("the definition append never lands
// inside an unclosed block"); manual sheet 11 line ~118 ("nothing is
// inserted or moved inside either %% block").

const noteEndingInsideAnOpener = (opener: string) => [
    "alpha[^1].",
    "",
    "[^1]: one",
    opener,
    "    hidden",
];

const openers: [string, string][] = [
    ["a %% comment", "    %%"],
    ["an HTML comment", "    <!--"],
    ["a code fence", "    ```"],
];

describe("bug: the append after the last definition block ignores an unclosed region", () => {
    describe.each(openers)("with %s opened by the last definition's continuation line", (_name, opener) => {
        // Green control: the scanner already knows the note ends inside
        // something that was never closed. The append just never asks.
        // (Obsidian runs a region opened by a definition's continuation
        // on across unindented lines, verified 2026-09-16, so the
        // list-item rule of ruling A3 does not apply here.)
        it("the scan reports that the note ends inside the unclosed region", () => {
            expect(scanDocument(noteEndingInsideAnOpener(opener)).endsProtected).toBe(true);
        });

        it("the new definition lands outside that region and is a real definition", () => {
            const lines = noteEndingInsideAnOpener(opener);
            const doc = fakeEditor(lines, { edits: true });
            const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
            doc.transaction({ changes: [change] });
            const after = doc.lines;
            const names = findDefinitionBlocks(after, scanDocument(after)).map((b) => b.name);
            expect({
                landingIsInsideTheUnclosedRegion: scanDocument(lines).endsProtectedAt[change.from.line],
                theNewDefinitionIsRecognized: names.includes("2"),
            }).toEqual({
                landingIsInsideTheUnclosedRegion: false,
                theNewDefinitionIsRecognized: true,
            });
        });
    });
});
