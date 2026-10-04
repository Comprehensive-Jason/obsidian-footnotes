import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { footnoteFacts } from "../../src/parsing/footnote-facts";

// BUG (performance): every Ctrl+C with a selection reads the whole note,
// even when the selection holds no footnote at all.
//
// What the user would see: on a very long note (here 20,000 lines with
// 2,000 footnotes), copying ten characters of plain prose takes as long
// as one full read of the note. The hunt measured 0.8 to 2.6 seconds per
// copy, cut, or paste on such a note while the machine sat at full CPU
// load from other work; one bare read of the note took about 200 to
// 240 ms under that same load. Copy is the
// cheapest of the three: a cut reads the note about four times and a
// default paste about seven.
//
// This pin does not use a fixed time limit, which would pass or fail with
// the machine's load. It compares the copy with one plain read of the
// same note, made the same way, so it holds on a slow or a fast machine.
//
// Hunt 2026-10-02, round 3, lens carry-terrain. Cluster T6. Under
// test/perf/ like the other timing pins, so the Stryker dry run (whose
// instrumented code is several times slower) leaves it out.
//
// Source of truth: the copy hook's own docstring, "A selection that needs
// no definition is left to the editor". A selection with no "[^" in it
// holds no reference, so it can need no definition, and finding that out
// needs only the selection.
//
// Cause: handleCopy calls remember, which calls carriedDefinitions on the
// whole note before it looks at the selection. carriedDefinitions started
// by reading every line of the note, whatever the selection holds.
//
// Fixed 2026-10-03 (the runtime swap, step 3): a selection with no "[^"
// on its lines leaves the note unread. The note reading remembers what it
// read, so each run below copies from a note no reading has seen (every
// line carries the run's own tag), and the baseline is one read of such a
// note from scratch (footnoteFacts, which remembers nothing).

/** A 20,000-line note: 18,000 lines of prose, one in nine citing a footnote, then 2,000 definitions; `tag` starts every line, so no two notes share a line. */
function hugeNote(tag: string): string[] {
    const lines: string[] = [];
    let n = 0;
    for (let i = 0; i < 18000; i++) {
        if (i % 9 === 0 && n < 2000) {
            n++;
            lines.push(`${tag} line ${i} cites a source[^${n}] and goes on a little.`);
        } else lines.push(i % 10 === 9 ? "" : `${tag} line ${i} is plain prose without footnotes, long enough to scan.`);
    }
    for (let k = 1; k <= 2000; k++) lines.push(`[^${k}]: ${tag} definition number ${k} with some text.`);
    return lines;
}

/** A stand-in for the browser's clipboard event: it records what the hook writes. */
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

/** The fastest of three runs of `run`, each handed its own fresh note, in milliseconds; the notes are built before the clock starts. */
function best(name: string, run: (lines: string[]) => void): number {
    let min = Infinity;
    for (let i = 0; i < 3; i++) {
        const lines = hugeNote(`${name}${i}`);
        const started = performance.now();
        run(lines);
        min = Math.min(min, performance.now() - started);
    }
    return min;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("copy on a 20,000-line note with 2,000 footnotes", () => {
    it("Ctrl+C of ten plain characters (no footnote anywhere in the selection) costs far less than one read of the note", () => {
        const scan = best("read", (lines) => footnoteFacts(lines.join("\n")));
        const copy = best("copy", (lines) => {
            resetCarryRegister();
            const from = { line: 1, ch: 0 };
            const to = { line: 1, ch: 10 };
            const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
            handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, doc), clipboardEvent() as never);
        });
        // a selection without "[^" can need no definition, so a cheap
        // check leaves it to the editor without reading the note (before
        // the fix the copy took about as long as one read, or longer)
        expect(copy).toBeLessThan(scan / 4);
    }, 60000);
});
