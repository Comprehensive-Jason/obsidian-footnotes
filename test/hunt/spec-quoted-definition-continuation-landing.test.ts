import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

import {
    jumpToFootnoteDefinition,
    shouldJumpFromDefinitionToReference,
} from "../../src/commands/navigation";

// spec question: does a quoted definition own its continuation lines for the
// purposes of navigation?
//
// Two things follow from the answer:
//   (b) where a jump from the reference LANDS: at the end of the quoted label
//       line, or at the end of the definition's last quoted continuation
//       line;
//   (c) whether a press ON that continuation line jumps BACK to the
//       reference, the way a press at the end of any other definition does.
//
// Reading one, "a quoted definition is one line": this is a deliberate model
// already written down in the code. jumpToFootnoteDefinition's comment says
// "A label in a blockquote never belongs to a block, so its own line is where
// the caret lands." On this reading the landing is the label line, and a
// press on the line below is a press on ordinary quoted prose, so it should
// not jump back. That is what the plugin does today.
//
// Reading two, "a quoted definition is a definition block like any other":
// CONTEXT.md defines a definition block as a label line plus its continuation
// lines, "the unit that moves, merges, and is jumped to as one thing", with
// no exception for quoting. Manual sheet 03 then says a multi-line definition
// lands the caret at the end of its LAST continuation line, and that a caret
// parked at the end of a definition jumps back to the reference on the next
// press. On this reading both (b) and (c) should change.
//
// Nothing decides between them yet: no manual-test sheet has a multi-line
// quoted definition, so the one-line model has never been tested against a
// case where it makes a difference. Worth knowing while deciding: the same
// gap lets a press on that continuation line create a nested footnote, pinned
// in test/hunt/bug-quoted-continuation-press-nests. Adopting reading two
// would close that hole as a side effect; adopting reading one means the
// nesting has to be refused some other way.
//
// Hunt: 2026-09-13. Lens: popup routing and the navigation cascade.

const single = [
    "> [!note] A callout",
    "> body[^cq] here",
    ">",
    "> [^cq]: callout definition",
];

const multi = [...single, ">     its continuation line"];

beforeEach(() => {
    resetNotices();
});

describe("a quoted definition with a continuation line", () => {
    it("control: a one-line quoted definition lands at the end of its label line", () => {
        const doc = fakeEditor(single, { wholeDoc: true });
        expect(
            jumpToFootnoteDefinition("cq", { line: 1, ch: 11 }, fakePlugin({ enablePopupEditor: false }, doc), doc),
        ).toBe(true);
        expect(doc.moves).toEqual([{ line: 3, ch: single[3].length }]);
    });

    it("(b) under reading two, the jump lands at the end of the last continuation line", () => {
        const doc = fakeEditor(multi, { wholeDoc: true });
        expect(
            jumpToFootnoteDefinition("cq", { line: 1, ch: 11 }, fakePlugin({ enablePopupEditor: false }, doc), doc),
        ).toBe(true);
        expect(doc.moves).toEqual([{ line: 4, ch: multi[4].length }]);
    });

    it("(c) under reading two, a press on that continuation line jumps back to the reference", () => {
        const doc = fakeEditor(multi, { wholeDoc: true });
        const handled = shouldJumpFromDefinitionToReference(
            multi[4],
            { line: 4, ch: multi[4].length },
            fakePlugin({ enablePopupEditor: false }, doc),
            doc,
        );
        expect(handled).toBe(true);
        expect(doc.moves).toEqual([{ line: 1, ch: "> body[^cq]".length }]);
    });
});
