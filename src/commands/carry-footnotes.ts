import { EditorPosition } from "obsidian";

import { positionAfterRewrite } from "../editor/document-diff";
import { orphanedDefinitionBlocks } from "../linting/rules/remove-orphaned-definitions";
import { definitionCuts, normalizeEol, removeLineRanges } from "../parsing/line-edits";
import { Definition, readNote } from "../parsing/note-reading";

// Carrying footnote definitions along on copy, cut, and paste (issue #59;
// Jason's rulings 2026-09-21 and 2026-09-22).
//
// Copy a paragraph holding "[^3]" into another note and the reference
// travels while the "[^3]: ..." definition stays behind. People have asked
// for this for years, and the one plugin that does it (Copy with
// Footnotes) reads its definitions from Obsidian's metadata cache, which
// lags the editor by a couple of seconds, and only through commands of its
// own. This plugin reads the live note, on the keys people already press.
//
// This file holds the pure pieces: which definitions a selection needs,
// how carried definitions merge into a destination note, and how a
// clipboard text that carries definition lines is split back apart. The
// editor-side hooks live in carry-footnotes-hooks.ts.

/**
 * One definition block to carry: its name as written, and its lines,
 * continuation lines included, lifted to the top level (liftedBlocks). A
 * definition that sat in a quote or a list item travels as an ordinary
 * definition, its label at the start of its line (Jason's ruling 1, option
 * a, 2026-10-03, made it carriable; Jason, 2026-10-05, Q1: it lands
 * unwrapped).
 */
export interface CarriedDefinition {
    name: string;
    lines: string[];
}

export interface CarriedDefinitions {
    /** the blocks the selection needs, in the order their references are first met */
    carried: CarriedDefinition[];
    /** the names referenced inside the selection (or inside a carried body) that have no definition to carry: an orphan or a lazy label; spelled as first seen, each once */
    missing: string[];
}

/**
 * The definition blocks the text between `from` and `to` needs when it
 * leaves this note: the definition of every live reference inside the
 * selection whose block lies outside it, plus, all the way down, the
 * definitions of the references inside those blocks' own bodies. A block
 * travels with the text, and is not carried again, exactly when the
 * selection holds its whole label, "[^name]:" (see selectionHolds). A
 * reference the selection cuts through (only part of its brackets
 * selected) is not a reference in the copy, so it needs nothing. Of
 * duplicate definitions the LAST in the note is carried, the one Obsidian
 * renders. Names match without regard to case.
 */
export function carriedDefinitions(markdown: string, from: EditorPosition, to: EditorPosition): CarriedDefinitions {
    const lines = normalizeEol(markdown).text.split("\n");
    const { blocks, missing } = carriedBlocks(lines, from, to);
    return { carried: liftedBlocks(lines, blocks), missing };
}

/**
 * The blocks as the clipboard carries them: each one's name, and its lines
 * lifted to the top level of the note.
 *
 * Every carried block is made here, whichever way it travels: the copy's
 * register, the clipboard text, and a clipboard read back by a paste with
 * no register (splitCarriedText). The destination has no list or quote for
 * a block to sit in, so each one lands as an ordinary definition (Jason,
 * 2026-10-05, Q1).
 *
 * What comes off: everything in front of the label on its own line (list
 * markers, quote markers, the item's indentation), and, on each line
 * after it, exactly what the definition's containers take from that line
 * as Obsidian reads it: the quote markers, the indentation that puts the
 * line inside its list item, and the indentation of a footnote the block
 * sits in. What stays is the line as the definition itself sees it, so
 * the block reads at the top level the way it read where it was: a second
 * paragraph indented 4 columns past the container stays 4 columns in, and
 * a code block stays code.
 *
 * How much a container takes is read off the parser rather than counted
 * here. The parser keeps, for each line, how many characters its
 * containers took; that count also holds what the definition itself took
 * (its own indentation) and what anything inside it took (a quote inside
 * the footnote). So the note is read once more with each block's label
 * turned into plain text ("[^a]:" becomes "[^a] "): there is no definition
 * then, and nothing inside one, and the count on each line is what the
 * containers alone took. A container's share is not the label's column:
 * a label may sit further in than its container needs ("  [^a]:" at the
 * top level, or 2 columns past a list item's text), and an ordered item
 * "1. " takes 4 columns from its later lines, not 3. Counting by the
 * label's column took too much and lost the definition's later
 * paragraphs (hunt 2026-10-05 round 2, clusters C1 and C4, pins
 * bug-carry-indented-label-loses-paragraphs and
 * bug-carry-ordered-item-continuation-column).
 *
 * Before the blocks were lifted at all, they travelled exactly as they
 * stood, and only the first one had its label's line unwrapped when it
 * landed. A second block indented 4 or with a "3." in front was then read
 * as more of the first one's text, and one indented 4 was read as code in
 * the clipboard text on its own (hunt 2026-10-05, pins
 * bug-carried-second-definition-glued, bug-in-item-definition-clipboard-code,
 * and bug-indented-carried-definition-not-reused).
 *
 * `blocks` must not overlap: the outermost carried blocks, or the
 * top-level ones of a clipboard text.
 */
