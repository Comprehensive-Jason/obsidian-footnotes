import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss): cutting the only reference to a footnote that is
// defined twice deletes both definitions but carries only the last one.
//
// What the user would see: the note has "a[^d] b" and two definitions,
// "[^d]: one" and "[^d]: two". They cut "a[^d] " and paste it elsewhere.
// Only "two" arrives; "one" is in neither the note nor the clipboard.
// The toast says "Cut with 2 footnote definitions ... paste to carry them
// along", promising both.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C4.
//
// Source of truth: README, "Cut takes the definitions that nothing else
// in the note uses along with the text". The lint's merge-duplicates rule
// exists because both bodies of a duplicate are the user's content (it
// keeps every body), and the lint never destroys content silently. Copy
// carries the LAST definition, the one Obsidian renders (the docstring
// of carriedDefinitions).
//
// Cause: definitionsOrphanedByCut lists every block the cut leaves with
// nothing to reference it, duplicates included, so handleCut deletes
// both. carriedDefinitions carries only the last block of a name, so the
// earlier body never reaches the clipboard. The toast counts the deleted
// blocks, not the carried ones.

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

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("cutting the only reference of a footnote defined twice", () => {
    it.fails("every definition body the cut deletes reaches the clipboard (or the earlier one stays in the note)", () => {
        const from = { line: 0, ch: 0 };
        const to = { line: 0, ch: 6 };
        const doc = fakeEditor(["a[^d] b", "", "[^d]: one", "", "[^d]: two"], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        const survives = (event.written["text/plain"] ?? "").includes("one") || doc.lines.join("\n").includes("one");
        expect(survives).toBe(true);
    });

    it.fails("the toast does not promise to carry a definition the clipboard lacks", () => {
        const from = { line: 0, ch: 0 };
        const to = { line: 0, ch: 6 };
        const doc = fakeEditor(["a[^d] b", "", "[^d]: one", "", "[^d]: two"], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        // How many [^d] definitions the clipboard actually holds.
        const carriedCount = ((event.written["text/plain"] ?? "").match(/^\[\^d\]:/gim) ?? []).length;
        const claimed = messages().find((m) => m.startsWith("Cut with"));
        expect(claimed).toBe(
            `Cut with ${carriedCount} footnote definition${carriedCount === 1 ? "" : "s"} that nothing else used; paste to carry ${carriedCount === 1 ? "it" : "them"} along.`,
        );
    });
});
