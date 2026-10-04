import { Editor, EditorChange, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { ValidatedTextModal } from "./validated-text-modal";
import {
    footnoteNameProblem,
    occurrenceAtCursor,
    quotedReference,
    referenceOccurrences,
} from "../parsing/footnote-grammar";
import { DocContext, docContext } from "../editor/doc-context";
import { footnotePrefixFromEditor, footnotePrefixProblem } from "../parsing/footnote-prefix";
import { simulateChanges } from "../editor/insertion-liveness";
import { Definition, readNote } from "../parsing/note-reading";
import { runOutsideTableCell } from "../editor/table-cursor";
import { withEditableEditor } from "./insert-or-navigate-footnotes";

import { nameAlreadyUsed, showNotice } from "../editor/notice";
// Renaming a footnote (Jason's calls 2026-08-12).
//
// With the caret on a "[^name]" reference or on a definition label, the
// Rename footnote command opens a modal prefilled with the current name. It
// then rewrites every live occurrence of that name, references and
// definition labels alike, in one transaction. The match ignores case,
// because Obsidian treats footnote names case-insensitively. Copies inside
// code, math, or comments are plain text, not footnotes, and are left
// alone.
//
// A name that is already in use is refused. Merging two footnotes into one
// is the merge-duplicate-definitions lint rule's job, not something a
// rename should do as a side effect.
//
// The whole rename is also simulated and checked before a single edit is
// made. A new name can complete markdown constructs around an occurrence,
// just as an insertion can (the "$…$" swallow class), and if it would,
// NOTHING is renamed.

export const RenameTargetNotice =
    "Place the cursor on a footnote reference or definition to rename it.";

/**
 * The footnote name under the caret, or null when there is none.
 *
 * It can come from a live reference (definition BODIES count too: a
 * reference sitting inside one can be renamed), or from the definition
 * label the caret sits inside. Like the navigation guards, this checks the
 * raw line first and only then confirms against the masked twin (the copy
 * of the note with protected text blanked out).
 */
/**
 * Whether a "[^x]:" at the start of this line is a label rather than a
 * reference: only a label that starts a definition is one. A lazy label
 * (written directly under a line of prose) and a label inside a %% block
 * comment both have a "[^x]" that Obsidian counts as a live reference,
 * so both are rename targets (Jason's ruling A1, 2026-09-15, after
 * Reading view showed a commented label giving its definition a second
 * back-arrow; this reverses the 2026-09-12 fix that called such a label
 * dead).
 */
function labelCountsAsLabel(ctx: DocContext, line: number): boolean {
    return ctx.definitionStarts()[line];
}

export function renameTargetAtCursor(
    doc: Editor,
    cursorPosition: EditorPosition,
    ctx: DocContext = docContext(doc),
): string | null {
    const lineText = doc.getLine(cursorPosition.line);
    if (!lineText.includes("[^")) return null;
    const occurrence = occurrenceAtCursor(
        referenceOccurrences(
            lineText,
            ctx.maskedLine(cursorPosition.line),
            labelCountsAsLabel(ctx, cursorPosition.line),
        ),
        cursorPosition.ch,
    );
    if (occurrence !== null) return occurrence.name;
    // a definition's label on this line, at the left margin, in a quote, or
    // after a list marker: the caret anywhere before the end of its ":"
    // means the user wants that definition's name. A label written directly
    // under a line of prose is what the project calls a lazy label: Obsidian
    // reads it as more paragraph text, so the note reading holds no
    // definition there, and its "[^x]" was a reference above.
    const label = ctx.reading().labelOn(cursorPosition.line);
    if (!label || cursorPosition.ch >= label.labelEnd) return null;
    return label.name;
}

/**
 * The footnote a SELECTION points at: a reference the selection overlaps,
 * or a definition label it overlaps, on the selection's line. A collapsed
 * selection is the plain caret rule above.
 *
 * Why: on a phone a long press selects the word it lands on, so the caret
 * ends up at the selection's end - on the "]" of a reference, or after a
 * label's name - and the caret rule alone found nothing there, so the
 * Rename footnote toolbar icon tapped after a long press said "not on a
 * footnote" (Jason's phone pass, sheet 13, 2026-09-11). The ends may come
 * in either order.
 *
 * What this does NOT change: the phone's long-press menu itself. Obsidian
 * builds that menu on its own for a footnote reference (its "Delete
 * footnote and reference" item) and, on a phone, never fires the
 * editor-menu event plugins listen on for it; a long press on a definition
 * label opens no menu at all there (read in Obsidian's own code,
 * 2026-09-11). The route to rename on a phone is the toolbar icon or the
 * command palette, and this function is what makes that route work with
 * the long press's word selection.
 */
export function renameTargetInSelection(
    doc: Editor,
    anchor: EditorPosition,
    head: EditorPosition,
    ctx: DocContext = docContext(doc),
): string | null {
    const [from, to] = comparePositions(anchor, head) <= 0 ? [anchor, head] : [head, anchor];
    if (from.line !== to.line) return renameTargetAtCursor(doc, head, ctx);
    if (from.ch === to.ch) return renameTargetAtCursor(doc, from, ctx);
    const lineText = doc.getLine(from.line);
    if (!lineText.includes("[^")) return null;
    for (const occurrence of referenceOccurrences(
        lineText,
        ctx.maskedLine(from.line),
        labelCountsAsLabel(ctx, from.line),
    )) {
        if (occurrence.start < to.ch && occurrence.end > from.ch) return occurrence.name;
    }
    const label = ctx.reading().labelOn(from.line);
    if (!label || from.ch >= label.labelEnd) return null;
    return label.name;
}

function comparePositions(a: EditorPosition, b: EditorPosition): number {
    return a.line - b.line || a.ch - b.ch;
}

export type RenamePlan =
    | {
          kind: "renamed";
          changes: EditorChange[];
          count: number;
          /** the name that actually gets written: what the user typed, or what they typed with the note's prefix in front of it (see prefixAdded) */
          newName: string;
          /** true when the apply-prefix rule was armed and would have re-prefixed the typed name on the very next lint, so the rename put the prefix on itself and the toast says so (Jason's ruling 2026-08-29, which replaced the 2026-08-25 refusal) */
          prefixAdded: boolean;
      }
    | { kind: "noop" }
    | { kind: "invalid"; reason: string }
    | { kind: "collision" }
    | { kind: "dead" };

/**
 * Decide what renaming `oldName` to `newName` would mean: either the list
 * of changes to apply, or the reason it cannot be done. This is planning
 * only. Nothing is written to the document here.
 */
export function planFootnoteRename(
    doc: Editor,
    oldName: string,
    newName: string,
    ctx: DocContext = docContext(doc),
    options?: {
        /**
         * The note's footnote prefix, but only when the
         * Apply-footnote-prefix rule is ARMED: the prefix feature is on,
         * that lint rule is on, and the note's prefix is valid.
         *
         * When it is armed, a new name that falls outside the prefix's
         * namespace is written BEHIND the prefix instead (see
         * effectiveRenameName), because the very next lint would rename
         * it that way anyway. The 2026-08-25 hunt fix refused such names
         * outright (bug-rename-swept-back-by-apply-prefix); Jason's
         * ruling 2026-08-29 swapped that refusal for doing the lint's
         * work up front and telling the user.
         *
         * Callers whose sweep is not armed leave this out, and bare
         * names stay legal and stay put.
         */
        sweepPrefix?: string;
        /**
         * The note's valid prefix whenever the prefix feature is on, armed
         * or not. A new name that is exactly this prefix, in any casing,
         * is refused: "[^p.]" is the bare-prefix placeholder the rest of
         * the plugin treats as a footnote still being named, so writing it
         * over every reference and the definition would turn the footnote
         * into fragments (Kimi and Claude sweeps 2026-09-13).
         */
        placeholderPrefix?: string;
    },
): RenamePlan {
    if (newName === oldName || newName === "") return { kind: "noop" };
    const problem = footnoteNameProblem(newName);
    if (problem !== null) return { kind: "invalid", reason: problem };
    const bare = options?.placeholderPrefix ?? options?.sweepPrefix;
    if (bare && newName.toLowerCase() === bare.toLowerCase()) {
        return {
            kind: "invalid",
            reason: `"[^${bare}]" is the note's prefix with nothing after it, so it isn't a name. Type a name after the prefix.`,
        };
    }
    const effective = effectiveRenameName(newName, options?.sweepPrefix);
    const prefixAdded = effective !== newName;
    newName = effective;
    if (newName === oldName) return { kind: "noop" };

    const oldFolded = oldName.toLowerCase();
    const newFolded = newName.toLowerCase();
    // every LIVE definition label, wherever the definition sits: at the
    // left margin, in a blockquote or callout, or in a list item. Missing the
    // quoted kind was a bug once: a rename rewrote the reference and left
    // "> [^note]:" behind, orphaning both halves (second review 2026-09-09).
    // A definition in a list item is renamed like any other (Jason's ruling
    // 1, option a, 2026-10-03; it used to be refused).
    const definitions = ctx.reading().definitions;
    const starts = ctx.definitionStarts();

    // a collision means the new name already belongs to ANOTHER footnote,
    // whatever its casing. Changing only the casing of the SAME footnote is
    // fine: that is cosmetic.
    if (newFolded !== oldFolded) {
        const taken =
            definitions.some((definition) => definition.name.toLowerCase() === newFolded) ||
            ctx.lines.some(
                (lineText, line) =>
                    lineText.includes("[^") &&
                    referenceOccurrences(lineText, ctx.maskedLine(line), starts[line]).some(
                        (occurrence) =>
                            occurrence.name.toLowerCase() === newFolded,
                    ),
            );
        if (taken) return { kind: "collision" };
    }

    const changes: EditorChange[] = [];
    const referenceLines = new Set<number>();
    for (let line = 0; line < ctx.lines.length; line++) {
        const lineText = ctx.lines[line];
        if (!lineText.includes("[^")) continue;
        for (const occurrence of referenceOccurrences(
            lineText,
            ctx.maskedLine(line),
            starts[line],
        )) {
            if (occurrence.name.toLowerCase() !== oldFolded) continue;
            changes.push({
                from: { line, ch: occurrence.start + 2 },
                to: { line, ch: occurrence.end - 1 },
                text: newName,
            });
            referenceLines.add(line);
        }
    }
    const labelLines: number[] = [];
    for (const definition of definitions) {
        if (definition.name.toLowerCase() !== oldFolded) continue;
        // the name sits between the label's "[^" and its "]:"
        changes.push({
            from: { line: definition.start, ch: definition.labelStart + 2 },
            to: { line: definition.start, ch: definition.labelEnd - 2 },
            text: newName,
        });
        labelLines.push(definition.start);
    }
    if (changes.length === 0) return { kind: "noop" };

    if (!renameSurvives(ctx, changes, oldFolded, newName, referenceLines, definitions, labelLines)) {
        return { kind: "dead" };
    }
    return { kind: "renamed", changes, count: changes.length, newName, prefixAdded };
}

/**
 * The name a rename actually writes. Usually that is `newName` exactly as
 * typed. When the apply-prefix rule is armed (`sweepPrefix` is given) and
 * the typed name does not already start with that prefix in any casing, the
 * prefix goes in front.
 *
 * The planner and the modal's messages both call this, so they can never
 * disagree about which name they are talking about.
 */
function effectiveRenameName(
    newName: string,
    sweepPrefix: string | undefined,
): string {
    if (
        !sweepPrefix ||
        newName.toLowerCase().startsWith(sweepPrefix.toLowerCase())
    ) {
        return newName;
    }
    return `${sweepPrefix}${newName}`;
}

// Run the whole rename in simulation and insist that the note's footnote
// structure afterwards is EXACTLY the old one with the name swapped.
//
// Concretely: on every edited line, the list of occurrences must match the
// old list, with positions shifted to allow for the new name's length, and
// every definition must keep its label line, its last line, and its mapped
// name.
// Anything else means the new name has changed how markdown reads the text
// around an occurrence. In that case refuse the entire rename, rather than
// corrupt one copy of it.
function renameSurvives(
    ctx: DocContext,
    changes: EditorChange[],
    oldFolded: string,
    newName: string,
    referenceLines: Set<number>,
    definitionsBefore: readonly Definition[],
    labelLines: number[],
): boolean {
    const simulated = simulateChanges(ctx.lines, changes);
    // the note as the rename leaves it, read once for all the lines
    // checked below (a footnote used on forty lines used to cost forty-one
    // scans, review B4)
    const startsBefore = ctx.definitionStarts();
    const readingAfter = readNote(simulated);
    const simulatedMasked = readingAfter.maskedLines();
    const startsAfter = readingAfter.labelLines;
    const labelLineSet = new Set(labelLines);
    for (const line of referenceLines) {
        const before = referenceOccurrences(ctx.lines[line], ctx.maskedLine(line), startsBefore[line]);
        const expected: { start: number; name: string }[] = [];
        // On the definition's own label line, the label is renamed too and
        // sits before every reference in the body, so the references
        // start out shifted by the label's change of length. Forgetting
        // that refused a perfectly safe rename whenever a definition's
        // body mentioned its own footnote (Kimi sweep 2026-09-13).
        let shift = 0;
        if (labelLineSet.has(line)) {
            const label = ctx.reading().labelOn(line);
            if (label && label.name.toLowerCase() === oldFolded) shift = newName.length - label.name.length;
        }
        for (const occurrence of before) {
            const renamed = occurrence.name.toLowerCase() === oldFolded;
            expected.push({
                start: occurrence.start + shift,
                name: renamed ? newName : occurrence.name,
            });
            if (renamed) shift += newName.length - occurrence.name.length;
        }
        const after = referenceOccurrences(simulated[line], simulatedMasked[line], startsAfter[line]);
        if (after.length !== expected.length) return false;
        for (let i = 0; i < expected.length; i++) {
            if (
                after[i].start !== expected[i].start ||
                after[i].name !== expected[i].name
            ) {
                return false;
            }
        }
    }
    // every definition, wherever it sits, must still be read on the same
    // lines with its name mapped: a renamed label then still reads as a live
    // definition under the new name
    const definitionsAfter = readingAfter.definitions;
    if (definitionsAfter.length !== definitionsBefore.length) return false;
    for (let i = 0; i < definitionsBefore.length; i++) {
        const before = definitionsBefore[i];
        const after = definitionsAfter[i];
        const wanted = before.name.toLowerCase() === oldFolded ? newName : before.name;
        if (after.start !== before.start || after.end !== before.end || after.name !== wanted) return false;
    }
    return true;
}

/**
 * Add "Rename footnote" to the editor's right-click menu when the click
 * landed on a reference or a definition label. It follows the same pattern
 * as Obsidian's own "Rename this heading" on heading lines (Jason's ask,
 * 2026-08-13).
 *
 * Obsidian moves the caret to the click point before it fires editor-menu,
 * so working out which footnote was clicked is exactly the command's own
 * caret lookup. Desktop only in practice: on a phone Obsidian owns the
 * long-press menu on a reference and never fires this event for it (see
 * renameTargetInSelection), so the phone's route is the toolbar icon.
 */
export function registerRenameFootnoteMenu(plugin: FootnotePlugin) {
    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
            // markdown views only. A canvas card's editor would pass the
            // check here, but the command would later go and act on the
            // ACTIVE markdown view's editor instead.
            if (!(info instanceof MarkdownView)) return;
            // the whole selection, not just the caret, so a selected word
            // that overlaps a footnote counts (the same rule as the command)
            const selection = editor.listSelections()[0];
            const target = renameTargetInSelection(editor, selection.anchor, selection.head);
            if (target === null) return;
            menu.addItem((item) =>
                item
                    .setTitle("Rename footnote")
                    .setIcon("footnote-rename")
                    .setSection("selection")
                    .onClick(() => {
                        void renameFootnote(plugin);
                    }),
            );
        }),
    );
}

