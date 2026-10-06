import { EditorView } from "@codemirror/view";
import { Editor, EditorPosition, EditorRangeOrCaret, EditorSelection, MarkdownView } from "obsidian";

import { applyOffsetChanges, lineDiffChanges, lineMapper, mapFoldLines, OffsetChange } from "./document-diff";
import { codeMirrorViewOf } from "./obsidian-internals";

// Writing a whole new text for the note back into the editor as the
// smallest set of edits, keeping folds and the caret. Moved out of
// linter.ts on 2026-09-16 so the footnote popup can write its definition
// the same way.

/**
 * Rewrite only the lines that actually changed, as separate edits in one
 * transaction. Untouched lines are never rewritten, so a fold on them
 * stays folded and a caret in them stays put. (It used to be one edit from
 * the first changed character to the last, which unfolded everything in
 * between and pushed a caret inside the span to its start: Jason's report
 * from a manual lint pass, 2026-09-11.) The edits are worked out by lineDiffChanges; all
 * of them are positions in the text BEFORE the rewrite, which is what a
 * transaction expects.
 */
export function replaceMinimal(doc: Editor, before: string, after: string, mdView?: MarkdownView) {
    writeChanges(doc, before, lineDiffChanges(before, after), mdView);
}

/**
 * Write `changes` (edits in the positions of `before`, the editor's text
 * now, in document order and never overlapping) into the editor as one
 * transaction, keeping folds, the caret, and the other panes on the same
 * note where they were. replaceMinimal works its edits out from the text
 * before and after; a command that has planned its own edits, such as the
 * conversion of inline footnotes to normal ones, hands them here, so its
 * edits land exactly as planned and still keep the folds and the other
 * panes (hunt 2026-10-02, round 4, cluster U2, pin
 * bug-convert-paste-skip-shared-write-back).
 *
 * `selection`, when given, is where the caret goes once the edits are in,
 * as a position in the text after them, set in the same transaction. The
 * carried paste puts the caret right after the pasted text this way,
 * wherever the definitions it adds pushed that text (same pin). Without
 * it the editor carries the caret through the edits, as it does for the
 * lint.
 */
export function writeChanges(doc: Editor, before: string, changes: OffsetChange[], mdView?: MarkdownView, selection?: EditorRangeOrCaret) {
    if (changes.length === 0) return;
    // the other panes showing this note, and where each one is, read
    // before anything moves (see restoreOtherPanes)
    const otherPanes = mdView ? otherPanesOn(mdView) : [];
    // Obsidian drops a heading's fold on any edit inside it (probed live,
    // 2026-09-11), so the folds are read before the rewrite and put back
    // after it, with their line numbers carried through the edits
    // (Jason's report: a folded section with footnotes under it still
    // unfolded). The fold API is undocumented, so every step is guarded.
    const mode = (mdView as { currentMode?: FoldingMode } | undefined)?.currentMode;
    const foldInfo = mode?.getFoldInfo?.() ?? null;
    doc.transaction({
        changes: changes.map((change) => ({
            from: doc.offsetToPos(change.from),
            to: doc.offsetToPos(change.to),
            text: change.text,
        })),
        ...(selection ? { selection } : {}),
    });
    // a caret the caller placed is already where it should be
    if (!selection) keepCaretBelowLinesAbove(doc, changes);
    const after = applyOffsetChanges(before, changes);
    if (foldInfo && foldInfo.folds.length > 0 && mode?.applyFoldInfo) {
        mode.applyFoldInfo({
            folds: mapFoldLines(foldInfo.folds, changes, before),
            lines: after.split("\n").length,
        });
    }
    if (otherPanes.length > 0) restoreOtherPanes(otherPanes, after, lineMapper(changes, before));
}

/**
 * After the edits: a caret that sat at the very start of the note, when
 * lines went in above the note's first line, is put back at the start of
 * its own line, now below the new lines.
 *
 * The editor keeps a caret that sits exactly where text goes in in front
 * of that text. lineDiffChanges writes lines inserted between two lines at
 * the end of the line above, so a caret at the start of the line below
 * stays on its line. The first line has no line above it: lines inserted
 * there go in at the very start of the note, where a caret at the start of
 * the first line also sits, so the editor put that caret on the first
 * inserted line (with a section heading set, a note that starts with
 * "[^1]: alpha" gets "# Footnotes" and a blank line above it, and the
 * caret went onto "# Footnotes"). No placement of the edit can avoid that.
 * Every other caret and selection is left where the editor carried it; a
 * selection that starts at the very start of the note, such as Select
 * all, already starts after the new lines, since the editor keeps
 * inserted text out of a selection's start (hunt 2026-10-05 round 2,
 * cluster D2, pin bug-caret-jumps-to-inserted-line).
 */
function keepCaretBelowLinesAbove(doc: Editor, changes: OffsetChange[]): void {
    const first = changes[0];
    // lines inserted above the first line come as one edit at offset 0
    // that ends with a line break; no other edit touches offset 0, so a
    // caret there now is one that was there before
    if (first.from !== 0 || first.to !== 0 || !first.text.endsWith("\n")) return;
    const atNoteStart = (range: EditorSelection) => range.anchor.line === 0 && range.anchor.ch === 0 && range.head.line === 0 && range.head.ch === 0;
    const ranges = doc.listSelections();
    if (!ranges.some(atNoteStart)) return;
    const ownLine = { line: first.text.split("\n").length - 1, ch: 0 };
    doc.setSelections(ranges.map((range) => (atNoteStart(range) ? { anchor: ownLine, head: ownLine } : range)));
}