function liftedBlocks(lines: readonly string[], blocks: readonly Definition[]): CarriedDefinition[] {
    if (blocks.length === 0) return [];
    // the note with every block's ":" after its label turned into a space
    const unlabelled = [...lines];
    for (const block of blocks) {
        const label = unlabelled[block.start];
        unlabelled[block.start] = label.slice(0, block.labelEnd - 1) + " " + label.slice(block.labelEnd);
    }
    const containers = readNote(unlabelled);
    // A line the parser counts as syntax to its end (a bare list marker)
    // cannot sit inside a definition; should one turn up, the line is kept
    // whole rather than emptied.
    const containerWidth = (line: number) => {
        const end = containers.containerEnd(line);
        return Number.isFinite(end) ? end : 0;
    };
    return blocks.map((block) => {
        const rest: string[] = [];
        for (let line = block.start + 1; line <= block.end; line++) rest.push(lines[line].slice(containerWidth(line)));
        return { name: block.name, lines: [lines[block.start].slice(block.labelStart), ...rest] };
    });
}

/**
 * Whether the selection from `from` to `to` holds the stretch of `line`
 * from character `start` to character `end` whole. Positions are compared
 * by line and then by character, never by line alone: a line-wise
 * selection made with Shift+Down ends at character 0 of the line below
 * and holds none of it, and one dragged up from the end of a line starts
 * on that line without holding any of it (hunt 2026-10-02, pin
 * bug-carry-line-selection-boundary).
 */
function selectionHolds(from: EditorPosition, to: EditorPosition, line: number, start: number, end: number): boolean {
    const atOrAfter = (a: EditorPosition, b: EditorPosition) => a.line > b.line || (a.line === b.line && a.ch >= b.ch);
    return atOrAfter({ line, ch: start }, from) && atOrAfter(to, { line, ch: end });
}

/**
 * The reader behind carriedDefinitions and planCut, so the two can never
 * disagree about what a selection carries: the blocks to carry, in the
 * order the copy meets them, in the note's own line numbers, and the
 * names that have nothing to carry.
 */
function carriedBlocks(lines: string[], from: EditorPosition, to: EditorPosition): { blocks: Definition[]; missing: string[] } {
    // A selection with no "[^" on its lines holds no reference, so it needs
    // no definition, and the note is not read at all: a copy of plain prose
    // on a 20,000-line note used to cost a whole reading of it (hunt
    // 2026-10-02, pin bug-carry-plain-copy-scans-note).
    if (!lines.slice(from.line, to.line + 1).some((line) => line.includes("[^"))) return { blocks: [], missing: [] };
    const reading = readNote(lines);

    // every definition the note has, wherever it sits (Jason's ruling 1,
    // option a, 2026-10-03: one in a list item is carried too), by
    // lower-cased name in document order, so "the last definition of a
    // name" is the last in the note whatever its shape (hunt 2026-10-02,
    // pin bug-carry-quoted-duplicate-first: the quoted ones used to be
    // listed after all the others, so a quoted first duplicate won)
    const blocksOf = new Map<string, Definition[]>();
    for (const block of reading.definitions) {
        const folded = block.name.toLowerCase();
        blocksOf.set(folded, [...(blocksOf.get(folded) ?? []), block]);
    }

    // the references the selection holds whole, in order; a label
    // defines, it does not point, so the reading leaves it out
    const queue: string[] = [];
    for (let line = from.line; line <= to.line && line < lines.length; line++) {
        for (const occurrence of reading.referencesOn(line)) {
            if (selectionHolds(from, to, line, occurrence.start, occurrence.end)) queue.push(occurrence.name);
        }
    }

    const carried: Definition[] = [];    const missing: string[] = [];
    const seen = new Set<string>();
    while (queue.length > 0) {
        const name = queue.shift() as string;
        const folded = name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        const blocks = blocksOf.get(folded);
        if (!blocks) {
            missing.push(name);
            continue;
        }
        // the last definition is the one Obsidian renders
        const block = blocks[blocks.length - 1];
        // A block whose whole label "[^name]:" the selection holds travels
        // with the text. One whose label the selection holds only part of,
        // or none of, lies outside it and is carried: a selection that
        // takes just the "[^" of a label, or starts after the label in the
        // middle of the definition's text, carries the definition whole
        // (hunt 2026-10-02, pins bug-carry-line-selection-boundary and
        // spec-carry-label-head-selection).
        if (selectionHolds(from, to, block.start, block.labelStart, block.labelEnd)) continue;
        carried.push(block);
        // and the references inside its body need their own definitions,
        // met right after it, as a reader meets them (preorder), before
        // the selection's later references
        const inner: string[] = [];
        for (let line = block.start; line <= block.end; line++) inner.push(...reading.referencesOn(line).map((occurrence) => occurrence.name));
        queue.unshift(...inner);
    }
    // A block whose lines lie inside another carried block (a footnote
    // defined in another footnote's body) already travels with that block,
    // so it is not carried a second time, whichever of the two the copy met
    // first (hunt 2026-10-05, pin bug-nested-definition-carried-twice)
    const outermost = carried.filter((block) => !carried.some((other) => other !== block && other.start <= block.start && block.end <= other.end));
    return { blocks: outermost, missing };
}

