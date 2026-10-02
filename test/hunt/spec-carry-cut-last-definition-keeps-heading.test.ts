import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: with Remove empty section heading on, should a cut whose
// selection IS the section's last definition remove the emptied heading
// too?
//
// What it does now: the note is "Body [^1] here", "", "# Footnotes", "",
// "[^1]: one", and the user selects the definition line "[^1]: one" and
// cuts it. The selection needs no definition (it holds the definition
// itself) and orphans none, so the plugin leaves the cut to the editor.
// The definition goes, and the empty "# Footnotes" heading stays.
// What a user might expect: the heading goes too, because the cut left no
// footnotes under it and nothing else below it.
// Why it is a question and not a bug: the two places that describe the
// setting disagree. The setting's description in the settings tab says
// "a cut", any cut. The README says "a cut that carries the last
// definition away", and this cut carries nothing: the definition IS the
// selection. Whether the setting covers every cut that empties the
// section, or only the ones the plugin takes over, is Jason's call.
// Taking this cut over would also mean the plugin handles cuts that hold
// no reference at all.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C34.
//
// Source of truth: the Remove empty section heading description in
// src/settings.ts: "When ... a cut, or linting leaves no footnotes under
// the section heading, and nothing else below it, the heading goes too."
// Against it, README: "a cut that carries the last definition away".

/** A stand-in for the browser's clipboard event: it records what the hook writes and whether the hook took the event over. */
function clipboardEvent() {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: () => "",
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

/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a cut whose selection is the section's last definition", () => {
    it.fails("removes the heading when the cut selection holds the section's last definition", () => {
        const doc = editor(["Body [^1] here", "", "# Footnotes", "", "[^1]: one"], { line: 4, ch: 0 }, { line: 4, ch: 9 });
        const settings = {
            carryFootnotesOnCopy: true,
            enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "# Footnotes",
            removeEmptySectionHeading: true,
        };
        const event = clipboardEvent();
        handleCut(fakePlugin(settings, doc), event as never);
        if (!event.defaultPrevented) {
            // The hook left the cut alone, so do what the editor's own cut
            // does: delete the selected text.
            doc.transaction({ changes: [{ from: { line: 4, ch: 0 }, to: { line: 4, ch: 9 }, text: "" }] });
        }
        expect(doc.lines).not.toContain("# Footnotes");
    });
});
