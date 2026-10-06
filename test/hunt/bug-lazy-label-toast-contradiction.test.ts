import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): copying a lazy label line and pasting it gives a toast
// that contradicts itself.
//
// What the user would see: the note reads "Para." with "[^1]: one" right
// under it, a lazy label (a label line under a paragraph, which Obsidian
// reads as more of that paragraph, so it defines nothing). The user copies
// "[^1]: one" and pastes it after "Dest." in another note. The toast says
// "Pasted with 1 footnote definition: 1 added." and, in the same breath,
// '"[^1]" has no definition to carry.'
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X14.
//
// Origin: pre-existing.
//
// This shares its root with bug-register-reads-selection-alone (cluster
// X7): the copy carries the lazy label as a definition at all only because
// the register reads the selection on its own. Once that is fixed, this
// toast should no longer say "no definition" either way, so this pin
// checks only that.
//
// Source of truth: the README's Paste paragraph: the toast names a
// reference that travelled without a definition; a footnote the same
// paste just added has one.
//
// Cause: remember() in src/commands/carry-footnotes-hooks.ts takes the
// missing names from the note reading (where [^1] has no definition: the
// lazy label is paragraph text), and the carried blocks from the selection
// read on its own (where "[^1]: one" is a definition), so the two halves
// of the register disagree about [^1].

interface FakeClipboardEvent {
    clipboardData: { getData(type: string): string; setData(type: string, value: string): void; types: string[] };
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
    written: Record<string, string>;
}

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clipboardEvent(text = ""): FakeClipboardEvent {
    const event: FakeClipboardEvent = {
        written: {},
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
const settings = { carryFootnotesOnCopy: true, enableRemoveBlankLastLines: true, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
const editor = (lines: string[], from: Pos, to = from) => fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("the toast after pasting a copied lazy label", () => {
    it("copying a lazy label line and pasting it: the toast does not say the footnote it just added has no definition", () => {
        const source = editor(["Para.", "[^1]: one"], { line: 1, ch: 0 }, { line: 1, ch: 9 });
        const copied = clipboardEvent();
        handleCopy(fakePlugin(settings, source), copied as never);
        const clip = copied.defaultPrevented ? copied.written["text/plain"] : "[^1]: one";
        expect(clip).toBe("[^1]: one");
        const destination = editor(["Dest."], { line: 0, ch: 5 });
        handlePaste(fakePlugin(settings, destination), clipboardEvent(clip) as never, destination);
        const toast = messages().find((m) => m.startsWith("Pasted with")) ?? "";
        // Today: 'Pasted with 1 footnote definition: 1 added. "[^1]" has no definition to carry.'
        expect(toast).not.toContain("no definition");
    });
});
