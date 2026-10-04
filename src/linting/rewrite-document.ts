import { normalizeEol, restoreEol } from "../parsing/line-edits";
import { Definition, NoteReading, readNote } from "../parsing/note-reading";

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
    /** The definitions whose lines are their own to move or cut (Definition.movable): the blocks move-to-bottom gathers and reindex reorders. */
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
            return reading().blocks;
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
