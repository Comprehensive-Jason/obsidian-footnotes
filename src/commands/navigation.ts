import { Editor, EditorPosition } from "obsidian";

import type FootnotePlugin from "../main";
import { moveCursorAndSetJumpPoint } from "../editor/cursor-motion";
import {
    DocContext,
    docContext,
    listExistingFootnoteDefinitions,
    referenceOccurrenceAtCursor,
} from "../editor/doc-context";
import {
    definitionLabelWithName,
    idListIncludes,
    referenceOccurrences,
} from "../parsing/footnote-grammar";
import { openFootnotePopup, popupEditingAvailable } from "./footnote-popup";

import { addReferenceOrDeleteDefinition, showNotice } from "../editor/notice";
// The jump half of the decision cascade. From a definition it jumps to the
// first reference; from a reference it jumps to its definition, or opens the
// popup editor when that setting is on.
//
// This file imports the popup but never the linter, so that the linter can
// depend on jumps without the two importing each other in a circle. Split
// out of the all-in-one commands file 2026-08-11.

/** Cascade step 1: with the caret on a definition line, jump to the first place that footnote is referenced. Returns whether it handled the press. */
export function shouldJumpFromDefinitionToReference(
    lineText: string,
    cursorPosition: EditorPosition,
    plugin: FootnotePlugin,
    doc: Editor,
    ctx?: DocContext,
): boolean {
    // work out whether the caret is inside a definition: its label line or
    // any line of its body, wherever the definition sits (at the top level,
    // in a quote or callout, or in a list item: Jason's ruling 1, option a,
    // 2026-10-03). If it is, jump back to the footnote's reference in the
    // text. That matters on the definition's last line above all, because
    // jumping to a definition parks the caret there on purpose, and
    // pressing the hotkey there used to insert a new footnote instead of
    // jumping back (bug reported 2026-07-17).
    //
    // A blank line carries nothing to jump from. Inside a definition the
    // press refuses there instead (warnDefinitionCaretIfInside, GLM sweep
    // 2026-09-13), and anywhere else it creates as usual.
    if (lineText.trim() === "") return false;

    // #41: a "[^x]:" inside a code block is not a definition, and a
    // reference inside code is not somewhere to jump to. The note reading
    // knows both, and the press builds it anyway for its guards.
    ctx ??= docContext(doc);
    const lines = ctx.lines;
    const line = cursorPosition.line;
    let definitionName: string | null = ctx.reading().definitionAt(line)?.name ?? null;
    // the line whose own "[^x]" must not count as the reference to jump
    // to: a lazy label's, since its label reads as a reference
    let ownLabelLine = -1;
    if (definitionName === null) {
        // A LAZY label: a "[^x]:" line directly under prose, which
        // Obsidian reads as paragraph text. The user almost certainly
        // meant a definition and lost the blank line, so a press here
        // behaves as on a real definition label: it jumps to the
        // footnote's reference in the text, and never inserts (Jason's
        // ruling, 2026-09-15). Its own "[^x]" is a live reference to
        // Obsidian, so the search below skips this line.
        const hit = definitionLabelWithName(lineText, ctx.maskedLine(line));
        if (hit && !ctx.scan.isProtected[line] && !ctx.scan.inCommentBlock[line]) {
            definitionName = hit.name;
            ownLabelLine = line;
        }
    }
    if (definitionName !== null) {
        // footnote names ignore case, so a reference can be cased
        // differently from its definition's label ("[^Note]" and "[^note]:"
        // are the same footnote). Lowercase both before comparing.
        const name = definitionName.toLowerCase();
        const masked = ctx.maskedLines();

        // find the FIRST place this footnote is referenced. A label defines
        // a footnote wherever it appears; it never counts as a reference to
        // it. referenceOccurrences therefore skips a line's own label,
        // whether it starts the line or sits in a blockquote. Without that,
        // jumping could land on a blockquoted duplicate's label, a target
        // that is not really there (parallel-review probe 2026-08-10;
        // the exclusion was centralized 2026-09-08).
        const useStarts = ctx.definitionStarts();
        for (let i = 0; i < masked.length; i++) {
            if (i === ownLabelLine) continue;
            for (const use of referenceOccurrences(lines[i], masked[i], useStarts[i])) {
                if (use.name.toLowerCase() !== name) continue;
                const newCursorPos = { line: i, ch: use.end };
                moveCursorAndSetJumpPoint(doc, cursorPosition, newCursorPos, plugin, undefined, true);
                return true;
            }
        }
        // this is an orphaned definition: nothing references it anywhere.
        // Falling through from here used to insert a brand-new footnote INTO
        // the definitions area, when the user had almost certainly pressed
        // the key to jump to a reference they have since deleted. Explain
        // instead, and change nothing (QOL sweep, 2026-08-07).
        showNotice(
            `Nothing references this footnote. ${addReferenceOrDeleteDefinition(definitionName)}`,
            8000,
        );
        return true;
    }
    return false;
}

