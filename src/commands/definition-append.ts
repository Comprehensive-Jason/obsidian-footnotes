import { EditorChange, EditorPosition } from "obsidian";

import type FootnotePlugin from "../main";
import { contextOfLines, DocContext, definitionNames } from "../editor/doc-context";
import { composeChanges, mapPosition, simulateChanges, simulatedAnchors } from "../editor/insertion-liveness";
import { definitionLabel } from "../parsing/footnote-grammar";
import { trimmedSectionHeading } from "../linting/linter";
import { labelOutrunsLookahead } from "../linting/rules/move-footnotes-to-the-bottom";
import { findLineRunEnd } from "../parsing/line-edits";
import { readNote } from "../parsing/note-reading";

// Where a new footnote definition goes. This module holds the
// section-heading setting and the append edit, both of which every
// creation press shares. Split out of the one big commands file on
// 2026-08-11.

/**
 * The section heading a first footnote goes under: the setting's text when
 * the setting is on, without the blank lines at its start and end, the way
 * the lint reads it (trimmedSectionHeading); "" when the setting is off.
 * The setting is a text box that takes several lines, so a line break after
 * "# Footnotes" is one Enter away. Read as typed, it put an extra blank line
 * under a new heading, and a "# Footnotes" already ending the note was not
 * found, so a second one was added (found while fixing, 2026-10-06, pin
 * bug-settings-section-heading-trailing-newline).
 */
function sectionHeading(plugin: FootnotePlugin): string {
    return plugin.settings.enableFootnoteSectionHeading ? trimmedSectionHeading(plugin.settings.footnoteSectionHeading) : "";
}

function addFootnoteSectionHeader(plugin: FootnotePlugin): string {
    //If the "Enable Footnote Section Heading" setting is on, return the
    //"Footnote Section Heading" setting's text. Otherwise return "".

    // A heading whose text has been cleared out counts as no heading at
    // all. Lint already reads "" that way, and without this check the
    // "\n\n" prefix plus an empty heading would leave stray blank lines
    // sitting above the first footnote.
    const heading = sectionHeading(plugin);
    if (heading) {
        // The setting holds real markdown; older plain-text values are
        // converted when the plugin loads. A blank line always goes
        // between the heading and whatever is above it. That is the
        // markdown convention for blocks (requested 2026-07-20), and it
        // also stops a heading that begins with a divider from turning the
        // line above it into a setext heading.
        return `\n\n${heading}`;
    }
    return "";
}

