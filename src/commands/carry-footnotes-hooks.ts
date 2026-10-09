import { EditorView } from "@codemirror/view";
import { Editor, EditorChange, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { contextOfLines, docLines, insideDefinition } from "../editor/doc-context";
import { lineDiffChanges } from "../editor/document-diff";
import { simulateChanges } from "../editor/insertion-liveness";
import { NothingCutNotice, PasteNestedNotice, PasteProtectedNotice, PasteReadsDifferentlyNotice, showNotice } from "../editor/notice";
import { CreatedFootnote, EditIntent, judgeEdit, NoteRange } from "../editor/result-gate";
import { codeMirrorViewOf, readingViewActive, viewEditor } from "../editor/obsidian-internals";
import { mainEditorTextHolds, nestedSubEditorOwnsFocus } from "../editor/table-cursor";
import { replaceMinimal, writeChanges } from "../editor/write-back";
import { noticeLintAlerts } from "../linting/lint-alerts";
import { lintAfterFootnoteCreation, lintBlockedByPrefix, lintRulesAllDisabled, withEmptySectionHeadingRemoved } from "../linting/linter";
import { quotedReference } from "../parsing/footnote-grammar";
import { normalizeEol, restoreEol } from "../parsing/line-edits";
import { readNote } from "../parsing/note-reading";
import {
    CarriedDefinition,
    CarriedDefinitions,
    carriedDefinitions,
    carriedLines,
    landsInProtectedText,
    planCarriedPaste,
    planCut,
    splitCarriedText,
    uncarriedNames,
    withCarriedText,
} from "./carry-footnotes";
import { planDefinitionAppend } from "./definition-append";
import { footnotePopupEditor, footnotePopupSection } from "./footnote-popup";

// The editor side of carrying footnote definitions on copy, cut, and paste
// (issue #59; Jason's rulings 2026-09-21 and 2026-09-22). The pure pieces
// are in carry-footnotes.ts; this file hooks them to the keys people
// already press.
//
// Copy and cut write the selection AND the definition blocks its
// references need into the clipboard text, after one blank line, and
// remember the same in a register of the plugin's own. The definitions
// travel in the text on purpose (Jason, 2026-09-22): a cut pasted outside
// Obsidian would otherwise lose them, which reads as data loss, and a
// clipboard that carries them costs nothing inside Obsidian, because the
// paste strips them back off before landing them properly. An earlier
// design kept the clipboard clean behind a setting; Jason found no
// downside to carrying and the setting went.
//
// Cut takes the event over whenever the selection needs a definition
// (the editor's own cut would write the bare text): the selection AND the
// carried definitions nothing else uses leave the note in one
// transaction. A definition still used elsewhere stays, and only its copy
// travels; a definition the clipboard does not carry never leaves the
// note (planCut).
//
// Paste: Obsidian's editor-paste event hands over the ClipboardEvent
// before the insert, and its text is read synchronously from the event,
// with no Clipboard API permission (the async read is what makes Copy
// with Footnotes fragile on the phone). When the text matches the
// register, or ends in definition lines from anywhere (a manual copy, a
// Copy with Footnotes clipboard), the plugin takes the paste over and
// lands the body plus the carried definitions in one transaction, merged
// and renamed to fit the destination (planCarriedPaste), where a creation
// press would put them (planDefinitionAppend). Then the lint-on-creation
// trigger runs, as after every press that creates a footnote.
//
// A cut pasted back is an undo (ADR 0003, rule 2; Jason's rulings
// 2026-10-07). For a cut, the register also keeps the note before the cut
// and right after it, the caret the cut left, and the file. A paste of that
// cut's text into that file, while its text is still exactly the note the
// cut left, at that caret with nothing selected, writes the note before the
// cut back exactly, names and blank lines included (pastedBack). It
// compares texts, so the phone's Paste command and its keyboard's
// clipboard history paste a cut back too.

/** What the last copy or cut from this window took with it. */
export interface CarryRegister {
    /** the clipboard text as written: the body, then the carried blocks */
    text: string;
    /** the selection, less the definitions at its end, which are carried */
    body: string;
    /** the definitions at the end of the selection, then the ones its references need from outside it */
    carried: CarriedDefinition[];
    missing: string[];
    /** for a cut, what a paste back needs (pastedBack); none for a copy */
    cut?: CutRecord;
}

/** What a cut remembers for a paste back: the note before it and right after it (lines joined with "\n"), the caret it left, where the cut text ended in the note before it, and the file it was made in. */
interface CutRecord {
    before: string;
    after: string;
    caret: EditorPosition;
    end: EditorPosition;
    file: string | null;
}

let register: CarryRegister | null = null;

/** The register as it stands, for tests and the paste hook. */
export function carryRegister(): CarryRegister | null {
    return register;
}

/** Forget the last copy (tests; and unload). */
export function resetCarryRegister(): void {
    register = null;
}

/**
 * Whether the clipboard event `event` happened in `doc`'s own text.
 *
 * The copy and cut hooks listen on the whole page, so they also hear a
 * copy or cut in a Properties field, the inline title, the search box, a
 * dialog's input, or a hover popover's editor. While the focus sits in one
 * of those, the note keeps its old selection, and acting on it cut prose
 * the user was not even looking at (hunt 2026-10-02, pin
 * bug-carry-unfocused-field-acts-on-note). So the event counts only when
 * the element it was fired at (or, without one, the focused element) sits
 * inside the editor's own text area, CodeMirror's content element.
 *
 * A table cell, or any other small editor drawn inside that text area,
 * has its own copy, cut, and paste, and writing through the main editor
 * while it holds the focus races its write-back into the note (the issue
 * #28 corruption family; pin bug-carry-unreachable-nested-editor). So the
 * event does not count while such an editor holds the focus either.
 *
 * The Properties box needs no check of its own: Obsidian draws it outside
 * the content element, so the first test already turns it away.
 *
 * An event fired somewhere else still counts when the page's own selection
 * sits in the note's text, because a copy or a cut always takes the page's
 * selection, unless it was fired at a typing field (an input, a text
 * area, or editable text such as the inline title), which has a selection
 * of its own. This is the phone's case: a copy or cut from Android's
 * selection toolbar is fired at the page's body, since the selection does
 * not count as shown while the toolbar takes the tap, so without this the
 * phone carried nothing at all (Jason's report, 2026-10-04, 0.3.0-beta.3;
 * test/carry-phone-selection-toolbar.test.ts). The selection must sit in
 * the main editor's own text, not in a table cell's editor drawn inside
 * it, whose selection the main editor cannot see (mainEditorTextHolds;
 * hunt 2026-10-05, pin bug-toolbar-cut-in-table-cell).
 *
 * The unit tests' stand-in editor has no CodeMirror view, and then there
 * is nothing to ask, so the event counts.
 */
function eventInEditorText(doc: Editor, event: Event): boolean {
    const content = codeMirrorViewOf(doc)?.contentDOM;
    if (!content) return true;
    if (nestedSubEditorOwnsFocus(doc)) return false;
    const page = content.ownerDocument;
    const target = event.target ?? page.activeElement;
    if (target && content.contains(target as Node)) return true;
    if (target && isTypingField(target)) return false;
    // the tests' stand-in pages have no selection to ask
    const anchor = (page as Partial<Document>).getSelection?.()?.anchorNode;
    return !!anchor && mainEditorTextHolds(doc, anchor);
}

/** Whether `target` is an element that holds typed text and its own selection: an input, a text area, or editable text. */
function isTypingField(target: EventTarget): boolean {
    const element = target as Partial<HTMLElement>;
    return element.isContentEditable === true || element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

/** The single, non-empty selection of the note being edited, or null when the feature is off, no editor is active, the view is Reading view, the event happened outside the note's own text (eventInEditorText), or the selection is empty or multiple. */
function carryableSelection(plugin: FootnotePlugin, event: Event): { doc: Editor; from: EditorPosition; to: EditorPosition } | null {
    if (!plugin.settings.carryFootnotesOnCopy) return null;
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = mdView && viewEditor(mdView);
    if (!mdView || !doc || readingViewActive(mdView)) return null;
    if (!eventInEditorText(doc, event)) return null;
    const range = singleSelection(doc);
    return range && { doc, ...range };
}

/** The one selection of `doc`, start first, or null when it is empty or there are several. */
function singleSelection(doc: Editor): { from: EditorPosition; to: EditorPosition } | null {
    const selections = doc.listSelections();
    if (selections.length !== 1) return null;
    const [a, b] = [selections[0].anchor, selections[0].head];
    const before = a.line < b.line || (a.line === b.line && a.ch <= b.ch);
    const [from, to] = before ? [a, b] : [b, a];
    if (from.line === to.line && from.ch === to.ch) return null;
    return { from, to };
}

/** The text between two positions, read line by line (the fake editor has no getRange). */
function textBetween(doc: Editor, from: EditorPosition, to: EditorPosition): string {
    if (from.line === to.line) return doc.getLine(from.line).slice(from.ch, to.ch);
    const parts = [doc.getLine(from.line).slice(from.ch)];
    for (let line = from.line + 1; line < to.line; line++) parts.push(doc.getLine(line));
    parts.push(doc.getLine(to.line).slice(0, to.ch));
    return parts.join("\n");
}

/**
 * Remember what the selection between `from` and `to` carries, as the
 * register for the paste that follows.
 *
 * The register reads the selection the way a paste of its clipboard text
 * from anywhere else is read (splitCarriedText): definitions at the end of
 * the selection itself are carried too, merged and renamed to fit the
 * destination like the ones the selection needs from outside it. The
 * clipboard text is the same either way; only the paste reads it. A
 * selection that held its own definition, such as a whole note copied
 * with Ctrl+A, used to be pasted as it was, and where the destination
 * already used the name, the note got a second definition of it, while
 * the same text from another app was renamed (hunt 2026-10-02, pin
 * bug-carry-selection-own-definition-duplicates).
 */
function remember(doc: Editor, from: EditorPosition, to: EditorPosition, { carried, missing }: CarriedDefinitions): CarryRegister {
    const selected = textBetween(doc, from, to);
    // a selection with no "[^" in it holds no definition, so it is not read
    // (a copy of plain prose stays cheap; pin bug-carry-plain-copy-scans-note);
    // it is split as a selection of its note, not as a clipboard text, so
    // only the lines the note reads as definitions are carried, and its
    // blank lines in front of them stay the note's spacing (see
    // splitCarriedText)
    const own = selected.includes("[^") ? splitCarriedText(selected, { reading: readNote(docLines(doc)), from }) : { body: selected, carried: [] };
    register = { text: withCarriedText(selected, carried), body: own.body, carried: [...own.carried, ...carried], missing };
    return register;
}

/**
 * The copy hook (a bubbling document listener, so it runs after the
 * editor's own copy has written the clipboard and can override the text).
 * A selection that needs no definition is left to the editor.
 */
export function handleCopy(plugin: FootnotePlugin, event: ClipboardEvent): void {
    const selection = carryableSelection(plugin, event);
    if (!selection) return;
    const text = carriedCopyText(selection.doc, selection.from, selection.to);
    if (text === null || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
}

/** What a copy of the text between `from` and `to` puts in the clipboard, remembered for the paste that follows; null when the text needs no definition, and the editor's own copy is right. */
function carriedCopyText(doc: Editor, from: EditorPosition, to: EditorPosition): string | null {
    const needed = carriedDefinitions(doc.getValue(), from, to);
    const entry = remember(doc, from, to, needed);
    return needed.carried.length === 0 ? null : entry.text;
}

/**
 * The cut hook (a capturing document listener, so it runs before the
 * editor's own cut and can take the event over). It takes over when the
 * selection needs a definition; a cut that needs none is the editor's
 * own. What leaves the note and what goes into the clipboard come from
 * one plan (planCut), so the cut only ever removes definitions the
 * clipboard carries.
 */
export function handleCut(plugin: FootnotePlugin, event: ClipboardEvent): void {
    const selection = carryableSelection(plugin, event);
    if (!selection) return;
    const cut = plannedCut(plugin, selection.doc, selection.from, selection.to);
    if (!cut) return;
    // a refused cut cuts nothing and copies nothing (Jason's ruling B9)
    if (cut === "refused") {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", cut.text);
    event.preventDefault();
    event.stopPropagation();
    cut.make();
}

/**
 * A cut of the text between `from` and `to`, planned and remembered for
 * the paste that follows: what goes into the clipboard, and `make`, which
 * takes the text and the definitions nothing else uses out of the note.
 * Null when the text needs no definition, and the editor's own cut is
 * right. "refused" when the result gate refused the cut (planCut): the
 * notice has said so, and nothing is cut, copied, or remembered (Jason's
 * ruling B9, 2026-10-08).
 */
function plannedCut(plugin: FootnotePlugin, doc: Editor, from: EditorPosition, to: EditorPosition): { text: string; make: () => void } | "refused" | null {
    const before = doc.getValue();
    // a cut that takes the last definition with it empties the section,
    // so the section heading goes too when the setting says so (Jason,
    // 2026-09-25)
    const tidy = (text: string) => withEmptySectionHeadingRemoved(plugin, text);
    const plan = planCut(before, from, to, tidy);
    if (plan.refused) {
        showNotice(NothingCutNotice, 8000);
        return "refused";
    }
    const entry = remember(doc, from, to, plan);
    // a cut the editor makes leaves the note planCut worked out for it too:
    // the selection deleted, and the caret where it started
    entry.cut = { before: normalizeEol(before).text, after: plan.text, caret: plan.caret, end: to, file: fileOf(plugin, doc) };
    if (plan.carried.length === 0) return null;
    const make = () => {
        // the note as the plan reads it, written back as the smallest set of
        // edits in one transaction, and the caret where the selection was
        replaceMinimal(doc, before, restoreEol(plan.text, normalizeEol(before).eol), plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined);
        doc.setCursor(plan.caret);
        if (plan.removed > 0) {
            const count = plan.removed;
            showNotice(`Cut with ${count} footnote definition${count === 1 ? "" : "s"} that nothing else used; paste to carry ${count === 1 ? "it" : "them"} along.`);
        }
    };
    return { text: entry.text, make };
}

/**
 * The paste hook, on Obsidian's editor-paste event. Takes the paste over
 * when the text matches the register or ends in definition lines; leaves
 * every other paste, one another plugin already handled, and one that
 * happened outside the editor's own text (a table cell's editor, see
 * eventInEditorText), alone. Returns whether it took the paste over.
 */
export function handlePaste(plugin: FootnotePlugin, event: ClipboardEvent, doc: Editor): boolean {
    if (event.defaultPrevented || !plugin.settings.carryFootnotesOnCopy || !event.clipboardData) return false;
    if (!eventInEditorText(doc, event)) return false;
    if (!landPastedText(plugin, doc, event.clipboardData.getData("text/plain"))) return false;
    event.preventDefault();
    return true;
}

/**
 * Lands pasted `text` with the definitions it carries in place of `doc`'s
 * selection, when it carries any: the plugin's own copy (matched against
 * the register) or text from anywhere that ends in definition lines. A
 * text that carries none but defines a footnote of its own somewhere in
 * the middle is landed too when the note already uses that name, so the
 * pasted definition is renamed (see definesFootnotes).
 * Returns false, having changed nothing, when there is nothing to carry or
 * rename, the editor holds more than one selection, or the text lands in
 * protected text, such as a code block (see landCarriedText); the paste
 * is then the editor's own. `beforeWrite` runs right before the note is
 * changed (see wrapCommand).
 */
function landPastedText(plugin: FootnotePlugin, doc: Editor, text: string, beforeWrite: () => void = () => undefined): boolean {
    if (!text) return false;
    const [only] = doc.listSelections();
    if (doc.listSelections().length === 1 && pastedBack(plugin, doc, text, only.anchor, only.head, beforeWrite)) return true;
    let body: string;
    let carried: CarriedDefinition[];
    // the names the plugin's own copy found no definition for; null for a
    // text from anywhere else, whose names are read where it lands
    // (missingWhereLanded)
    let known: string[] | null = null;
    if (register && normalizeEol(register.text).text === normalizeEol(text).text) {
        // the plugin's own copy: the exact blocks it remembered, and the
        // names it could not find
        ({ body, carried, missing: known } = register);
    } else {
        // a clipboard from anywhere that ends in definition lines
        ({ body, carried } = splitCarriedText(text));
    }
    const selections = doc.listSelections();
    const [a, b] = [selections[0].anchor, selections[0].head];
    const [from, to] = a.line < b.line || (a.line === b.line && a.ch <= b.ch) ? [a, b] : [b, a];
    return landOrNameMissing(plugin, doc, from, to, text, body, carried, known, selections.length === 1, beforeWrite);
}

/** The path of the file `doc` is the editor of, or null when it is not the active note's editor (the footnote popup's, a hover popover's). */
function fileOf(plugin: FootnotePlugin, doc: Editor): string | null {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return view && viewEditor(view) === doc ? (view.file?.path ?? null) : null;
}

/**
 * A paste of `text` in `doc` from `from` to `to`, made as the paste back
 * of the last cut (ADR 0003, rule 2): the text is that cut's clipboard
 * text, nothing is selected and the caret is where the cut left it, the
 * editor is the one of the file the cut was made in, and its text is
 * exactly the note the cut left. Then the note before the cut is written
 * back, every name and blank line as it was, and the caret goes to the end
 * of the restored text, and this returns true. Otherwise it changes
 * nothing and returns false, and the paste is planned as any other.
 * `beforeWrite` runs right before the note is changed (see wrapCommand).
 *
 * A carried paste plans the text afresh where it lands, so a cut pasted
 * back could come back renamed, joined to the line around it, or with its
 * definition doubled (the paste back questions C27, Q5, Q6, Q12, and X25
 * of the hunts of 2026-10-02 to 2026-10-06; Jason's rulings 2026-10-07).
 * The cut knew what the note was, so the paste back gives exactly that.
 */
function pastedBack(plugin: FootnotePlugin, doc: Editor, text: string, from: EditorPosition, to: EditorPosition, beforeWrite: () => void = () => undefined): boolean {
    const cut = register?.cut;
    if (!register || !cut || normalizeEol(register.text).text !== normalizeEol(text).text) return false;
    const at = (pos: EditorPosition) => pos.line === cut.caret.line && pos.ch === cut.caret.ch;
    if (!at(from) || !at(to) || fileOf(plugin, doc) !== cut.file) return false;
    const now = doc.getValue();
    const { text: note, eol } = normalizeEol(now);
    if (note !== cut.after) return false;
    beforeWrite();
    writeChanges(doc, now, lineDiffChanges(now, restoreEol(cut.before, eol)), plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined, { from: cut.end });
    return true;
}

/**
 * Lands `body` and its `carried` definitions in place of the text between
 * `from` and `to` (landCarriedText), when it carries any or defines a
 * footnote of its own, the editor holds `one` selection, and the landing
 * goes through. Otherwise the editor pastes as usual, and a text that
 * carries nothing still gets a word for each reference it brings without
 * a definition. Both routes a text can arrive by, the paste event and the
 * phone keyboard's input (carriedInputHandler), come through here, so they
 * say the same: the input route used to say nothing (hunt 2026-10-06
 * cycle 5, cluster X9, pin bug-input-route-missing-notice). Returns
 * whether the text was landed.
 */
function landOrNameMissing(
    plugin: FootnotePlugin,
    doc: Editor,
    from: EditorPosition,
    to: EditorPosition,
    text: string,
    body: string,
    carried: CarriedDefinition[],
    known: string[] | null,
    one: boolean,
    beforeWrite: () => void = () => undefined,
): boolean {
    const missing = missingWhereLanded(doc, from, to, body, carried, known);
    if (one && (carried.length > 0 || definesFootnotes(body)) && landCarriedText(plugin, doc, from, to, text, body, carried, missing, beforeWrite)) return true;
    if (carried.length === 0 && missing.length > 0) {
        showNotice(`${missing.map(quotedReference).join(", ")} ${missing.length === 1 ? "has" : "have"} no definition to carry.`, 8000);
    }
    return false;
}

/**
 * The references a pasted text brings with no definition, read where its
 * `body` lands in place of the text between `from` and `to`
 * (uncarriedNames). Of the plugin's own copy, only the names the copy
 * found no definition for in its note (`known`) are named, and only those
 * the text still cites as references where it lands: pasted into a code
 * block or math, "[^1]" is no reference, and nothing is said (hunt
 * 2026-10-06 cycle 5, cluster X11, pin bug-missing-notice-in-protected-text).
 */
function missingWhereLanded(doc: Editor, from: EditorPosition, to: EditorPosition, body: string, carried: CarriedDefinition[], known: string[] | null): string[] {
    // the copy found every definition, so there is nothing to read
    if (known?.length === 0) return [];
    const uncarried = uncarriedNames(simulateChanges(docLines(doc), [{ from, to, text: "" }]), from, body, carried);
    if (!known) return uncarried;
    const cited = new Set(uncarried.map((name) => name.toLowerCase()));
    return known.filter((name) => cited.has(name.toLowerCase()));
}

/**
 * Whether the pasted `body` holds a definition of its own: a text copied
 * whole, such as a note copied with Ctrl+A, whose definition is followed by
 * more text ("Tags: #a"), so it is not lifted off the end as a carried one.
 * Pasted into a note that already uses the name, the editor's own paste left
 * the note defining that name twice; the plugin lands such a text so that
 * the pasted definition is renamed, as one at the end of the text is (hunt
 * 2026-10-06 cycle 3, cluster K6, pin bug-paste-body-defines-name-mid-text).
 */
function definesFootnotes(body: string): boolean {
    return body.includes("[^") && readNote(normalizeEol(body).text.split("\n")).definitions.length > 0;
}

/**
 * The same landing for text that arrives by another route than a paste
 * event. On a phone, the keyboard's clipboard history (Gboard, Samsung
 * Keyboard) commits the text through the input method, so no paste event
 * fires and the editor-paste hook never sees it: the footnotes landed as
 * plain text, definitions after the text (Jason's phone pass,
 * 2026-09-25). CodeMirror reports such an insert to its input handlers,
 * so this one looks at any inserted text that spans lines and ends in
 * definition lines, and lands it the way a paste would, with the same
 * toast and lint; a text that carries nothing gets the same word a paste
 * gives about the references it brings without a definition
 * (landOrNameMissing). `editorFor` turns the CodeMirror view into the Obsidian
 * editor that owns it (the unit tests hand in the fake editor directly).
 * Returns whether it took the insert over. A real paste never reaches
 * here: CodeMirror handles those itself and the editor-paste hook covers
 * them, so nothing is landed twice.
 */
export function carriedInputHandler(
    plugin: FootnotePlugin,
    editorFor: (view: EditorView) => Editor | null,
): (view: EditorView, from: number, to: number, text: string) => boolean {
    return (view, from, to, text) => {
        if (!plugin.settings.carryFootnotesOnCopy) return false;
        // the last cut's text, pasted back from the keyboard's clipboard
        // history (pastedBack)
        if (from === to && register?.cut && normalizeEol(register.text).text === normalizeEol(text).text) {
            const doc = editorFor(view);
            if (doc && !nestedSubEditorOwnsFocus(doc) && pastedBack(plugin, doc, text, doc.offsetToPos(from), doc.offsetToPos(to))) return true;
        }
        if (!text.includes("\n")) return false;
        const { body, carried } = splitCarriedText(text);
        // a text with no "[^" left in its body, and nothing carried, has
        // nothing to land, rename, or name
        if (carried.length === 0 && !body.includes("[^")) return false;
        const doc = editorFor(view);
        if (!doc || nestedSubEditorOwnsFocus(doc)) return false;
        return landOrNameMissing(plugin, doc, doc.offsetToPos(from), doc.offsetToPos(to), text, body, carried, null, true);
    };
}

/**
 * The Obsidian editor whose CodeMirror view is `view`, or null when no open
 * note owns it. The footnote popup's editor counts: the plugin's input
 * handler runs in it too, and the keyboard's clipboard history lands there
 * as it does in a note. Without it the handler found no editor, and the
 * carried definition lines went into the footnote as its own text (probed
 * live, 2026-10-06; hunt 2026-10-02, round 4, cluster U6).
 */
function editorOwning(plugin: FootnotePlugin, view: EditorView): Editor | null {
    const popup = footnotePopupEditor();
    if (popup && codeMirrorViewOf(popup) === view) return popup;
    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const md = leaf.view;
        if (!(md instanceof MarkdownView)) continue;
        const editor = viewEditor(md);
        if (editor && codeMirrorViewOf(editor) === view) return editor;
    }
    return null;
}

/**
 * Lands `body` in place of the text between `from` and `to`, and the
 * `carried` definitions where a creation press would put a definition,
 * merged and renamed to fit the note, all in one transaction; then the
 * toast with the counts, and the lint or its alerts. `missing` names the
 * references whose definitions could not be found at copy time.
 * `beforeWrite` runs right before the transaction that changes the note.
 *
 * The result gate judges the note as the paste would leave it; a paste it
 * refuses pastes nothing, and the notice says why (Jason, 2026-10-07 and
 * 2026-10-08), so this returns true for it, the paste settled.
 *
 * `pasted` is the text as it arrived, definition lines and all. Returns
 * false, having changed nothing, when its footnote syntax all lands in
 * protected text, pasted as it is: a paste inside a code block, a math
 * block, or the frontmatter. Nothing there needs a definition, so the
 * editor pastes the text as it is, definition lines and all, as plain text
 * inside the block. Taking such a paste over pulled the definitions out of
 * the code and landed them as live footnotes that nothing referenced (hunt
 * 2026-10-02, pin bug-carry-paste-in-protected-text; and, for a clipboard
 * whose text before the definitions cites nothing, hunt 2026-10-06 cycle
 * 3, pin bug-carry-paste-definitions-into-protected-text). A "%%" comment
 * is no such place, since a reference inside one is live (Jason's ruling
 * A1).
 */
function landCarriedText(
    plugin: FootnotePlugin,
    doc: Editor,
    from: EditorPosition,
    to: EditorPosition,
    pasted: string,
    body: string,
    carried: CarriedDefinition[],
    missing: string[],
    beforeWrite: () => void = () => undefined,
): boolean {
    const lines = docLines(doc);
    // In the footnote popup, the editor holds one definition's text, and the
    // note is around it. The paste is planned against the whole note, so it
    // sees the names the note already uses, and its definitions go where a
    // creation press would put them in the note: the popup's text is joined
    // into the note as that footnote's own text, so a definition left in it
    // would be held inside the footnote. Planned against the popup's text
    // alone, the paste kept a name the note already used, and the note got
    // a second definition of it (hunt 2026-10-02, round 4, cluster U6, pin
    // bug-carry-paste-into-popup-ignores-note). Elsewhere the note is the
    // editor's own text.
    const popup = footnotePopupSection(doc);
    const noteLines = popup ? popup.note.split("\n") : lines;
    const toNote = popup ? popup.toNote : (pos: EditorPosition) => pos;
    // the text as it reads in the note: in the popup, each line after the
    // first carries the indent the popup's lines get there
    const inNote = (text: string) => (popup ? text.replace(/\n/g, `\n${popup.indent}`) : text);
    const fromNote = (text: string) => (popup ? text.split(`\n${popup.indent}`).join("\n") : text);
    const [noteFrom, noteTo] = [toNote(from), toNote(to)];
    // The paste is planned against the note as it reads once the selection
    // is gone. A definition the paste deletes is then not one the note
    // "already has" to reuse, and a name only the deleted text used is free
    // again (hunt 2026-10-02, pin
    // bug-carry-paste-over-selection-holding-definitions: Ctrl+A and paste
    // pointed the pasted reference at the definition it was deleting).
    const cleared = simulateChanges(noteLines, [{ from: noteFrom, to: noteTo, text: "" }]);
    // The whole clipboard is asked, pasted as it is, which is what the
    // editor would do: a clipboard of definition lines alone has nothing in
    // front of them, so only this can find it in a code block. A text of
    // several lines pasted into inline code or math breaks out of it, so the
    // plugin lands it, and the result gate refuses that paste as one that
    // puts footnotes in protected text. The text in front of the definitions
    // used to be asked too, and such a paste was left to the editor, whose
    // raw paste could define a name twice (subtraction pass 2026-10-08;
    // hunt 2026-10-06 cycle 4, cluster K7, pin
    // spec-raw-paste-into-inline-code-escapes-span).
    if (landsInProtectedText(cleared, noteFrom, inNote(normalizeEol(pasted).text))) return false;
    // The body is planned where it lands, with any blank line in front of
    // it and after it already there: the planner reads its footnotes in
    // place (renames only change names, so the blank lines asOwnParagraph
    // wants are the same before and after them). The blank line after the
    // text is there so that a label right under the text stays a
    // definition; planned without it, the planner read that label as more
    // of the text's paragraph (a lazy label), so a paste right above its
    // own definition added a renamed copy instead of reusing it, and one
    // right above the shown copy of a name defined twice was pointed at
    // the hidden first copy (hunt 2026-10-06 cycle 4, cluster K1, pin
    // bug-paste-planner-reads-label-lazy).
    const selected = noteFrom.line !== noteTo.line || noteFrom.ch !== noteTo.ch;
    const landing = asOwnParagraph(cleared, noteFrom, inNote(body), selected ? noteLines : cleared);
    const after = landing.after;
    const plan = planCarriedPaste(cleared.join("\n"), landing.text + inNote(after), carried, noteFrom);
    // a text that carries nothing is only landed to rename a definition of
    // its own; with nothing to rename, the paste is the editor's own
    if (carried.length === 0 && plan.renamed === 0) return false;
    // the pasted text as the editor gets it, and as the note reads it, the
    // blank line after it taken back off: it goes in as an edit of its own
    const text = fromNote(plan.body.slice(0, plan.body.length - inNote(after).length));
    // a blank line after the text goes in as an edit of its own, so the
    // caret can land at the end of the text, before it
    const editsAt = (start: EditorPosition, end: EditorPosition, inserted: string, blank: string): EditorChange[] =>
        blank ? [{ from: start, to: end, text: inserted }, { from: end, text: blank }] : [{ from: start, to: end, text: inserted }];
    const edits = editsAt(from, to, text, after);
    const noteEdits = editsAt(noteFrom, noteTo, inNote(text), inNote(after));
    let changes: EditorChange[] = noteEdits;
    let noteAfter: string[] | null = null;
    // For the result gate: where the pasted text and its blank line after
    // sit in the note after the paste, and the lines the carried
    // definitions take there (null when the paste adds none). Without
    // definitions the pasted text starts where the paste does.
    let landed: NoteRange = { from: noteFrom, to: endOf(noteFrom, inNote(text) + inNote(after)) };
    let appended: NoteRange | null = null;
    let end = endOf(from, text);
    if (plan.definitions.length > 0) {
        // where a creation press would put a definition, seeded with the
        // first carried block's body and extended with the rest, planned
        // against the note with the text already pasted, all in the same
        // transaction as the text; the caret goes right after the pasted
        // text, wherever the definitions pushed it (hunt 2026-10-02, pin
        // bug-carry-paste-caret-before-append). The other blocks go in
        // under the first one as the clipboard text has them (carriedLines),
        // so a block that needs a blank line in front gets it here too.
        const [first] = plan.definitions;
        // in the popup, its text stays whole: the definitions go after all
        // of it, its empty last lines included
        const popupStart = popup ? toNote({ line: 0, ch: 0 }).line : 0;
        const append = planDefinitionAppend({
            lines: noteLines,
            edits: noteEdits,
            footnoteId: first.name,
            plugin,
            body: blockBody(first),
            moreDefinitionLines: carriedLines(plan.definitions).slice(first.lines.length),
            whole: popup ? { from: popupStart, to: popupStart + simulateChanges(lines, edits).length - 1 } : undefined,
        });
        changes = append.changes;
        noteAfter = append.final;
        // The definitions can go in above the pasted text (under a
        // definition block in the middle of the note) and push it down, so
        // both are taken from the append's own positions in the note after
        // the paste. Measured in the note before the definitions went in,
        // the gate left out the wrong lines as the paste's own, and a link
        // or code span below them read as gone (hunt 2026-10-09 cycle 8,
        // pin bug-carried-paste-below-mid-note-definitions-refused).
        landed = { from: append.edits[0].start, to: append.edits[append.edits.length - 1].end };
        // from the section heading the append writes above a first
        // footnote, when it writes one (DefinitionAppendPlan's heading), to
        // the end of the last carried definition
        appended = {
            from: { line: append.heading.length > 0 ? append.heading[0].from.line : append.labelLine, ch: 0 },
            to: { line: append.labelLine + carriedLines(plan.definitions).length, ch: 0 },
        };
        // in the popup the definitions land outside its text, so the caret
        // there stays right after the pasted text
        if (!popup) end = append.edits[0].end;
    }
    // In the popup, the definitions go into the note around the popup's
    // text, and the pasted text into the popup's editor. A note that does
    // not come apart that way, with the popup's new text whole in it, is
    // left alone, and the paste is the editor's own.
    const around = popup
        ? popup.around((noteAfter ?? simulateChanges(noteLines, noteEdits)).join("\n"), simulateChanges(lines, edits).join("\n"))
        : null;
    if (popup && !around) return false;
    const finalNote = noteAfter ?? simulateChanges(noteLines, noteEdits);
    const verdict = judgeEdit(noteLines, finalNote, pasteIntent(finalNote, { from: noteFrom, to: noteTo }, landed, appended, plan.definitions));
    if (!verdict.pass) {
        showNotice(verdict.reason === "nested" ? PasteNestedNotice : verdict.reason === "protected" ? PasteProtectedNotice : PasteReadsDifferentlyNotice, 8000);
        return true;
    }
    beforeWrite();
    around?.();
    // through the shared write-back, so a folded section the definitions
    // go into stays folded and a second pane on the note stays where it
    // was, as after a cut (hunt 2026-10-02, round 4, cluster U2, pin
    // bug-convert-paste-skip-shared-write-back); the edits are handed over
    // as offsets into the note as it is now, in document order. In the
    // popup only the pasted text goes into its editor, and the folds and
    // panes are the note's, not the popup's, so none are handed over.
    const offsetChanges = (popup ? edits : changes)
        .map((change) => ({ from: doc.posToOffset(change.from), to: doc.posToOffset(change.to ?? change.from), text: change.text }))
        .sort((x, y) => x.from - y.from);
    const mdView = popup ? undefined : (plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined);
    writeChanges(doc, lines.join("\n"), offsetChanges, mdView, { from: end });

    // The counts read in a fixed order, added, reused, matched, renamed,
    // and a zero is left out rather than said, so the usual paste reads
    // "4 added." and stays short enough to finish reading before the
    // toast goes; a familiar eye still scans the same order (Jason's pick
    // A, 2026-09-25). "Matched" is a carried definition whose text the
    // note already had under another name, so the reference took that
    // name and nothing was added.
    // A text that carries nothing brings only the definitions in its own
    // text, and is landed only when some of them were renamed: those are
    // the ones it counts.
    const total = carried.length > 0 ? plan.added + plan.reused : plan.renamed;
    const matched = plan.repointed;
    const counts: [number, string][] = [
        [plan.added, "added"],
        [plan.reused - matched, "reused"],
        [matched, `matched ${matched === 1 ? "an existing footnote" : "existing footnotes"} (same definition, different name)`],
        [plan.renamed, "renamed"],
    ];
    const said = counts
        .filter(([count]) => count > 0)
        .map(([count, what]) => `${count} ${what}`)
        .join(", ");
    let notice = `Pasted with ${total} footnote definition${total === 1 ? "" : "s"}: ${said}.`;
    if (missing.length > 0) {
        // a reference renamed out of the way of a footnote the note defines
        // is named by its new name (Jason's ruling X10, 2026-10-07)
        const named = missing.map((name) => plan.renamedCites.get(name.toLowerCase()) ?? name);
        notice += ` ${named.map(quotedReference).join(", ")} ${named.length === 1 ? "has" : "have"} no definition to carry.`;
    }
    showNotice(notice, missing.length > 0 ? 8000 : undefined);
    // the note as the paste left it, which in the popup is not the editor's text
    lintAfterPaste(plugin, doc, () => (popup ? (noteAfter ?? simulateChanges(noteLines, noteEdits)).join("\n") : doc.getValue()));
    return true;
}

/** Where `text` ends when it is written at `start`. */
function endOf(start: EditorPosition, text: string): EditorPosition {
    const lines = text.split("\n");
    return lines.length === 1 ? { line: start.line, ch: start.ch + text.length } : { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
}

/**
 * What a carried paste means to change, for the result gate: to take out
 * the selection `replaced` (when there is one), a stretch of the note
 * before, and to write the pasted text, which sits at `landed` in `after`,
 * the note as the paste leaves it, and the carried `definitions`, which
 * take the lines `appended` of `after` (null when it adds none), under the
 * section heading that starts there when the paste writes one. The
 * definitions come from the clipboard and the heading from the settings, so
 * their lines are text the paste writes in too.
 */
function pasteIntent(after: string[], replaced: NoteRange, landed: NoteRange, appended: NoteRange | null, definitions: readonly CarriedDefinition[]): EditIntent {
    const inserted: NoteRange[] = [landed];
    const created: CreatedFootnote[] = [];
    if (appended !== null) {
        inserted.push(appended);
        // each block's label at the margin, after the block before it
        let from = appended.from.line;
        for (const block of definitions) {
            let line = after.findIndex((text, i) => i >= from && text.startsWith(`[^${block.name}]:`));
            if (line === -1) line = from;
            created.push({ kind: "footnote", name: block.name, references: [], definition: { line, lines: block.lines.length } });
            from = line + block.lines.length;
        }
    }
    const selected = replaced.from.line !== replaced.to.line || replaced.from.ch !== replaced.to.ch;
    return { created, insertedText: inserted, ...(selected ? { removedText: [replaced] } : {}) };
}

/**
 * After a paste that landed footnotes: the lint on footnote creation, as
 * after every press that creates a footnote, or its alerts when that
 * trigger is off.
 *
 * A footnote-prefix the plugin cannot use cancels the lint, and the lint
 * then says nothing, because a press under such a prefix has already
 * refused and said why. A paste does not need the prefix and lands anyway,
 * so nothing had said anything: the paste gives the reason the lint was
 * canceled, as a save does (ADR 0002, the lint is never silent; hunt
 * 2026-10-02, pin bug-paste-invalid-prefix-lint-silent).
 */
function lintAfterPaste(plugin: FootnotePlugin, doc: Editor, note: () => string): void {
    if (lintAfterFootnoteCreation(plugin, doc, false) !== null) return;
    if (!plugin.settings.lintOnFootnoteCreation) {
        // no lint ran, so the orphan alerts speak even while their delete
        // toggles are on: a paste over the only reference to a footnote
        // leaves its definition behind, and nothing else would say so
        // (found while fixing, 2026-10-06, pin bug-paste-orphan-unreported)
        noticeLintAlerts(plugin, note(), false);
        return;
    }
    if (lintRulesAllDisabled(plugin)) return;
    const blocked = lintBlockedByPrefix(note(), plugin.settings.enableFootnotePrefix);
    if (blocked) showNotice(blocked, 8000);
}

/**
 * `text`, as it should be pasted at `at` into `lines` so that it stays its
 * own paragraph next to the definitions around it.
 *
 * Above: a paste on the empty line right under a definition would read as
 * that definition's lazy continuation (a line that carries on the
 * paragraph above it without being indented), so the text vanishes into
 * the footnote and the references in it are nested (hunt 2026-10-02, pin
 * bug-carry-paste-below-last-definition-lazy; ADR 0001). The text then
 * gets a blank line in front: the paste-shaped twin of the blank line a
 * new definition gets when text follows it (the swallowed-prose bug, 2026-07-20). A
 * paste made inside a definition, and a pasted text that starts with a
 * definition label of its own, are where the user put them and get
 * nothing.
 *
 * Below: a definition label right under the pasted text would read as
 * more of its paragraph (a lazy label), and that footnote would lose its
 * definition. The text then gets a blank line after it too (2026-10-03,
 * the same paste on the empty line between two definitions). The label
 * that ends up under the text is the one on the line below the caret, or,
 * when the caret sits in front of a label on its own line and the text
 * ends its own line, that label: a cut that takes a definition out leaves
 * the caret at the start of the next label, and pasting there turned that
 * definition into lazy text (hunt 2026-10-06 cycle 3, cluster M5, pin
 * bug-paste-above-label-makes-it-lazy).
 *
 * Whether the paste is made inside a definition is asked of `original`,
 * the note before the paste's selection is cleared, where the caret still
 * sits in the text around it. Asked of the note with the selection
 * cleared, a selection from the start of a footnote's second line through
 * the paragraph citing it left the caret on an empty line, outside the
 * footnote, and a paste of that very text back over it split the footnote
 * into two paragraphs (hunt 2026-10-06 cycle 4, cluster RT1, pin
 * bug-paste-over-selection-from-definition-continuation). A caret in front
 * of a label on its own line is not inside that definition: the text lands
 * before the label, and right under another definition it would carry on
 * that one's paragraph (hunt 2026-10-06 cycle 4, cluster K3, pin
 * bug-paste-before-label-under-definition).
 *
 * Returns the text with any blank line in front already added, and in
 * `after` the blank line to add after it ("" for none).
 */
function asOwnParagraph(lines: string[], at: EditorPosition, text: string, original: string[]): { text: string; after: string } {
    const before = contextOfLines(lines);
    const landed = (pasted: string) => contextOfLines(simulateChanges(lines, [{ from: at, text: pasted }]));
    // a paste with no selection has nothing to clear, so its note is read once
    const madeInside = (original === lines ? before : contextOfLines(original))
        .reading()
        .definitions.some((definition) => definition.start <= at.line && at.line <= definition.end && !(definition.start === at.line && at.ch <= definition.labelStart));
    if (!madeInside) {
        const joined = landed(text);
        if (insideDefinition(joined, at.line) && joined.reading().labelOn(at.line) === null) text = "\n" + text;
    }
    // the label line the text pushes down, and the line it lands on
    const onCaretLine = before.reading().labelOn(at.line);
    const pushed = text.endsWith("\n") && onCaretLine !== null && onCaretLine.labelStart >= at.ch ? at.line : at.line + 1;
    const demotes =
        pushed < lines.length &&
        before.reading().labelOn(pushed) !== null &&
        landed(text).reading().labelOn(pushed + text.split("\n").length - 1) === null;
    return { text, after: demotes ? "\n" : "" };
}

/**
 * A carried block's text after its label, continuation lines joined with
 * newlines, the way seedDefinitionBody wants a body. Every carried block
 * starts with its label, because it was lifted to the top level when it
 * was carried (liftedBlocks in carry-footnotes.ts), so the first block is
 * read the same way as every other.
 */
function blockBody(block: CarriedDefinition): string {
    const first = block.lines[0];
    const head = first.slice(first.indexOf("]:") + 2).replace(/^ /, "");
    return [head, ...block.lines.slice(1)].join("\n");
}

/** An Obsidian command as its registry holds it, for the one field this file replaces. */
interface EditorCommand {
    editorCallback?: (editor: Editor, context: unknown) => unknown;
}

/**
 * Obsidian's own Cut, Copy, and Paste commands on a phone ("editor:cut",
 * "editor:copy", "editor:paste", the mobile toolbar's buttons) talk to the
 * clipboard directly, through navigator.clipboard, so no clipboard event
 * fires and the hooks above never hear them: footnote definitions did not
 * travel (found 2026-10-04, read off Obsidian 1.14's app.js; Jason chose to
 * carry them, option 2). So each command's action is wrapped: when the
 * selection needs a definition (a copy or a cut) or the clipboard carries
 * some (a paste), the plugin does the carrying, the same way as the hooks;
 * otherwise, and whenever the carry setting is off, a table cell's editor
 * holds the focus, or anything goes wrong before the carry has written,
 * Obsidian's own action runs as it would have. Unloading the plugin puts
 * the original actions back.
 *
 * The command registry is not part of Obsidian's documented API, so every
 * step checks what it finds: a command that is missing (a desktop
 * registers none of the three) or has no action of the expected shape is
 * left alone.
 */
export function wrapClipboardCommands(plugin: FootnotePlugin): void {
    const registry = (plugin.app as unknown as { commands?: { commands?: Record<string, EditorCommand | undefined> } }).commands?.commands;
    const carries = (doc: Editor) => plugin.settings.carryFootnotesOnCopy && !nestedSubEditorOwnsFocus(doc);
    wrapCommand(plugin, registry?.["editor:copy"], async (doc, wrote) => {
        const range = carries(doc) ? singleSelection(doc) : null;
        const text = range && carriedCopyText(doc, range.from, range.to);
        if (!text) return false;
        await navigator.clipboard.writeText(text);
        wrote();
        return true;
    });
    wrapCommand(plugin, registry?.["editor:cut"], async (doc, wrote) => {
        const range = carries(doc) ? singleSelection(doc) : null;
        const before = doc.getValue();
        const cut = range && plannedCut(plugin, doc, range.from, range.to);
        if (!cut) return false;
        // refused: nothing is cut or copied, and the editor's own cut does
        // not run either
        if (cut === "refused") return true;
        await navigator.clipboard.writeText(cut.text);
        wrote();
        // the note changed while the clipboard was written: cutting by the
        // old plan could take the wrong text, so the clipboard holds the
        // copy and the note is left as it is
        if (doc.getValue() === before) cut.make();
        return true;
    });
    wrapCommand(plugin, registry?.["editor:paste"], async (doc, wrote) => {
        if (!carries(doc)) return false;
        return landPastedText(plugin, doc, await navigator.clipboard.readText(), wrote);
    });
}

/**
 * Replace `command`'s action with one that tries `carry` first and falls
 * back to the original; the original comes back on unload.
 *
 * The fallback runs only while nothing has been written. `carry` calls
 * `wrote` once the clipboard holds its text (after that write succeeds,
 * since a write that failed changed nothing) and right before it changes
 * the note. An error after that point is logged and the command ends
 * there: running Obsidian's own action on top of a carry that had already
 * written pasted the text a second time, or ran Obsidian's cut on the
 * emptied selection and wrote "" over the clipboard that held the cut
 * text (hunt 2026-10-05, pin bug-wrapped-command-fallback-after-write).
 */
function wrapCommand(plugin: FootnotePlugin, command: EditorCommand | undefined, carry: (doc: Editor, wrote: () => void) => Promise<boolean>): void {
    const original = command?.editorCallback;
    if (!command || typeof original !== "function") return;
    const wrapped = async (editor: Editor, context: unknown): Promise<unknown> => {
        let carried = false;
        // an object, so the type checker sees that the callback can change it
        const progress = { written: false };
        try {
            carried = await carry(editor, () => {
                progress.written = true;
            });
        } catch (error) {
            if (progress.written) {
                console.error("Footnote Shortcut: carrying footnotes failed after it wrote, so the plain command does not run", error);
                return undefined;
            }
            console.error("Footnote Shortcut: carrying footnotes failed, so the plain command runs", error);
        }
        return carried ? undefined : original.call(command, editor, context);
    };
    command.editorCallback = wrapped;
    plugin.register(() => {
        if (command.editorCallback === wrapped) command.editorCallback = original;
    });
}

/** Install the three hooks. Copy bubbles (after the editor's own), cut captures (before it), paste is Obsidian's event. */
export function installCarryFootnoteHooks(plugin: FootnotePlugin): void {
    plugin.registerDomEvent(document, "copy", (event) => {
        handleCopy(plugin, event);
    });
    plugin.registerDomEvent(document, "cut", (event) => {
        handleCut(plugin, event);
    }, { capture: true });
    plugin.registerEvent(
        plugin.app.workspace.on("editor-paste", (evt, editor) => {
            if (evt.defaultPrevented) return;
            if (handlePaste(plugin, evt, editor)) evt.preventDefault();
        }),
    );
    // text a phone keyboard's clipboard history commits through the input
    // method (see carriedInputHandler)
    plugin.registerEditorExtension(
        EditorView.inputHandler.of(carriedInputHandler(plugin, (view) => editorOwning(plugin, view))),
    );
}
