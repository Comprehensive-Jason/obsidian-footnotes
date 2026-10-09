import { Editor, EditorChange, EditorPosition } from "obsidian";

import type FootnotePlugin from "../main";
import {
    emptyReferenceStart,
    footnoteNameProblem,
    idListIncludes,
    referenceText,
} from "../parsing/footnote-grammar";
import { activeFootnotePrefix, footnotePrefixFromEditor } from "../parsing/footnote-prefix";
import { adjustFootnotePosition, comparePositions } from "../editor/cursor-motion";
import { planDefinitionAppend } from "./definition-append";
import { judgeEdit } from "../editor/result-gate";
import { DocContext, docContext, listExistingFootnoteDefinitions } from "../editor/doc-context";
import { inlineNoteBody, readInlineFootnoteFromClipboard } from "./inline-footnotes";
import { simulateChanges, simulatedAnchors } from "../editor/insertion-liveness";
import {
    autonumFootnoteId,
    createMatchingFootnoteDefinition,
    landDefinitionBackedInsertion,
    refusedCreation,
} from "./create-footnote";
import {
    caretGuardsHandled,
    warnDefinitionCaretIfInside,
    warnPrefilledReferenceIfInside,
    warnProtectedCaretIfInside,
    warnTableEdgeCaretIfOutside,
} from "./press-guards";

import { MultiCaretNestedNotice, showNotice } from "../editor/notice";
// The multi-caret press: several Alt-clicked carets all get the SAME
// footnote (Jason's ask 2026-08-22, for one source cited in many places;
// always on, no toggle, his call). What each key does:
//
//   numbered - the same "[^N]" at every caret, with ONE definition
//   named    - the empty "[^]" at every caret, with a cursor left inside
//              each pair of brackets
//   inline   - the empty "^[]" at every caret, same idea
//   paste    - the same clipboard text wrapped at every caret
//
// Leaving a cursor inside every bracket pair is what lets you type the
// name or the body once and have it appear in all of them, because
// CodeMirror repeats your typing at every cursor.
//
// The press is atomic by ruling: every caret has to sit somewhere a
// footnote can be created, or the whole press refuses with a single
// message. The edit itself is one transaction, so one undo takes all of it
// back. Before this, extra carets were quietly ignored, which served
// nobody.

// The message shown when the carets disagree is MultiCaretNestedNotice
// (editor/notice.ts). It is the same sentence about nesting that the
// single-caret guards use, with a plural opening.

/** What a caret is sitting inside, used by the continuation check. These are the same three tests the guard sweep refuses on. An inline footnote is reported ahead of a reference on purpose, because an inline footnote's body can contain reference-shaped text; the single-caret guards order them the same way. */
type CaretArtifact =
    | { kind: "inline"; empty: boolean }
    | { kind: "empty" }
    | { kind: "ref"; name: string }
    | null;

function caretArtifact(
    ctx: DocContext,
    pos: EditorPosition,
): CaretArtifact {
    // the reading matches an inline footnote's brackets the way Obsidian
    // does, a bracket in a code span not counted (hunt 2026-10-02, G1). It
    // finds one that runs over a line break of its paragraph too, as the
    // single-caret hop does (hunt 2026-10-05, pin
    // bug-multi-caret-multi-line-inline-note: the one-line lookup missed
    // it, so a caret there counted as one on plain text)
    const span = ctx.reading().inlineNoteHolding(pos.line, pos.ch);
    if (span !== null) return { kind: "inline", empty: inlineNoteBody(ctx.reading(), span).trim() === "" };
    if (emptyReferenceStart(ctx.maskedLine(pos.line), pos.ch) !== null) return { kind: "empty" };
    // a lazy label's own "[^x]" is a live reference to the reading, so a
    // caret inside it is inside a reference, not on plain text (Kimi sweep
    // 2026-09-13)
    const occurrence = ctx.reading().referenceAt(pos.line, pos.ch);
    if (occurrence !== null) return { kind: "ref", name: occurrence.name };
    return null;
}

/**
 * When EVERY caret sits inside the same kind of footnote thing, the press
 * is not refused. It is the ordinary second press, the one that carries on
 * from where the first left off, aimed at whichever of them comes first in
 * the note (from Jason's manual pass, 2026-08-27: the named multi-caret
 * flow had nowhere to go on its second press, and a filled inline footnote
 * could never be hopped back out of).
 *
 * What each case does:
 *
 *   every caret in an empty "[^]" or an untouched prefix placeholder: the
 *   shared guards warn, and the carets are NOT collapsed to one, so typing
 *   keeps filling all of them at once
 *
 *   every caret in a filled inline footnote: one cursor hops out past the
 *   first one
 *
 *   every caret on a reference of the same name with no definition: they
 *   all get their ONE shared definition, then the popup or the jump and
 *   the creation lint, through createMatchingFootnoteDefinition
 *
 * Anything mixed keeps the atomic refusal: different kinds, different
 * names, some empty and some filled. So does a name that already works,
 * meaning it already has a definition, since there is nothing to carry on
 * from. Either way the press is used up.
 */
