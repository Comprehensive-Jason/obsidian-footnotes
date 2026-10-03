import { Editor, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { settleFootnotePopupWithFeedback, toggleCloseFootnotePopup } from "./footnote-popup";
import { adjustFootnotePosition, moveCursorAndSetJumpPoint } from "../editor/cursor-motion";
import {
    createAutonumFootnote,
    createFootnoteReference,
    createMatchingFootnoteDefinition,
    insertInTableCell,
    refusedCreation,
} from "./create-footnote";
import { DocContext, docContext, referenceOccurrenceAtCursor } from "../editor/doc-context";
import { bareInsertionVerdict, readInlineFootnoteFromClipboard } from "./inline-footnotes";
import { ProtectedCreationNotice, simulatedContext } from "../editor/insertion-liveness";
import { shouldJumpFromDefinitionToReference, shouldJumpFromReferenceToDefinition } from "./navigation";
import { propertiesWidgetOwnsFocus, readingViewActive, viewEditor } from "../editor/obsidian-internals";
import { warnTableEdgeCaretIfOutside, caretGuardsHandled, warnDefinitionCaretIfInside, warnProtectedCaretIfInside } from "./press-guards";
import { selectionPressHandled, submitActiveNameModal } from "./selection-footnote";
import { multiCaretPastePressHandled, multiCaretPressHandled } from "./multi-caret";
import { activeTableCellEditor, resolvedCaret, runOutsideTableCell, TableCellEditor } from "../editor/table-cursor";

import { showNotice } from "../editor/notice";
// The command entry points. Every press walks the same decision cascade,
// and what sits at the caret decides which step handles it:
//   1. on a definition line ("[^x]: …"): jump back to the first reference
//   2. on a reference that already has a definition: jump to it, or open
//      the popup editor on it
//   3. on a reference with NO definition: create that definition. Every key
//      does this, because an accidental press while you are still naming a
//      footnote must continue that footnote, never nest a new reference
//      inside the brackets.
//   4. anything else: insert a new reference ("[^N]" plus its definition,
//      or an empty "[^]")
// The guards live in press-guards.ts, the creation steps in
// create-footnote.ts, and the jump steps in navigation.ts. This file is only
// the cascade WIRING plus the shared command preamble (2026-08-12 split).
// Table caveat (see table-cursor.ts): when the caret is in a table cell the
// user is actively editing, reads use the position resolved from that cell's
// own sub-editor, and reference writes are sent INTO that sub-editor.

/**
 * The opening steps that every footnote command shares: wait for a pending
 * popup save to settle, close an open popup (a press that closes the popup
 * is used up by the closing), then find an editor we are allowed to write
 * to.
 *
 * The press does nothing at all when the popup consumed it, when there is
 * no markdown view, when the view has not loaded its editor yet
 * (viewEditor), or when Reading view is showing. Reading view matters
 * because the editor API will happily edit the HIDDEN buffer behind it: one
 * press invisibly inserted "[^]", and the next press toasted about a
 * reference the user could not see (reported 2026-08-08, probed live).
 * main.ts also hides the commands from the palette there; this check is
 * what stops a programmatic call.
 *
 * ORDER MATTERS: the settle wait comes BEFORE the popup close. Otherwise a
 * second press in the same tick races past the popup the first press
 * opened instead of closing it. Document edits must also wait for a
 * just-closed popup's pending definition save, or that save lands
 * afterwards and clobbers them.
 *
 * Handing `action` in as a callback is ON PURPOSE. It runs synchronously,
 * in the SAME microtask as the settle continuation and the close check. If
 * this function returned the editor to an awaiting caller instead, there
 * would be a microtask hop between the close check and the popup
 * registration that `action` performs. That gap is wide enough for a second
 * press in the same tick to run its own close check, find no popup, and
 * mint a second footnote (the 2026-07-16 regression class). This is not
 * theory: it happened when the preamble was first extracted as a helper
 * that returned a value, and the rapid-press smoke tests caught it
 * (2026-08-11).
 *
 * Exported for the Rename-footnote command (2026-08-12), which needs the
 * same popup settling: renaming under an open popup would strand its save
 * against the old name.
 */
export async function withEditableEditor(
    plugin: FootnotePlugin,
    action: (doc: Editor) => void | Promise<void>,
    propertiesFocusNotice: string = ProtectedCreationNotice,
): Promise<void> {
    // an open Name-the-footnote modal claims the press FIRST: any footnote
    // command submits that modal, exactly like pressing Enter (Jason's ask
    // 2026-08-22). Without this the command would act on the editor
    // UNDERNEATH the modal and stack a second modal on top of the first.
    if (submitActiveNameModal()) return;
    await settleFootnotePopupWithFeedback();
    if (toggleCloseFootnotePopup()) return;
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = mdView && viewEditor(mdView);
    if (!mdView || !doc) return;
    if (readingViewActive(mdView)) return;
    // Live Preview's Properties widget: while the user is typing in a
    // property field, the caret the editor reports is the STALE one from
    // before they clicked in, so acting on it edits prose they are not even
    // looking at. Source mode refuses the same press because that caret
    // counts as protected frontmatter; match it (Jason's A19 pass,
    // 2026-09-04).
    if (propertiesWidgetOwnsFocus(mdView)) {
        showNotice(propertiesFocusNotice, 8000);
        return;
    }
    return action(doc);
}

/** The numbered command ("Insert / navigate numbered footnote"). It runs the decision cascade, and when there is nothing to navigate to it creates "[^N]" plus its definition. */
export async function insertAutonumFootnote(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, (doc) => {
        // a table cell the user is actively editing owns the real caret.
        // getCursor() is stale there, and editing the row through the main
        // editor corrupts the table, so reads use the resolved position and
        // writes go through the cell.
        const cell = activeTableCellEditor(doc);
        const run = (cursorPosition: EditorPosition) => {
            // a live selection claims the press before any caret guard runs:
            // when text is selected, converting it is what the press MEANS
            // (issue #35)
            if (selectionPressHandled(plugin, doc, cell, "autonum", cursorPosition))
                return;
            // several Alt-clicked carets: the same "[^N]" lands at every one,
            // sharing a single definition (2026-08-22)
            if (multiCaretPressHandled(plugin, doc, cell !== null, "autonum"))
                return;
            // the guards run INSIDE run() so that the sub-editor fallback has
            // resolved the real caret before they judge it (2026-08-11 review
            // bug #9)
            if (caretGuardsHandled(plugin, doc, cell, cursorPosition)) return;
            const lineText = doc.getLine(cursorPosition.line);
            // ONE shared reading of the document for the whole cascade, rather
            // than one per step (perf F1). Built inside run() so that the
            // table-fallback path reads the state after the sync.
            const ctx = docContext(doc);

            if (shouldJumpFromDefinitionToReference(lineText, cursorPosition, plugin, doc, ctx))
                return;
            if (shouldJumpFromReferenceToDefinition(lineText, cursorPosition, plugin, doc, ctx))
                return;
            // the caret is inside a reference that has NO definition: continue
            // the half-built footnote by creating its definition, instead of
            // nesting "[^N]" into the brackets. This matches what the named and
            // inline keys do, so an accidental numbered press while you are
            // still naming a footnote is simply the next step (reported from
            // beta.9 phone testing, 2026-08-09)
            if (createMatchingFootnoteDefinition(lineText, cursorPosition, plugin, doc, ctx))
                return;

            createAutonumFootnote(lineText, cursorPosition, plugin, doc, cell, ctx);
        };
        if (cell) run(resolvedCaret(doc, cell));
        else runOutsideTableCell(doc, run);
    });
}

