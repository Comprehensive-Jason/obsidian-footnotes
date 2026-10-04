import { EditorView } from "@codemirror/view";
import { Editor, EditorChange, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { contextOfLines, docLines, insideDefinition } from "../editor/doc-context";
import { simulateChanges } from "../editor/insertion-liveness";
import { showNotice } from "../editor/notice";
import { codeMirrorViewOf, readingViewActive, viewEditor } from "../editor/obsidian-internals";
import { nestedSubEditorOwnsFocus } from "../editor/table-cursor";
import { replaceMinimal } from "../editor/write-back";
import { noticeLintAlerts } from "../linting/lint-alerts";
import { lintAfterFootnoteCreation, withEmptySectionHeadingRemoved } from "../linting/linter";
import { quotedReference } from "../parsing/footnote-grammar";
import { normalizeEol, restoreEol } from "../parsing/line-edits";
import {
    CarriedDefinition,
    CarriedDefinitions,
    carriedDefinitions,
    planCarriedPaste,
    planCut,
    splitCarriedText,
    withCarriedText,
} from "./carry-footnotes";
import { planDefinitionAppend } from "./definition-append";

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

/** What the last copy or cut from this window took with it. */
export interface CarryRegister {
    /** the clipboard text as written: the body, then the carried blocks */
    text: string;
    /** the selection alone */
    body: string;
    carried: CarriedDefinition[];
    missing: string[];
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
 * The unit tests' stand-in editor has no CodeMirror view, and then there
 * is nothing to ask, so the event counts.
 */
function eventInEditorText(doc: Editor, event: Event): boolean {
    const content = codeMirrorViewOf(doc)?.contentDOM;
    if (!content) return true;
    const target = event.target ?? content.ownerDocument.activeElement;
    return !!target && content.contains(target as Node) && !nestedSubEditorOwnsFocus(doc);
}

/** The single, non-empty selection of the note being edited, or null when the feature is off, no editor is active, the view is Reading view, the event happened outside the note's own text (eventInEditorText), or the selection is empty or multiple. */
function carryableSelection(plugin: FootnotePlugin, event: Event): { doc: Editor; from: EditorPosition; to: EditorPosition } | null {
    if (!plugin.settings.carryFootnotesOnCopy) return null;
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = mdView && viewEditor(mdView);
    if (!mdView || !doc || readingViewActive(mdView)) return null;
    if (!eventInEditorText(doc, event)) return null;
    const selections = doc.listSelections();
    if (selections.length !== 1) return null;
    const [a, b] = [selections[0].anchor, selections[0].head];
    const before = a.line < b.line || (a.line === b.line && a.ch <= b.ch);
    const [from, to] = before ? [a, b] : [b, a];
    if (from.line === to.line && from.ch === to.ch) return null;
    return { doc, from, to };
}

/** The text between two positions, read line by line (the fake editor has no getRange). */
function textBetween(doc: Editor, from: EditorPosition, to: EditorPosition): string {
    if (from.line === to.line) return doc.getLine(from.line).slice(from.ch, to.ch);
    const parts = [doc.getLine(from.line).slice(from.ch)];
    for (let line = from.line + 1; line < to.line; line++) parts.push(doc.getLine(line));
    parts.push(doc.getLine(to.line).slice(0, to.ch));
    return parts.join("\n");
}

/** Remember what the selection between `from` and `to` carries, as the register for the paste that follows. */
function remember(doc: Editor, from: EditorPosition, to: EditorPosition, { carried, missing }: CarriedDefinitions): CarryRegister {
    const body = textBetween(doc, from, to);
    register = { text: withCarriedText(body, carried), body, carried, missing };
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
    const { doc, from, to } = selection;
    const entry = remember(doc, from, to, carriedDefinitions(doc.getValue(), from, to));
    if (entry.carried.length === 0 || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", entry.text);
    event.preventDefault();
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
    const { doc, from, to } = selection;
    const before = doc.getValue();
    // a cut that takes the last definition with it empties the section,
    // so the section heading goes too when the setting says so (Jason,
    // 2026-09-25)
    const plan = planCut(before, from, to, (text) => withEmptySectionHeadingRemoved(plugin, text));
    const entry = remember(doc, from, to, plan);
    if (entry.carried.length === 0 || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", entry.text);
    event.preventDefault();
    event.stopPropagation();
    // the note as the plan reads it, written back as the smallest set of
    // edits in one transaction, and the caret where the selection was
    replaceMinimal(doc, before, restoreEol(plan.text, normalizeEol(before).eol), plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined);
    doc.setCursor(plan.caret);
    if (plan.removed > 0) {
        const count = plan.removed;
        showNotice(`Cut with ${count} footnote definition${count === 1 ? "" : "s"} that nothing else used; paste to carry ${count === 1 ? "it" : "them"} along.`);
    }
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
    const text = event.clipboardData.getData("text/plain");
    if (!text) return false;
    let body: string;
    let carried: CarriedDefinition[];
    let missing: string[];
    if (register && normalizeEol(register.text).text === normalizeEol(text).text) {
        // the plugin's own copy: the exact blocks it remembered, and the
        // names it could not find
        ({ body, carried, missing } = register);
    } else {
        // a clipboard from anywhere that ends in definition lines
        ({ body, carried } = splitCarriedText(text));
        missing = [];
    }
    if (carried.length === 0) {
        // nothing to land, so the editor pastes as usual; a reference that
        // travelled without a definition is still worth a word
        if (missing.length > 0) {
            showNotice(`${missing.map(quotedReference).join(", ")} ${missing.length === 1 ? "has" : "have"} no definition to carry.`, 8000);
        }
        return false;
    }
    const selections = doc.listSelections();
    if (selections.length !== 1) return false;
    const [a, b] = [selections[0].anchor, selections[0].head];
    const [from, to] = a.line < b.line || (a.line === b.line && a.ch <= b.ch) ? [a, b] : [b, a];
    event.preventDefault();
    landCarriedText(plugin, doc, from, to, body, carried, missing);
    return true;
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
 * toast and lint. `editorFor` turns the CodeMirror view into the Obsidian
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
        if (!plugin.settings.carryFootnotesOnCopy || !text.includes("\n")) return false;
        const { body, carried } = splitCarriedText(text);
        if (carried.length === 0) return false;
        const doc = editorFor(view);
        if (!doc || nestedSubEditorOwnsFocus(doc)) return false;
        landCarriedText(plugin, doc, doc.offsetToPos(from), doc.offsetToPos(to), body, carried, []);
        return true;
    };
}

/** The Obsidian editor whose CodeMirror view is `view`, or null when no open note owns it. */
function editorOwning(plugin: FootnotePlugin, view: EditorView): Editor | null {
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
 */
function landCarriedText(
    plugin: FootnotePlugin,
    doc: Editor,
    from: EditorPosition,
    to: EditorPosition,
    body: string,
    carried: CarriedDefinition[],
    missing: string[],
): void {
    const lines = docLines(doc);
    // The paste is planned against the note as it reads once the selection
    // is gone. A definition the paste deletes is then not one the note
    // "already has" to reuse, and a name only the deleted text used is free
    // again (hunt 2026-10-02, pin
    // bug-carry-paste-over-selection-holding-definitions: Ctrl+A and paste
    // pointed the pasted reference at the definition it was deleting).
    const cleared = simulateChanges(lines, [{ from, to, text: "" }]);
    const plan = planCarriedPaste(cleared.join("\n"), body, carried);
    const { text, after } = asOwnParagraph(cleared, from, plan.body);
    // a blank line after the text goes in as an edit of its own, so the
    // caret can land at the end of the text, before it
    const edits: EditorChange[] = after ? [{ from, to, text }, { from: to, text: after }] : [{ from, to, text }];
    let changes: EditorChange[] = edits;
    const textLines = text.split("\n");
    let end: EditorPosition =
        textLines.length === 1
            ? { line: from.line, ch: from.ch + text.length }
            : { line: from.line + textLines.length - 1, ch: textLines[textLines.length - 1].length };
    if (plan.definitions.length > 0) {
        // where a creation press would put a definition, seeded with the
        // first carried block's body and extended with the rest, planned
        // against the note with the text already pasted, all in the same
        // transaction as the text; the caret goes right after the pasted
        // text, wherever the definitions pushed it (hunt 2026-10-02, pin
        // bug-carry-paste-caret-before-append)
        const [first, ...rest] = plan.definitions;
        const append = planDefinitionAppend({
            lines,
            edits,
            footnoteId: first.name,
            plugin,
            body: blockBody(first),
            moreDefinitionLines: rest.flatMap((block) => block.lines),
        });
        changes = append.changes;
        end = append.edits[0].end;
    }
    doc.transaction({ changes, selection: { from: end } });

    // The counts read in a fixed order, added, reused, matched, renamed,
    // and a zero is left out rather than said, so the usual paste reads
    // "4 added." and stays short enough to finish reading before the
    // toast goes; a familiar eye still scans the same order (Jason's pick
    // A, 2026-09-25). "Matched" is a carried definition whose text the
    // note already had under another name, so the reference took that
    // name and nothing was added.
    const total = plan.added + plan.reused;
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
        notice += ` ${missing.map(quotedReference).join(", ")} ${missing.length === 1 ? "has" : "have"} no definition to carry.`;
    }
    showNotice(notice, missing.length > 0 ? 8000 : undefined);
    if (lintAfterFootnoteCreation(plugin, doc, false) === null && !plugin.settings.lintOnFootnoteCreation) {
        noticeLintAlerts(plugin, doc.getValue());
    }
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
 * new definition gets when text follows it (the A4 bug, 2026-07-20). A
 * paste made inside a definition, and a pasted text that starts with a
 * definition label of its own, are where the user put them and get
 * nothing.
 *
 * Below: a definition label right under the pasted text would read as
 * more of its paragraph (a lazy label), and that footnote would lose its
 * definition. The text then gets a blank line after it too (2026-10-03,
 * the same paste on the empty line between two definitions).
 *
 * Returns the text with any blank line in front already added, and in
 * `after` the blank line to add after it ("" for none).
 */
function asOwnParagraph(lines: string[], at: EditorPosition, text: string): { text: string; after: string } {
    const before = contextOfLines(lines);
    const landed = (pasted: string) => contextOfLines(simulateChanges(lines, [{ from: at, text: pasted }]));
    if (!insideDefinition(before, at.line)) {
        const joined = landed(text);
        if (insideDefinition(joined, at.line) && joined.reading().labelOn(at.line) === null) text = "\n" + text;
    }
    const below = at.line + 1;
    const demotes =
        below < lines.length &&
        before.reading().labelOn(below) !== null &&
        landed(text).reading().labelOn(below + text.split("\n").length - 1) === null;
    return { text, after: demotes ? "\n" : "" };
}

/** A carried block's text after its label, continuation lines joined with newlines, the way seedDefinitionBody wants a body. */
function blockBody(block: CarriedDefinition): string {
    const first = block.lines[0];
    const label = first.indexOf("]:");
    const head = label === -1 ? first : first.slice(label + 2).replace(/^ /, "");
    return [head, ...block.lines.slice(1)].join("\n");
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