/** How carried definitions land in a destination note: the pasted body and the blocks to append, both with the collision renames made, and the counts for the toast. */
export interface CarriedPastePlan {
    body: string;
    /** the blocks to append, renamed, in carried order; a merged one is not among them */
    definitions: CarriedDefinition[];
    added: number;
    /** incoming definitions whose body an existing definition already holds, so the existing one serves */
    reused: number;
    /** the reused ones whose existing definition goes by another name, so the pasted references were pointed at it (a second paste of a footnote the first paste renamed lands here; Jason's question, 2026-09-22) */
    repointed: number;
    /** incoming names the destination already used for a different body, given a new name */
    renamed: number;
}

/**
 * Decide how `carried` definitions and the pasted `body` fit into the
 * `destination` note (T6's merge rule applied on paste; Jason,
 * 2026-09-21). In carried order: a definition whose body, whitespace
 * collapsed, equals an existing definition's is merged into it whatever
 * its label, and the references to it are pointed at the existing name; a
 * name the destination does not use (as a definition or a reference) is
 * kept; a name the destination uses for a different body is renamed, a
 * number to the smallest free number, a name to name-2, name-3, and so on.
 * The renames are made in the body and inside the carried blocks (labels
 * and references alike), so a carried definition that cites another keeps
 * citing it. Protected text in the body is left as it is.
 */
export function planCarriedPaste(destination: string, body: string, carried: CarriedDefinition[]): CarriedPastePlan {
    const lines = normalizeEol(destination).text.split("\n");
    const reading = readNote(lines);

    // what the destination holds: every name in use (definitions and
    // references, folded), and every definition body by its normalised
    // text, wherever the definition sits (a list item's included: hunt
    // 2026-10-02, pin spec-carry-paste-reuse-in-item-definition), the last
    // definition of a name winning as it does in Obsidian
    const taken = new Set<string>();
    const bodies = new Map<string, string>();
    for (const block of reading.definitions) {
        taken.add(block.name.toLowerCase());
        bodies.set(normalisedBody(lines.slice(block.start, block.end + 1), block.labelEnd), block.name);
    }
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of reading.referencesOn(i)) taken.add(occurrence.name.toLowerCase());
    }

    // the final name of every incoming name, folded
    const finalName = new Map<string, string>();
    const assigned = new Set<string>();
    const reusedNames = new Set<string>();
    let added = 0;
    let reused = 0;
    let repointed = 0;
    let renamed = 0;
    const occupied = (folded: string) => taken.has(folded) || assigned.has(folded);
    for (const definition of carried) {
        const folded = definition.name.toLowerCase();
        const existing = bodies.get(normalisedBody(definition.lines));
        if (existing !== undefined) {
            finalName.set(folded, existing);
            reusedNames.add(folded);
            reused++;
            if (existing.toLowerCase() !== folded) repointed++;
            continue;
        }
        if (!occupied(folded)) {
            finalName.set(folded, definition.name);
            assigned.add(folded);
            added++;
            continue;
        }
        let name: string;
        if (/^\d+$/.test(definition.name)) {
            let n = 1;
            while (occupied(String(n))) n++;
            name = String(n);
        } else {
            let k = 2;
            while (occupied(`${folded}-${k}`)) k++;
            name = `${definition.name}-${k}`;
        }
        finalName.set(folded, name);
        assigned.add(name.toLowerCase());
        added++;
        renamed++;
    }

    // the renames, made right to left on each line so that one keeps the
    // offsets of the ones before it; a line's own label is renamed too
    const rename = (text: string[]): string[] => {
        const textReading = readNote(text);
        return text.map((line, i) => {
            const edits = [...textReading.labelsOn(i), ...textReading.referencesOn(i)].map(({ start, end, name }) => ({ start: start + 2, end: end - 1, name }));
            return edits
                .filter((edit) => {
                    const target = finalName.get(edit.name.toLowerCase());
                    return target !== undefined && target !== edit.name;
                })
                .sort((a, b) => b.start - a.start)
                .reduce(
                    (kept, edit) => kept.slice(0, edit.start) + (finalName.get(edit.name.toLowerCase()) as string) + kept.slice(edit.end),
                    line,
                );
        });
    };
    const definitions = carried
        .filter((definition) => !reusedNames.has(definition.name.toLowerCase()))
        .map((definition) => ({
            name: finalName.get(definition.name.toLowerCase()) as string,
            lines: rename(definition.lines),
        }));
    return { body: rename(normalizeEol(body).text.split("\n")).join("\n"), definitions, added, reused, repointed, renamed };
}