/** The named command ("Insert / navigate named footnote"). Same cascade, but creation takes two steps: the first press inserts "[^]" so you can type a name, and the next press, with the caret on that named reference, creates its definition. */
export async function insertNamedFootnote(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, (doc) => {
        // a table cell the user is actively editing owns the real caret.
        // getCursor() is stale there, and editing the row through the main
        // editor corrupts the table, so reads use the resolved position and
        // writes go through the cell.
        const cell = activeTableCellEditor(doc);
        const run = (cursorPosition: EditorPosition) => {
            // a selection opens the name modal and converts under the name you
            // type. The usual second press cannot carry the selected body
            // along without storing state (issue #35; the named flavor was
            // added 2026-08-13)
            if (selectionPressHandled(plugin, doc, cell, "named", cursorPosition))
                return;
            // several carets: an empty "[^]" at each one, with a cursor inside
            // every bracket pair, so typing names them all at once
            if (multiCaretPressHandled(plugin, doc, cell !== null, "named"))
                return;
            // the guards run INSIDE run(), for the same reason as in the
            // autonum command
            if (caretGuardsHandled(plugin, doc, cell, cursorPosition)) return;
            const lineText = doc.getLine(cursorPosition.line);
            // ONE shared reading of the document for the whole cascade, rather
            // than one per step (perf F1)
            const ctx = docContext(doc);

            if (shouldJumpFromDefinitionToReference(lineText, cursorPosition, plugin, doc, ctx))
                return;
            if (shouldJumpFromReferenceToDefinition(lineText, cursorPosition, plugin, doc, ctx))
                return;

            if (createMatchingFootnoteDefinition(lineText, cursorPosition, plugin, doc, ctx))
                return;
            createFootnoteReference(lineText, cursorPosition, plugin, doc, cell, ctx);
        };
        if (cell) run(resolvedCaret(doc, cell));
        else runOutsideTableCell(doc, run);
    });
}

