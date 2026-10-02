import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { planCarriedPaste } from "../../src/commands/carry-footnotes";
import { carryRegister, handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): the paste compares a carried definition's text with
// the destination's BEFORE the paste's renames, so a definition that cites
// another footnote is merged into one that cites a different footnote of
// the same name.
//
// What the user would see: they copy "p[^a]" where [^a] says "see [^b]"
// and [^b] says "src bee". The destination already has a definition that
// says "see [^b]", but its [^b] is "dest bee". The pasted [^a] is pointed
// at the destination's footnote, so it now leads to "dest bee". The
// carried [^b] is renamed to [^b-2] and appended with nothing pointing at
// it. Pasting the same chain a second time adds the citing definition
// again as [^a-2], where the README promises it is reused.
//
// Hunt 2026-10-02, round 1, lenses carry-reg and carry-int. Cluster C17.
//
// Source of truth: the README's Paste paragraph, "A definition the
// destination already has (same text, whatever its name) is reused", and
// manual sheet 18, "Paste the same clipboard a second time: the ...
// definitions are reused, not added again". Text that cites a renamed
// footnote is not the same text once the rename is made.
//
// Cause: planCarriedPaste compares each carried body with the
// destination's bodies as the body reads in the source. The renames are
// worked out in the same pass but applied to the text only afterwards, so
// the comparison never sees "see [^b-2]".

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

type Pos = { line: number; ch: number };

// A fake editor holding `lines`, with the selection running from `from`
// to `to`.
function editor(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("merge compares bodies before the paste's renames", () => {
    it.fails("does not merge a body whose inner reference is renamed by the same paste", () => {
        const plan = planCarriedPaste("a[^x] c[^b]\n\n[^x]: see [^b]\n[^b]: dest bee", "p[^a]", [
            one("a", "[^a]: see [^b]"),
            one("b", "[^b]: src bee"),
        ]);
        expect(plan.body).toBe("p[^a]");
        expect(plan.definitions).toEqual([one("a", "[^a]: see [^b-2]"), one("b-2", "[^b-2]: src bee")]);
    });

    it.fails("the citing definition is reused the second time, not added as a-2", () => {
        const sourceLines = ["x[^a] y", "", "[^a]: see[^b]", "[^b]: bee"];
        const source = editor(sourceLines, { line: 0, ch: 0 }, { line: 0, ch: 7 });
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, source), clipboardEvent() as never);
        const register = carryRegister();
        expect(register).not.toBeNull();
        const text = register?.text ?? "";
        // The destination already uses [^b] for something else.
        const dest = editor(["d[^b]", "", "[^b]: other"], { line: 0, ch: 5 });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, dest), clipboardEvent(text) as never, dest);
        const afterFirst = dest.lines.slice();
        resetNotices();
        // Paste the same clipboard again, at the end of the first line.
        const dest2 = editor(afterFirst, { line: 0, ch: afterFirst[0].length });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, dest2), clipboardEvent(text) as never, dest2);
        const defsAfterFirst = afterFirst.filter((l) => /^\[\^[^\]]+\]:/.test(l)).length;
        const defsAfterSecond = dest2.lines.filter((l) => /^\[\^[^\]]+\]:/.test(l)).length;
        expect(defsAfterSecond).toBe(defsAfterFirst);
    });
});