// Works out the edit that adds a "[^name]: " label to the note's
// definitions, and hands it back without applying it.
//
// Where it goes: right after the last definition block when the note has
// one. That matters because the definitions may sit under a heading in the
// middle of the note with more content below them (issue #55). When there
// is no definition yet, it goes after the last line that has anything on
// it, trimming trailing blank lines if that setting is on. Before the very
// first footnote it also adds a blank line and, if enabled, the section
// heading.
//
// It comes back as plain data, measured against the lines of `ctx`.
// Every caller goes through planDefinitionAppend below, which hands this
// the note as it reads AFTER the caller's own edit and puts the two into
// one single transaction.
//
// `whole` is a stretch of lines the definition must not go between (see
// planDefinitionAppend).
export function buildDefinitionAppend(
    ctx: DocContext,
    footnoteId: string,
    isFirstFootnote: boolean,
    plugin: FootnotePlugin,
    whole?: { from: number; to: number },
): { change: EditorChange; cursor: EditorPosition; prepend?: EditorChange } {
    const lines = ctx.lines;
    const reading = ctx.reading();
    const isProtected = reading.protectedLines;
    // the line where a region that never closes opens (an unclosed fence,
    // comment, or math block runs to the end of the note), or -1
    const openFrom = reading.openRegionFrom;
    // the definitions at the top level of the note, the ones the new
    // definition joins; one in a quote, a list item, or another footnote is
    // not somewhere to append (Jason's ruling 1, option a, 2026-10-03)
    const blocks = reading.blocks;
    // A line with text on it directly below the new definition gets pulled
    // INTO the definition, because Obsidian carries a definition on into
    // the next line. So when there is content below, add a blank line
    // after the definition (the swallowed-prose bug, 2026-07-20). The caret still lands
    // on the definition line itself.
    const needsSeparator = (insertLine: number) =>
        insertLine + 1 < lines.length && lines[insertLine + 1].trim() !== "";
    // After the last definition block, unless that block's last line sits
    // inside a comment, math block, or fence that never closes: a block
    // owns the region a continuation line of its opens, so it can end
    // inside one, and a definition appended there would be born hidden.
    // That case falls through to the walk above the unclosed region below
    // (Claude sweep 2026-09-13).
    if (blocks.length > 0 && (openFrom === -1 || blocks[blocks.length - 1].end < openFrom)) {
        const last = blocks[blocks.length - 1];
        // A last block that ends inside the stretch kept whole takes the
        // new definition after the stretch's last line instead.
        const lastLine = whole && last.end >= whole.from && last.end < whole.to ? whole.to : last.end;
        // A block that ends on a paragraph line (a lazy continuation
        // directly under the label, or the live tail after a comment
        // closer one of its lines opened) needs a blank line before the
        // new label, or that label reads as more paragraph text and the
        // new footnote is born lazy; move-to-bottom keeps the same blank
        // (GLM hunt cycle 3, 2026-09-16). So does a block too long for the
        // new label to end it (labelOutrunsLookahead).
        const lastText = lines[lastLine];
        const paragraphTail =
            lastLine > last.start &&
            !isProtected[lastLine] &&
            lastText.trim() !== "" &&
            !/^(?: {4}|\t)/.test(lastText);
        const blankFirst = paragraphTail || labelOutrunsLookahead(lines, last.start, lastLine, definitionLabel(footnoteId).length);
        let text = blankFirst ? `\n\n[^${footnoteId}]: ` : `\n[^${footnoteId}]: `;
        const cursor = { line: lastLine + (blankFirst ? 2 : 1), ch: text.length - 1 };
        if (needsSeparator(lastLine)) text += "\n";
        return {
            change: {
                from: { line: lastLine, ch: lines[lastLine].length },
                text,
            },
            cursor,
        };
    }

    // No definitions yet. But if the note already has a section heading,
    // that heading claims the first footnote (a follow-up to issue #55):
    // put the definition under it, rather than adding a second heading at
    // the end of the note. The setting can hold markdown spanning several
    // lines, so what is matched is a run of lines, not one line.
    const heading = sectionHeading(plugin);
    if (heading) {
        // findLineRunEnd is the single piece of code that finds the
        // heading, shared with the move-to-bottom rule. They have to agree
        // on what counts as the existing heading, or running lint twice
        // would keep changing the note instead of settling.
        const headingLines = heading.split("\n");
        const anchorEnd = findLineRunEnd(lines, isProtected, headingLines, reading.commentLines);
        if (anchorEnd !== -1) {
            let fromLine = anchorEnd;
            let slotText = `\n\n[^${footnoteId}]: `;
            // If a blank line already sits between the heading and what
            // follows, use that one instead of adding a second.
            if (fromLine + 1 < lines.length && lines[fromLine + 1] === "") {
                fromLine += 1;
                slotText = `\n[^${footnoteId}]: `;
            }
            const slotLinesAdded = slotText.split("\n").length - 1;
            const cursor = {
                line: fromLine + slotLinesAdded,
                ch: slotText.length - slotText.lastIndexOf("\n") - 1,
            };
            if (needsSeparator(fromLine)) slotText += "\n";
            return {
                change: {
                    from: { line: fromLine, ch: lines[fromLine].length },
                    text: slotText,
                },
                cursor,
            };
        }
    }

    let fromLine = lines.length - 1;
    let to: EditorPosition | undefined;
    if (openFrom !== -1) {
        // The note ends inside a fence, comment, or math region that was
        // never closed (2026-08-11 review, bug #10). A definition added at
        // the very end would be born inside it as dead text, and the next
        // lint would then delete its live reference as an orphan.
        //
        // So put it above the unclosed region: walk up to the last line a
        // definition can follow, then keep walking up past blank lines.
        // The trailing-blank trimming must not run in this case, because
        // its range reaches to the end of the note and would delete the
        // unclosed region itself.
        fromLine = openFrom - 1;
        while (fromLine >= 0 && lines[fromLine].trim() === "") fromLine--;
        if (fromLine < 0) {
            // The unclosed region starts at line 0, so there is nowhere
            // above it to walk to. Put the definition at the very top,
            // with a blank line between it and whatever follows.
            const topText =
                `${definitionLabel(footnoteId)} \n` + (lines[0].trim() === "" ? "" : "\n");
            return {
                change: { from: { line: 0, ch: 0 }, text: topText },
                cursor: { line: 0, ch: definitionLabel(footnoteId).length + 1 },
            };
        }
    } else if (plugin.settings.enableRemoveBlankLastLines) {
        while (fromLine > 0 && lines[fromLine].length === 0) {
            fromLine--;
        }
        to = { line: lines.length - 1, ch: lines[lines.length - 1].length };
    }
    const from = { line: fromLine, ch: lines[fromLine].length };

    let text = `\n[^${footnoteId}]: `;
    if (isFirstFootnote) {
        let heading = addFootnoteSectionHeader(plugin);
        // The heading already brings a blank line of its own above it. If
        // the line we are inserting after is itself blank, which happens
        // when trimming is off and the note ends empty, that blank line is
        // already there, so drop the heading's one.
        if (heading && lines[fromLine].trim() === "") {
            heading = heading.slice(1);
        }
        text = heading + "\n" + text;
    } else if (lines[fromLine].trim() !== "") {
        // Not the first footnote, and yet there is no definition block at
        // the left margin to append under, because the note's only
        // definitions are inside blockquotes. Without help the label would
        // land directly beneath a line of prose, and Obsidian reads such a
        // line as more of that paragraph rather than as a definition. The
        // project calls that a lazy label; the note reading is what
        // decides it (ground truth in the live Reading view, 2026-09-09).
        // So give it the blank line that the first footnote would have
        // received from its heading.
        text = "\n" + text;
    }

    // The caret ends up at the end of the definition line just inserted.
    const linesAdded = text.split("\n").length - 1;
    const cursor = {
        line: fromLine + linesAdded,
        ch: text.length - text.lastIndexOf("\n") - 1,
    };

    // When the definition sits in the middle of the note, above an
    // unclosed region, a line with text on it directly below would be
    // pulled INTO the new definition. Same danger as at the other places a
    // definition can be inserted (the swallowed-prose bug again).
    if (openFrom !== -1 && needsSeparator(fromLine)) text += "\n";

    // The first footnote's section heading may itself start with a "---"
    // divider at the left margin. If the note's first line is also a bare
    // "---", meaning a horizontal rule with no partner, adding that second
    // divider makes Obsidian re-read the whole top of the note as YAML
    // frontmatter and swallow the prose in it. The same danger that
    // preserveLeadingThematicBreak handles in
    // move-footnotes-to-the-bottom, checked against Obsidian's own
    // metadataCache on 2026-08-10.
    //
    // The fix: add a blank line at the very top in the same edit. That
    // pins line 0 as ordinary content, and it renders exactly the same.
    let prepend: EditorChange | undefined;
    if (isFirstFootnote && lines[0] === "---" && !isProtected[0]) {
        const candidate = lines.slice(0, fromLine + 1).join("\n") + text;
        if (readNote(candidate.split("\n")).protectedLines[0]) {
            prepend = { from: { line: 0, ch: 0 }, text: "\n" };
            cursor.line += 1;
        }
    }
    return { change: { from, to, text }, cursor, prepend };
}

