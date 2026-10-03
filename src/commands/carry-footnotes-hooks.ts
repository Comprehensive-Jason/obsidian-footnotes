import { EditorView } from "@codemirror/view";
import { Editor, EditorChange, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { docLines } from "../editor/doc-context";
import { showNotice } from "../editor/notice";
import { codeMirrorViewOf, readingViewActive, viewEditor } from "../editor/obsidian-internals";
import { activeTableCellEditor } from "../editor/table-cursor";
import { replaceMinimal } from "../editor/write-back";
import { noticeLintAlerts } from "../linting/lint-alerts";
import { lintAfterFootnoteCreation, withEmptySectionHeadingRemoved } from "../linting/linter";
import { quotedReference } from "../parsing/footnote-grammar";
import { normalizeEol, removeLineRanges, restoreEol } from "../parsing/markdown-scan";
import {
    CarriedDefinition,
    carriedDefinitions,
    definitionsOrphanedByCut,
    planCarriedPaste,
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
// (the editor's own cut would write the bare text) or the deletion
// orphans one: the selection AND the definitions it orphaned leave the
// note in one transaction. A definition still used elsewhere stays, and
// only its copy travels.
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

/** The single, non-empty selection of the note being edited, or null when the feature is off, no editor is active, the view is Reading view, a table cell owns focus, or the selection is empty or multiple. */
function carryableSelection(plugin: FootnotePlugin): { doc: Editor; from: EditorPosition; to: EditorPosition } | null {
    if (!plugin.settings.carryFootnotesOnCopy) return null;
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = mdView && viewEditor(mdView);
    if (!mdView || !doc || readingViewActive(mdView)) return null;
    if (activeTableCellEditor(doc)) return null;
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

/** Remember what the selection needs, and return it with the editor and the range. Null when there is nothing to remember. */
function remember(plugin: FootnotePlugin): { doc: Editor; from: EditorPosition; to: EditorPosition; entry: CarryRegister } | null {
    const selection = carryableSelection(plugin);
    if (!selection) return null;
    const { doc, from, to } = selection;
    const body = textBetween(doc, from, to);
    const { carried, missing } = carriedDefinitions(doc.getValue(), from, to);
    const entry = { text: withCarriedText(body, carried), body, carried, missing };
    register = entry;
    return { doc, from, to, entry };
}

/**
 * The copy hook (a bubbling document listener, so it runs after the
 * editor's own copy has written the clipboard and can override the text).
 * A selection that needs no definition is left to the editor.
 */
export function handleCopy(plugin: FootnotePlugin, event: ClipboardEvent): void {
    const remembered = remember(plugin);
    if (!remembered || remembered.entry.carried.length === 0 || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", remembered.entry.text);
    event.preventDefault();
}

/**
 * The cut hook (a capturing document listener, so it runs before the
 * editor's own cut and can take the event over). It takes over when the
 * selection needs a definition or the deletion orphans one; a cut that
 * needs neither is the editor's own.
 */
export function handleCut(plugin: FootnotePlugin, event: ClipboardEvent): void {
    const remembered = remember(plugin);
    if (!remembered || !event.clipboardData) return;
    const { doc, from, to, entry } = remembered;
    const before = doc.getValue();
    const orphaned = definitionsOrphanedByCut(before, from, to);
    if (entry.carried.length === 0 && orphaned.length === 0) return;
    event.clipboardData.setData("text/plain", entry.text);
    event.preventDefault();
    event.stopPropagation();
    // the note as it reads without the selection and without the orphaned
    // blocks, written back as the smallest set of edits in one transaction
    const { text: normalised, eol } = normalizeEol(before);
    const lines = normalised.split("\n");
    const joined = [
        ...lines.slice(0, from.line),
        lines[from.line].slice(0, from.ch) + lines[to.line].slice(to.ch),
        ...lines.slice(to.line + 1),
    ];
    // the orphaned blocks were reported in the note's own line numbers;
    // after the deletion the lines below the selection sit higher up
    const shift = to.line - from.line;
    const ranges = orphaned.map((block) => ({
        start: block.start < from.line ? block.start : block.start - shift,
        end: block.end < from.line ? block.end : block.end - shift,
    }));
    // a cut that takes the last definition with it empties the section,
    // so the section heading goes too when the setting says so (Jason,
    // 2026-09-25)
    const after = withEmptySectionHeadingRemoved(plugin, restoreEol(removeLineRanges(joined, ranges).join("\n"), eol));
    replaceMinimal(doc, before, after, plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined);
    doc.setCursor(from);
    if (orphaned.length > 0) {
        const count = orphaned.length;
        showNotice(`Cut with ${count} footnote definition${count === 1 ? "" : "s"} that nothing else used; paste to carry ${count === 1 ? "it" : "them"} along.`);
    }
}

/**
 * The paste hook, on Obsidian's editor-paste event. Takes the paste over
 * when the text matches the register or ends in definition lines; leaves
 * every other paste, and one another plugin already handled, alone.
 * Returns whether it took the paste over.
 */
export function handlePaste(plugin: FootnotePlugin, event: ClipboardEvent, doc: Editor): boolean {
    if (event.defaultPrevented || !plugin.settings.carryFootnotesOnCopy || !event.clipboardData) return false;
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
    if (activeTableCellEditor(doc)) return false;
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
        if (!doc || activeTableCellEditor(doc)) return false;
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
    const plan = planCarriedPaste(doc.getValue(), body, carried);
    const edits = [{ from, to, text: plan.body }];
    let changes: EditorChange[] = edits;
    const bodyLines = plan.body.split("\n");
    let end: EditorPosition =
        bodyLines.length === 1
            ? { line: from.line, ch: from.ch + plan.body.length }
            : { line: from.line + bodyLines.length - 1, ch: bodyLines[bodyLines.length - 1].length };
    if (plan.definitions.length > 0) {
        // where a creation press would put a definition, seeded with the
        // first carried block's body and extended with the rest, planned
        // against the note with the text already pasted, all in the same
        // transaction as the text; the caret goes right after the pasted
        // text, wherever the definitions pushed it (hunt 2026-10-02, pin
        // bug-carry-paste-caret-before-append)
        const [first, ...rest] = plan.definitions;
        const append = planDefinitionAppend({
            lines: docLines(doc),
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
    if (lintAfterFootnoteCreation(plugin, false) === null && !plugin.settings.lintOnFootnoteCreation) {
        noticeLintAlerts(plugin, doc.getValue());
    }
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
