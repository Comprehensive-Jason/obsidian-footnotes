import { NoteReading, readNote, type ReferenceOccurrence } from "./note-reading";

// The reference GRAMMAR: how a footnote's name is spelled and compared,
// which names a new footnote may have, and the next free number. Which
// references and definitions a note holds, and where, is the note
// reading's to say (note-reading.ts, since step 3 of the runtime swap,
// 2026-10-03, which retired the regular expressions that used to stand in
// for it here); this file keeps the plain text handling that needs no note
// around it.
//
// It imports nothing from the editor or the plugin, so the lint rules and
// the command cascade can both import it without the circular imports the
// old all-in-one file forced on them (split 2026-08-11).

/**
 * Whether the character at `index` is escaped by a backslash, meaning an
 * ODD number of backslashes sits directly in front of it. (Backslashes pair
 * off and escape each other, so an even run leaves the next character
 * alone.)
 *
 * Exported for the insertion-position adjuster: text INSERTED at an escaped
 * position would itself come out escaped (bug-insert-after-backslash).
 */
export function escapedAt(line: string, index: number): boolean {
    let backslashes = 0;
    for (let j = index - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
    return backslashes % 2 === 1;
}

/**
 * Every stretch of `line` SHAPED like a reference, "[^name]" with a name
 * holding no square bracket, whatever Obsidian makes of it. Which
 * references are live, and where, is the note reading's to say
 * (NoteReading.referencesOn); this exists only to explain a name that
 * cannot work. Obsidian reads "[^my note]" as plain text, so the reading
 * holds no reference there, yet the user plainly meant one: the press
 * says why the name cannot work instead of writing a footnote into its
 * brackets, and the lint names it in its invalid-name alert.
 *
 * Pass the line's masked twin as `masked`, so that protected text holds no
 * shape; the name is cut from the raw `line`. An escaped "\[^x]" is
 * literal prose and "^[^x]" the text of an inline footnote, so neither is
 * a shape.
 */
export function referenceShapes(line: string, masked: string): ReferenceOccurrence[] {
    const shapes: ReferenceOccurrence[] = [];
    for (const match of masked.matchAll(/\[\^[^[\]]+\]/g)) {
        const start = match.index;
        if (escapedAt(masked, start)) continue;
        if (masked[start - 1] === "^" && !escapedAt(masked, start - 1)) continue;
        const end = start + match[0].length;
        shapes.push({ name: line.slice(start + 2, end - 1), start, end });
    }
    return shapes;
}

/**
 * Whether `id` is in `ids`, ignoring letter case. Two footnote names that
 * differ only in case are the same footnote: Obsidian folds them together,
 * and its metadata cache lowercases them.
 */
export function idListIncludes(ids: string[], id: string): boolean {
    const lower = id.toLowerCase();
    return ids.some((name) => name.toLowerCase() === lower);
}

// Obsidian will not render a footnote whose name holds whitespace or a
// backtick, and an empty name is not a footnote at all. Jason's call,
// 2026-08-10: names like that are disallowed outright rather than
// supported. The shape reader above (referenceShapes) stays permissive on
// purpose, so such a name can be caught and warned about instead of
// quietly misbehaving. Dollar signs are FINE: Jason verified live that
// "[^a$1]" renders as a footnote.
//
// Below are the three spellings of a footnote name, each with ONE owner.
// The duplicated-logic audit of 2026-09-05 found "[^…]" being built by hand
// in twenty places. A spelling with a single home is also what a future
// translation, or a change to the syntax, would need.

/** The reference: "[^name]". */
export function referenceText(name: string): string {
    return `[^${name}]`;
}

/** The definition label, without the space before the body: "[^name]:". */
export function definitionLabel(name: string): string {
    return `[^${name}]:`;
}

/** The reference as every toast quotes it: `"[^name]"`. */
export function quotedReference(name: string): string {
    return `"[^${name}]"`;
}

/** The definition label as an alert quotes it when the LABEL LINE is the thing to fix: `"[^name]:"`. */
export function quotedDefinitionLabel(name: string): string {
    return `"[^${name}]:"`;
}

export function isValidFootnoteName(name: string): boolean {
    return name.length > 0 && !/[\s`]/.test(name);
}

// A "#" is refused when a footnote is CREATED or RENAMED, on top of the
// render rule above. "[^#x]" does render in Reading view, but Obsidian's
// footnote hover preview and its Footnotes sidebar both find a footnote
// through a "#[^name]" subpath that splits on "#", so both say "Footnote
// not found" for it (Jason's finding, 2026-09-05), and the plugin's own
// popup can't bind to it either. A "#" reference that already exists stays
// a footnote to the note reading and the lint, because it does render. It shares
// the ordinary invalid-character message with spaces and backticks
// (Jason: one rule, one toast).
export const InvalidNameCharacters = 'Footnote names can\'t contain spaces, backticks, brackets, or "#".';

/**
 * Why `name` can't name a NEW or RENAMED footnote, or null when it can.
 * One message covers every character a name can't carry (Jason, 2026-09-05:
 * the separate line about brackets said nothing the first line didn't).
 */
export function footnoteNameProblem(name: string): string | null {
    if (/[[\]#]/.test(name) || !isValidFootnoteName(name)) return InvalidNameCharacters;
    return null;
}

// Where a placeholder starts, when the column `ch` sits strictly inside its
// brackets; null otherwise.
//
// This exists for the empty "[^]". The note reading reads no reference
// with an empty name, so the placeholder a first press has just inserted is
// invisible to every earlier step of the cascade. This check is the only
// guard standing between a second press and a nested "[^[^]]". The
// prefilled "[^7-]" placeholder reuses the same containment scan through
// warnPrefilledReferenceIfInside.
export function emptyReferenceStart(
    text: string,
    ch: number,
    reference = "[^]",
): number | null {
    for (let i = 0; (i = text.indexOf(reference, i)) !== -1; i += reference.length) {
        if (ch > i && ch < i + reference.length) return i;
    }
    return null;
}

/**
 * One more than the highest numbered footnote in the note: the next free
 * number. Every reference counts, live or not, and every definition, so a
 * number in use anywhere is never handed out again; gaps are not filled
 * back in, and named footnotes do not count. A number inside a code block
 * or the frontmatter is no footnote and reserves nothing (#41). When a
 * `prefix` is given, only names carrying it count ("[^2.7]" under the
 * prefix "2."), and plain numbers belong to the "" prefix alone.
 *
 * The footnotes come from the note reading (the runtime swap, step 3,
 * 2026-10-03). A caller that holds the reading passes it; the note's text
 * is read the same way, and a reading is remembered, so a caller that
 * passes the text it just read costs nothing more.
 */
export function computeNextFootnoteNumber(note: NoteReading | string, prefix = ""): number {
    const reading = typeof note === "string" ? readNote(note.split("\n")) : note;
    // The "i" flag matters here: footnote names are case-insensitive in
    // Obsidian, so "[^P.1]" lives in the prefix "p."'s namespace and must
    // reserve its number. A case-sensitive scan let the next insert mint a
    // name that collided with it.
    const numbered = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`, "i");
    let currentMax = 1;
    for (const { name } of [...reading.references, ...reading.definitions]) {
        const match = numbered.exec(name);
        if (match === null) continue;
        const value = Number(match[1]);
        // A run of digits too big to survive the trip through Number is
        // treated as a name, not a number. So is one whose SUCCESSOR is too
        // big: past MAX_SAFE_INTEGER, minting value + 1 would create a name
        // this very scan then skips, so the name after it would repeat
        // (bug-autonumber-unsafe-integer).
        if (!Number.isSafeInteger(value) || !Number.isSafeInteger(value + 1)) continue;
        currentMax = Math.max(currentMax, value + 1);
    }
    return currentMax;
}

// Words that say nothing about what a footnote is about, skipped when a
// name is taken from its body. English only, and short on purpose: a word
// wrongly kept costs a less telling name, a word wrongly skipped costs
// nothing worse.
const FillerWords = new Set(
    "a an the of in on at to and or but for with by from as is are was were be been being this that these those it its see cf eg ie also not no than then so if we he she they i you my our your their his her which who whom what when where into over under per via vs et al".split(" "),
);

/**
 * A footnote name taken from a body: its first word that is not a filler
 * word (a one-letter word only when nothing longer follows, and never a
 * word made of digits alone, which would read as a numbered footnote),
 * spelled as written, with the note's prefix in front, and "-2", "-3"
 * appended while the name is taken. Null when no word will do, so the
 * caller numbers it. Names are matched without regard to case, as
 * Obsidian matches them. Used by the inline-to-normal converter and, under
 * the Named setting, by the reindex rule (Jason, 2026-09-22).
 */
export function nameForBody(body: string, taken: ReadonlySet<string>, prefix = ""): string | null {
    const words = [...body.matchAll(/[\p{L}\p{N}]+/gu)]
        .map((m) => m[0])
        .filter((w) => /\p{L}/u.test(w) && !FillerWords.has(w.toLowerCase()));
    const word = words.find((w) => w.length > 1) ?? words.at(0);
    if (word === undefined) return null;
    const base = `${prefix}${word.slice(0, 30)}`;
    if (!taken.has(base.toLowerCase())) return base;
    for (let k = 2; ; k++) {
        const candidate = `${base}-${k}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}