/** The "Rename footnote" command. It works out the name under the caret, then hands over to the modal. */
export async function renameFootnote(plugin: FootnotePlugin) {
    await withEditableEditor(
        plugin,
        (doc) => {
            runOutsideTableCell(doc, (cursorPosition) => {
                // on a phone the command usually runs from the toolbar right
                // after a long press, which left the pressed word selected;
                // the selection decides then
                const selection = doc.listSelections()[0];
                const target =
                    comparePositions(selection.anchor, selection.head) !== 0
                        ? renameTargetInSelection(doc, selection.anchor, selection.head)
                        : renameTargetAtCursor(doc, cursorPosition);
                if (target === null) {
                    showNotice(RenameTargetNotice, 8000);
                    return;
                }
                new RenameFootnoteModal(plugin, doc, target).open();
            });
        },
        // When focus is in the Properties panel there is no footnote under a
        // property field, and the editor's own caret position is stale. So
        // give the same answer as for a caret on plain prose: nothing here
        // to rename.
        RenameTargetNotice,
    );
}

// One text box, prefilled with the current name. Enter, or the Rename
// button, applies it. Invalid names, collisions, and names the simulation
// refuses each show their reason inside the modal and leave it open. It is
// built the same way as the Set-footnote-prefix modal.
// Stryker disable all: modal DOM against the live app - smoke-test
// territory, unreachable from units (the whole prefix modal's FILE is
// excluded for the same reason; this one shares a file with the pure
// planners, so the exemption is scoped here). Coverage-verified by the
// 2026-08-12 incremental run: every mutant below was no-coverage.
class RenameFootnoteModal extends ValidatedTextModal {
    private plugin: FootnotePlugin;
    private doc: Editor;
    private oldName: string;