/**
 * When the caret sits strictly inside a "[^x]" reference, handle the press
 * the way the numbered and named commands would: jump to the reference's
 * definition, or open the popup editor on it, creating that definition when
 * it is missing. Reports true when it did.
 *
 * This is the mirror image of exitInlineFootnoteIfInside (QOL, 2026-07-20),
 * and both inline commands share it. Inserting "^[…]" into a reference
 * would corrupt it ("[^na^[]med]"), so the inline hotkeys navigate instead.
 */
export function navigateReferenceIfInside(
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor | null,
    // the press's own reading of the document, so this step does not build a
    // second one
    ctx?: DocContext,
): boolean {
    const cursorPosition = resolvedCaret(doc, cell);
    const lineText = doc.getLine(cursorPosition.line);
    // the shared lookup checks the raw line first and only then the masked
    // twin (the copy of the note with protected text blanked out). This runs
    // on every inline-command press, and a "[^x]" inside code is plain text,
    // where inserting an inline footnote is fine (perf F1, #41 semantics;
    // see referenceOccurrenceAtCursor). The one reading of the document it
    // builds past that gate serves the rest of the press.
    const hit = referenceOccurrenceAtCursor(lineText, cursorPosition, doc, ctx);
    if (hit === null) return false;

    if (shouldJumpFromReferenceToDefinition(lineText, cursorPosition, plugin, doc, hit.ctx))
        return true;
    if (createMatchingFootnoteDefinition(lineText, cursorPosition, plugin, doc, hit.ctx))
        return true;
    // however the cascade settled it, even if all it did was warn about an
    // invalid name, the press counts as handled: "^[…]" must never land
    // inside the reference
    return true;
}

// The shared tail of both inline commands: put `text` at the caret (through
// the cell sub-editor when inside a table, see the table notes above) and
// leave the caret `caretOffsetInText` characters into what was inserted.
function insertInlineText(
    plugin: FootnotePlugin,
    text: string,
    caretOffsetInText: number,
) {
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = mdView && viewEditor(mdView);
    if (!doc) return;

    const cell = activeTableCellEditor(doc);
    if (cell) {
        insertInTableCell(cell, plugin, text, caretOffsetInText);
        return;
    }
    runOutsideTableCell(doc, (cursorPosition) => {
        const lineText = doc.getLine(cursorPosition.line);
        // a caret on a table row but outside its cells, or on the row of
        // dashes under the header, would break the table (the same guard
        // the numbered and named keys run)
        if (lineText.includes("|") && warnTableEdgeCaretIfOutside(null, cursorPosition, docContext(doc))) return;
        const at = adjustFootnotePosition(cursorPosition, doc, lineText, plugin);
        // born-dead check (see bareInsertionVerdict). "Born-dead" means an
        // insertion that would not be a live footnote the moment it lands.
        // The "^[…]" must still read as an inline footnote on the masked
        // result, because text it carries (pasted inline code, say) can mask
        // INSIDE the brackets. And it must not land inside a definition,
        // which an empty line right under one does once it is filled.
        const verdict = bareInsertionVerdict(simulatedContext(doc, at, text), [at], text);
        if (refusedCreation(verdict, ProtectedCreationNotice)) return;
        const newCursorPos = { line: at.line, ch: at.ch + caretOffsetInText };
        moveCursorAndSetJumpPoint(doc, cursorPosition, newCursorPos, plugin, [
            { from: at, text },
        ]);
    });
}