/**
 * Takes buildDefinitionAppend's edit and fills `body` in after the label,
 * because a conversion (issue #35) creates its definition already holding
 * the selected text.
 *
 * The label is the LAST label-shaped string in the edit's text, since an
 * optional section heading above it could contain one too. The caret,
 * which arrives sitting at the end of the label, slides along to the end
 * of the body, and stops before any blank line added after it.
 *
 * When the body spans several lines, which happens when a selection
 * spanning lines is converted (2026-08-19) and which already carries its
 * continuation indent, the caret lands at the end of the body's LAST line.
 *
 * `labelLineOffset` is which line of the edit's text the label is on. It
 * is worked out here, BEFORE the body is filled in. Once the body is
 * spliced in, a label-shaped string inside the body, say "`[^1]: x`"
 * written in a code span, would be the last one and would point the caller
 * at a continuation line instead (review A4; Jason confirmed it live on
 * 2026-09-08, where the conversion was wrongly refused as protected text).
 */
function seedDefinitionBody(
    definition: {
        change: EditorChange;
        cursor: EditorPosition;
        prepend?: EditorChange;
    },
    footnoteId: string,
    body: string,
): {
    change: EditorChange;
    cursor: EditorPosition;
    prepend?: EditorChange;
    labelLineOffset: number;
} {
    const label = `${definitionLabel(footnoteId)} `;
    const text = definition.change.text;
    const at = text.lastIndexOf(label) + label.length;
    const bodyLines = body.split("\n");
    return {
        ...definition,
        labelLineOffset: text.slice(0, at).split("\n").length - 1,
        change: {
            ...definition.change,
            text: text.slice(0, at) + body + text.slice(at),
        },
        cursor:
            bodyLines.length === 1
                ? {
                      line: definition.cursor.line,
                      ch: definition.cursor.ch + body.length,
                  }
                : {
                      line: definition.cursor.line + bodyLines.length - 1,
                      ch: bodyLines[bodyLines.length - 1].length,
                  },
    };
}

