import { MarkdownView, TFile } from "obsidian";

import type FootnotePlugin from "../main";
import { footnotePrefixProblem } from "../parsing/footnote-prefix";
import { ensureTextPropertyType } from "../editor/obsidian-internals";
import { ValidatedTextModal } from "./validated-text-modal";

import { showNotice } from "../editor/notice";
// The modal behind the "Set footnote prefix" command. One text box, which
// writes the footnote-prefix frontmatter property when the user presses
// Enter or the Save button. An invalid prefix, meaning one with spaces,
// brackets, or a trailing digit, shows the reason inside the modal and
// keeps it open until the value is fixed or the user presses Escape.
// Leaving the box empty removes the property.

export class SetFootnotePrefixModal extends ValidatedTextModal {
    private plugin: FootnotePlugin;
    private file: TFile;
    /** whether the note had a prefix when the dialog opened */
    private hadPrefix: boolean;

    constructor(plugin: FootnotePlugin, file: TFile, currentPrefix: string) {
        super(plugin.app, {
            title: "Set footnote prefix",
            fieldName: "Prefix",
            fieldDesc:
                'Written to the note\'s footnote-prefix property. With "2." the numbered command inserts [^2.1], then [^2.2], and so on. Leave empty to remove the property.',
            buttonText: "Save",
            placeholder: "2.",
            initialValue: currentPrefix,
        });
        this.plugin = plugin;
        this.file = file;
        this.hadPrefix = currentPrefix !== "";
    }

    protected async submit() {
        const prefix = this.value.trim();
        const problem = footnotePrefixProblem(prefix);
        if (problem) {
            // keep the modal open until the prefix is valid
            this.showProblem(problem);
            return;
        }
        // write any unsaved editor changes to this file first.
        // processFrontMatter edits the FILE on disk, so an autosave of a
        // stale buffer landing just afterwards would silently overwrite the
        // property we just set. This race was lost now and then until the
        // smoke suite pinned it.
        try {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (view?.file === this.file) await view.save();
            await this.plugin.app.fileManager.processFrontMatter(
                this.file,
                (frontmatter: Record<string, unknown>) => {
                    if (prefix) frontmatter["footnote-prefix"] = prefix;
                    else delete frontmatter["footnote-prefix"];
                },
            );
        } catch (error: unknown) {
            // knowing which of the two known causes fired helps with a bug
            // report, so log it. What the user sees stays plain.
            console.debug("Footnote Shortcut: the footnote-prefix write failed", error);
            // the write can fail for two reasons: the note's frontmatter is
            // malformed YAML (YAMLParseError), or the file has gone from
            // disk while the modal was open (ENOENT). Jason confirmed both
            // live, 2026-09-08 (review A7). Enter and the Save button call
            // submit() without waiting on it, so a failure used to leave the
            // modal sitting there with nothing but a console error to show
            // for it. Say what happened on the modal's own error line.
            this.showProblem(
                "Couldn't write the footnote-prefix property. Check that the note still exists and that its frontmatter is valid YAML.",
            );
            return;
        }
        // a prefix is TEXT even when it looks like a number ("2."). Without
        // being told the type, Obsidian guesses it from the values it sees
        // and can register the property as a number (reported 2026-08-12).
        if (prefix) {
            ensureTextPropertyType(this.plugin.app, "footnote-prefix");
        }
        this.close();
        if (prefix && !this.plugin.settings.enableFootnotePrefix) {
            // the property was written, but nothing reads it while the
            // feature is switched off. Without this warning the insert
            // commands would just quietly ignore the prefix the user set.
            showNotice(
                `Footnote prefix set to "${prefix}", but the "Per-note footnote prefix" setting is turned off, so it won't be used until you enable it.`,
                8000,
            );
        } else if (prefix) {
            showNotice(`Footnote prefix set to "${prefix}".`);
        } else if (this.hadPrefix) {
            // an empty box saved over no prefix removed nothing, so it
            // says nothing (Jason, 2026-10-22; item 12 of the toast
            // inventory's odd things)
            showNotice("Footnote prefix removed.");
        }
    }
}
