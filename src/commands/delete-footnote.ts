import {
    definitionLabelWithName,
    quotedDefinitionLabel,
    quotedReference,
    referenceOccurrences,
} from "../parsing/footnote-grammar";
import {
    definitionCuts,
    lazyDefinitionLabelLines,
    maskProtectedLines,
    normalizeEol,
    removeLineRanges,
    restoreEol,
    scanDocument,
    underlinedDefinitionLabelLines,
} from "../parsing/markdown-scan";
import { readNote } from "../parsing/note-reading";
import { linesReadDifferently } from "../linting/rules/remove-orphaned-definitions";
import { cutOne, readsDifferently } from "../linting/rules/remove-orphaned-references";
import { MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { showNotice } from "../editor/notice";
import { runOutsideTableCell } from "../editor/table-cursor";
import { replaceMinimal } from "../editor/write-back";
import { noticeLintAlerts } from "../linting/lint-alerts";
import { withEmptySectionHeadingRemoved } from "../linting/linter";
import { withEditableEditor } from "./insert-or-navigate-footnotes";
import { renameTargetAtCursor, renameTargetInSelection } from "./rename-footnote";

// Deleting a footnote everywhere (T4 of the 2026-09 feature round; Jason's
// rulings 2026-09-19 to 2026-09-21).
//
// Obsidian's own right-click "Delete footnote and reference" removes the
// one reference that was clicked and the definition. A footnote cited in
// two places keeps its other reference, now pointing at nothing (Jason's
// report, 2026-09-19). This command deletes the definition AND every
// reference to it, from whichever end the caret sits on, in one step and
// one undo.
//
// The work is a pure markdown-to-markdown transform, the way the lint
// rules are written, so the command can write it back as one transaction
// that keeps folds and the caret (replaceMinimal), and so the transform can
// be property-tested with the same generator the rules use.

export type DeleteFootnotePlan =
    | {
          kind: "deleted";
          markdown: string;
          /** how many references were cut out of the text (a reference inside a deleted definition's own body is not counted: it went with the block) */
          references: number;
          /** how many definition blocks were removed */
          definitions: number;
      }
    /** the note holds no live reference or definition with this name */
    | { kind: "nothing" }
    /** the deletion would change how Obsidian reads text it was not asked to touch, or the definition is one the plugin never cuts; nothing was changed and `reason` says why, in the toast's words */
    | { kind: "refused"; reason: string };

/**
 * `markdown` with the footnote called `name` gone: every live reference to
 * it cut out of the text with the gap closed, and every definition block
 * of that name removed. Names match without regard to case, as Obsidian
 * matches them. Copies inside code, math, comments, or frontmatter are
 * plain text and stay.
 */
export function deleteFootnoteEverywhere(markdown: string, name: string): DeleteFootnotePlan {
    const folded = name.toLowerCase();
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const reading = readNote(lines);
    const starts = reading.labelLines;

    // Every definition of the name goes, wherever it sits: at the top
    // level, in a blockquote or callout with the quoted continuation
    // Obsidian gives it, or in a list item with its whole body (Jason's
    // ruling 1, option a, 2026-10-03: the plugin now knows where an in-item
    // definition ends, so one over several lines is no longer refused; on
    // a list marker's line the bullet stays, see definitionCuts). A
    // definition whose label follows other text on its line (a callout's
    // title, the "%%" closing a comment) is never cut, since the line would
    // take that text with it, leaving the callout untitled or the comment
    // open over the rest of the note; the command refuses and says so.
    const named = reading.definitions.filter((definition) => definition.name.toLowerCase() === folded);
    const unremovable = named.find((definition) => !definition.removable);
    if (unremovable) {
        return {
            kind: "refused",
            reason: `Nothing was deleted: the ${quotedDefinitionLabel(unremovable.name)} definition shares its line with other text, such as a callout's title or the "%%" that closes a comment, which cutting it would take too. Delete it by hand.`,
        };
    }
    const definitionCut = definitionCuts(lines, named);
    const blocks = definitionCut.ranges;
    let definitions = named.length;
    // A lazy label (a "[^x]:" line directly under prose, one blank line
    // short of a definition) and an underlined label (a "[^x]:" line with
    // a setext underline under it, which makes it a heading) are the
    // definitions the user MEANT to write, so they go too: the lazy line
    // alone, the underlined line together with its underline, which has
    // no business staying behind under the line above.
    const labelOf = (i: number): boolean =>
        definitionLabelWithName(lines[i], masked[i])?.name.toLowerCase() === folded;
    for (const i of lazyDefinitionLabelLines(lines, scan, masked, starts)) {
        if (labelOf(i)) {
            blocks.push({ start: i, end: i });
            definitions++;
        }
    }
    for (const i of underlinedDefinitionLabelLines(lines, scan, masked, starts)) {
        if (labelOf(i)) {
            blocks.push({ start: i, end: i + 1 });
            definitions++;
        }
    }
    blocks.sort((a, b) => a.start - b.start);
    // the lines a block cut takes with it: a reference on one of them
    // goes with the block and is not cut, or counted, on its own
    const cut = new Set<number>();
    for (const block of blocks) {
        for (let i = block.start; i <= block.end; i++) cut.add(i);
    }

    let references = 0;
    const cutLines = definitionCut.lines.map((line, i) => {
        // a label line trimmed back to its list marker is done with
        if (scan.isProtected[i] || cut.has(i) || line !== lines[i]) return line;
        // rightmost first, so that cutting one keeps the offsets of the
        // ones before it
        const hits = referenceOccurrences(line, masked[i], starts[i])
            .filter((occurrence) => occurrence.name.toLowerCase() === folded)
            .reverse();
        references += hits.length;
        return hits.reduce((kept, { start, end }) => cutOne(kept, start, end), line);
    });
    if (references === 0 && definitions === 0) return { kind: "nothing" };

    // The promise the two orphan rules make, kept here too: a deletion
    // that changes how Obsidian reads a line it was not asked to touch is
    // refused whole, rather than half done. Cutting reference text can
    // turn "-[^9] tail" into a bullet; cutting a block can put the line
    // below it under a setext underline or a blank line and so promote a
    // lazy label there into a definition (the guards' own comments list
    // the cases).
    const byHand = " would change how Obsidian reads the text around it. Delete it by hand.";
    // a deleted definition's label line that keeps only its list marker is
    // meant to stop being a label, so it is not asked to read as before
    const keptStarts = starts.map((start, i) => start && definitionCut.lines[i] === lines[i]);
    if (references > 0 && readsDifferently(lines, scan, keptStarts, cutLines)) {
        return { kind: "refused", reason: `Nothing was deleted: removing ${quotedReference(name)}${byHand}` };
    }
    const out = removeLineRanges(cutLines, blocks);
    if (
        blocks.length > 0 &&
        linesReadDifferently(cutLines, references > 0 ? scanDocument(cutLines) : scan, blocks, out)
    ) {
        return {
            kind: "refused",
            reason: `Nothing was deleted: removing the ${quotedDefinitionLabel(name)} definition${byHand}`,
        };
    }
    return {
        kind: "deleted",
        markdown: restoreEol(out.join("\n"), eol),
        references,
        definitions,
    };
}

export const DeleteTargetNotice =
    "Place the cursor on a footnote reference or definition to delete it.";

/** The toast after a deletion: what went, in numbers. A zero count is left out rather than said, as the paste toast does (Jason, 2026-09-25). */
function deleteFootnoteNotice(name: string, references: number, definitions: number): string {
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const went = [
        references > 0 ? count(references, "reference") : null,
        definitions > 0 ? count(definitions, "definition") : null,
    ].filter((part): part is string => part !== null);
    return `Deleted ${quotedReference(name)} everywhere: ${went.join(" and ")}.`;
}

/**
 * The "Delete footnote everywhere" command. It works
 * out the name under the caret (or under the selection, the way the
 * rename command does for a phone's long-press selection), runs the
 * transform, and writes the result back as one transaction that keeps
 * folds and the caret. Then the lint alerts speak, since a deletion can
 * leave something for them to say (a definition only the deleted one's
 * body was citing is now an orphan).
 */
export async function deleteFootnote(plugin: FootnotePlugin) {
    await withEditableEditor(
        plugin,
        (doc) => {
            runOutsideTableCell(doc, (cursorPosition) => {
                const selection = doc.listSelections()[0];
                const collapsed =
                    selection.anchor.line === selection.head.line &&
                    selection.anchor.ch === selection.head.ch;
                // the rename command's resolvers find the footnote under a
                // caret or a selection; they are about the caret, not the
                // rename, so this command shares them
                const target = collapsed
                    ? renameTargetAtCursor(doc, cursorPosition)
                    : renameTargetInSelection(doc, selection.anchor, selection.head);
                if (target === null) {
                    showNotice(DeleteTargetNotice, 8000);
                    return;
                }
                const before = doc.getValue();
                const plan = deleteFootnoteEverywhere(before, target);
                switch (plan.kind) {
                    case "nothing":
                        // the target came from this very document, so this
                        // is unreachable in practice; say something honest
                        // rather than nothing if it ever happens
                        showNotice(`Nothing was deleted: ${quotedReference(target)} was not found in this note.`, 8000);
                        return;
                    case "refused":
                        showNotice(plan.reason, 8000);
                        return;
                    case "deleted": {
                        const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
                        // the section heading goes with the last footnote when
                        // the setting says so (Jason, 2026-09-25)
                        const markdown = withEmptySectionHeadingRemoved(plugin, plan.markdown);
                        replaceMinimal(doc, before, markdown, mdView);
                        showNotice(deleteFootnoteNotice(target, plan.references, plan.definitions));
                        noticeLintAlerts(plugin, markdown);
                    }
                }
            });
        },
        // focus in the Properties panel: no footnote under a property
        // field, and the editor's caret is stale (the rename command's
        // reasoning)
        DeleteTargetNotice,
    );
}

/**
 * "Delete footnote everywhere" in the editor's
 * right-click menu, beside the rename item and Obsidian's own "Delete
 * footnote and reference", when the click landed on a reference or a
 * definition label. Desktop only in practice, as the rename item is: on a
 * phone Obsidian owns the long-press menu and never fires this event for a
 * reference, so the phone's route is the toolbar icon.
 */
export function registerDeleteFootnoteMenu(plugin: FootnotePlugin) {
    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
            if (!(info instanceof MarkdownView)) return;
            const selection = editor.listSelections()[0];
            const target = renameTargetInSelection(editor, selection.anchor, selection.head);
            if (target === null) return;
            menu.addItem((item) =>
                item
                    .setTitle("Delete footnote everywhere")
                    .setIcon("footnote-delete")
                    .setSection("selection")
                    .onClick(() => {
                        void deleteFootnote(plugin);
                    }),
            );
        }),
    );
}