/**
 * Another pane's place in the same note: its editor, its selection (anchor
 * and head), and where it is scrolled to, kept two ways. The line at the
 * top edge of the window and how many pixels into that line the edge
 * sits is the one that survives a rewrite (see restoreOtherPanes); the
 * pixel scroll is the fallback where the CodeMirror view is out of reach.
 */
interface PanePlace {
    editor: Editor;
    cm: EditorView | undefined;
    anchor: EditorPosition;
    head: EditorPosition;
    topLine: number;
    topOffset: number;
    scroll: { top: number; left: number };
}

/**
 * Every other pane that shows the same note as `mdView` (the note split
 * into two panes, or open in a second window), with its caret and scroll
 * position as they are now.
 */
function otherPanesOn(mdView: MarkdownView): PanePlace[] {
    const path = mdView.file?.path;
    // the unit tests hand in a bare stand-in for the view, with no app on
    // it; there are no other panes to find then
    const app = (mdView as Partial<MarkdownView>).app;
    if (path === undefined || !app) return [];
    const places: PanePlace[] = [];
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || view === mdView || view.file?.path !== path) continue;
        const editor = view.editor;
        const cm = codeMirrorViewOf(editor);
        let topLine = 0;
        let topOffset = 0;
        if (cm) {
            const scrollTop = cm.scrollDOM.scrollTop;
            const block = cm.lineBlockAtHeight(scrollTop);
            topLine = cm.state.doc.lineAt(block.from).number - 1;
            topOffset = scrollTop - block.top;
        }
        places.push({
            editor,
            cm,
            anchor: editor.getCursor("anchor"),
            head: editor.getCursor("head"),
            topLine,
            topOffset,
            scroll: editor.getScrollInfo(),
        });
    }
    return places;
}

/**
 * Put every other pane back where it was. Obsidian copies a rewrite into
 * the other panes on the same note a moment later, as one whole
 * replacement, which drops each pane's caret to the top of the note and
 * can shift its scroll (Jason's report from the feature-round sheet, 2026-09-24: the pane he
 * was not typing in jumped, and a split view is on purpose). The copy
 * lands within about 200 ms (probed live, 2026-09-24), so this waits for
 * each pane's text to become the new text, then puts its selection back,
 * carried through the edits the way folds are, and its scroll position
 * after it. A pane whose copy never lands is left alone after a second.
 *
 * The scroll position is put back by LINE, not by pixel. CodeMirror only
 * measures the lines it has drawn and estimates the rest, and the copy
 * throws those estimates away, so the old pixel offset lands on a
 * different line once lines wrap or vary in height (Jason's second
 * report, 2026-09-24: the caret line came back near the bottom of the
 * window; probed live: a 96 px drift in a narrow pane of wrapped lines).
 * So the line that was at the top edge of the window is asked to sit at
 * the top edge again, through CodeMirror's own scroll request, which it
 * re-applies after every measurement until it holds; a beat later the
 * pixels the edge sat into that line are added back, now that the line
 * has been drawn and measured. Setting the selection through the view
 * rather than the editor keeps Obsidian from also asking for the caret
 * to be scrolled into view, which would win over the restore and park
 * the caret line at the bottom edge (probed live, 2026-09-24).
 */
function restoreOtherPanes(places: PanePlace[], after: string, mapLine: (line: number) => number): void {
    let waiting = places;
    let tries = 0;
    const tick = (): void => {
        const stillWaiting: PanePlace[] = [];
        for (const place of waiting) {
            if (place.editor.getValue() !== after) {
                stillWaiting.push(place);
                continue;
            }
            const editor = place.editor;
            const at = (pos: EditorPosition): EditorPosition => {
                const line = Math.min(mapLine(pos.line), editor.lastLine());
                return { line, ch: Math.min(pos.ch, editor.getLine(line).length) };
            };
            const cm = place.cm;
            if (!cm) {
                editor.setSelection(at(place.anchor), at(place.head));
                editor.scrollTo(place.scroll.left, place.scroll.top);
                continue;
            }
            const topPos = editor.posToOffset({ line: Math.min(mapLine(place.topLine), editor.lastLine()), ch: 0 });
            cm.dispatch({
                selection: { anchor: editor.posToOffset(at(place.anchor)), head: editor.posToOffset(at(place.head)) },
                effects: EditorView.scrollIntoView(topPos, { y: "start" }),
            });
            const topOffset = place.topOffset;
            window.setTimeout(() => {
                cm.scrollDOM.scrollTop = cm.lineBlockAt(topPos).top + topOffset;
            }, 50);
        }
        waiting = stillWaiting;
        tries++;
        if (waiting.length > 0 && tries < 20) window.setTimeout(tick, 50);
    };
    window.setTimeout(tick, 0);
}

/** The fold half of a MarkdownView's edit mode, as Obsidian ships it without typings: the folds as line ranges, and a way to put a list of them back. */
interface FoldingMode {
    getFoldInfo?: () => { folds: { from: number; to: number }[]; lines: number } | null;
    applyFoldInfo?: (info: { folds: { from: number; to: number }[]; lines: number }) => void;
}
