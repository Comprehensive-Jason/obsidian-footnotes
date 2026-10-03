// DEV ONLY: the "Benchmark footnote parsers on this note" command, for
// Jason's phone test of the remark-parse 8 reader before it replaces the
// scanner (Jason, 2026-10-03). It is to be removed before the 0.3.0 stable
// release unless Jason says otherwise. main.ts registers it only in a beta
// build (a version with a "-" in it, such as 0.3.0-beta.3), so a stable
// build that still held this file would not show it.
//
// It times two ways of reading the note in front of you:
// - the scanner the commands use today (markdown-scan.ts): scanDocument,
//   the masking of protected text, definitionStartLines, and
//   findDefinitionBlocks, the same unit the carry speed pin times
//   (test/perf/bug-carry-plain-copy-scans-note.perf.test.ts);
// - the remark-parse 8 reader (obsidian-markdown.ts): the parse plus the
//   footnote facts read off its tree (footnote-facts.ts).
// Each is run once untimed to warm up, then five times; the notice shows
// the median of the five, with the note's line count and whether Obsidian
// runs in mobile mode, and the developer console gets the same line.

import { App, MarkdownView } from "obsidian";

import { showNotice } from "../editor/notice";
import { viewEditor } from "../editor/obsidian-internals";
import { footnoteFacts } from "../parsing/footnote-facts";
import { definitionStartLines, findDefinitionBlocks, maskProtectedLines, normalizeEol, scanDocument } from "../parsing/markdown-scan";

/** The median of five timed runs of `run`, after one untimed warm-up run, in milliseconds. */
function medianMs(run: () => void): number {
    run();
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
        const started = performance.now();
        run();
        times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    return times[2];
}

/** One read of the note by the scanner, as the commands read it. */
function scannerRead(text: string): void {
    const lines = normalizeEol(text).text.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    findDefinitionBlocks(lines, scan, masked, starts);
}

/** The note's line count and the median time of each read. */
export function timeParsers(text: string): { lines: number; scannerMs: number; readerMs: number } {
    return {
        lines: normalizeEol(text).text.split("\n").length,
        scannerMs: medianMs(() => {
            scannerRead(text);
        }),
        readerMs: medianMs(() => {
            footnoteFacts(text);
        }),
    };
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
    showNotice("Benchmarking the footnote parsers on this note...");
    // a moment's wait lets that notice appear before the timing holds up the screen
    window.setTimeout(() => {
        const t = timeParsers(text);
        const message = `Footnote parser benchmark on ${t.lines} lines (isMobile: ${String(mobile)}). Scanner: ${t.scannerMs.toFixed(1)} ms. remark-parse 8 reader: ${t.readerMs.toFixed(1)} ms. Each is the median of 5 runs after a warm-up.`;
        // console.debug, the level the plugin guidelines allow: the developer console shows it under "Verbose"
        console.debug(message);
        // a duration of 0 keeps the notice until it is tapped, so it can be read on the phone
        showNotice(message, 0);
    }, 50);
}