function multiCaretContinuation(
    plugin: FootnotePlugin,
    doc: Editor,
    ctx: DocContext,
    carets: EditorPosition[],
    artifacts: NonNullable<CaretArtifact>[],
    allowDefinitionContinuation: boolean,
): "handled" {
    const refuse = (): "handled" => {
        showNotice(MultiCaretNestedNotice, 8000);
        return "handled";
    };
    // The one that comes first in the note (Jason's consistency ruling,
    // 2026-08-29). The numbered flow already parks the caret after its
    // first reference and gives it back there, so the named second press
    // and the inline hop-out land there too. One answer to the question
    // "where is my caret when this is done".
    const first = carets.reduce((a, b) => (comparePositions(a, b) <= 0 ? a : b));
    if (new Set(artifacts.map((a) => a.kind)).size !== 1) return refuse();
    const kind = artifacts[0].kind;
    if (kind === "inline") {
        // They must be all empty or all filled. A mixture means the press
        // would mean two different things at once.
        if (new Set(artifacts.map((a) => a.kind === "inline" && a.empty)).size !== 1) {
            return refuse();
        }
        // The shared guards take it from here, working at the first caret.
        // While the inline footnotes are empty they warn, and every caret
        // stays put. Once filled, the caret hops out past the first one,
        // which collapses the several cursors down to one.
        caretGuardsHandled(plugin, doc, null, first);
        return "handled";
    }
    if (kind === "empty") {
        // The shared warning about an empty "[^]". Every caret stays put,
        // so you can keep typing the name into all of them.
        caretGuardsHandled(plugin, doc, null, first);
        return "handled";
    }
    const names = artifacts.map((a) => (a.kind === "ref" ? a.name : ""));
    if (new Set(names.map((n) => n.toLowerCase())).size !== 1) return refuse();
    // A "[^prefix]" placeholder you have not typed into yet asks for the
    // rest of the name. Every caret stays put.
    if (warnPrefilledReferenceIfInside(plugin, doc, null, first)) {
        return "handled";
    }
    // The paste key does not carry on into a definition at a single caret
    // either. Its meaning is "wrap the clipboard", so carets on references
    // of the same name are refused for that key.
    if (!allowDefinitionContinuation) return refuse();
    // A reference sitting inside another footnote's definition (a name
    // typed on the line right under a definition is its lazy continuation)
    // would complete a nested footnote once the shared definition exists,
    // which the plugin refuses everywhere (ADR 1). The single-caret press
    // refuses through this guard at its one caret; here every caret is
    // checked, since only the first one goes on to create. Found by the
    // named-flow property's 1500-run soak after Kimi hunt cycle 2
    // (2026-09-16).
    for (const caret of carets) {
        if (warnDefinitionCaretIfInside(doc, null, caret, ctx)) return "handled";
    }
    const name = names[0];
    if (idListIncludes(listExistingFootnoteDefinitions(doc, ctx), name)) {
        // The footnote already works, so there is nothing to carry on
        // from.
        return refuse();
    }
    if (footnoteNameProblem(name) !== null) {
        // This shows the shared warning about a name that cannot work, and
        // changes nothing in the note.
        createMatchingFootnoteDefinition(doc.getLine(first.line), first, plugin, doc, ctx);
        return "handled";
    }
    // Collapse the carets down to the first one. The ordinary second press
    // then creates the ONE shared definition and lands, in the popup or by
    // jumping, with the lint after it. On the popup route the caret parks
    // here and comes back here when the popup closes.
    doc.setCursor(first);
    createMatchingFootnoteDefinition(doc.getLine(first.line), first, plugin, doc, ctx);
    return "handled";
}

/**
 * Where a multi-caret press would insert. Every caret is checked by the
 * guards first, and a refusal shows its message and returns "handled".
 * The surviving positions get the end-of-word adjustment every
 * single-caret insertion gets, which moves them to the end of the word and
 * past trailing punctuation. Then duplicates are dropped and the rest are
 * sorted into the order they appear in the note.
 *
 * Returns null when this is not a multi-caret press at all: fewer than two
 * carets, a real selection, or an active table cell, since a cell is a
 * single-caret world of its own.
 *
 * Returns "handled" when the press was used up without inserting anything:
 * refused, or dealt with by the case where every caret sits inside the
 * same footnote (see multiCaretContinuation).
 */
