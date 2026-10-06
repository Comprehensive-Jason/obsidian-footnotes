import { Editor, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import {
    footnotePopupBusy,
    settleFootnotePopupWithFeedback,
    toggleCloseFootnotePopup,
} from "../commands/footnote-popup";
import { jumpToFootnoteDefinition } from "../commands/navigation";
import { docContext } from "../editor/doc-context";
import { replaceMinimal } from "../editor/write-back";
import { rewriteDocument } from "./rewrite-document";
import { definitionLabel, quotedReference } from "../parsing/footnote-grammar";
import { footnotePrefix, footnotePrefixProblem } from "../parsing/footnote-prefix";
import { FootnotePlacement } from "../parsing/landing";
import { readNote } from "../parsing/note-reading";
import { AppWithCommands, AppWithPlugins, readingViewActive, viewEditor, WindowWithVim } from "../editor/obsidian-internals";
import { activeTableCellEditor, nestedSubEditorOwnsFocus, runOutsideTableCell } from "../editor/table-cursor";
// The pipeline calls each rule through its catalogue entry (rule.apply), not
// the bare function behind it. That gives the tests one seam per rule to
// watch, which is how test/lint-pipeline-order.test.ts checks that the order
// below matches the order the catalogue in ./rules/index.ts lists.
import { applyFootnotePrefixRule } from "./rules/apply-footnote-prefix";
import { fixLazyDefinitionsRule } from "./rules/fix-lazy-definitions";
import { footnoteAfterPunctuationRule } from "./rules/footnote-after-punctuation";
import { moveFootnotesToTheBottomRule } from "./rules/move-footnotes-to-the-bottom";
import { reIndexFootnotesRule, ReindexOptions } from "./rules/re-index-footnotes";
import { removeEmptySectionHeading } from "./rules/remove-empty-section-heading";
import { removeOrphanedDefinitionsRule } from "./rules/remove-orphaned-definitions";
import { removeOrphanedReferencesRule } from "./rules/remove-orphaned-references";
import { mergeDuplicateDefinitionsRule } from "./rules/merge-duplicate-definitions";
import { noticeLintAlerts, orphanSafePrefixFor } from "./lint-alerts";

import { invalidPrefixMessage, LintingCanceled, showNotice } from "../editor/notice";
// The lint: the pass that cleans up footnotes across a whole note.
//
// The actual cleanups live one folder down, in src/linting/rules/. Each of
// those is a pure function (text in, text out) and each gets its own
// command, plus one "lint" command composing all three.
//
// This file is the plumbing around them: talking to the editor, turning the
// user's settings into the options the rules take, and running the lint
// automatically when a trigger fires (on save, and on footnote creation).

function configuredSectionHeading(plugin: FootnotePlugin): string {
    return plugin.settings.enableFootnoteSectionHeading
        ? trimmedSectionHeading(plugin.settings.footnoteSectionHeading)
        : "";
}

/**
 * The section heading setting without the blank lines at its start and
 * end. The setting is a text box that takes several lines, so a line break
 * after "# Footnotes" is one Enter away, and Obsidian stores it as typed.
 * The lint finds the heading in the note line by line, so "# Footnotes"
 * plus an empty line never matched the note's "# Footnotes" when nothing
 * followed it, and every lint added the heading again (hunt 2026-10-02,
 * pin bug-settings-section-heading-trailing-newline). A blank line at
 * either end says nothing: the plugin always puts one around the heading.
 */
function trimmedSectionHeading(heading: string): string {
    return heading.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

/**
 * The reindex policy the user picked in the settings tab.
 *
 * Reindex no longer deletes orphaned definitions on the lint path; the
 * separate orphan rule does that job (ruling 2026-08-10). So reindex keeps
 * every orphaned definition that is still there, and numbers it like any
 * other.
 */
function reindexOptionsFromSettings(
    plugin: FootnotePlugin,
): ReindexOptions {
    return {
        renumberNamedFootnotes: plugin.settings.footnoteNaming === "numbered",
        nameNumberedFootnotes: plugin.settings.footnoteNaming === "named",
    };
}

/**
 * The whole lint pipeline the user picked in the settings tab: which rules
 * run, plus the reindex policy.
 *
 * `markdown` is the text about to be linted. Its frontmatter carries the
 * note's prefix, which names the bare-prefix placeholder (a footnote the
 * user is still naming) that orphan deletion must never touch.
 */
export function lintOptionsFromSettings(
    plugin: FootnotePlugin,
    sectionHeading: string,
    markdown: string,
): LintOptions {
    return {
        sectionHeading,
        fixPunctuation: plugin.settings.lintFixPunctuation,
        placement: plugin.settings.footnotePlacement,
        fixLazyDefinitions: plugin.settings.lintFixLazyDefinitions,
        moveDefinitionsToBottom: plugin.settings.lintMoveToBottom,
        reindex: plugin.settings.lintReindex,
        reindexOptions: reindexOptionsFromSettings(plugin),
        removeOrphanedReferences: plugin.settings.lintDeleteOrphanedReferences,
        removeOrphanedDefinitions:
            plugin.settings.lintDeleteOrphanedDefinitions,
        mergeDuplicateDefinitions:
            plugin.settings.lintMergeDuplicateDefinitions,
        orphanSafePrefix: orphanSafePrefixFor(plugin, markdown),
        applyNotePrefix:
            plugin.settings.enableFootnotePrefix &&
            plugin.settings.lintApplyPrefix,
        removeEmptySectionHeading: plugin.settings.removeEmptySectionHeading,
    };
}

/**
 * `markdown` with its footnote section heading removed when the section
 * is empty and the "Remove empty section heading" setting asks for it;
 * otherwise unchanged. The commands that can empty the section (Delete
 * footnote everywhere, the normal-to-inline conversion) run their result
 * through this before writing it back (Jason's ask, 2026-09-25).
 */
export function withEmptySectionHeadingRemoved(plugin: FootnotePlugin, markdown: string): string {
    if (!plugin.settings.removeEmptySectionHeading) return markdown;
    return removeEmptySectionHeading(markdown, configuredSectionHeading(plugin));
}

export interface LintOptions {
    /** Passed through to moveFootnoteDefinitionsToBottom (default none). */
    sectionHeading?: string;
    /** Remove the section heading when the lint leaves nothing under it (default off; the Remove empty section heading setting). */
    removeEmptySectionHeading?: boolean;
    /** Run footnoteAfterPunctuation (default on). */
    fixPunctuation?: boolean;
    /** Which side of the punctuation the rule puts references on (default
     * after; the caller passes the footnotePlacement setting). Under
     * "none" the rule does nothing even when fixPunctuation is on. */
    placement?: FootnotePlacement;
    /**
     * Run fixLazyDefinitions (default on). A "[^x]:" line sitting directly
     * under a line of prose gets the blank line that turns it into a real
     * definition. When this is off, the lazy-definition lint alert reports
     * such lines instead of fixing them.
     */
    fixLazyDefinitions?: boolean;
    /** Run moveFootnoteDefinitionsToBottom (default on). */
    moveDefinitionsToBottom?: boolean;
    /** Run reindexFootnotes (default on). */
    reindex?: boolean;
    /** Passed through to reindexFootnotes. */
    reindexOptions?: ReindexOptions;
    /**
     * Delete orphaned references: references with no definition anywhere in
     * the note (default off; the caller turns it on from the "Delete
     * orphaned references" setting).
     */
    removeOrphanedReferences?: boolean;
    /**
     * Delete orphaned definitions: definitions nothing references (default
     * off; the caller turns it on from the "Delete orphaned definitions"
     * setting). It works transitively, so deleting one definition can orphan
     * another, which then goes too. Nothing to do with `reindex`.
     */
    removeOrphanedDefinitions?: boolean;
    /**
     * When one name has several definitions, fold the later ones into the
     * first as continuation lines (default off; the caller turns it on from
     * the "Merge duplicate definitions" setting). While it is off, the lint
     * alerts report duplicates instead. Worth knowing: Obsidian renders only
     * the LAST definition of a name (ground truth 2026-08-12).
     */
    mergeDuplicateDefinitions?: boolean;
    /**
     * The note's own footnote-prefix, when the prefix feature is on and the
     * prefix is valid. A bare "[^2.]" placeholder is a footnote the user is
     * still typing a name for, so orphan deletion must leave it alone.
     */
    orphanSafePrefix?: string;
    /**
     * Two behaviors on one flag (default off; the caller turns it on from
     * the settings). First, rename footnotes - plain numbered ones AND named
     * ones - so they carry the note's own footnote-prefix property. Second,
     * have reindex treat footnotes that already match the prefix as NUMBERED
     * inside that namespace.
     *
     * They share a flag on purpose. Renumbering inside the namespace while
     * nothing else was being prefixed felt inconsistent (Jason, 2026-08-08),
     * so the separate `prefixAware` knob was folded into this one
     * (2026-08-11). Both behaviors ride the apply-prefix rule.
     */
    applyNotePrefix?: boolean;
}

/**
 * Run the enabled cleanups, in the order they depend on each other: fix
 * punctuation, gather the definitions at the bottom, then renumber them and
 * put them in matching order.
 */
export function lintFootnotes(
    markdown: string,
    options: LintOptions = {},
): string {
    if (options.sectionHeading) {
        const sectionHeading = trimmedSectionHeading(options.sectionHeading);
        options = { ...options, sectionHeading: sectionHeadingProblem(sectionHeading) === null ? sectionHeading : "" };
    }
    // Notes can use any line endings. rewriteDocument converts them to plain
    // LF once here, so every step below sees the same thing, and puts the
    // note's original endings back once on the way out.
    return rewriteDocument(markdown, (text) => {
        let result = text;
        // Hidden definitions come FIRST of all. A "[^x]:" line directly
        // under a line of prose is not a definition to Obsidian; it is more
        // paragraph text (a "lazy label") until a blank line separates them.
        // Every rule below - the duplicate merge, both orphan rules, the
        // move, prefixing, reindex - must judge the definition the user
        // meant, not the prose line Obsidian sees. (Ruling: Jason,
        // 2026-09-09.)
        if (options.fixLazyDefinitions ?? true) {
            result = fixLazyDefinitionsRule.apply(result);
        }
        // Duplicates merge next, so every rule below sees exactly one
        // definition block per name: orphan deletion judges one block, the
        // move gathers one, reindex reorders one. It also means a second run
        // of the lint finds no duplicates left, which is what keeps running
        // the lint twice from changing anything the second time.
        if (options.mergeDuplicateDefinitions) {
            result = mergeDuplicateDefinitionsRule.apply(result);
        }
        // Orphaned definitions go next, before the rules that move, prefix,
        // and number things: there is no point doing any of that to a
        // definition that is about to be deleted. Deleting an orphaned
        // definition can never orphan a live reference, because a reference
        // pointing at a definition is exactly what keeps that definition
        // alive.
        //
        // This is the only place the lint deletes orphaned definitions.
        // Reindex had a deletion of its own that skipped this rule's check
        // on how the lines around a cut read, and it was removed (hunt
        // 2026-10-05 round 2, cluster L7).
        //
        // The order matters: EVERY definition deletion has to happen before
        // the reference deletion further down. That rule looks at where the
        // definitions sit before it decides whether to refuse a deletion, so
        // a definition deleted after it looked would flip its verdict on the
        // next run. (Caught by the idempotence property, 2026-08-10.)
        if (options.removeOrphanedDefinitions) {
            result = removeOrphanedDefinitionsRule.apply(result);
        }
        if (options.fixPunctuation ?? true) {
            result = footnoteAfterPunctuationRule.apply(result, { placement: options.placement });
        }
        if (options.moveDefinitionsToBottom ?? true) {
            result = moveFootnotesToTheBottomRule.apply(
                result,
                options.sectionHeading ?? "",
            );
        }
        // Orphaned REFERENCE deletion runs once the layout has settled:
        // after the deletions and moves above, and before prefixing and
        // reindex start handing out numbers.
        //
        // Why here and nowhere else: this rule has a guard that refuses a
        // deletion when removing the reference would change how Obsidian
        // reads the lines around it (the bug-orphan-delete-reclassifies
        // guard). That guard looks at where the definitions sit relative to
        // the reference, and both definition deletion and move-to-bottom
        // shift them. Run any earlier, the first pass could refuse a
        // deletion that a second pass then goes ahead and makes. (The
        // idempotence property caught exactly that, twice, 2026-08-10.)
        //
        // The punctuation rule running before this is harmless: it may move
        // a reference that is about to be deleted anyway, and the text left
        // behind after the deletion comes out the same either way. Nothing
        // downstream matters either, because prefixing and reindex only
        // rename definitions or shuffle them between slots that already
        // exist. Neither can change whether a definition sits above a
        // reference, so the guard's verdict stays the same on every pass.
        if (options.removeOrphanedReferences) {
            const beforeDeletion = result;
            result = removeOrphanedReferencesRule.apply(result, {
                orphanSafePrefix: options.orphanSafePrefix,
            });
            // Deleting a reference can leave its line empty. If that empty
            // line lands where the moved definitions were joined on, the
            // NEXT run of the move would collapse it, so this run's output
            // would not match the next one's. Run the move again now, so
            // this run already produces the final text. (Idempotence
            // property, 2026-08-10.)
            if (result !== beforeDeletion && (options.moveDefinitionsToBottom ?? true)) {
                result = moveFootnotesToTheBottomRule.apply(
                    result,
                    options.sectionHeading ?? "",
                );
            }
        }
        // The note's own footnote-prefix, when the prefix behavior is on and
        // the prefix is valid. An invalid one changes nothing here, since
        // the lint guard cancels those runs before they get this far.
        const notePrefix = options.applyNotePrefix ? footnotePrefix(result) : "";
        const validPrefix =
            notePrefix && footnotePrefixProblem(notePrefix) === null
                ? notePrefix
                : "";
        if (options.applyNotePrefix && validPrefix) {
            // This runs BEFORE reindex on purpose. Footnotes that do not
            // carry the prefix yet adopt it here: a plain number is given
            // the next free slot past the current highest, and a named
            // footnote keeps its name behind the prefix. Reindex then
            // renumbers the whole namespace in reading order. Doing it this
            // way round means one lint settles the note; the other order
            // would need a second pass.
            result = applyFootnotePrefixRule.apply(result, { prefix: validPrefix });
        }
        if (options.reindex ?? true) {
            result = reIndexFootnotesRule.apply(result, {
                ...options.reindexOptions,
                // A footnote that carries this note's prefix counts as a numbered
                // footnote too: reindex renumbers "2-1", "2-2", "2-3" inside their
                // own prefix namespace, the same way it renumbers plain "1", "2",
                // "3". This is a quality-of-life choice. validPrefix is the empty
                // string unless the apply-prefix rule is on, so one flag drives
                // both prefix behaviours.
                prefix: validPrefix,
                // An orphan still here is one the orphan rule refused to
                // cut, so reindex leaves it in its slot rather than moving
                // it where the next lint would cut it (hunt 2026-10-05
                // round 2, cluster L4).
                leaveOrphansInPlace: options.removeOrphanedDefinitions ?? false,
            });
        }
        // Last of all, once every rule has had its say about what stays:
        // a heading with nothing left under it goes, when asked
        if (options.removeEmptySectionHeading && options.sectionHeading) {
            result = removeEmptySectionHeading(result, options.sectionHeading);
        }
        return result;
    });
}

/**
 * The lint's last result, and the options it ran with (written out as
 * text, so two sets of options compare by what they say). See lintNote.
 */
let lastLint: { options: string; text: string } | null = null;

/**
 * The lint as the plugin runs it on a note: lintFootnotes with the user's
 * settings. The commands and both triggers (on save, on footnote creation)
 * go through here.
 *
 * A lint whose input is exactly the text the last lint produced, with the
 * same options, is skipped, and the text comes back as it is (the speed
 * brief, item 5, Jason's pick, 2026-10-05). The lint is meant to settle a
 * note in one run, so running it on its own result changes nothing; the
 * usual case is a second Ctrl+S with nothing typed in between, which on
 * a 22,000-line note relinted for a quarter of a second. Any change to the
 * text, and any change to a lint setting, means the lint runs, because
 * the options are worked out from the settings (and from the note's
 * prefix) every time and compared whole.
 *
 * What the user sees is unchanged: the callers still say "No linting
 * needed." and still show the lint alerts after a skipped lint, so the
 * lint is never silent about what it left in place (ADR 0002). Only the
 * rules' work is saved, never the alerts'. Worth knowing: if the lint
 * ever fails to settle a note in one run (always a bug, such as the one
 * hunt 2026-10-05's pin bug-reindex-moves-refused-orphan caught), the
 * change a second run would make waits for the next edit to the note.
 */
export function lintNote(plugin: FootnotePlugin, markdown: string, sectionHeading: string): string {
    const options = lintOptionsFromSettings(plugin, sectionHeading, markdown);
    const written = JSON.stringify(options);
    if (lastLint !== null && lastLint.options === written && lastLint.text === markdown) return markdown;
    const after = lintFootnotes(markdown, options);
    lastLint = { options: written, text: after };
    return after;
}

/**
 * True when the user has turned every lint rule off.
 *
 * With nothing enabled the lint cannot change anything, so the command says
 * that plainly. Reporting "nothing to fix" would wrongly suggest the note
 * had been checked and come back clean.
 */
export function lintRulesAllDisabled(plugin: FootnotePlugin): boolean {
    const s = plugin.settings;
    return (
        // Under the placement "Don't move" the punctuation rule does
        // nothing, and the settings tab greys its toggle out, so it counts
        // as off then, as the prefix rule does while prefixes are off
        // (hunt 2026-10-02, pin bug-settings-idle-placement-counts-as-lint-on).
        !(s.lintFixPunctuation && s.footnotePlacement !== "none") &&
        !s.lintFixLazyDefinitions &&
        !s.lintMoveToBottom &&
        !s.lintReindex &&
        !(s.enableFootnotePrefix && s.lintApplyPrefix) &&
        // Deleting orphans and merging duplicates are rules that change the
        // note, so they count here. The lint alerts that speak in their place
        // while those toggles are off do not count: when every rule is off,
        // lint is off, and the alerts deliberately stay silent too.
        !s.lintDeleteOrphanedReferences &&
        !s.lintDeleteOrphanedDefinitions &&
        !s.lintMergeDuplicateDefinitions
    );
}

// ---------- automatic linting (Linter-style triggers) ----------

// When a table cell is being edited it runs its own little sub-editor, and
// while that has focus any edit to the document races the cell writing its
// text back (the issue #28 corruption family).
//
// The manual lint command waits for that state to pass. The automatic
// triggers simply skip instead: a save must never be delayed or made
// unreliable by the lint attached to it. (The shared check is
// nestedSubEditorOwnsFocus in table-cursor.ts.)

/**
 * The message explaining why `markdown` cannot be linted, or null when the
 * lint may go ahead.
 *
 * There is one such case: a footnote-prefix ending in a digit. With a prefix
 * like that, a prefixed reference is impossible to tell apart from a plain
 * number, so reindex would fold the whole chapter namespace back into the
 * ordinary numbers. The lint refuses to run until the property is fixed.
 */
export function lintBlockedByPrefix(markdown: string, prefixFeatureOn = true): string | null {
    // with the per-note prefix feature off, the property is ignored like
    // any other frontmatter, so it blocks nothing (Jason's ruling
    // 2026-09-20, from the pruned sheet on invalid prefix properties)
    if (!prefixFeatureOn) return null;
    const prefix = footnotePrefix(markdown);
    if (!prefix) return null;
    const problem = footnotePrefixProblem(prefix);
    if (problem === null) return null;
    return invalidPrefixMessage(LintingCanceled, prefix, problem);
}

/**
 * Why the configured section heading cannot be used, or null when it can.
 * A heading whose text holds a footnote reference ("# Footnotes [^9]")
 * can never be found again after a lint: the rules renumber, prefix, or
 * move that reference, so the text in the note stops matching the setting
 * and every lint appended one more copy of the heading (Kimi hunt cycle 1,
 * 2026-09-16). The pure lint ignores such a heading; the lint commands
 * cancel with this message instead, so the setting gets fixed.
 */
export function sectionHeadingProblem(heading: string): string | null {
    // only a LIVE reference can desync the heading from its copy in the
    // note: an escaped "\[^9]" is literal prose and a "[^9]" in a code
    // span is dead text, and no rule renames either (Kimi hunt cycle 4,
    // 2026-09-16). The heading is markdown that may run over several lines,
    // so it is read as a note of its own.
    const headingLines = heading.split("\n");
    const reading = readNote(headingLines);
    const live = headingLines.flatMap((_, i) => reading.referencesOn(i));
    if (live.length === 0) return null;
    return `${LintingCanceled}the footnote section heading setting contains a footnote reference (${quotedReference(live[0].name)}), which the lint rules would renumber. Take it out of the heading in the plugin settings.`;
}

/** The lint-cancelling message for the section heading in the settings, or null. */
function lintBlockedBySectionHeading(plugin: FootnotePlugin): string | null {
    const heading = configuredSectionHeading(plugin);
    return heading ? sectionHeadingProblem(heading) : null;
}

/**
 * The safety check both automatic triggers share (lint-on-save and
 * lint-on-footnote-creation each used to spell it out separately). It
 * returns the active markdown view and its editor, or null when the lint
 * must not touch the document.
 *
 * The four reasons to say no:
 *
 * - There is no editable view. viewEditor is used because a deferred view
 *   has no editor, despite what the type definitions claim.
 * - Reading view is showing: never edit the hidden buffer behind it
 *   (2026-08-08).
 * - The popup has a save in flight and owns the file.
 * - A table cell or other nested sub-editor has focus (the issue #28
 *   corruption family).
 *
 * Unlike the live-Obsidian code further down, this function is covered by
 * mutation testing: the unit tests reach it through
 * lintAfterFootnoteCreation, and bug-reading-view-deferred-lint pins the
 * Reading-view refusal.
 */
function safeLintTarget(
    plugin: FootnotePlugin,
): { mdView: MarkdownView; doc: Editor } | null {
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = mdView && viewEditor(mdView);
    if (!mdView || !doc) return null;
    if (readingViewActive(mdView)) return null;
    // Stryker disable next-line all: whether the popup is busy lives in the
    // footnote-popup module, and only a real running embedRegistry can set
    // it, so only the smoke tests can reach this line (2026-08-12)
    if (footnotePopupBusy()) return null;
    if (activeTableCellEditor(doc) || nestedSubEditorOwnsFocus(doc)) return null;
    return { mdView, doc };
}

// Stryker disable all: everything below plugs straight into a running
// Obsidian (workspace views, the save-command wrapper, the vim adapter).
// Only the smoke tests can reach it, so mutation testing here would report
// nothing but noise by design (coverage-verified 2026-08-11).

// Lint the note the user is in, right now, if that is safe. The save hook
// calls this just before handing off to Obsidian's own save, so what gets
// written to disk is the linted text.
function lintActiveNoteIfSafe(plugin: FootnotePlugin) {
    const target = safeLintTarget(plugin);
    if (!target) return;
    const doc = target.doc;
    // Same message the Lint footnotes command shows. With every rule off
    // the lint cannot change anything, and "No linting needed." would
    // wrongly imply the note had been checked and found clean (E34).
    if (lintRulesAllDisabled(plugin)) {
        showNotice(
            "All lint rules are turned off in the plugin settings, so there is nothing to lint.",
        );
        return;
    }
    const before = doc.getValue();
    const blocked = lintBlockedByPrefix(before, plugin.settings.enableFootnotePrefix) ?? lintBlockedBySectionHeading(plugin);
    if (blocked) {
        showNotice(blocked, 8000);
        return;
    }
    const after = lintNote(plugin, before, configuredSectionHeading(plugin));
    // A manual save (Ctrl+S, or vim's ":w") is something you asked for, so
    // it tells you the outcome either way, just like the Lint footnotes
    // command does. (Jason's call, 2026-08-08, reversing an earlier change
    // that stayed quiet when the note was already clean.) Only the
    // lint-on-footnote-creation trigger says nothing when there was nothing
    // to do.
    if (after === before) {
        showNotice("No linting needed.");
    } else {
        replaceMinimal(doc, before, after, target.mdView);
        showNotice("Footnotes linted.");
    }
    noticeLintAlerts(plugin, after);
}

/**
 * Wrap Obsidian's own save command so "Lint on save" runs just before the
 * file is written.
 *
 * `app.commands` is private API, not part of what Obsidian promises plugins.
 * If its shape ever changes, this quietly does nothing and the user is back
 * to linting by hand. The original callback is put back when the plugin
 * unloads.
 */
export function installLintOnSave(plugin: FootnotePlugin) {
    const command = (plugin.app as AppWithCommands).commands?.commands?.[
        "editor:save-file"
    ];
    if (!command || typeof command.checkCallback !== "function") return;
    const original = command.checkCallback;
    const wrapped = (checking: boolean) => {
        // Only lint while THIS copy of the plugin is still the one Obsidian
        // has loaded. Reloading the plugin can leave an old wrapper buried
        // inside a newer one's chain, and the restore below correctly
        // refuses to unpick someone else's wrapper, so the old one stays.
        // Without this check that old wrapper kept linting forever, using
        // the settings frozen at the moment it was made (observed live,
        // 2026-08-10).
        const active = (plugin.app as AppWithPlugins).plugins?.plugins?.[
            "obsidian-footnotes"
        ];
        if (!checking && active === plugin && plugin.settings.lintOnSave) {
            lintActiveNoteIfSafe(plugin);
        }
        return original(checking);
    };
    command.checkCallback = wrapped;
    plugin.register(() => {
        // Put the original back only if OUR wrapper is still the outermost
        // one. Another plugin may have wrapped the same command after us,
        // and writing `original` back regardless would throw that plugin's
        // wrapper away without a word (E30).
        if (command.checkCallback === wrapped) {
            command.checkCallback = original;
        }
    });
}

// In vim mode, ":w" saves through vim's own adapter and never goes near
// Obsidian's save command, so the wrapper above never sees it (verified
// live: calling handleEx("w") leaves editor:save-file uninvoked). ":w" is a
// save like any other, so it has to lint too.
//
// What is remembered here is the adapter object itself, not a yes/no flag.
// Turning vim mode off and on again can build a brand new adapter that our
// defineEx never touched, and a flag would wrongly say it was done (E31).
let hookedVim: unknown = null;

/**
 * Redefine vim's "write" / ":w" command so it goes through Obsidian's own
 * save command instead, which is the path "Lint on save" already wraps.
 *
 * With the toggle off nothing changes for the user: ":w" still just saves.
 * The vim adapter only exists while vim mode is on, and the user can toggle
 * that at any moment, so this is cheap and safe to call over and over; the
 * first call that finds an adapter is the one that takes effect.
 *
 * The override deliberately outlives the plugin: all it does is call the
 * app's own save command, which is what ":w" was going to do anyway.
 */
export function installVimWriteHook(plugin: FootnotePlugin) {
    const vim = (activeWindow as WindowWithVim).CodeMirrorAdapter?.Vim;
    if (!vim?.defineEx || hookedVim === vim) return;
    const app = plugin.app as AppWithCommands;
    vim.defineEx("write", "w", () => {
        app.commands?.executeCommandById?.("editor:save-file");
    });
    hookedVim = vim;
}
// Stryker restore all

// The name of the note's one and only empty definition ("[^x]: " with
// nothing after it), or null when there are none or more than one.
//
// Why look for it that way: linting a note right after a footnote was
// created can rename that footnote, because reindex hands out names by
// order of appearance. So the name it had a moment ago is no help in
// finding it again. What is reliable is that the brand new definition is
// empty, and as long as it is the only empty one in the note, it can only
// be the footnote just created.
function uniqueEmptyDefinitionName(doc: Editor): string | null {
    const ctx = docContext(doc);
    let found: string | null = null;
    for (const definition of ctx.reading().definitions) {
        // A definition in a quote, a list item, or another footnote is a
        // real definition, but it can never be the one being hunted here:
        // the plugin only ever creates definitions at the left margin (or
        // indented). Counting it would make the note look ambiguous, and the
        // caret would be left stranded.
        if (!definition.movable) continue;
        // nothing typed after the label yet
        if (ctx.lines[definition.start].slice(definition.labelEnd).trim() !== "") continue;
        if (found !== null) return null; // ambiguous
        found = definition.name;
    }
    return found;
}

// The same idea as uniqueEmptyDefinitionName, but for conversions: turning
// selected text into a footnote (Jason's report, 2026-08-26).
//
// A conversion's new definition is never empty, since it holds the text
// that was selected. So after a lint that may have both renumbered and
// moved it, that body text is what identifies it.
//
// A definition matches when its whole definition block is exactly
// "[^name]: " plus the body, continuation lines and all. That works because
// the conversion wrote those lines itself, and the lint rules only move and
// rename definition blocks; they never edit the text inside one. More than
// one match is ambiguous, exactly as with the empty version above.
function uniqueSeededDefinitionName(doc: Editor, body: string): string | null {
    const ctx = docContext(doc);
    const bodyLines = body.split("\n");
    let found: string | null = null;
    for (const block of ctx.reading().definitions) {
        if (!block.movable || block.end - block.start !== bodyLines.length - 1) continue;
        if (ctx.lines[block.start] !== `${definitionLabel(block.name)} ${bodyLines[0]}`) {
            continue;
        }
        let same = true;
        for (let j = 1; j < bodyLines.length; j++) {
            if (ctx.lines[block.start + j] !== bodyLines[j]) {
                same = false;
                break;
            }
        }
        if (!same) continue;
        if (found !== null) return null; // ambiguous
        found = block.name;
    }
    return found;
}

/**
 * The "Lint on footnote creation" trigger: lint the note the user is in,
 * right after a new footnote definition was made there. It replaced the old
 * lint-on-focused-file-change trigger (2026-08-05).
 *
 * It is quiet on purpose. A creation that needed no cleanup, which is the
 * usual case, shows no notice at all; only real changes announce
 * themselves. And they happen in the note the user is LOOKING AT, which the
 * old file-change trigger could not promise.
 *
 * Every creation that makes a definition runs this as part of the press
 * itself, not later. There are two arms:
 *
 * The jump arm runs right after the caret lands. With `relandCursor` set,
 * the caret is put back on the new definition even if the lint renumbered
 * or moved it. It is found again as the note's only empty definition, or,
 * when `seededBody` is given, as the only definition holding exactly that
 * text. That second route is how a conversion's pre-filled footnote is
 * found again (Jason's report, 2026-08-26).
 *
 * The popup arm runs right BEFORE the popup opens. Jason asked for that on
 * 2026-08-27: the note must already look linted the moment the popup
 * appears. The old version waited for the popup to settle, which left the
 * text visibly unlinted for as long as the popup was up.
 *
 * Linting before the popup binds also removes the danger the waiting was
 * there to avoid, because the popup now opens on the name the footnote has
 * AFTER the lint. That is why this function RETURNS that name. Null means
 * either that the lint changed nothing, or that the new definition could
 * not be picked out for certain; either way the caller keeps the name it
 * started with.
 *
 * Creations inside a table cell skip this trigger completely: editing the
 * document while a cell's sub-editor has focus is the issue #28 corruption
 * family.
 *
 * `edited` is the editor the creation wrote into. The lint only ever
 * touches the active tab's main editor, so when the creation happened
 * somewhere else, such as a carried paste into a hover popover's editor,
 * it lints nothing and lets the alerts speak for the edited note instead,
 * as they do when this trigger is off. It used to lint the active tab's
 * note, which the user had not touched (hunt 2026-10-02, pin
 * bug-paste-lints-other-note).
 */
export function lintAfterFootnoteCreation(
    plugin: FootnotePlugin,
    edited: Editor,
    relandCursor: boolean,
    seededBody?: string,
): string | null {
    if (!plugin.settings.lintOnFootnoteCreation) return null;
    // with every rule off, lint is off and its alerts stay silent, as the
    // command and the save trigger already hold (Kimi hunt cycle 2,
    // 2026-09-16)
    if (lintRulesAllDisabled(plugin)) return null;
    // The shared safety check covers Reading view as well. That is belt and
    // braces: the creation commands already refuse it, but this also stops
    // code calling in directly from editing the hidden buffer.
    const target = safeLintTarget(plugin);
    if (!target) return null;
    if (target.doc !== edited) {
        noticeLintAlerts(plugin, edited.getValue());
        return null;
    }
    const doc = target.doc;
    const before = doc.getValue();
    // Say nothing when a bad prefix blocks the lint. The insert that just
    // happened has already told the user about it.
    if (lintBlockedByPrefix(before, plugin.settings.enableFootnotePrefix) ?? lintBlockedBySectionHeading(plugin)) return null;
    const after = lintNote(plugin, before, configuredSectionHeading(plugin));
    if (after === before) {
        noticeLintAlerts(plugin, after);
        return null;
    }
    replaceMinimal(doc, before, after, target.mdView);
    showNotice("Footnotes linted.");
    noticeLintAlerts(plugin, after);
    const relocated =
        seededBody === undefined
            ? uniqueEmptyDefinitionName(doc)
            : uniqueSeededDefinitionName(doc, seededBody);
    if (relandCursor && relocated !== null) {
        jumpToFootnoteDefinition(relocated, doc.getCursor(), plugin, doc);
    }
    return relocated;
}

// Stryker disable all: this too plugs straight into a running Obsidian
// (waiting for the popup to settle, the active view, the table-cell guard).
// The unit tests cannot reach it; only the smoke tests can
// (coverage-verified 2026-08-11).
export async function runFootnoteTransformCommand(
    plugin: FootnotePlugin,
    transform: (markdown: string, sectionHeading: string) => string,
    notices: { done: string; noop: string },
) {
    // An open popup, or one that has just closed and still has a save in
    // flight, would write over a whole-document edit. So: wait for any save
    // already running, close the popup, then wait for the save that closing
    // it starts.
    await settleFootnotePopupWithFeedback();
    toggleCloseFootnotePopup();
    await settleFootnotePopupWithFeedback();

    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    // viewEditor is used because a deferred view has no editor, whatever
    // the type definitions say
    const doc = mdView && viewEditor(mdView);
    if (!mdView || !doc) return;
    // In Reading view, never edit the hidden buffer behind it (2026-08-08)
    if (readingViewActive(mdView)) return;

    // The same guard the insert commands use: never edit the document while
    // a table cell's sub-editor has focus. When that cell writes its text
    // back, it does so from the state it saw before the edit, which
    // overwrites its part of the note (issue #28 family).
    runOutsideTableCell(doc, () => {
        const before = doc.getValue();
        // An invalid footnote-prefix cancels the lint outright. Left to
        // run, reindex would treat the prefixed references as plain
        // numbers and renumber them.
        const blocked = lintBlockedByPrefix(before, plugin.settings.enableFootnotePrefix) ?? lintBlockedBySectionHeading(plugin);
        if (blocked) {
            showNotice(blocked, 8000);
            return;
        }
        const after = transform(before, configuredSectionHeading(plugin));
        if (after === before) {
            showNotice(notices.noop);
        } else {
            replaceMinimal(doc, before, after, mdView);
            showNotice(notices.done);
        }
        noticeLintAlerts(plugin, after);
    });
}
