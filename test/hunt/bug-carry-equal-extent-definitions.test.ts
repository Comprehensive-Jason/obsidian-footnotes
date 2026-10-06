import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { carriedDefinitions, planCut } from "../../src/commands/carry-footnotes";
import { carryRegister, handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output, silent; data loss with Delete orphaned definitions
// on): a copy or cut of text citing two footnotes whose definitions share
// one line ("[^1]: [^2]: x") carries neither definition.
//
// What the user would see: the note reads "a[^1] b[^2]", a blank line,
// and "[^1]: [^2]: x". Obsidian reads that last line as two definitions:
// [^1], whose text holds the definition of [^2] (rule E2). The user
// copies "a[^1] b[^2]": the clipboard gets the bare text, with no
// definition at all. A cut of the same text leaves "[^1]: [^2]: x" behind
// with nothing referencing either footnote, and a paste elsewhere gives
// two references with no definition. No toast says anything went wrong.
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X6.
//
// Origin: pre-existing.
//
// Source of truth: rule E2 of docs/obsidian-reading-rules.md (two
// definitions on one line), and the README's Copy and Cut paragraphs: the
// definitions the copied footnotes need travel with the text, and a cut
// takes the definitions nothing else in the note uses along with it.
//
// Cause: carriedBlocks in src/commands/carry-footnotes.ts keeps only the
// "outermost" carried blocks: it drops any block whose lines lie inside
// another carried block's lines, so a footnote defined in another's text
// is not carried twice. The two definitions here start and end on the
// same line, so each lies inside the other and both are dropped.

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

const note = ["a[^1] b[^2]", "", "[^1]: [^2]: x"];

describe("two definitions on one line (rule E2) travel with text citing both", () => {
    it.fails("copying text that cites both carries a definition for each (nothing missing)", () => {
        // the reader sees both definitions on the last line
        expect(readNote(note).definitions.map((d) => d.name).sort()).toEqual(["1", "2"]);
        const { carried, missing } = carriedDefinitions(note.join("\n"), { line: 0, ch: 0 }, { line: 0, ch: 11 });
        expect(missing).toEqual([]);
        // one block holding both, or two blocks: either way both names are defined in what travels
        const defined = readNote(carried.flatMap((block) => [...block.lines, ""])).definitions.map((d) => d.name).sort();
        // Today: [] - neither definition travels.
        expect(defined).toEqual(["1", "2"]);
    });

    it.fails("the copy hook writes the definitions into the clipboard text", () => {
        const doc = editor(note, { line: 0, ch: 0 }, { line: 0, ch: 11 });
        const event = clipboardEvent();
        handleCopy(fakePlugin(settings, doc), event as never);
        // Today the plugin leaves the copy to the editor, so only "a[^1] b[^2]" is copied.
        expect(event.defaultPrevented).toBe(true);
        expect(event.written["text/plain"]).toContain("[^1]: [^2]: x");
        expect(carryRegister()?.carried.length).toBeGreaterThan(0);
    });

    it.fails("a cut of the only references takes the line that defines both, and a paste elsewhere defines both", () => {
        const plan = planCut(note.join("\n"), { line: 0, ch: 0 }, { line: 0, ch: 11 });
        // Today the plan carries nothing and leaves "[^1]: [^2]: x" in the note.
        expect(plan.carried.length).toBeGreaterThan(0);
        expect(plan.text).not.toContain("[^1]: [^2]: x");
        const doc = editor(note, { line: 0, ch: 0 }, { line: 0, ch: 11 });
        const event = clipboardEvent();
        handleCut(fakePlugin(settings, doc), event as never);
        expect(event.defaultPrevented).toBe(true);
        const clip = event.written["text/plain"];
        const destination = editor(["Dest."], { line: 0, ch: 5 });
        const paste = clipboardEvent(clip);
        handlePaste(fakePlugin(settings, destination), paste as never, destination);
        const defined = readNote(destination.lines).definitions.map((d) => d.name).sort();
        expect(defined, JSON.stringify({ clip, lines: destination.lines, toasts: messages() })).toEqual(["1", "2"]);
    });
});