    constructor(plugin: FootnotePlugin, doc: Editor, oldName: string) {
        // when the apply-prefix rule is armed, only the part AFTER the
        // prefix is preselected. The prefix visibly stays put, so typing a
        // new name keeps it without the user having to think about it
        // (Jason's consistency concern 2026-08-29). Deleting the prefix by
        // hand still works: the plan puts it back and the toast says so.
        const prefix = armedSweepPrefix(plugin, doc);
        super(plugin.app, {
            title: "Rename footnote",
            fieldName: "New name",
            fieldDesc: `Renames every "[^${oldName}]" reference and its definition in this note. Copies inside code or math stay untouched.`,
            buttonText: "Rename",
            initialValue: oldName,
            selectFrom:
                prefix && oldName.toLowerCase().startsWith(prefix.toLowerCase())
                    ? prefix.length
                    : undefined,
        });
        this.plugin = plugin;
        this.doc = doc;
        this.oldName = oldName;
    }

    protected submit() {
        const typed = this.value.trim();
        // read this when the user submits, just as the plan itself is: the
        // note's frontmatter may have changed while the modal was open
        const sweepPrefix = armedSweepPrefix(this.plugin, this.doc);
        const newName = effectiveRenameName(typed, sweepPrefix);
        // plan against the CURRENT document, for the same reason: the note
        // may have changed while the modal was open
        const plan = planFootnoteRename(this.doc, this.oldName, typed, undefined, {
            sweepPrefix,
            placeholderPrefix: notePlaceholderPrefix(this.plugin, this.doc),
        });
        switch (plan.kind) {
            case "noop":
                this.close();
                return;
            case "invalid":
                this.showProblem(plan.reason);
                return;
            case "collision":
                this.showProblem(
                    nameAlreadyUsed(newName),
                );
                return;
            case "dead":
                this.showProblem(
                    `${quotedReference(newName)} wouldn't survive as a footnote where it's used. Try a different name.`,
                );
                return;
            case "renamed":
                this.doc.transaction({ changes: plan.changes });
                this.close();
                showNotice(
                    `Renamed "[^${this.oldName}]" to "[^${plan.newName}]" in ${plan.count} ${plan.count === 1 ? "place" : "places"}.` +
                        (plan.prefixAdded
                            ? ` The note's prefix "${sweepPrefix}" was added.`
                            : ""),
                );
        }
    }
}

/** The note's prefix, but only when the Apply-footnote-prefix rule is armed: the prefix feature is on, that lint rule is on, and the note's prefix is valid. Armed means a bare rename would be re-prefixed on the very next lint. An invalid prefix never arms, because lint refuses to run under one at all (lintBlockedByPrefix). */
function armedSweepPrefix(plugin: FootnotePlugin, doc: Editor): string | undefined {
    if (!plugin.settings.lintApplyPrefix) return undefined;
    return notePlaceholderPrefix(plugin, doc);
}

/** The note's prefix whenever the prefix feature is on and the prefix is valid, whether or not the apply-prefix rule is armed. A name that is just this prefix is the bare-prefix placeholder, never a real name. */
function notePlaceholderPrefix(plugin: FootnotePlugin, doc: Editor): string | undefined {
    if (!plugin.settings.enableFootnotePrefix) return undefined;
    const prefix = footnotePrefixFromEditor(doc);
    if (!prefix || footnotePrefixProblem(prefix) !== null) return undefined;
    return prefix;
}
