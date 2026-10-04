// DEV ONLY: the "Benchmark footnote parsers on this note" command, for
// Jason's phone test of the note reading (Jason, 2026-10-03). It is to be
// removed before the 0.3.0 stable release unless Jason says otherwise.
// main.ts registers it only in a beta build (a version with a "-" in it,
// such as 0.3.0-beta.3), so a stable build that still held this file would
// not show it.
//
// It times the note reading (note-reading.ts), which every command asks
// since the runtime swap, the two ways a user feels it:
// - a cold read: the note read with nothing remembered, as the first press
//   on a note just opened reads it;
// - a warm read after a one-character edit: the note read again after one
//   character was typed, which is what each press and each lint pays, since
//   the reading remembers the parts of the note the edit did not touch.
// Each is run once untimed to warm up, then five times; the notice shows
// the median of the five, with the note's line count and whether Obsidian
// runs in mobile mode, and the developer console gets the same line. The
// hand-written scanner it used to be compared with is gone (steps 2 to 4
// of the runtime swap), so there is nothing to compare it with any more.

import { App, MarkdownView } from "obsidian";

import { showNotice } from "../editor/notice";
import { viewEditor } from "../editor/obsidian-internals";
import { normalizeEol } from "../parsing/markdown-scan";
import { forgetReadings, readNote } from "../parsing/note-reading";

/** How many timed runs each measurement takes, after one untimed warm-up run. */
const Runs = 5;

/** The middle value of `times`. */
function median(times: number[]): number {
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/** How long `run` takes, in milliseconds. */
function timed(run: () => void): number {
    const started = performance.now();
    run();
    return performance.now() - started;
}

/** The note's line count, and the median time of a cold read and of a read after a one-character edit. */
export function timeReading(text: string): { lines: number; coldMs: number; warmMs: number } {
    const lines = normalizeEol(text).text.split("\n");
    const cold: number[] = [];
    for (let k = 0; k <= Runs; k++) {
        forgetReadings();
        const ms = timed(() => readNote(lines));
        // the first run warms up
        if (k > 0) cold.push(ms);
    }
    const warm: number[] = [];
    for (let k = 0; k <= Runs; k++) {
        // the note as it stands is remembered, as it is between presses
        readNote(lines);
        // one character typed at the end of a line, a different line each
        // run, so that no run finds its text already read
        const edited = [...lines];
        const at = Math.floor(((k + 1) * lines.length) / (Runs + 2));
        edited[at] = `${edited[at]}x`;
        const ms = timed(() => readNote(edited));
        if (k > 0) warm.push(ms);
    }
    return { lines: lines.length, coldMs: median(cold), warmMs: median(warm) };
}

export function benchmarkParsers(app: App): void {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view ? viewEditor(view) : null;
    if (!editor) {
        showNotice("Open a note first: the benchmark times the note in front of you.");
        return;
    }
    const text = editor.getValue();
    // app.isMobile is undocumented; it says whether Obsidian runs in mobile mode (the oracle reads the same flag)
    const mobile = (app as { isMobile?: boolean }).isMobile;
    showNotice("Benchmarking the footnote reading on this note...");
    // a moment's wait lets that notice appear before the timing holds up the screen
    window.setTimeout(() => {
        const t = timeReading(text);
        const message = `Footnote reading benchmark on ${t.lines} lines (isMobile: ${String(mobile)}). Cold read, with nothing remembered: ${t.coldMs.toFixed(1)} ms. Read after a one-character edit, what each press costs: ${t.warmMs.toFixed(1)} ms. Each is the median of ${Runs} runs after a warm-up. The old scanner is gone, so there is nothing to compare with.`;
        // console.debug, the level the plugin guidelines allow: the developer console shows it under "Verbose"
        console.debug(message);
        // a duration of 0 keeps the notice until it is tapped, so it can be read on the phone
        showNotice(message, 0);
    }, 50);
}
