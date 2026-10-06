import { EditorPosition } from "obsidian";

import { positionAfterRewrite } from "../editor/document-diff";
import { definitionsToCut, orphanedDefinitionBlocks } from "../linting/rules/remove-orphaned-definitions";
import { normalizeEol } from "../parsing/line-edits";
import { Definition, NoteReading, readNote, ReferenceOccurrence } from "../parsing/note-reading";

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
    /** the blocks the selection needs, in the order their references are first met, except that blocks holding copies of one name keep the note's order (copiesInNoteOrder) */
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
    return liftedCuts(lines, blocks).map((cuts, k) => ({
        name: blocks[k].name,
        lines: cuts.map((cut, i) => lines[blocks[k].start + i].slice(cut)),
    }));
}

/** For each of the `blocks`, how many characters liftedBlocks takes off the front of each of its lines, the label's line first. */
function liftedCuts(lines: readonly string[], blocks: readonly Definition[]): number[][] {
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
        const cuts = [block.labelStart];
        for (let line = block.start + 1; line <= block.end; line++) cuts.push(containerWidth(line));
        return cuts;
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
    // first (hunt 2026-10-05, pin bug-nested-definition-carried-twice).
    // Two definitions can share their lines, as in "[^1]: [^2]: x", where
    // [^2] is held in [^1]'s text (rule E2). Comparing lines alone, each
    // then lay inside the other, and both were dropped, so the copy carried
    // neither; the holder is the one whose label comes first (hunt
    // 2026-10-06 cycle 5, cluster X6, pin bug-carry-equal-extent-definitions).
    const outermost = carried.filter((block) => !carried.some((other) => other !== block && holds(other, block)));
    return { blocks: copiesInNoteOrder(outermost, reading.definitions), missing };
}

/** Whether the definition `outer` holds `inner` in its body: `inner` starts after `outer`'s label and ends by `outer`'s last line. */
function holds(outer: Definition, inner: Definition): boolean {
    const startsAfter = outer.start < inner.start || (outer.start === inner.start && outer.labelStart < inner.labelStart);
    return startsAfter && inner.end <= outer.end;
}

/**
 * The carried `blocks`, in the order the copy met them, except that blocks
 * holding copies of the same name keep the order they have in the note.
 *
 * A name can be defined twice, once inside another footnote's definition
 * (a held copy, indented under "[^a]: outer") and once on its own.
 * Obsidian draws the last copy in the note, and a held copy counts (live
 * Obsidian 1.14.4, 2026-10-05). The copy carries the last copy of a name
 * on its own, and a held copy travels inside the block that holds it, so
 * the carried blocks can put the two copies the other way round: text
 * citing [^b] and then [^a] used to land "[^b]: last" first and [^a] with
 * its held [^b] after it, and the pasted [^b] showed the held text (hunt
 * 2026-10-05 round 2, cluster C3, pin bug-carry-reorders-held-duplicate).
 *
 * So a block waits until every block that holds an earlier copy of one of
 * its names has gone first; nothing else moves. A block holding an
 * earlier copy always starts earlier in the note, so one can always go.
 * `definitions` is the note reading's list, which has every definition,
 * held ones included.
 */