/**
 * The clipboard text with the carried blocks appended after one blank
 * line: what copy and cut write to the clipboard (Jason, 2026-09-22:
 * always, so a paste outside Obsidian keeps the definitions). A
 * body with no definitions to carry comes back untouched.
 */
export function withCarriedText(body: string, carried: CarriedDefinition[]): string {
    if (carried.length === 0) return body;
    return body.replace(/\n+$/, "") + "\n\n" + carriedLines(carried).join("\n");
}

/**
 * The lines of the carried blocks one under the other, the way both the
 * clipboard text and the paste write them.
 *
 * A label at the start of a line ends the block above it, almost always.
 * Where it does not (the block above ends inside raw HTML, which runs on
 * until a blank line), the label would read as more of that block, and
 * its footnote would lose its definition; that block gets a blank line in
 * front. Each block keeps its own lines otherwise (hunt 2026-10-05, pin
 * bug-carried-second-definition-glued).
 */
export function carriedLines(carried: readonly CarriedDefinition[]): string[] {
    const joined: string[] = [];
    for (const block of carried) {
        const start = joined.length;
        joined.push(...block.lines);
        if (start > 0 && readNote(joined).labelOn(start)?.movable !== true) joined.splice(start, 0, "");
    }
    return joined;
}

/**
 * A pasted text split back into its body and the trailing definition
 * blocks it carries: the mirror of withCarriedText, and the reading the
 * paste fallback gives any clipboard that ends in definition lines,
 * wherever it came from. Only a trailing run of definitions (blank lines
 * between them allowed) counts; a definition in the middle of the text is
 * part of the body, since the text around it is. A definition-shaped line
 * inside a code fence is protected text and not a definition.
 */
export function splitCarriedText(text: string): { body: string; carried: CarriedDefinition[] } {
    const lines = normalizeEol(text).text.split("\n");
    // the definitions at the top level of the text, the ones withCarriedText
    // appends, lifted as every carried block is (liftedBlocks), which takes
    // off any indentation in front of a label
    const blocks = readNote(lines).blocks;
    const byEnd = new Map(blocks.map((block) => [block.end, block]));
    let cut = lines.length;
    for (;;) {
        while (cut > 0 && lines[cut - 1].trim() === "") cut--;
        const block = byEnd.get(cut - 1);
        if (!block) break;
        cut = block.start;
    }
    if (cut === lines.length) return { body: text, carried: [] };
    const carried = liftedBlocks(lines, blocks.filter((block) => block.start >= cut));
    let bodyEnd = cut;
    while (bodyEnd > 0 && lines[bodyEnd - 1].trim() === "") bodyEnd--;
    return { body: lines.slice(0, bodyEnd).join("\n"), carried };
}

/** What a cut does to the note and to the clipboard (planCut). */
export interface CutPlan extends CarriedDefinitions {
    /** the note as it reads after the cut, its lines joined with "\n" */
    text: string;
    /** where the caret goes in `text`: the place the selection was */
    caret: EditorPosition;
    /** how many of the carried blocks the cut took out of the note, the number the toast gives */
    removed: number;
}