/** What planDefinitionAppend works out. Every position is a position in `final`. */
export interface DefinitionAppendPlan {
    /** The changes for ONE transaction, measured against the note as it is now: the caller's edits and the definition together, so that applying them gives `final` exactly. */
    changes: EditorChange[];
    /** The note as the transaction leaves it. */
    final: string[];
    /** Where the text of each of the caller's edits begins and ends, in the order the caller gave them. */
    edits: { start: EditorPosition; end: EditorPosition }[];
    /** The new definition's label line. */
    labelLine: number;
    /** Where the caret goes in the new definition: the end of its label, or the end of the seeded body. */
    cursor: EditorPosition;
}

/**
 * The one way a definition is added: plan it against the note as it will
 * read AFTER the caller's own edits (`edits`, measured against `lines`, the
 * note as it is now), and hand back both as one transaction.
 *
 * Every creation and the carried paste make two edits at once: one at the
 * caret (a reference, a converted selection, a pasted text) and the
 * definition. The definition used to be planned against the note BEFORE
 * the caret's edit, and whenever that edit changed what the definition
 * should see, the two collided: the trailing-blank trim ran over the caret
 * and the reference landed inside its own definition, a definition went
 * into the blank line the reference filled and was read as more of that
 * paragraph, a section heading lost the blank line it needs above it, and
 * a paste over a selection reused a definition the paste itself deleted
 * (hunt 2026-10-02, clusters R1, I1, I2, O1, C8, C12, C13, C28). Planned
 * against the note after the edit, every rule in buildDefinitionAppend
 * sees the real neighbours, and its positions are already the final ones.
 *
 * Whether this is the note's first footnote is read from that same note,
 * so a paste that replaces every definition gets the section heading a
 * first footnote gets, and a pasted text that brings the heading with it
 * keeps the one it brought. "First" means the first DEFINITION, the way
 * the named command and the move-to-bottom rule count it: a note whose
 * only footnote is an orphaned reference still gets the heading
 * (2026-08-11 review, bug #8).
 *
 * `body` is the definition's text, filled in after the label (a
 * conversion, a carried definition), and `moreDefinitionLines` are whole
 * definition lines added right under it (the other carried or converted
 * definitions). Leave both out for an empty definition.
 *
 * `whole` is a stretch of lines, from line `from` to line `to` of the note
 * after the edits, that the definition must not go between: the footnote
 * popup's text, which the popup's editor holds and the note shows as that
 * footnote's own. A popup text that ends in an empty line ends in a blank
 * line of the note, which the footnote's definition does not take in, so
 * the definition went in after the footnote and before that blank line,
 * between two lines of the popup, where nothing could write it (hunt
 * 2026-10-06 cycle 3, cluster K4, pin bug-popup-paste-trailing-empty-line).
 */
export function planDefinitionAppend(opts: {
    lines: string[];
    edits: EditorChange[];
    footnoteId: string;
    plugin: FootnotePlugin;
    body?: string;
    moreDefinitionLines?: string[];
    whole?: { from: number; to: number };
}): DefinitionAppendPlan {
    const middle = simulateChanges(opts.lines, opts.edits);
    const editStarts = simulatedAnchors(opts.lines, opts.edits, opts.edits.map((_, i) => i), middle);
    const ctx = contextOfLines(middle);
    const body = opts.body ?? "";
    const bodyExtraLines = body.split("\n").length - 1;
    const seeded = seedDefinitionBody(
        buildDefinitionAppend(ctx, opts.footnoteId, definitionNames(ctx).length === 0, opts.plugin, opts.whole),
        opts.footnoteId,
        body,
    );
    const text = seeded.change.text.split("\n");
    text.splice(seeded.labelLineOffset + bodyExtraLines + 1, 0, ...(opts.moreDefinitionLines ?? []));
    const change = { ...seeded.change, text: text.join("\n") };
    const append = seeded.prepend ? [seeded.prepend, change] : [change];
    const final = simulateChanges(middle, append);
    // An edit's text starts after anything the append inserts right where
    // it starts (the prepended blank line at the top of the note), and
    // ends before anything the append inserts right where it ends (the
    // definition, written straight after a reference that ends the note).
    const edits = editStarts.map((start, i) => {
        const editLines = opts.edits[i].text.split("\n");
        const end =
            editLines.length === 1
                ? { line: start.line, ch: start.ch + editLines[0].length }
                : { line: start.line + editLines.length - 1, ch: editLines[editLines.length - 1].length };
        return {
            start: mapPosition(middle, append, start, 1, final),
            end: mapPosition(middle, append, end, -1, final),
        };
    });
    return {
        changes: composeChanges(opts.lines, opts.edits, append),
        final,
        edits,
        labelLine: seeded.cursor.line - bodyExtraLines,
        cursor: seeded.cursor,
    };
}