function copiesInNoteOrder(blocks: readonly Definition[], definitions: readonly Definition[]): Definition[] {
    // the names each block defines: its own, and those held in its body
    const names = blocks.map((block) => new Set(definitions.filter((other) => block.start <= other.start && other.start <= block.end).map((other) => other.name.toLowerCase())));
    const earlier = (i: number, j: number) => blocks[i].start < blocks[j].start && [...names[i]].some((name) => names[j].has(name));
    const order: number[] = [];
    while (order.length < blocks.length) {
        order.push(blocks.findIndex((_, j) => !order.includes(j) && blocks.every((_, i) => order.includes(i) || !earlier(i, j))));
    }
    return order.map((i) => blocks[i]);
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
 * 2026-09-21). `at` is where the body lands in the destination; without
 * it, the body is read on its own.
 *
 * One planner sees every name the paste brings: the carried blocks' own
 * names, the names defined inside a carried block (a footnote held in
 * another footnote's definition), the names the pasted body defines
 * itself, and the names the body and the blocks only cite. Each pasted
 * definition is then merged, kept, or renamed:
 *
 * - Merged: a carried block whose text, whitespace collapsed and with the
 *   paste's own merges made, equals the text of a definition the
 *   destination shows. Its references are pointed at the existing name,
 *   whatever its label, and the block is not added.
 * - Kept: a name nothing in the destination uses, as a definition or a
 *   reference, and that no name settled before it has taken.
 * - Renamed: any other, a number to the smallest free number, a name to
 *   name-2, name-3, and so on.
 *
 * The renames are made in the body and inside the carried blocks (labels
 * and references alike), so a carried definition that cites another keeps
 * citing it. Protected text in the body is left as it is.
 */
export function planCarriedPaste(destination: string, body: string, carried: CarriedDefinition[], at?: EditorPosition): CarriedPastePlan {
    const lines = normalizeEol(destination).text.split("\n");
    const reading = readNote(lines);

    // Every name the destination uses (definitions and references, folded).
    const taken = new Set<string>();
    for (const block of reading.definitions) taken.add(block.name.toLowerCase());
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of reading.referencesOn(i)) taken.add(occurrence.name.toLowerCase());
    }

    // The pasted body, read where it lands. Read on its own, a body whose
    // first line is indented 4 columns is a code block, so the references
    // in it were not renamed while the definition they cite was; where it
    // lands, after other text on the line or under a list item, it is
    // ordinary text (hunt 2026-10-02, pin
    // bug-carry-indented-body-not-renamed).
    const bodyLines = normalizeEol(body).text.split("\n");
    const landing = landedText(lines, bodyLines, at);
    const landed = landedFootnoteSyntax(landing, bodyLines);
    const bodyDefines = landed.flatMap((line) => line.labels.map((occurrence) => occurrence.name));
    const bodyCites = landed.flatMap((line) => line.references.map((occurrence) => occurrence.name));

    // The definitions the destination shows, offered for a merge, wherever
    // they sit (a list item's included: hunt 2026-10-02, pin
    // spec-carry-paste-reuse-in-item-definition). Of two definitions of one
    // name only the last is shown, as in Obsidian, so only the last is
    // offered; offering the first, hidden one pointed the pasted reference
    // at the text Obsidian shows instead (hunt 2026-10-02, pin
    // bug-carry-merge-into-shadowed-duplicate).
    //
    // They are read in the note with the body already landed, the body's
    // own labels left out. A cut can leave text joined under a definition
    // as its lazy continuation (a line that carries on the paragraph above
    // it without being indented), which the paste back takes away again:
    // read before the body landed, that definition's text held the joined
    // line and matched nothing, so the paste back added a renamed copy of
    // it (hunt 2026-10-06 cycle 3, cluster M2, pin
    // bug-cut-kept-definition-lazy-join-paste-back).
    const host = at ? landing : { reading, lines, line: 0, shift: () => 0 };
    const ownLabel = (block: Definition) => {
        const i = block.start - landing.line;
        return at !== undefined && i >= 0 && i < bodyLines.length && block.labelStart >= landing.shift(i) && block.labelStart < landing.shift(i) + bodyLines[i].length;
    };
    const shown = new Map<string, Definition>();
    for (const block of host.reading.definitions) if (!ownLabel(block)) shown.set(block.name.toLowerCase(), block);
    const shownBlocks = [...shown.values()].sort((a, b) => a.start - b.start || a.labelStart - b.labelStart);
    const shownShapes = destinationShapes(host, shownBlocks);
    const existing = new Map(shownBlocks.map((block, k) => [block.name.toLowerCase(), { name: block.name, shape: shownShapes[k] }]));
    // the shown definitions by their text set aside, in note order
    const byText = new Map<string, { name: string; shape: Shape }[]>();
    for (const offered of existing.values()) byText.set(offered.shape.text, [...(byText.get(offered.shape.text) ?? []), offered]);

    // Each carried block read on its own, the way it lands: at the top
    // level, among the definitions.
    const blockReadings = carried.map((definition) => readNote(definition.lines));
    const blockSyntax = (i: number) => (line: number) => [...blockReadings[i].labelsOn(line), ...blockReadings[i].referencesOn(line)];
    const citedIn = (i: number) => carried[i].lines.flatMap((_, line) => blockReadings[i].referencesOn(line).map((occurrence) => occurrence.name));
    // The names defined inside a carried block's body: a footnote held in
    // another footnote's definition travels inside that block, and lands
    // in the destination as a definition like any other, so its name is
    // kept or renamed like the block's own (hunt 2026-10-05 round 2,
    // cluster C6, pin bug-paste-held-definition-name-collision). Every
    // definition in the block but the block's own counts, a held one on
    // the label's line too ("[^1]: [^2]: x"; hunt 2026-10-06 cycle 5,
    // cluster X6, pin bug-carry-equal-extent-definitions).
    const heldIn = (i: number) => {
        const ownLabel = blockReadings[i].labelOn(0)?.labelStart ?? 0;
        return blockReadings[i].definitions.filter((held) => held.start > 0 || held.labelStart > ownLabel).map((held) => held.name);
    };

    // How many definitions the paste brings for each name, folded.
    const defined = new Map<string, number>();
    const define = (name: string) => defined.set(name.toLowerCase(), (defined.get(name.toLowerCase()) ?? 0) + 1);
    bodyDefines.forEach(define);
    carried.forEach((definition, i) => {
        define(definition.name);
        heldIn(i).forEach(define);
    });
    // A name the paste cites without defining it keeps its spelling, and
    // whatever the destination means by it, so no rename may land on it.
    // Renaming onto one made two pasted footnotes into one (hunt
    // 2026-10-02, pin bug-carry-rename-ignores-body-names).
    for (const name of [...bodyCites, ...carried.flatMap((_, i) => citedIn(i))]) {
        if (!defined.has(name.toLowerCase())) taken.add(name.toLowerCase());
    }

    // Merges first. A block's text is compared as it reads once the
    // paste's own merges are made: "see [^b]" is the destination's
    // "see [^b]" only if the pasted [^b] is merged into the destination's
    // [^b]. So the two texts must be the same with their footnote names set
    // aside (Shape), and each name in the block must pair up with the name
    // in the same place in the destination's text: a name the paste does
    // not define with itself, and a carried block's name with the
    // definition it is merged into, which must then match too. A name the
    // paste brings and does not merge lands under a name the destination
    // does not use at all, so a block citing one, or holding a definition
    // (which is never merged), matches nothing there and is not merged
    // either. Comparing before the renames merged a citing block into one
    // citing a different footnote (hunt 2026-10-02, pin
    // bug-carry-merge-before-renames).
    //
    // A block that cites itself, or blocks that cite each other in a ring,
    // are matched together: the match a block is being tried for counts as
    // made while its own text is compared. Waiting for each cited block to
    // be merged first, a block citing itself waited on itself and the
    // blocks of a ring on each other, so none was ever merged and a cut
    // pasted back added renamed copies (hunt 2026-10-06 cycle 3, cluster
    // M1, pin bug-paste-reuse-self-citing-definition).
    //
    // Only a name the paste defines once can be merged. A held definition
    // cannot, since its lines are part of the block that holds it, and nor
    // can a name defined twice: merging one copy would leave the other to
    // stand alone, and dropping both lost the footnote (hunt 2026-10-02,
    // pin bug-carry-duplicate-clipboard-name-dropped). Both copies then
    // land under one name, the last still the one shown.
    const merged = new Map<string, string>();
    const unmerged = new Set<string>();
    const blockOf = new Map(carried.map((definition, i) => [definition.name.toLowerCase(), i]));
    const shapes = carried.map((definition, i) => shapeOf(definition.lines, blockReadings[i].labelOn(0)?.labelEnd ?? 0, blockSyntax(i)));
    // whether carried block `i` reads as the destination's `offered` once
    // every name in it is paired up; `pairs` holds the matches assumed so
    // far, and gains the ones this match needs
    const matches = (i: number, offered: { name: string; shape: Shape }, pairs: Map<string, string>): boolean => {
        const there = offered.shape.names;
        if (shapes[i].text !== offered.shape.text || shapes[i].names.length !== there.length) return false;
        return shapes[i].names.every((name, k) => {
            const folded = name.toLowerCase();
            const target = there[k].toLowerCase();
            const paired = merged.get(folded) ?? pairs.get(folded);
            if (paired !== undefined) return paired.toLowerCase() === target;
            if (!defined.has(folded)) return folded === target;
            const j = blockOf.get(folded);
            const definition = existing.get(target);
            if (j === undefined || defined.get(folded) !== 1 || unmerged.has(folded) || !definition) return false;
            pairs.set(folded, definition.name);
            return matches(j, definition, pairs);
        });
    };
    carried.forEach((definition, i) => {
        const folded = definition.name.toLowerCase();
        if (merged.has(folded) || unmerged.has(folded) || defined.get(folded) !== 1) return;
        // Of two shown definitions with the same text, one with the same
        // name serves first (in a ring of look-alike definitions, "[^a]:
        // see [^b]" and "[^b]: see [^a]", the pasted [^a] could otherwise
        // pair with [^b] and [^b] with [^a]), then the later one.
        const offers = [...(byText.get(shapes[i].text) ?? [])].reverse();
        for (const offered of [...offers.filter((offer) => offer.name.toLowerCase() === folded), ...offers.filter((offer) => offer.name.toLowerCase() !== folded)]) {
            const pairs = new Map([[folded, offered.name]]);
            if (!matches(i, offered, pairs)) continue;
            for (const [incoming, name] of pairs) merged.set(incoming, name);
            return;
        }
        unmerged.add(folded);
    });

    // Then every other name is kept or renamed, in the order the pasted
    // text meets them: the body's own definitions, then each carried block
    // and the definitions it holds. The final name of every incoming name,
    // folded:
    const finalName = new Map(merged);
    const assigned = new Set<string>();
    let renamed = 0;
    const occupied = (folded: string) => taken.has(folded) || assigned.has(folded);
    // an incoming name keeps its spelling when the destination and the
    // names given so far leave it free, and is renamed otherwise
    const settle = (incoming: string) => {
        const folded = incoming.toLowerCase();
        if (finalName.has(folded)) return;
        let name = incoming;
        if (occupied(folded)) {
            if (/^\d+$/.test(incoming)) {
                let n = 1;
                while (occupied(String(n))) n++;
                name = String(n);
            } else {
                let k = 2;
                while (occupied(`${folded}-${k}`)) k++;
                name = `${incoming}-${k}`;
            }
            renamed++;
        }
        finalName.set(folded, name);
        assigned.add(name.toLowerCase());
    };
    bodyDefines.forEach(settle);
    const definitions: CarriedDefinition[] = [];
    carried.forEach((definition, i) => {
        if (merged.has(definition.name.toLowerCase())) return;
        settle(definition.name);
        heldIn(i).forEach(settle);
    });
    carried.forEach((definition, i) => {
        if (merged.has(definition.name.toLowerCase())) return;
        definitions.push({ name: finalName.get(definition.name.toLowerCase()) as string, lines: renamedLines(definition.lines, blockSyntax(i), finalName) });
    });

    const repointed = [...merged].filter(([incoming, existing]) => existing.toLowerCase() !== incoming).length;
    return {
        body: renamedLines(bodyLines, (line) => [...landed[line].labels, ...landed[line].references], finalName).join("\n"),
        definitions,
        added: definitions.length,
        reused: merged.size,
        repointed,
        renamed,
    };
}