function multiCaretTargets(
    plugin: FootnotePlugin,
    doc: Editor,
    ctx: DocContext,
    allowDefinitionContinuation: boolean,
): EditorPosition[] | "handled" | null {
    const ranges = doc.listSelections();
    if (ranges.length < 2) return null;
    // Any range with text in it belongs to the selection claim, which runs
    // before this one and would have taken the press. If such a range
    // reaches here, the selection claim looked at it and declined, for
    // instance because it held only whitespace. Either way it is not this
    // claim's press.
    if (ranges.some((range) => comparePositions(range.anchor, range.head) !== 0)) {
        return null;
    }
    const artifacts = ranges.map((range) => caretArtifact(ctx, range.head));
    if (artifacts.every((artifact) => artifact !== null)) {
        return multiCaretContinuation(
            plugin,
            doc,
            ctx,
            ranges.map((range) => range.head),
            artifacts,
            allowDefinitionContinuation,
        );
    }
    for (const [index, range] of ranges.entries()) {
        const pos = range.head;
        // A caret inside an existing footnote, while the OTHER carets sit
        // in plain text, refuses. At a single caret such a press means
        // navigate, hop out, or carry on, and carets that mean different
        // things from each other are exactly what the atomic rule forbids.
        // When every caret is inside one, the press carries on instead;
        // see multiCaretContinuation above.
        if (artifacts[index] !== null) {
            showNotice(MultiCaretNestedNotice, 8000);
            return "handled";
        }
        // A caret in protected text refuses with its own message, exactly
        // as the single-caret creation guard does.
        if (warnProtectedCaretIfInside(doc, null, pos, ctx)) return "handled";
        // and a caret at a table row's edge or on its delimiter row, where
        // the single-caret press refuses too (Kimi hunt cycle 1, 2026-09-16)
        if (warnTableEdgeCaretIfOutside(null, pos, ctx)) return "handled";
    }
    const adjusted = ranges.map((range) =>
        adjustFootnotePosition(
            range.head,
            ctx.reading(),
            doc.getLine(range.head.line),
            plugin,
            ctx.lines,
        ),
    );
    adjusted.sort(comparePositions);
    // The end-of-word adjustment can push two carets in the same word onto
    // the same spot. That spot gets ONE insertion, not two.
    return adjusted.filter(
        (pos, i) => i === 0 || comparePositions(pos, adjusted[i - 1]) !== 0,
    );
}

/**
 * The multi-caret claim for the keys that work straight away, without
 * waiting on anything.
 *
 * Returns true when the press was a multi-caret press and is now settled,
 * either inserted at every caret or refused with its message. Returns
 * false when it was not a multi-caret press, and the ordinary cascade
 * takes it.
 */
export function multiCaretPressHandled(
    plugin: FootnotePlugin,
    doc: Editor,
    cellActive: boolean,
    command: "autonum" | "named" | "inline",
): boolean {
    if (cellActive) return false;
    // A press with one caret is the common case, so answer it before
    // building the document context that multiCaretTargets would only
    // throw away. Without this, every press paid for a full scan here and
    // then a second one in the cascade (review B3, 2026-09-09).
    if (doc.listSelections().length < 2) return false;
    const ctx = docContext(doc);
    const targets = multiCaretTargets(plugin, doc, ctx, true);
    if (targets === null) return false;
    if (targets === "handled") return true;

    if (command === "autonum") {
        insertReferenceAtEveryCaret(plugin, doc, ctx, targets);
        return true;
    }
    if (command === "named") {
        const prefix = plugin.settings.enableFootnotePrefix
            ? activeFootnotePrefix(plugin, footnotePrefixFromEditor(doc))
            : "";
        // An invalid prefix has already shown a message explaining why.
        if (prefix === null) return true;
        const skeleton = referenceText(prefix);
        insertSkeletonAtEveryCaret(doc, ctx, targets, skeleton, 2 + prefix.length);
        return true;
    }
    insertSkeletonAtEveryCaret(doc, ctx, targets, "^[]", 2);
    return true;
}

/**
 * The multi-caret claim for the paste key: the same clipboard text wrapped
 * as "^[…]" at every caret.
 *
 * The only reason this one has to wait is the clipboard read, and that
 * happens AFTER the guards have run, so a press that is going to be
 * refused never touches the clipboard at all.
 */
