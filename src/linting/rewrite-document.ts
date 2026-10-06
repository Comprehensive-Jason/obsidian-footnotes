import { normalizeEol, restoreEol } from "../parsing/line-edits";
import { Definition, NoteReading, readNote } from "../parsing/note-reading";
import { definitionsHeldBy } from "./rules/remove-orphaned-definitions";

// The setup and teardown every rewriting rule used to repeat for itself,
// gathered here (duplicated-logic audit, 2026-09-05). The steps: convert the
// note's line endings to plain LF, split it into lines, read it, run the
// rule, then put the note's own line endings back.
//
// The one subtlety is what happens when the rule changed nothing. Then the
// ORIGINAL text is handed back byte for byte, without the ending-restoring
// step. A note with mixed line endings would otherwise come out with them
// all made the same, and the lint would report a change the user never
// asked for. (Decided 2026-08-10; pinned by spec-mixed-eol-noop-rewrite.)

/**
 * The view of the note a rewriting rule works from.
 *
 * Everything in it comes from the note reading (note-reading.ts), which
 * reads each distinct text once and remembers it: the lint hands the note
 * through its rules in a row, and a rule that changed nothing hands the
 * next one the same text, which is then not read again (Jason,
 * 2026-09-09: "if it's free, do it"; the reading's own memory has done it
 * since step 2 of the runtime swap, 2026-10-03). The reading is asked for
 * the first time something needs it, because one rule, move-to-bottom,
 * trims `lines` before anything is read.
 */
export interface DocumentView {
    readonly lines: string[];
    /** The note reading of `lines`: definitions, protected text, the masked twin, and the rest. */
    readonly reading: NoteReading;
    /** The masked twin (the copy with protected text blanked out), from the reading. */
    readonly maskedLines: readonly string[];
    /** Every definition, wherever it sits, from the note reading (note-reading.ts). */
    readonly definitions: readonly Definition[];
    /** The definitions the rules may move (movedDefinitions): the blocks move-to-bottom gathers and reindex reorders. */
    readonly blocks: readonly Definition[];
    /**
     * Drop the blank lines at the end of the note, and say how many there
     * were.
     *
     * This is the ONE change to `lines` that is allowed, and only before
     * anything has been read from them. move-to-bottom used to shorten the
     * array itself. That happened to work, but only because the reading is
     * done lazily and the shortening came first: read the note anywhere
     * above the trim and it would describe the untrimmed note (review C7,
     * 2026-09-09).
     *
     * So this throws if the reading has already been asked for.
     */
    trimTrailingBlankLines(): number;
}

/**
 * The definitions a rule may move or reorder, out of every definition
 * `reading` holds (its list, in label order): the ones whose lines are
 * their own (Definition.movable), except one whose label sits inside a
 * table (labelInsideTable), and a copy of a name that also has a copy
 * staying put, in a quote, a list item, another footnote, on a comment
 * closer's line, or inside a table.
 *
 * A label typed between two rows of a table stays where it is (Jason's
 * ruling A2, 2026-09-15: the plugin does not move it, the in-table alert
 * tells the user). Its definition holds the rows below it, which Obsidian
 * folds into the footnote's text, so moving it to the bottom carried a row
 * of the table away with it, and the blank line the move puts above the
 * definitions took a label that already ended the note out of the table;
 * either way the alert, which reads the note after the lint, found
 * nothing to name (hunt 2026-10-02, round 4, cluster A1, pin
 * bug-lint-move-silences-in-table-alert).
 *
 * Obsidian renders the LAST definition of a name. Moving a copy past one
 * that stays put would change which copy that is, and so the text the
 * footnote shows. So such a name's movable copies stay where they are
 * too, and only the duplicate alert speaks about them. Move-to-bottom and
 * reindex both take their blocks from here, so neither can do it (hunt
 * 2026-10-05, pin bug-lint-reorders-mixed-container-duplicates).
 *
 * A copy held inside another footnote's definition (an indented
 * "[^b]: inner" under "[^a]: outer") counts in "the last copy wins" too,
 * and it travels with the definition that holds it. So a movable
 * definition that holds a copy of a name with another copy outside it
 * stays where it is as well, and so do the other copies of its own name,
 * as for a copy that stays put (live Obsidian 1.14.4, 2026-10-05; hunt
 * 2026-10-05 round 2, pin bug-lint-moves-held-duplicate). The merge rule
 * takes its copies from here for the same reason.
 */