/**
 * The note `lines` with `text` written in at `at`, between what came before
 * the caret on that line and what came after it, read; and where the text's
 * own stretch of each of its lines starts (the first line of the text
 * starts at the caret, every later one at the start of its line). Without
 * `at` the text is read on its own.
 */
function landedText(lines: readonly string[], text: readonly string[], at: EditorPosition | undefined): Landing {
    const origin = at ?? { line: 0, ch: 0 };
    let note = [...text];
    if (at) {
        const host = lines[at.line] ?? "";
        note[0] = host.slice(0, at.ch) + note[0];
        note[note.length - 1] += host.slice(at.ch);
        note = [...lines.slice(0, at.line), ...note, ...lines.slice(at.line + 1)];
    }
    return { lines: note, reading: readNote(note), line: origin.line, shift: (i) => (i === 0 ? origin.ch : 0) };
}

/** A text landed in a note (landedText): the note's lines and reading, the line the text starts on, and where its own stretch of each of its lines starts. */
interface Landing {
    lines: readonly string[];
    reading: NoteReading;
    line: number;
    shift: (i: number) => number;
}

/**
 * Whether `text`, pasted into `lines` at `at` just as it is, holds footnote
 * syntax ("[^") and every bit of it lands in protected text: code, math,
 * frontmatter, and the like. A "%%" comment is no such place, since a
 * reference inside one is live (Jason's ruling A1), and the masked twin
 * keeps a comment's text for that reason.
 *
 * The paste asks this of the whole clipboard, its definition lines
 * included, and of the text in front of them (landCarriedText in
 * carry-footnotes-hooks.ts). It used to ask only of the text in front, so
 * a clipboard of definition lines and nothing else (or prose citing
 * nothing, then its definitions) never counted as landing in a code block,
 * and the definitions were pulled out of the code (hunt 2026-10-06 cycle
 * 3, clusters K1 and K2, pin bug-carry-paste-definitions-into-protected-text).
 */