/** Move the caret to the end of the named footnote's definition, counting its indented continuation lines as part of it. */
export function jumpToFootnoteDefinition(
    footnoteName: string,
    cursorPosition: EditorPosition,
    plugin: FootnotePlugin,
    doc: Editor,
    ctx: DocContext = docContext(doc),
): boolean {
    // find the LAST definition of this name. When a note has duplicate
    // definitions, Obsidian renders only the last of them (ground-truthed
    // 2026-08-12), so jumping to an earlier one would land the user on text
    // nobody sees. The note reading leaves out definition-shaped lines
    // inside code (#41) and counts a definition wherever it sits: in a
    // blockquote or callout (C22) or in a list item (Jason's ruling 1,
    // option a, 2026-10-03). Names ignore case: the definition's label may
    // be cased differently from the reference name that sent us here.
    const folded = footnoteName.toLowerCase();
    const target = ctx.reading().definitions.filter((definition) => definition.name.toLowerCase() === folded).at(-1);
    if (target === undefined) return false;
    // land at the END of the definition, continuation lines included, so
    // the user can backspace or type without reaching for the arrow keys.
    // A walk written by hand here once stopped at runs of blank lines and
    // inside regions the definition owns, which left the caret in the
    // middle of a definition (2026-08-11 review bug #12).
    const newCursorPos = { line: target.end, ch: doc.getLine(target.end).length };
    moveCursorAndSetJumpPoint(doc, cursorPosition, newCursorPos, plugin, undefined, true);
    return true;
}

/** Cascade step 2: with the caret on a reference that HAS a definition, open the popup editor on it when that setting is on, or else jump to it. A reference with no definition returns false, so the creation step runs instead. */
export function shouldJumpFromReferenceToDefinition(
    lineText: string,
    cursorPosition: EditorPosition,
    plugin: FootnotePlugin,
    doc: Editor,
    ctx?: DocContext,
): boolean {
    // Jump from the reference to its definition: find the reference whose
    // brackets hold the cursor on this line, then put the cursor on that
    // footnote's definition line.
    //
    // The shared lookup checks the raw line before it consults the masked
    // twin. This runs on every press of both commands, and the
    // whole-document scan is slow enough to notice on large notes (perf F1,
    // the #41 re-check against the mask, and a name re-slice that survives
    // NUL characters; see referenceOccurrenceAtCursor).
    const hit = referenceOccurrenceAtCursor(lineText, cursorPosition, doc, ctx);
    if (hit === null) return false;
    ctx = hit.ctx;
    const footnoteName = hit.target.name;

    // a reference with no definition line falls through to the steps that
    // create one. Names are compared ignoring case.
    const definitions = listExistingFootnoteDefinitions(doc, ctx);
    if (!idListIncludes(definitions, footnoteName)) {
        return false;
    }

    // A footnote defined more than once: Obsidian renders the LAST
    // definition, and the jump below goes there, but the popup's embed is
    // resolved by Obsidian's own subpath lookup, which finds the FIRST one
    // (Jason's report, sheet 03, 2026-09-09). Rather than open the popup on
    // the definition that does not render, the press jumps; the duplicate
    // lint alert already says how to fix the note.
    if (popupRouteFor(plugin, definitions, footnoteName)) {
        // the popup's fallback callback runs LATER, by which time its save
        // may have edited the document, so it must build a FRESH reading of
        // the document rather than reuse this one
        void openFootnotePopup(plugin, footnoteName, () => {
            jumpToFootnoteDefinition(footnoteName, cursorPosition, plugin, doc);
        });
        return true;
    }
    return jumpToFootnoteDefinition(footnoteName, cursorPosition, plugin, doc, ctx);
}

/** Whether a press on `name`'s reference takes the popup route: the popup is on and can bind, and the footnote is defined exactly once (see shouldJumpFromReferenceToDefinition). */
export function popupRouteFor(plugin: FootnotePlugin, definitions: readonly string[], name: string): boolean {
    return popupEditingAvailable(plugin) && !definedMoreThanOnce(definitions, name);
}

/** Whether `name` (any casing) has more than one definition in the list listExistingFootnoteDefinitions returns. */
export function definedMoreThanOnce(definitions: readonly string[], name: string): boolean {
    const folded = name.toLowerCase();
    let seen = 0;
    for (const definition of definitions) {
        if (definition.toLowerCase() === folded && ++seen > 1) return true;
    }
    return false;
}
