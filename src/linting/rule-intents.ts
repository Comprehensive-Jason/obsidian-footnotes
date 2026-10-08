// What each lint rule means to change, said in the result gate's terms
// (EditIntent in editor/result-gate.ts), for shadow mode: each rule hands
// its result to the gate with one of these (stage 2 of the result gate
// design, 2026-10-07). Each is worked out from the note before the rule and
// the note after it, by the rule's own purpose: the gate then judges
// everything else.

import { EditIntent } from "../editor/result-gate";
import { labelShapedLines } from "../parsing/label-shapes";
import { readNote } from "../parsing/note-reading";

const fold = (name: string): string => name.toLowerCase();

/** How many definitions each name has in `lines`, by name in lower case. */
function definitionCounts(lines: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const definition of readNote(lines).definitions) counts.set(fold(definition.name), (counts.get(fold(definition.name)) ?? 0) + 1);
    return counts;
}

/** A rule that only moves definitions or the lines around them (move to the bottom, the empty heading): it means to change no footnote. */
export const movesOnly = (): EditIntent => ({});

/** The punctuation rule: it moves references and inline footnotes past the punctuation next to them. */
export const footnotesMovedPastPunctuation = (): EditIntent => ({ footnotesMoved: true });

/** Fix lazy definitions: the names a blank line gave a definition, those with more definitions after than before. */
export function lazyLabelsDefined(before: string[], after: string[]): EditIntent {
    const was = definitionCounts(before);
    return { defined: [...definitionCounts(after)].filter(([name, n]) => n > (was.get(name) ?? 0)).map(([name]) => name) };
}

/** Merge duplicate definitions: every name defined more than once before has its copies folded into one. */
export function duplicatesMerged(before: string[]): EditIntent {
    return { merged: [...definitionCounts(before)].filter(([, n]) => n > 1).map(([name]) => name) };
}

/** Delete orphaned references: the names the note references and does not define, not even with a lazy or underlined label. */
export function orphanedReferencesRemoved(before: string[]): EditIntent {
    const reading = readNote(before);
    // a lazy or underlined label is the definition the user meant, so the
    // rule leaves its name alone
    const defined = new Set([...reading.definitions, ...labelShapedLines(before)].map((definition) => fold(definition.name)));
    return { removed: [...new Set(reading.references.filter((reference) => reference.live && !defined.has(fold(reference.name))).map((reference) => fold(reference.name)))] };
}

/**
 * Apply the note's prefix and reindex: the renames, read off the two notes.
 * The references outside every definition are paired in the order the note
 * reads them (a rename moves none of them). Then each definition is paired
 * with the one after the edit that has the name it was renamed to, or,
 * when its name is not known yet, the same text with its footnotes taken
 * out (reindex moves definitions, so the references inside one move with
 * it), and the references inside the two are paired in order. That goes
 * round until nothing more is paired.
 */
export function footnotesRenamed(before: string[], after: string[]): EditIntent {
    const was = readNote(before);
    const is = readNote(after);
    const renamed = new Map<string, string>();
    const pair = (from: string, to: string) => {
        if (!renamed.has(fold(from))) renamed.set(fold(from), fold(to));
    };
    type Reading = typeof was;
    type Definition = Reading["definitions"][number];
    const inOrder = (reading: Reading, holder: Definition | null) =>
        reading.references.filter((reference) => reference.live && reading.definitionAt(reference.line) === holder).sort((a, b) => a.line - b.line || a.start - b.start);
    const pairAll = (a: readonly { name: string }[], b: readonly { name: string }[]) => {
        if (a.length === b.length) a.forEach((reference, i) => { pair(reference.name, b[i].name); });
    };
    pairAll(inOrder(was, null), inOrder(is, null));
    const text = (lines: string[], definition: Definition) =>
        [lines[definition.start].slice(definition.labelEnd), ...lines.slice(definition.start + 1, definition.end + 1)].join("\n").replace(/\[\^[^\]\s]*\]/g, "");
    const paired = new Set<Definition>();
    // pairs `definition` with `match`, and the references inside them
    const take = (definition: Definition, match: Definition) => {
        paired.add(definition);
        paired.add(match);
        pair(definition.name, match.name);
        pairAll(inOrder(was, definition), inOrder(is, match));
    };
    for (;;) {
        const free = is.definitions.filter((other) => !paired.has(other));
        // a definition whose new name is known first, so a guess by its
        // text never takes the place of one that is known
        const known = was.definitions.find((definition) => !paired.has(definition) && free.some((other) => fold(other.name) === renamed.get(fold(definition.name))));
        if (known !== undefined) {
            const target = renamed.get(fold(known.name));
            const named = free.filter((other) => fold(other.name) === target);
            take(known, named.find((other) => text(after, other) === text(before, known)) ?? named[0]);
            continue;
        }
        // A definition whose new name is not known is matched by its text:
        // first with every footnote it cites written under its new name,
        // where all of those are known, then with its footnotes taken out.
        const mapped = (lines: string[], definition: Definition, reading: Reading, names: (name: string) => string | undefined): string | null => {
            const parts: string[] = [];
            for (let line = definition.start; line <= definition.end; line++) {
                let text = lines[line];
                for (const reference of [...reading.referencesOn(line)].reverse()) {
                    const name = names(fold(reference.name));
                    if (name === undefined) return null;
                    text = `${text.slice(0, reference.start)}[^${name}]${text.slice(reference.end)}`;
                }
                parts.push(line === definition.start ? text.slice(definition.labelEnd) : text);
            }
            return parts.join("\n");
        };
        const unknown = was.definitions.filter((definition) => !paired.has(definition) && !renamed.has(fold(definition.name)));
        let found: [Definition, Definition] | null = null;
        for (const definition of unknown) {
            const mine = mapped(before, definition, was, (name) => renamed.get(name));
            if (mine === null) continue;
            const match = free.filter((other) => mapped(after, other, is, (name) => name) === mine);
            if (match.length === 1) {
                found = [definition, match[0]];
                break;
            }
        }
        if (found === null) {
            // one whose text only one definition after the edit has goes
            // first, so a common text is guessed only when nothing else is left
            const candidates = (definition: Definition) => free.filter((other) => text(after, other) === text(before, definition)).length;
            const guess = unknown.find((definition) => candidates(definition) === 1) ?? unknown.find((definition) => candidates(definition) > 0);
            const match = guess === undefined ? undefined : free.find((other) => text(after, other) === text(before, guess));
            if (guess !== undefined && match !== undefined) found = [guess, match];
        }
        if (found === null) break;
        take(found[0], found[1]);
    }
    for (const [from, to] of renamed) if (from === to) renamed.delete(from);
    return { renamed };
}
