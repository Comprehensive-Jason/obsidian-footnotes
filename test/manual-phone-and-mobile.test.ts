import { describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";

import { InvalidNameCharacters } from "../src/parsing/footnote-grammar";
import { planFootnoteRename } from "../src/commands/rename-footnote";

// Manual sheet P, "phone and mobile-emulation checks".
//
// Almost every check on that sheet needs the phone itself: how the dialog
// sits above the on-screen keyboard, what Obsidian's own long-press menu
// offers, how the popup's label reads on a theme, whether a toolbar tap
// launches a command. None of that is reachable from a unit test, so the
// sheet keeps those checks.
//
// One check is not about the phone at all. The sheet's refused-name box
// says to "type a name that is already taken (`menu` itself, or one that
// fails the rules)" and expect the dialog to show an error. The phone part
// of that box (the keyboard staying up, the field focused, its text
// selected) stays on the sheet. What the planner decides for each of those
// three names is text, and it is what this file pins, because the sheet's
// first suggestion does not do what the sheet says.
//
// Sheet item replaced: none outright. This file covers the naming half of
// the "Rename footnote from the toolbar with a refused name" box, so that
// the box on the sheet can name a value that really is refused.
//
// The sheet's own fixture note, as the sheet holds it.
const SHEET = [
    "Fixture reference[^menu] for the long-press check.",
    "",
    "[^menu]: the definition to rename",
];

/** the note with a second footnote in it, so that a name really can be taken */
const TWO = [
    "Fixture reference[^menu] and another[^other] here.",
    "",
    "[^menu]: the definition to rename",
    "[^other]: the second one",
];

describe("what the Rename footnote dialog does with each refused name", () => {
    // The sheet offers "`menu` itself" as a name that is already taken. It
    // is not taken by ANOTHER footnote: it is this footnote's own name, and
    // the planner treats retyping the current name as nothing to do. The
    // dialog closes quietly on a no-op, so no error ever appears. The test
    // below carries the sheet's promise and fails; the sheet needs a
    // different example.

    it("the footnote's own name is a no-op, so the dialog just closes", () => {
        expect(planFootnoteRename(fakeEditor(SHEET, { wholeDoc: true }), "menu", "menu")).toEqual({
            kind: "noop",
        });
    });

    it("a name that fails the rules is refused, with the reason the dialog shows", () => {
        expect(planFootnoteRename(fakeEditor(SHEET, { wholeDoc: true }), "menu", "two words")).toEqual({
            kind: "invalid",
            reason: InvalidNameCharacters,
        });
    });

    it("a name another footnote in the note already uses is refused as a collision", () => {
        expect(planFootnoteRename(fakeEditor(TWO, { wholeDoc: true }), "menu", "other")).toEqual({
            kind: "collision",
        });
    });
});
