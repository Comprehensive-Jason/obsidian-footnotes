import { EditorView, ViewUpdate } from "@codemirror/view";
import { Notice } from "obsidian";

import { quotedReference, referenceOccurrences } from "../parsing/footnote-grammar";
import { readNote } from "../parsing/note-reading";

import { showNotice } from "./notice";
// Feedback for a PARTIAL undo (Jason's report 2026-08-27; the notice is
// always on, his call).
//
// Creating a footnote from inside a table cell takes TWO undo steps. The
// reference has to be written through the cell's own editor, because
// writing the row through the main editor while a cell holds focus is the
// issue #28 corruption family, while the definition rides a main-editor
// transaction. CodeMirror's history only groups changes that arrive
// together in one dispatch, so those two can never share an undo step.
//
// The first undo used to strand an orphaned reference in the table without
// a word about it; this listener says so. It speaks up for every
// partial-undo orphan, not just tables: undoing the definition press of the
// named flow leaves the typed reference behind the same way, and the
// guidance is identical.

/**
 * The names this undo orphaned: defined before it, not defined after it,
 * and still referenced afterwards. Reported in the casing the definition
 * itself used.
 *
 * Both sides are judged on the masked twin, so a footnote-shaped decoy
 * inside a code span neither sets the notice off nor holds it back (the A20
 * decoy lesson), and names are compared case-insensitively as everywhere
 * else. Pure function; exported so unit tests can call it.
 */
export function orphanedByUndo(before: string, after: string): string[] {
    const beforeDefined = namesIn(before.split("\n")).defined;
    if (beforeDefined.size === 0) return [];
    const { defined: afterDefined, referenced } = namesIn(after.split("\n"));
    const orphaned: string[] = [];
    for (const [folded, raw] of beforeDefined) {
        if (!afterDefined.has(folded) && referenced.has(folded)) {
            orphaned.push(raw);
        }
    }
    return orphaned;
}

/**
 * Which of `names` are STILL orphaned in `text`: a reference is left and no
 * definition is.
 *
 * This is how the notice on screen knows to dismiss itself (Jason's ask
 * 2026-08-29). Once a later undo removes the reference, or a redo brings
 * the definition back, the guidance no longer applies and the toast hides.
 * Judged on the masked twin and case-insensitively, like the detector
 * above. Pure function; exported so unit tests can call it.
 */
export function stillOrphanedNames(text: string, names: string[]): string[] {
    const { defined, referenced } = namesIn(text.split("\n"));
    return names.filter(
        (name) =>
            referenced.has(name.toLowerCase()) &&
            !defined.has(name.toLowerCase()),
    );
}

/**
 * Every definition name and every reference name in `lines`, from the one
 * note reading and its masked twin. The two functions above used to mask
 * the document separately (review B4, 2026-09-09). Both sides are judged on
 * the masked twin.
 *
 * Definition names come back as a map from the lowercased name to the
 * casing actually typed, and when a name is defined more than once the LAST
 * one wins, matching Obsidian's rule that only the last definition renders.
 * A definition counts wherever it sits, in a list item too (Jason's ruling
 * 1, option a, 2026-10-03; hunt 2026-10-02, cluster U7).
 * Reference names come back lowercased.
 */
function namesIn(lines: string[]): { defined: Map<string, string>; referenced: Set<string> } {
    const reading = readNote(lines);
    const masked = reading.maskedLines();
    const starts = reading.labelLines;
    const defined = new Map<string, string>();
    for (const definition of reading.definitions) defined.set(definition.name.toLowerCase(), definition.name);
    const referenced = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of referenceOccurrences(lines[i], masked[i], starts[i])) {
            referenced.add(occurrence.name.toLowerCase());
        }
    }
    return { defined, referenced };
}

// The one notice now on screen and the names it spoke for, so the next
// history step can retire it. One slot is enough: a new partial-undo state
// replaces the old notice rather than stacking toasts up.
let standing: { notice: Notice; names: string[] } | null = null;