/**
 * What cutting the text between `from` and `to` does, worked out in one
 * pass so the clipboard and the note can never disagree.
 *
 * The promise: a cut removes the selection, plus the definition blocks it
 * carries that nothing else in the note uses, and nothing else. So a
 * definition block leaves the note only when all three of these hold.
 * The clipboard carries it (carriedBlocks, the reader copy uses too). Once
 * the selection is gone, nothing references it, read by the orphan rule's
 * own reader on the note as it reads then, chains included; a definition
 * that was an orphan before the cut, and one the plugin never cuts (its
 * line closes a comment), are not the cut's to take. And deleting the
 * selection left its lines whole (leftWhole).
 *
 * Every other block stays where it is. That is how the cut used to lose
 * text, wherever the two halves disagreed (hunt 2026-10-02): a selection
 * ending inside a reference's brackets deleted a definition the clipboard
 * did not carry (pin bug-carry-cut-through-reference-brackets); a block
 * the deletion joined unselected text onto was deleted with that text
 * (pin bug-carry-cut-deletes-unselected-tail); and of a name defined
 * twice both blocks were deleted while only the last was carried (pin
 * bug-carry-cut-duplicate-definitions). The first duplicate now stays in
 * the note, where the lint's alerts name it (ADR 0002: never silent,
 * never eat text).
 *
 * `tidy` is what the plugin does to the note after the cut (removing a
 * section heading the cut left empty); the caret is worked out in the
 * note as it reads after that too, so it can never point past the end of
 * the note (pin bug-carry-cut-caret-stale-line).
 *
 * When the clipboard carries nothing, the plugin leaves the cut to the
 * editor, and the plan is the editor's own cut: the selection deleted,
 * and nothing tidied.
 */
export function planCut(
    markdown: string,
    from: EditorPosition,
    to: EditorPosition,
    tidy: (text: string) => string = (text) => text,
): CutPlan {
    const lines = normalizeEol(markdown).text.split("\n");
    const { blocks, missing } = carriedBlocks(lines, from, to);
    const carried = liftedBlocks(lines, blocks);
    // the note with the selection deleted: what was left of its first line
    // and of its last line, joined into one
    const joined = [
        ...lines.slice(0, from.line),
        lines[from.line].slice(0, from.ch) + lines[to.line].slice(to.ch),
        ...lines.slice(to.line + 1),
    ];
    const joinedText = joined.join("\n");
    if (blocks.length === 0) return { carried, missing, text: joinedText, caret: from, removed: 0 };

    // where a line the deletion keeps sits once the selection is gone
    const moved = (line: number) => (line <= from.line ? line : line - (to.line - from.line));
    const wasOrphan = new Set(orphanedDefinitionBlocks(lines).map((block) => block.name.toLowerCase()));
    const orphanedAt = new Set(
        orphanedDefinitionBlocks(joined)
            .filter((block) => !wasOrphan.has(block.name.toLowerCase()))
            .map((block) => block.start),
    );
    const removed = blocks.filter((block) => leftWhole(lines, from, to, block) && orphanedAt.has(moved(block.start)) && block.removable);
    const cut = definitionCuts(
        joined,
        removed.map((block) => ({ ...block, start: moved(block.start), end: moved(block.end) })),
    );
    const kept = removeLineRanges(cut.lines, cut.ranges);
    const text = tidy(kept.join("\n"));
    return { carried, missing, text, caret: positionAfterRewrite(joinedText, text, from), removed: removed.length };
}

/**
 * Whether deleting the selection from `from` to `to` leaves `block` whole,
 * on lines of its own, so that taking its lines out takes nothing else.
 *
 * A block on lines the deletion never touches is whole. So is one that
 * meets the selection only at an edge: it ends exactly where the
 * selection starts and nothing follows the selection's end on its line,
 * or it starts at the very beginning of the selection's last line and
 * nothing comes before the selection's start on its line. Either way the
 * line the deletion joins is the block's own line, as it was (a line-wise
 * selection made with Shift+Down ends like this; hunt 2026-10-02, pin
 * bug-carry-line-selection-boundary). Any other block shares a line with
 * text the cut is not taking, and keeps its lines.
 */
function leftWhole(lines: string[], from: EditorPosition, to: EditorPosition, block: Definition): boolean {
    if (block.end < from.line || block.start > to.line) return true;
    if (block.end === from.line && from.ch === lines[from.line].length && to.ch === lines[to.line].length) return true;
    return block.start === to.line && to.ch === 0 && from.ch === 0;
}

/**
 * A definition block's body with the label stripped and whitespace
 * collapsed, the key two definitions are compared by. `labelEnd` is where
 * the label ends on the first line; without it, the block is read on its
 * own to find out (a carried block, as the clipboard holds it).
 */
function normalisedBody(blockLines: string[], labelEnd = readNote(blockLines).labelOn(0)?.labelEnd ?? 0): string {
    const first = blockLines[0].slice(labelEnd);
    return [first, ...blockLines.slice(1)].join("\n").replace(/\s+/g, " ").trim();
}
