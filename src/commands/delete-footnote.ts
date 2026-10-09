import { quotedDefinitionLabel, quotedReference } from "../parsing/footnote-grammar";
import { labelShapedLines } from "../parsing/label-shapes";
import { definitionCuts, normalizeEol, removeLineRanges, restoreEol } from "../parsing/line-edits";
import { readNote } from "../parsing/note-reading";
import { definitionsHeldBy } from "../linting/rules/remove-orphaned-definitions";
import { cutOne } from "../linting/rules/remove-orphaned-references";
import { MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { showNotice } from "../editor/notice";
import { judgeEdit } from "../editor/result-gate";
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
    /** the deletion would change how Obsidian reads text it was not asked to touch, or the definition holds another; nothing was changed and `reason` says why, in the toast's words */
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
    const reading = readNote(lines);

    // Every definition of the name goes, wherever it sits: at the top
    // level, in a blockquote or callout with the quoted continuation
    // Obsidian gives it, or in a list item with its whole body (Jason's
    // ruling 1, option a, 2026-10-03: the plugin now knows where an in-item
    // definition ends, so one over several lines is no longer refused; on
    // a list marker's line the bullet stays, see definitionCuts). A
    // definition whose label follows other text on its line (a callout's
    // marker, the "%%" closing a comment) goes the same way: its line is
    // cut back to the text in front of the label, so the callout and the
    // comment stay as they were. The result gate below judges that, as it
    // judges every deletion (subtraction pass 2026-10-08: the command used
    // to refuse such a definition outright).
    const named = reading.definitions.filter((definition) => definition.name.toLowerCase() === folded);
    // A definition can hold another footnote's definition inside its body
    // (an indented "[^b]: inner" under "[^a]: outer"). Cutting the outer
    // block would cut the inner definition too, and the text citing it
    // would be left with nothing, so the command refuses and names it, as
    // it refuses a definition it never cuts (hunt 2026-10-05, pin
    // bug-nested-definition-deleted-with-outer; ADR 0001: hand-typed
    // nesting is never destroyed). The refusal names every definition held
    // inside, each name once, so one fix by hand is enough; naming only the
    // first held one left the user to be refused again for the next (hunt
    // 2026-10-05 round 2, cluster L10; Jason's triage decision Q6,
    // 2026-10-05).
    for (const definition of named) {
        const inner: string[] = [];
        for (const held of definitionsHeldBy(reading.definitions, definition)) {
            const heldName = held.name.toLowerCase();
            if (heldName !== folded && !inner.some((name) => name.toLowerCase() === heldName)) inner.push(held.name);
        }
        if (inner.length > 0) {
            // the held labels as one list: "a", "a and b", or "a, b, and c"
            const labels = inner.map(quotedDefinitionLabel);
            const them = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")}${labels.length > 2 ? "," : ""} and ${labels[labels.length - 1]}`;
            return {
                kind: "refused",
                reason:
                    inner.length === 1
                        ? `Nothing was deleted: the ${them} definition sits inside the ${quotedDefinitionLabel(definition.name)} definition, which cutting it would take too. Move it out, or delete it by hand.`
                        : `Nothing was deleted: the ${them} definitions sit inside the ${quotedDefinitionLabel(definition.name)} definition, which cutting it would take too. Move them out, or delete them by hand.`,
            };
        }
    }
    const definitionCut = definitionCuts(lines, named);
    const blocks = definitionCut.ranges;
    let definitions = named.length;
    // A lazy label (a "[^x]:" line directly under prose, one blank line
    // short of a definition) and an underlined label (a "[^x]:" line with
    // a setext underline under it, which makes it a heading) are the
    // definitions the user MEANT to write, so they go too: the lazy line
    // alone, the underlined line together with its underline, which has
    // no business staying behind under the line above. Each label's name
    // is the one labelShapedLines read from where the line's list and
    // quote markers end, so a label at a nested item's content column
    // counts too (hunt 2026-10-05, cluster CN3).
    //
    // The underline goes only while it is paragraph text in the note as
    // it is. A line that starts a block of its own stays: under a lazy
    // label, "---" is a horizontal rule (live Obsidian 1.14.4,
    // 2026-10-06), and under a table's last row a "===" is a paragraph of
    // its own. The label is filed underlined because the "---" would
    // underline it once a blank line went in above it, but no blank line
    // goes in here (hunt 2026-10-06, cycle 5, pins
    // bug-delete-cuts-rule-under-lazy-label and
    // bug-delete-cuts-paragraph-under-table-row).
    for (const label of labelShapedLines(lines)) {
        if (label.name.toLowerCase() !== folded) continue;
        const underlineIsText = label.underlined && !(reading.lineBlocks[label.line + 1] ?? "").includes("^");
        blocks.push({ start: label.line, end: underlineIsText ? label.line + 1 : label.line });
        definitions++;
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
        if (cut.has(i) || line !== lines[i]) return line;
        // rightmost first, so that cutting one keeps the offsets of the
        // ones before it
        const hits = reading
            .referencesOn(i)
            .filter((occurrence) => occurrence.name.toLowerCase() === folded)
            .reverse();
        references += hits.length;
        return hits.reduce((kept, { start, end }) => cutOne(kept, start, end, reading.blockSyntaxEnd(i)), line);
    });
    if (references === 0 && definitions === 0) return { kind: "nothing" };
    // A line the reference cuts leave blank, with text right above it and
    // right below it, goes too, when it carried on the paragraph above. A
    // reference alone on a line between two lines of text is part of one
    // paragraph with them (a press on the blank line between two paragraphs
    // writes one there, Jason's ruling B1), and an empty line left in its
    // place would split that paragraph in two, so the deletion was refused.
    // Without the line, the note reads as it did (Jason's ruling Q28,
    // 2026-10-08; hunt 2026-10-08 cycle 6, cluster Z13).
    //
    // A line that started its paragraph stays, empty: under a heading, a
    // rule, a code block, or a table, a press on the blank line writes the
    // reference there, and the blank line back gives the note as it was
    // before the press (Jason, 2026-10-08; hunt 2026-10-08 cycle 7, cluster
    // Y10). An emptied line with a blank line next to it stays too, as
    // before.
    const hasText = (i: number) => i >= 0 && i < lines.length && !cut.has(i) && lines[i].trim() !== "";
    // its own block a paragraph without the mark for where one starts
    const carriesOn = (i: number) => /(?:^| )paragraph$/.test(reading.lineBlocks[i] ?? "");
    const emptied = cutLines.flatMap((line, i) =>
        line !== lines[i] && !cut.has(i) && line.trim() === "" && hasText(i - 1) && hasText(i + 1) && carriesOn(i) ? [{ start: i, end: i }] : [],
    );

    // The promise the two orphan rules make, kept here too: the result gate
    // judges the deletion, and one that changes how Obsidian reads text it
    // was not asked to touch is refused whole, rather than half done.
    // Cutting reference text can turn "-[^9] tail" into a bullet; cutting a
    // block can put the line below it under a setext underline or a blank
    // line and so promote a lazy label there into a definition, or empty a
    // numbered item so it folds into the paragraph above (Jason's ruling
    // B11, 2026-10-08).
    const byHand = " would change how Obsidian reads the text around it. Delete it by hand.";
    // The reference cuts are judged on their own first, so the toast can
    // say which half was refused; then the whole deletion, against the
    // note as it was.
    const referencesCut = removeLineRanges(
        cutLines.map((line, i) => (definitionCut.lines[i] === lines[i] ? line : lines[i])),
        emptied,
    );
    const intent = { removed: [name] };
    if (references > 0 && !judgeEdit(lines, referencesCut, intent, reading).pass) {
        return { kind: "refused", reason: `Nothing was deleted: removing ${quotedReference(name)}${byHand}` };
    }
    const out = removeLineRanges(cutLines, [...blocks, ...emptied].sort((a, b) => a.start - b.start));
    if (!judgeEdit(lines, out, intent, reading).pass) {
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
                        // no lint ran, so an orphan the deletion left is
                        // named even while a delete toggle is on
                        noticeLintAlerts(plugin, markdown, false);
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