export function landsInProtectedText(lines: readonly string[], at: EditorPosition, text: string): boolean {
    const pasted = normalizeEol(text).text.split("\n");
    const landed = landedText(lines, pasted, at);
    const opens = pasted.flatMap((line, i) => [...line.matchAll(/\[\^/g)].map((match) => landed.reading.maskedLine(landed.line + i)[landed.shift(i) + match.index]));
    return opens.length > 0 && opens.every((character) => character === "\0");
}

/**
 * The footnote syntax of the pasted `body` as it reads where it landed
 * (`landing`, from landedText): for each line of the body, the live
 * references and the definition labels on it, with columns counted from
 * the start of that line of the body.
 */
function landedFootnoteSyntax(landing: Landing, body: readonly string[]): { references: ReferenceOccurrence[]; labels: ReferenceOccurrence[] }[] {
    const { reading, line, shift } = landing;
    return body.map((text, i) => {
        const own = (occurrences: readonly ReferenceOccurrence[]) =>
            occurrences
                .filter((occurrence) => occurrence.start >= shift(i) && occurrence.end <= shift(i) + text.length)
                .map((occurrence) => ({ ...occurrence, start: occurrence.start - shift(i), end: occurrence.end - shift(i) }));
        return { references: own(reading.referencesOn(line + i)), labels: own(reading.labelsOn(line + i)) };
    });
}

/**
 * `text` with every name in `names` (keyed by folded name) written in its
 * place: the "[^name]" labels and references that `syntaxOn` lists for each
 * line. The renames are made right to left on each line, so that one keeps
 * the columns of the ones before it.
 */
function renamedLines(text: readonly string[], syntaxOn: (line: number) => readonly ReferenceOccurrence[], names: ReadonlyMap<string, string>): string[] {
    return text.map((line, i) =>
        syntaxOn(i)
            .filter(({ name }) => {
                const target = names.get(name.toLowerCase());
                return target !== undefined && target !== name;
            })
            .sort((a, b) => b.start - a.start)
            .reduce((kept, { start, end, name }) => kept.slice(0, start + 2) + (names.get(name.toLowerCase()) as string) + kept.slice(end - 1), line),
    );
}

/**
 * The clipboard text with the carried blocks appended after one blank
 * line: what copy and cut write to the clipboard (Jason, 2026-09-22:
 * always, so a paste outside Obsidian keeps the definitions). A
 * body with no definitions to carry comes back untouched.
 *
 * The body goes in exactly as it was selected, its trailing line breaks
 * included, and splitCarriedText takes back off exactly the one blank
 * line put in here. A paragraph selected line-wise (Shift+Down, so the
 * selection holds its line break) used to lose that line break here, and
 * a paste of the clipboard text glued it onto the text after the caret
 * (hunt 2026-10-02, pin bug-carry-line-wise-body-loses-line-break).
 */
export function withCarriedText(body: string, carried: CarriedDefinition[]): string {
    if (carried.length === 0) return body;
    return body + "\n\n" + carriedLines(carried).join("\n");
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
 *
 * The body comes back with everything in front of the definitions except
 * the one blank line that separates them from it, so a body that ended in
 * a line break keeps it. Line breaks after the last definition go back on
 * the end of the body: a text that ends in a line break was taken whole
 * lines at a time, and pasted at the start of a line it must still end
 * its own line, with the definitions lifted out of it (hunt 2026-10-02,
 * pin bug-carry-line-wise-body-loses-line-break).
 *
 * So do the blank lines between two definitions of the run past the first
 * one. withCarriedText puts one blank line in front of the definitions it
 * appends, and the definitions sit right under one another; a second blank
 * line there is the line break that ended the selection, when the selection
 * itself ended with a definition of its own. The selection was then taken
 * whole lines at a time too, and its body must end its own line. Dropping
 * that line break glued the pasted body onto the text after the caret,
 * where a paste of the plugin's own copy in the same window kept it on its
 * own line (hunt 2026-10-06 cycle 3, cluster K3, pin
 * bug-carry-line-wise-break-before-outside-definition).
 *
 * That reading holds only for a text withCarriedText wrote. The copy's own
 * register splits the selection itself, before anything is appended
 * (`selection` true), and there the blank lines between two definitions
 * are the note's own spacing, never a line break of the selection's: read
 * as one, a selection ending right after "[^2]: two", in a note that
 * spaces its definitions by two blank lines, pasted mid-line split the
 * line it landed in (hunt 2026-10-06 cycle 4, cluster K2, pin
 * bug-own-copy-double-blank-definitions-split-line).
 */
export function splitCarriedText(text: string, selection = false): { body: string; carried: CarriedDefinition[] } {
    const lines = normalizeEol(text).text.split("\n");
    // the definitions at the top level of the text, the ones withCarriedText
    // appends, lifted as every carried block is (liftedBlocks), which takes
    // off any indentation in front of a label
    const blocks = readNote(lines).blocks;
    const byEnd = new Map(blocks.map((block) => [block.end, block]));
    // `cut` is the first line of the trailing run of definitions, and
    // `end` the line the search for the next block up has reached
    let cut = lines.length;
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === "") end--;
    const after = lines.slice(end);
    // the blank lines past the first between two definitions of the run
    const breaks: string[] = [];
    for (;;) {
        const below = end;
        while (end > 0 && lines[end - 1].trim() === "") end--;
        const block = byEnd.get(end - 1);
        if (!block) break;
        if (cut < lines.length && !selection) breaks.push(...lines.slice(end + 1, below));
        cut = end = block.start;
    }
    if (cut === lines.length) return { body: text, carried: [] };
    const carried = liftedBlocks(lines, blocks.filter((block) => block.start >= cut));
    const bodyEnd = cut > 0 && lines[cut - 1].trim() === "" ? cut - 1 : cut;
    return { body: [...lines.slice(0, bodyEnd), ...breaks, ...after].join("\n"), carried };
}

/**
 * The names a pasted `text` from anywhere cites with no definition of its
 * own: the live references in it, read on its own, whose name nothing in
 * the text defines; spelled as first seen, each once. This is the
 * `missing` list the plugin's own copy keeps (CarriedDefinitions), read
 * off the clipboard text instead of the note it came from, since the paste
 * has nothing else to read. A clipboard from another app was pasted with
 * an empty list, so its toast never named a reference that travelled
 * without a definition, as the README promises (hunt 2026-10-06 cycle 4,
 * cluster K5, pin bug-foreign-paste-toast-missing-definition).
 */
export function uncarriedNames(text: string): string[] {
    // a text with no "[^" cites nothing, so it is not read
    if (!text.includes("[^")) return [];
    const lines = normalizeEol(text).text.split("\n");
    const reading = readNote(lines);
    const defined = new Set(reading.definitions.map((definition) => definition.name.toLowerCase()));
    const missing = new Map<string, string>();
    for (let line = 0; line < lines.length; line++) {
        for (const { name } of reading.referencesOn(line)) {
            if (!defined.has(name.toLowerCase()) && !missing.has(name.toLowerCase())) missing.set(name.toLowerCase(), name);
        }
    }
    return [...missing.values()];
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
 * definition block leaves the note only when all four of these hold.
 * The clipboard carries it (carriedBlocks, the reader copy uses too). Once
 * the selection is gone, nothing references it, read by the orphan rule's
 * own reader on the note as it reads then, chains included; a definition
 * that was an orphan before the cut, and one the plugin never cuts (its
 * line closes a comment), are not the cut's to take, and nor is one that
 * a definition staying in the note still cites. Deleting the selection
 * left its lines whole (leftWhole). And taking it out changes how no
 * other line of the note reads, the guard the orphan rule uses
 * (definitionsToCut).
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
    // A block the deletion leaves right under a line of text, with no blank
    // line between, is no definition any more: its label reads as more of
    // that paragraph (a lazy label). The orphan rule's reader never sees it,
    // so it is judged by its name alone: it goes when nothing outside it
    // cites it (definitionsToCut checks that). Kept, it stayed in the note
    // as plain text while the clipboard carried it too, and a paste back
    // gave the footnote twice (hunt 2026-10-06 cycle 3, cluster M3, pin
    // bug-cut-leaves-carried-definition-lazy).
    const joinedReading = readNote(joined);
    const undone = (block: Definition) => joinedReading.labelOn(moved(block.start)) === null && !wasOrphan.has(block.name.toLowerCase());
    const candidates = blocks
        .filter((block) => leftWhole(lines, from, to, block) && (orphanedAt.has(moved(block.start)) || undone(block)) && block.removable)
        .map((block) => ({ ...block, start: moved(block.start), end: moved(block.end) }));
    // A definition the cut leaves in place, such as one between two lists,
    // still travels on the clipboard, so pasting the text back reuses it
    // (Jason, 2026-10-05, triage decision Q2; pin
    // bug-cut-definition-between-lists-joins-them).
    const { removed, kept } = definitionsToCut(joined, candidates);
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
 * A definition's text with its footnote names set aside, the key two
 * definitions are compared by: the text after its label, every name in a
 * label or a reference taken out ("see [^b]" reads "see [^]"), whitespace
 * collapsed; and the names taken out, in the order they come. Two
 * definitions with the same text read the same once each name in one is
 * paired with the name in the same place in the other.
 */
interface Shape {
    text: string;
    names: string[];
}

/** The Shape of a definition's `lines`, its label ending at column `labelEnd` of the first line, with `syntaxOn` listing the labels and references on each line. */
function shapeOf(lines: readonly string[], labelEnd: number, syntaxOn: (line: number) => readonly ReferenceOccurrence[]): Shape {
    const names: string[] = [];
    const text = lines.map((line, i) => {
        let kept = "";
        let from = i === 0 ? labelEnd : 0;
        for (const { name, start, end } of [...syntaxOn(i)].filter((occurrence) => occurrence.start >= from).sort((a, b) => a.start - b.start)) {
            kept += line.slice(from, start + 2);
            from = end - 1;
            names.push(name);
        }
        return kept + line.slice(from);
    });
    return { text: text.join("\n").replace(/\s+/g, " ").trim(), names };
}

/**
 * The Shape of each of the `blocks` of the note `host` reads, each lifted
 * to the top level of the note first, as a carried block is, so that a
 * definition in a quote compares with a carried copy of it line for line.
 * Compared as it stood, the second line of "> [^q]: one" / "> two" kept its
 * quote marker and read "one > two", and a paste never reused it (hunt
 * 2026-10-06 cycle 3, cluster K5, pin
 * bug-paste-reuse-multi-line-quoted-definition). Only a quote's markers are
 * text; a list item takes only indentation from the lines after its first,
 * and whitespace does not count, so only definitions in a quote that run
 * over lines are lifted, and the note is read once more only for those.
 */
function destinationShapes(host: Landing, blocks: readonly Definition[]): Shape[] {
    const quoted = blocks.filter((block) => block.container.quotes > 0 && block.end > block.start);
    const lifted = new Map(liftedCuts(host.lines, quoted).map((cuts, k) => [quoted[k], cuts]));
    return blocks.map((block) => {
        const cuts = lifted.get(block) ?? [block.labelStart];
        const cut = (k: number) => cuts[k] ?? 0;
        const lines = host.lines.slice(block.start, block.end + 1).map((line, k) => line.slice(cut(k)));
        const syntaxOn = (k: number) =>
            [...host.reading.labelsOn(block.start + k), ...host.reading.referencesOn(block.start + k)]
                .filter((occurrence) => occurrence.start >= cut(k))
                .map((occurrence) => ({ ...occurrence, start: occurrence.start - cut(k), end: occurrence.end - cut(k) }));
        return shapeOf(lines, block.labelEnd - block.labelStart, syntaxOn);
    });
}