export async function multiCaretPastePressHandled(
    plugin: FootnotePlugin,
    doc: Editor,
    cellActive: boolean,
): Promise<boolean> {
    if (cellActive) return false;
    if (doc.listSelections().length < 2) return false;
    const ctx = docContext(doc);
    const targets = multiCaretTargets(plugin, doc, ctx, false);
    if (targets === null) return false;
    if (targets === "handled") return true;

    const text = await readInlineFootnoteFromClipboard(plugin);
    if (text === null) return true;
    // A pasted body is already complete, so there is nothing left for you
    // to type into each wrapper. The press therefore ends the way every
    // other multi-caret insertion does: with ONE caret, just after the
    // first footnote (Jason's consistency ruling, extended to the paste
    // key on 2026-09-04; leaving a cursor after every wrapper only made
    // you reach for the mouse to get back down to one).
    insertSkeletonAtEveryCaret(doc, ctx, targets, text, text.length, "first");
    return true;
}

// The numbered version: the same next-numbered reference at every caret,
// with ONE definition appended. Then the popup or the jump, whichever the
// settings say, exactly as for a single-caret insertion. There is only one
// definition, so there is only one place to land.
//
// The whole thing is a single edit. The result gate judges EVERY
// reference, and one it refuses refuses the lot; the press is atomic.
function insertReferenceAtEveryCaret(
    plugin: FootnotePlugin,
    doc: Editor,
    ctx: DocContext,
    targets: EditorPosition[],
): void {
    const footnoteId = autonumFootnoteId(plugin, doc, ctx);
    if (footnoteId === null) return;
    const footnoteReference = referenceText(footnoteId);
    const plan = planDefinitionAppend({
        lines: ctx.lines,
        edits: targets.map((pos) => ({ from: pos, text: footnoteReference })),
        footnoteId,
        plugin,
    });
    const verdict = judgeEdit(
        ctx.lines,
        plan.final,
        { created: [{ kind: "footnote", name: footnoteId, references: plan.edits.map((edit) => edit.start), definition: { line: plan.labelLine, lines: 1 } }], insertedText: plan.heading },
        ctx.reading(),
    );
    if (refusedCreation(verdict)) return;

    landDefinitionBackedInsertion({
        plugin,
        doc,
        changes: plan.changes,
        origin: targets[0],
        footnoteId,
        definitionCursor: plan.cursor,
        afterReference: plan.edits[0].end,
        // The landing runs the after-creation lint, the same as every other
        // creation press (Jason asked for that parity on 2026-08-25). That
        // works here because reindexing renames every newly minted reference
        // to the same new name, and the caret relocation only has to find
        // the one new definition they all share.
    });
}

// The shared writer for the named key ("[^]"), the inline key ("^[]"), and
// the paste key ("^[clipboard]"). It puts the same text at every caret and
// then places a cursor `innerOffset` characters into it.
//
// For the named and inline keys that lands the cursor inside the brackets,
// so that typing the name or the body types into all of them at once,
// which is CodeMirror's multi-cursor behavior. For the paste key it lands
// just past the FIRST wrapper and nowhere else (`land: "first"`), because
// the body is already complete and one caret is the rule.
//
// The result gate judges every caret's landing on one shared simulated
// result, and any it refuses refuses the whole press.
function insertSkeletonAtEveryCaret(
    doc: Editor,
    ctx: DocContext,
    targets: EditorPosition[],
    text: string,
    innerOffset: number,
    land: "every" | "first" = "every",
): void {
    const changes: EditorChange[] = targets.map((pos) => ({ from: pos, text }));
    const simulated = simulateChanges(ctx.lines, changes);
    // Work out all the positions in one pass and judge them on one view of
    // the result. The old one-position-at-a-time version re-resolved and
    // rescanned the whole note once per caret (second review 2026-09-09).
    // The paste key's text comes from the clipboard.
    const anchors = simulatedAnchors(ctx.lines, changes, targets.map((_, index) => index), simulated);
    const verdict = judgeEdit(
        ctx.lines,
        simulated,
        { created: [text.startsWith("^[") ? { kind: "inline", text, at: anchors, fromOutside: text !== "^[]" } : { kind: "placeholder", text, at: anchors }] },
        ctx.reading(),
    );
    if (refusedCreation(verdict)) return;
    // The targets arrive in the order they appear in the note, so
    // anchors[0] is the first footnote.
    const landed = land === "first" ? anchors.slice(0, 1) : anchors;
    doc.transaction({
        changes,
        selections: landed.map((anchor) => ({
            from: { line: anchor.line, ch: anchor.ch + innerOffset },
        })),
    });
}
