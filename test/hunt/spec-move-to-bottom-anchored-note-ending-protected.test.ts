import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// spec question: when a note has the section heading in the MIDDLE of it
// and the note ENDS inside an unclosed protected region (an unclosed code
// fence, or an unclosed "%%" comment), should move-to-bottom still gather
// the definitions under that heading, or stay off?
//
// Reading one, gather. The heading is the anchor and the definitions land
// under it, nowhere near the unclosed region at the end. The creation path
// (buildDefinitionAppend) already puts a brand new definition under the
// heading in exactly this note, and the move rule's own contract says the
// layout it produces "deliberately matches the one buildDefinitionAppend
// produces". On this reading the two paths currently disagree.
//
// Reading two, stay off. This is what the code does today: the
// endsProtected guard refuses the whole rule before it ever looks for the
// heading. The guard is older than the anchored path (8bab1b9, 2026-07-17,
// against 831bfc9, 2026-08-05) and was never revisited afterwards, so its
// blanket refusal may simply predate the case rather than cover it. When
// the rule only ever appended at the very bottom of the note, an unclosed
// region at the end really was in the way.
//
// Hunt: 2026-09-13. Lens: interactions.
//
// How urgent it is not: the layout the creation path produces is already a
// fixed point of the move rule, so nothing churns back and forth and no
// note is damaged either way. The durable trigger is a note that ends in an
// unclosed "%%" by accident, usually a comment the writer never closed. In
// such a note the rule is silently off for as long as the "%%" stays open,
// and no alert says so.
//
// Answered (Jason's ruling on list A, 2026-10-08, stage 3 of the result
// gate design): reading one. The guard is gone; the result gate judges the
// move, and under the heading the definitions stay definitions, the fence
// or comment running from its opener to the end (live Obsidian 1.14.4 on
// sprout, 2026-10-08, answers gs3:a1-fence and gs3:a1-comment, rule F6).
// The "reading one" tests were it.fails, and the "reading two" tests,
// which held the old guard, are gone. How Reading view draws the gathered
// note is on the manual lint-rules sheet for Jason to look at.

const HEADING = "# Footnotes";

const noteEndingIn = (...tail: string[]) =>
    ["intro[^1] text", "", "[^1]: one", "", HEADING, "", ...tail].join("\n");

const gatheredNote = (...tail: string[]) =>
    ["intro[^1] text", "", HEADING, "", "[^1]: one", "", ...tail].join("\n");

const appendSlotLine = (...tail: string[]) => {
    // the same note with no definition in it yet, asking the creation path
    // where a new definition would go
    const editor = fakeEditor(["intro[^1] text", "", HEADING, "", ...tail], {
        cursor: { line: 0, ch: 0 },
        wholeDoc: true,
    });
    const plugin = fakePlugin({
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: HEADING,
    });
    return buildDefinitionAppend(docContext(editor), "1", true, plugin).change.from.line;
};

describe("a mid-note heading with an unclosed code fence at the end", () => {
    const doc = noteEndingIn("```", "unclosed code");

    it("reading one: the definitions gather under the heading", () => {
        expect(moveFootnoteDefinitionsToBottom(doc, HEADING)).toBe(
            gatheredNote("```", "unclosed code"),
        );
    });

    it("the creation path uses the heading slot in the same note", () => {
        // line 3 is the blank line under the heading
        expect(appendSlotLine("```", "unclosed code")).toBe(3);
    });

    it("and that layout is already where the move rule would leave it", () => {
        // so the two paths disagree about the starting note, not about the
        // finished one: nothing churns back and forth
        const gathered = gatheredNote("```", "unclosed code");
        expect(moveFootnoteDefinitionsToBottom(gathered, HEADING)).toBe(gathered);
    });
});

describe("a mid-note heading with an unclosed %% comment at the end", () => {
    // the shape a person actually hits by accident
    const doc = noteEndingIn("%%", "open comment");

    it("reading one: the definitions gather under the heading", () => {
        expect(moveFootnoteDefinitionsToBottom(doc, HEADING)).toBe(
            gatheredNote("%%", "open comment"),
        );
    });

    it("with no section heading, the definitions would land in the comment, so the note comes back untouched", () => {
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });

    it("the creation path uses the heading slot here too", () => {
        expect(appendSlotLine("%%", "open comment")).toBe(3);
    });
});
