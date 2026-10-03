import { DocumentScan, maskProtectedLines, normalizeEol, restoreEol, scanDocument } from "../parsing/markdown-scan";
import { Definition, readNote } from "../parsing/note-reading";

// The setup and teardown every rewriting rule used to repeat for itself,
// gathered here (duplicated-logic audit, 2026-09-05). The steps: convert the
// note's line endings to plain LF, split it into lines, scan it, run the
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
 * The scan, the masked twin (the copy with protected text blanked out) and
 * the note reading are each worked out the first time they are asked for,
 * then kept. Two reasons: no rule needs all three, and one rule,
 * move-to-bottom, trims `lines` before anything has been scanned.
 */
export interface DocumentView {
    readonly lines: string[];
    readonly scan: DocumentScan;
    readonly maskedLines: string[];
    /**
     * One entry per line: true where a definition's label sits, from the
     * note reading.
     */
    readonly definitionStarts: boolean[];
    /** Every definition, wherever it sits, from the note reading (note-reading.ts). */
    readonly definitions: readonly Definition[];
    /** The definitions whose lines are their own to move or cut (Definition.movable): the blocks move-to-bottom gathers and reindex reorders. */
    readonly blocks: readonly Definition[];
    /**
     * Drop the blank lines at the end of the note, and say how many there
     * were.
     *
     * This is the ONE change to `lines` that is allowed, and only before
     * anything has been worked out from them. move-to-bottom used to
     * shorten the array itself. That happened to work, but only because
     * the scan is done lazily and the shortening came first: read `scan`
     * anywhere above the trim and it would describe the untrimmed note
     * (review C7, 2026-09-09).
     *
     * So this throws if the scan, the masked twin, or the reading has
     * already been asked for.
     */
    trimTrailingBlankLines(): number;
}

/** The pieces a view works out from its lines, each null until asked for. */
interface Derived {
    scan: DocumentScan | null;
    masked: string[] | null;
}

// A one-entry memo shared by every view built while one outer
// rewriteDocument call is running (Jason, 2026-09-09: "if it's free, do
// it"). The lint pipeline hands the note through eight rules in a row, and
// each rule builds its own view of the text it receives. On a clean note
// most rules hand their text back unchanged, so the next rule receives the
// identical string and used to scan it all over again. Now a view whose
// text matches the memo starts with the previous view's finished pieces.
//
// The memo is keyed on the exact text, so a rule that changed anything
// gets a fresh scan as before. The rules themselves are untouched: still
// markdown in, markdown out. The memo is dropped when the outermost call
// returns, so no note is kept in memory after a lint, and a rule run on its
// own (as the tests do) behaves exactly as it did before.
let memoText: string | null = null;
let memoDerived: Derived | null = null;
let depth = 0;

function documentView(text: string, lines: string[]): DocumentView {
    const d: Derived =
        memoText === text && memoDerived !== null
            ? { ...memoDerived }
            : { scan: null, masked: null };
    // whether anything has been read through THIS view yet (the trim guard)
    let read = false;
    // once trimmed, the pieces describe a shorter note than `text`, so they
    // must not be offered to the next view under this text
    let trimmed = false;
    const publish = () => {
        if (!trimmed) {
            memoText = text;
            memoDerived = { ...d };
        }
    };
    return {
        lines,
        trimTrailingBlankLines() {
            if (read) {
                throw new Error("trimTrailingBlankLines must run before the view is scanned");
            }
            let count = 0;
            while (lines.length > 1 && lines[lines.length - 1] === "") {
                lines.pop();
                count++;
            }
            // pieces inherited from the memo describe the untrimmed note, so
            // they are only kept when the trim removed nothing (move-to-bottom
            // trims every time, and usually there is nothing to remove)
            if (count > 0) {
                d.scan = null;
                d.masked = null;
                trimmed = true;
            }
            return count;
        },
        get scan() {
            read = true;
            if (d.scan === null) {
                d.scan = scanDocument(lines);
                publish();
            }
            return d.scan;
        },
        get maskedLines() {
            read = true;
            if (d.masked === null) {
                d.masked = maskProtectedLines(lines, this.scan);
                publish();
            }
            return d.masked;
        },
        // the note reading keeps its own memo, keyed by the text
        get definitionStarts() {
            read = true;
            return readNote(lines).labelLines;
        },
        get definitions() {
            read = true;
            return readNote(lines).definitions;
        },
        get blocks() {
            read = true;
            return readNote(lines).blocks;
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
    depth++;
    try {
        const result = rewrite(text, documentView(text, text.split("\n")));
        return result === text ? markdown : restoreEol(result, eol);
    } finally {
        // the outermost call is over: forget the memo so the note is not
        // kept alive, and so the next lint starts clean
        if (--depth === 0) {
            memoText = null;
            memoDerived = null;
        }
    }
}