/**
 * The inline-footnote command. It inserts `^[]` with the caret between the
 * brackets, so you can write the footnote straight away. Press it again
 * while the cursor is still inside an inline footnote and it hops the caret
 * just past the closing bracket instead, so typing continues without
 * reaching for the arrow keys. Inside a regular "[^x]" reference the press
 * navigates, like the numbered and named commands, rather than nesting.
 */
export async function insertInlineFootnote(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, (doc) => {
        const cell = activeTableCellEditor(doc);
        // a live selection claims the press: it becomes "^[…]" in place
        // (issue #35)
        if (selectionPressHandled(plugin, doc, cell, "inline")) return;
        // several carets: "^[]" at each one, with a cursor inside every pair,
        // so typing writes the same body into all of them (2026-08-22)
        if (multiCaretPressHandled(plugin, doc, cell !== null, "inline")) return;
        if (caretGuardsHandled(plugin, doc, cell)) return;
        const cursorPosition = resolvedCaret(doc, cell);
        const ctx = docContext(doc);
        // anywhere inside a definition (the label, its body, a continuation
        // line), jump back to the reference EXACTLY like the numbered and
        // named keys. Nested footnotes are nonstandard markdown the plugin
        // will not create, and a jump is more useful than a toast (Jason's
        // rulings 2026-08-13)
        if (
            !cell &&
            shouldJumpFromDefinitionToReference(
                doc.getLine(cursorPosition.line),
                cursorPosition,
                plugin,
                doc,
                ctx,
            )
        ) {
            return;
        }
        // the blank line between two of a definition's continuation lines
        // is inside the definition too, but carries no definition-shaped
        // text for the jump step to see: refuse there like the numbered and
        // named keys do, instead of planting a nested "^[]" (GLM sweep
        // 2026-09-13)
        if (warnDefinitionCaretIfInside(doc, cell, cursorPosition, ctx)) return;
        // inside a real reference, navigate instead of nesting "^[]"
        if (navigateReferenceIfInside(plugin, doc, cell, ctx)) return;
        // creating a footnote inside protected text (code, math, comments,
        // frontmatter) is blocked outright
        if (warnProtectedCaretIfInside(doc, cell, cursorPosition, ctx)) return;

        insertInlineText(plugin, "^[]", 2);
    });
}

/** The inline-footnote paste command. It inserts `^[<clipboard>]` with the caret after it. Inside a "[^x]" reference it navigates like the named command instead, and the clipboard is left untouched. */
export async function pasteInlineFootnote(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, async (doc) => {
        const pasteCell = activeTableCellEditor(doc);
        // a selection redirects to the numbered and inline keys: the
        // clipboard already carries this key's body (issue #35). This runs
        // before the clipboard await, like the guards below.
        if (selectionPressHandled(plugin, doc, pasteCell, "paste")) return;
        // several carets: the same "^[clipboard]" lands at every one
        // (2026-08-22)
        if (await multiCaretPastePressHandled(plugin, doc, pasteCell !== null))
            return;
        // the same guards every other insert command runs. They were missing
        // here until the 2026-08-07 QOL sweep; pinned by
        // test/paste-inline-in-inline.test.ts
        if (caretGuardsHandled(plugin, doc, pasteCell)) return;
        const pastePosition = resolvedCaret(doc, pasteCell);
        const pasteCtx = docContext(doc);
        // inside a definition, jump back like every other footnote key. This
        // runs before the clipboard await, so a press that is handled here
        // never reads the clipboard.
        if (
            !pasteCell &&
            shouldJumpFromDefinitionToReference(
                doc.getLine(pastePosition.line),
                pastePosition,
                plugin,
                doc,
                pasteCtx,
            )
        ) {
            return;
        }
        // the same definition-interior guard as the inline key above
        if (warnDefinitionCaretIfInside(doc, pasteCell, pastePosition, pasteCtx)) return;
        if (navigateReferenceIfInside(plugin, doc, pasteCell, pasteCtx)) return;
        // creating a footnote inside protected text (code, math, comments,
        // frontmatter) is blocked outright. Before the clipboard await, so a
        // blocked press never reads the clipboard.
        if (warnProtectedCaretIfInside(doc, pasteCell, pastePosition, pasteCtx)) {
            return;
        }

        // the clipboard read is the only await, and everything that depends
        // on the caret position happens after it (the helper re-checks for
        // Reading view once the await returns)
        const text = await readInlineFootnoteFromClipboard(plugin);
        if (text === null) return;
        insertInlineText(plugin, text, text.length);
    });
}
