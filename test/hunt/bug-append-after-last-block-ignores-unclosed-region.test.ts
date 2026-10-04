import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";

import { readNote } from "../../src/parsing/note-reading";

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
        // Control, corrected in step 2 of the runtime swap (2026-10-03):
        // the region a definition's continuation line opens reaches no
        // further than the definition, and a label written after a blank
        // line at the left margin ends the definition (rule D5,
        // docs/obsidian-reading-rules.md, held to Obsidian's saved answers
        // by the referee). So an appended definition is not swallowed and
        // the note does not "end inside" the region; the old pin read it
        // the other way, as the hand-written scanner did.
        it("the region ends with the definition, so a definition appended after a blank line is not inside it", () => {
            expect(readNote(noteEndingInsideAnOpener(opener)).openRegionFrom !== -1).toBe(false);
        });

        it("the new definition lands outside that region and is a real definition", () => {
            const lines = noteEndingInsideAnOpener(opener);
            const doc = fakeEditor(lines, { edits: true });
            const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
            doc.transaction({ changes: [change] });
            const after = doc.lines;
            const names = readNote(after).blocks.map((b) => b.name);
            expect({
                landingIsInsideTheUnclosedRegion: readNote(lines).openRegionFrom !== -1 && change.from.line >= readNote(lines).openRegionFrom,
                theNewDefinitionIsRecognized: names.includes("2"),
            }).toEqual({
                landingIsInsideTheUnclosedRegion: false,
                theNewDefinitionIsRecognized: true,
            });
        });
    });
});