// The one footnote whose creation the plugin itself last had to split
// into two history steps (the reference through a table cell's editor, the
// definition through the main editor). Only for it is "undo again to
// remove the reference too" a promise the plugin can keep, and only for
// the undo that takes that definition back out: the reference step is
// exactly the previous one THEN. For any other undo that strands a
// reference - a definition typed by hand, a definition press after a
// hand-typed reference, or the same name in another note weeks later -
// the notice states the fact and stops there (Jason's report 2026-09-11:
// the promise was made for every such undo). The record used to be a set
// of names that was never emptied and knew nothing of which note or which
// moment, so one cell creation made its name promising forever,
// everywhere (Claude sweep 2026-09-13). Now it is the note's text as it
// stood before the definition landed: an undo that takes the definition
// out leaves the note reading exactly that, and nothing else does.
let lastSplit: { name: string; textBefore: string } | null = null;

/** Record that `name`'s reference and definition are landing in two separate history steps, the reference first; `textBefore` is the note's text just before the definition's step. Without it, no promise is ever made for the name. */
export function noteSplitCreation(name: string, textBefore?: string): void {
    lastSplit = textBefore === undefined ? null : { name: name.toLowerCase(), textBefore };
}

/** The notice for `orphaned` (already quoted and joined as `refs`): the second-undo guidance only when the one orphaned name is the last split creation and `textAfterUndo` is the note as it stood before that creation's definition landed. Exported for the unit tests. */
export function undoOrphanMessage(orphaned: string[], refs: string, textAfterUndo?: string): string {
    const one = orphaned.length === 1;
    const promise =
        one &&
        lastSplit !== null &&
        orphaned[0].toLowerCase() === lastSplit.name &&
        textAfterUndo === lastSplit.textBefore
            ? ` Undo again to remove the reference too.`
            : "";
    // "the footnote reference" spelled out, so the toast says what is left
    // behind rather than leaving it to the quoted name (Jason, 2026-09-11)
    return `The undo removed the footnote definition, but the footnote ${one ? "reference" : "references"} ${refs} ${one ? "is" : "are"} still in the note.${promise}`;
}

// Stryker disable all: CodeMirror update-listener plumbing driven by the
// live editor - smoke-test territory, and unit tests cannot reach it. The
// pure decisions above are what the unit tests pin down.
/**
 * The editor extension, registered app-wide in main.ts. When an UNDO leaves
 * footnote references with no definition, it says so: the note looks half
 * reverted, and without the notice the leftover reference reads as a bug.
 *
 * The checks before it does any real work are deliberately strict, because
 * this runs on every editor update: the document must have changed, the
 * transaction must be a history undo, and the removed text must at least
 * contain "]:". Only past all three does a whole-document scan run.
 *
 * A notice on screen retires ITSELF on the history step that resolves it
 * (Jason's ask 2026-08-29): a second undo removing the reference, or a redo
 * restoring the definition, makes the guidance moot, so the toast hides
 * instead of lingering.
 */
export function undoOrphanNoticeExtension() {
    return EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.docChanged) return;
        const undo = update.transactions.some((tr) => tr.isUserEvent("undo"));
        const redo = update.transactions.some((tr) => tr.isUserEvent("redo"));
        if (!undo && !redo) return;
        if (
            standing &&
            stillOrphanedNames(update.state.doc.toString(), standing.names)
                .length === 0
        ) {
            standing.notice.hide();
            standing = null;
        }
        if (!undo) return;
        let removed = "";
        update.changes.iterChanges((fromA, toA) => {
            removed += update.startState.sliceDoc(fromA, toA);
        });
        if (!removed.includes("]:")) return;
        const orphaned = orphanedByUndo(
            update.startState.doc.toString(),
            update.state.doc.toString(),
        );
        if (orphaned.length === 0) return;
        // wrapped in quotes, like every other toast that names a footnote
        // (2026-09-04)
        const refs = orphaned.map(quotedReference).join(", ");
        standing?.notice.hide();
        standing = {
            notice: showNotice(undoOrphanMessage(orphaned, refs, update.state.doc.toString()), 8000),
            names: orphaned,
        };
    });
}
// Stryker restore all