export function movedDefinitions(reading: NoteReading): readonly Definition[] {
    const definitions = reading.definitions;
    let moved = movedOf.get(definitions);
    if (moved === undefined) {
        const folded = (definition: Definition): string => definition.name.toLowerCase();
        const copies = new Map<string, number>();
        for (const definition of definitions) copies.set(folded(definition), (copies.get(folded(definition)) ?? 0) + 1);
        const staying = new Set(definitions.filter((definition) => !definition.movable || labelInsideTable(reading, definition.start)).map(folded));
        for (const definition of definitions) {
            if (!definition.movable) continue;
            // the definitions this one carries along when it moves: itself
            // and every one held inside it
            const carried = [definition, ...definitionsHeldBy(definitions, definition)];
            const holdsSharedCopy = carried.some(
                (held) => held !== definition && (copies.get(folded(held)) ?? 0) > carried.filter((other) => folded(other) === folded(held)).length,
            );
            if (holdsSharedCopy) staying.add(folded(definition));
        }
        // frozen, as the reading's own lists are, so a rule cannot change
        // the list another rule is handed (spec-document-view-memo-mutation)
        moved = Object.freeze(definitions.filter((definition) => definition.movable && !staying.has(folded(definition))));
        movedOf.set(definitions, moved);
    }
    return moved;
}

/**
 * Whether the definition label on `line` sits inside a table: a row of a
 * table right above it, and right below it a line with the shape of
 * another row of that table. The line below is such a row when it holds a
 * pipe, is no label itself, and starts with a pipe when the row above
 * does. The note reading's table rows answer the "row above" question, so
 * a pipe-less GFM table ("a | b" over "--- | ---") counts like a piped one
 * (Kimi hunt cycle 3, 2026-09-16: Reading view breaks both the same way,
 * folding the rows after the label into the footnote's text). Under a
 * table written with outer pipes, a sentence with a pipe in it ("where
 * a|b is shorthand") is the footnote's own text, not a row someone typed
 * there (hunt 2026-10-02, round 4, cluster A2, pin
 * bug-lint-pipe-prose-false-in-table-alert). The lines are read on the
 * masked twin, where a pipe in code or math does not count.
 */
export function labelInsideTable(reading: NoteReading, line: number): boolean {
    if (line === 0 || line + 1 >= reading.tableRowLines.length || !reading.tableRowLines[line - 1]) return false;
    const below = reading.maskedLine(line + 1);
    if (!below.includes("|") || /^ {0,3}\[\^/.test(below)) return false;
    return !reading.maskedLine(line - 1).trimStart().startsWith("|") || below.trimStart().startsWith("|");
}

// The answer above, remembered per list: the note reading hands out one
// list per text, so rules handed the same text share one answer, as they
// share the reading (test/rewrite-document-memo.test.ts).
const movedOf = new WeakMap<readonly Definition[], readonly Definition[]>();

function documentView(lines: string[]): DocumentView {
    // whether anything has been read through this view yet (the trim guard)
    let read = false;
    const reading = (): NoteReading => {
        read = true;
        return readNote(lines);
    };
    return {
        lines,
        trimTrailingBlankLines() {
            if (read) {
                throw new Error("trimTrailingBlankLines must run before the view is read");
            }
            let count = 0;
            while (lines.length > 1 && lines[lines.length - 1] === "") {
                lines.pop();
                count++;
            }
            return count;
        },
        get reading() {
            return reading();
        },
        get maskedLines() {
            return reading().maskedLines();
        },
        get definitions() {
            return reading().definitions;
        },
        get blocks() {
            return movedDefinitions(reading());
        },
    };
}

/**
 * Run `rewrite` over `markdown` with its line endings converted to plain LF,
 * handing it that text and a view of it.
 *
 * Returns the rewritten note with the note's own line endings put back, or,
 * when the rule handed `text` back unchanged, `markdown` itself, byte for
 * byte.
 */
export function rewriteDocument(
    markdown: string,
    rewrite: (text: string, view: DocumentView) => string,
): string {
    const { text, eol } = normalizeEol(markdown);
    const result = rewrite(text, documentView(text.split("\n")));
    return result === text ? markdown : restoreEol(result, eol);
}
