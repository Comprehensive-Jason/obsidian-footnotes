// The settings: their shape, their defaults, and the settings tab itself.
// Obsidian 1.13+ is required, because the tab is built from
// getSettingDefinitions(): you describe the controls and Obsidian renders
// them and saves them for you.
import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type FootnotePlugin from "./main";
import { AppWithPlugins } from "./editor/obsidian-internals";
import type { FootnotePlacement } from "./parsing/landing";

export interface FootnotePluginSettings {
    /** Records which one-time migrations this saved data has already been
     * through (see loadSettings). Never shown in the settings tab. */
    settingsVersion: number;
    insertAtEndOfWord: boolean;
    /** Where a reference goes relative to the punctuation after a word:
     * after it (English and most of East Asia outside the mainland and
     * Japan), before it (mainland Chinese, Japanese, French, Italian,
     * Portuguese, Polish, the EU style guide), or left at the end of the
     * word and never moved by the lint. One global choice, no per-language
     * table (Jason's ruling 2026-09-20). Read by the end-of-word hop, the
     * selection grab and the punctuation lint rule. */
    footnotePlacement: FootnotePlacement;
    /** Copying or cutting text carries the definitions its references
     * need, and pasting lands them in the destination, merged and renamed
     * to fit (issue #59; Jason, 2026-09-21: one toggle, default on, no
     * prompt). */
    carryFootnotesOnCopy: boolean;
    /** One choice for every footnote name (Jason, 2026-09-22): keep names
     * as written; numbered, so linting renumbers named footnotes too; or
     * named, so linting names numbered footnotes after their definition's
     * first meaningful word and leaves the already named alone. The
     * inline-to-normal converter follows it. Replaces the old Renumber
     * named footnotes toggle and the converter's own dropdown. */
    footnoteNaming: "keep" | "numbered" | "named";
    /** When a selection is turned into a footnote, a word the selection cut
     * in half is taken whole, and the end is moved to the end of the word
     * plus one trailing punctuation mark. The selection twin of the
     * end-of-word insertion (2026-08-29). */
    expandSelectionToWholeWords: boolean;
    enablePopupEditor: boolean;
    enableFootnotePrefix: boolean;

    enableFootnoteSectionHeading: boolean;
    footnoteSectionHeading: string;

    enableRemoveBlankLastLines: boolean;
    /** Remove the section heading when a plugin action leaves no footnotes under it (Jason, 2026-09-25; off by default, since templates carry a heading that should stay). */
    removeEmptySectionHeading: boolean;

    /** Linting deletes references that have no definition. While this is
     * off, it raises a lint alert about them instead: an orphan is never
     * silent either way (Jason, 2026-08-10). */
    lintDeleteOrphanedReferences: boolean;
    /** Linting deletes definitions that no reference points at. This does
     * not depend on reindexing. While it is off, they are kept and a lint
     * alert names them. The mirror image of lintDeleteOrphanedReferences. */
    lintDeleteOrphanedDefinitions: boolean;
    /** Linting folds any later duplicate definitions of one footnote into
     * the first, as continuation lines. Without that, Obsidian renders only
     * the last definition. While this is off, the duplicates are kept and a
     * lint alert names them, the same never-silent promise the orphan
     * toggles make (Jason, 2026-08-12). */
    lintMergeDuplicateDefinitions: boolean;
    lintFixPunctuation: boolean;
    /** Linting inserts the blank line a definition needs when its label
     * sits directly under a line of prose. Without that blank line Obsidian
     * reads the label as plain text. While this is off, the
     * lazy-definition alert speaks instead (Jason, 2026-09-09). */
    lintFixLazyDefinitions: boolean;
    lintMoveToBottom: boolean;
    lintReindex: boolean;
    lintApplyPrefix: boolean;
    lintOnSave: boolean;
    lintOnFootnoteCreation: boolean;
}

export const DEFAULT_SETTINGS: FootnotePluginSettings = {
    // Zero on purpose. Settings saved before this key existed have no
    // version at all, and those must run the one-time migrations (on a
    // fresh install the migrations find nothing to do). The migration code
    // in main.ts then stamps the current version and saves once.
    settingsVersion: 0,
    insertAtEndOfWord: true,
    // "after" is the behaviour every note had before the setting existed,
    // so nothing moves on upgrade; users of a before-punctuation convention
    // pick "before" themselves
    footnotePlacement: "after",
    carryFootnotesOnCopy: true,
    footnoteNaming: "keep",
    expandSelectionToWholeWords: true,
    enablePopupEditor: true,
    enableFootnotePrefix: false,

    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",

    enableRemoveBlankLastLines: true,
    removeEmptySectionHeading: false,

    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
    lintFixPunctuation: true,
    lintFixLazyDefinitions: true,
    lintMoveToBottom: true,
    lintReindex: true,
    lintApplyPrefix: true,
    lintOnSave: false,
    lintOnFootnoteCreation: false,
};

/**
 * A setting description with a little markup: **double asterisks** around
 * a command, setting, or dropdown name make it bold, and `backticks` around
 * footnote syntax set it in code, so a reader can tell where a name starts
 * and ends (Jason's ask, 2026-09-22: "How Convert inline footnotes to
 * normal footnotes names what it makes" read as one run of words). A line
 * break starts a new line, and lines that start with "- " become a bullet
 * list, so a description that lists a dropdown's values need not be one
 * long paragraph (Jason's ask, 2026-09-22). Obsidian renders a
 * DocumentFragment in the row; where there is no DOM (the unit tests) the
 * plain words come back with the markup stripped.
 */
function rich(text: string): string | DocumentFragment {
    if (typeof createFragment !== "function") return text.replace(/\*\*|`/g, "");
    const fragment = createFragment();
    let list: HTMLUListElement | null = null;
    let previousWasText = false;
    for (const line of text.split("\n")) {
        if (line.startsWith("- ")) {
            list ??= fragment.createEl("ul", { cls: "footnote-setting-list" });
            richInline(list.createEl("li"), line.slice(2));
            previousWasText = false;
        } else {
            list = null;
            if (previousWasText) fragment.createEl("br");
            richInline(fragment, line);
            previousWasText = true;
        }
    }
    return fragment;
}

/** One line of a description: bold names and code syntax, appended to `parent`. */
function richInline(parent: DocumentFragment | HTMLElement, line: string): void {
    for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
        if (part.startsWith("**")) parent.createEl("b", { text: part.slice(2, -2) });
        else if (part.startsWith("`")) parent.createEl("code", { text: part.slice(1, -1) });
        else if (part) parent.appendText(part);
    }
}

export class FootnotePluginSettingTab extends PluginSettingTab {
    plugin: FootnotePlugin;

    constructor(app: App, plugin: FootnotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Each control below is tied to one key in this.plugin.settings by name.
    // Obsidian reads and writes that key itself and saves automatically.
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: "Edit footnotes in a popup",
                desc: rich("Open the footnote definition in a small editor where you're typing, instead of jumping to the bottom of the note. Close with the footnote hotkey, the escape key, or by clicking outside."),
                control: { type: "toggle", key: "enablePopupEditor" },
            },
            {
                name: "Carry footnote definitions on copy, cut, and paste",
                desc: rich(
                    "Copying or cutting a footnote reference takes its definition along so:\n" +
                        "- Pasting inside Obsidian puts the definitions where they belong, reusing duplicates and renaming names that clash.\n" +
                        "- Pasting outside Obsidian leaves them after the pasted text.",
                ),
                control: { type: "toggle", key: "carryFootnotesOnCopy" },
            },
            {
                type: "group",
                heading: "Footnote reference placement",
                items: [
                    {
                        name: "Insert footnote reference at end of word",
                        desc: rich("A new footnote reference goes at the end of the word rather than inside it, on the side of any following punctuation chosen in the setting below."),
                        control: { type: "toggle", key: "insertAtEndOfWord" },
                    },
                    {
                        name: "Placement relative to punctuation",
                        // Jason's pick A of three, 2026-09-21: no language list, people
                        // know what they want; the README keeps the conventions
                        desc: rich(
                            "Where the footnote reference goes relative to following punctuation, for new footnotes inserted at the end of the word, converted selections, and linting:\n" +
                                "- **After punctuation**: `word.[^1]`\n" +
                                "- **Before punctuation**: `word[^1].`\n" +
                                "- **Don't move**: the reference stays at the end of the word\n" +
                                "The first two always step over closing quotation marks and brackets; **Don't move** steps over nothing.",
                        ),
                        control: {
                            type: "dropdown",
                            key: "footnotePlacement",
                            options: { after: "After punctuation", before: "Before punctuation", none: "Don't move" },
                        },
                    },
                    {
                        name: "Expand selections to whole words",
                        desc: rich("When a selection is turned into a footnote, cut-off words at either end are included whole. The punctuation after the last word is included only under **After punctuation**, so that the reference lands after it."),
                        control: { type: "toggle", key: "expandSelectionToWholeWords" },
                    },
                ],
            },
            {
                type: "group",
                heading: "Footnote names",
                items: [
                    {
                        name: "Preferred footnote naming style",
                        // Jason's pick A of three, 2026-09-22: lead with what follows the
                        // setting, since the insert hotkeys deliberately do not
                        // Jason's own merge of two drafts, 2026-09-22, one bullet per value
                        desc: rich(
                            "Followed by linting and by **Convert inline footnotes to normal footnotes**, not by the numbered and named insert commands.\n" +
                                "- **Keep as written**: changes nothing, while converted inline footnotes get numbers\n" +
                                "- **Numbered**: renumbers named footnotes by order of appearance\n" +
                                "- **Named**: names numbered footnotes after the first meaningful word of their definition (`[^1]: the Smith paper` becomes `[^Smith]`, with `-2, -3` for repeats) and leaves already named ones alone",
                        ),
                        control: {
                            type: "dropdown",
                            key: "footnoteNaming",
                            options: { keep: "Keep as written", numbered: "Numbered", named: "Named" },
                        },
                    },
                    {
                        name: "Per-note footnote prefix",
                        desc: rich(
                            "Footnotes use the note's `footnote-prefix` property, set with the **Set footnote prefix** command. With `footnote-prefix: 2-`:\n" +
                                "- The numbered command inserts `[^2-1]`, `[^2-2]`, and so on.\n" +
                                "- The named command prefills `[^2-]`.\n" +
                                "Useful when chapter notes merge into one document.",
                        ),
                        control: { type: "toggle", key: "enableFootnotePrefix" },
                    },
                ],
            },
            {
                type: "group",
                heading: "Footnotes section",
                items: [
                    {
                        name: "Enable section heading",
                        desc: rich("Adds a heading above the footnote definitions at the bottom of the note. An existing one is reused."),
                        control: { type: "toggle", key: "enableFootnoteSectionHeading" },
                    },
                    {
                        name: "Section heading",
                        desc: rich("Heading to place above the footnotes section. Accepts standard Markdown, including multiple lines and dividers."),
                        control: {
                            type: "textarea",
                            key: "footnoteSectionHeading",
                            rows: 6,
                            placeholder: "Ex: '# Footnotes'",
                            disabled: () => !this.plugin.settings.enableFootnoteSectionHeading,
                        },
                    },
                    {
                        name: "Trim blank lines",
                        desc: rich("Remove blank lines from the end of the note when the first footnote (and its section heading, if enabled) is added at the bottom."),
                        control: { type: "toggle", key: "enableRemoveBlankLastLines" },
                    },
                    {
                        name: "Remove empty section heading",
                        // off by default (Jason, 2026-09-25): a template's
                        // References heading should stay even while empty
                        desc: rich("When **Convert normal footnotes to inline footnotes**, **Delete footnote everywhere**, a cut, or linting leaves no footnotes under the section heading, and nothing else below it, the heading goes too. Leave it off if your template always carries the heading."),
                        control: {
                            type: "toggle",
                            key: "removeEmptySectionHeading",
                            disabled: () => !this.plugin.settings.enableFootnoteSectionHeading,
                        },
                    },
                ],
            },
            {
                type: "page",
                name: "Linting",
                desc: rich("Lint triggers, cleanup rules, and reindexing."),
                items: [
                    {
                        // A row with no control: it shows as plain information
                        // text. It only appears while the Linter community
                        // plugin is enabled. Jason verified on 2026-08-08 that
                        // the two plugins get along, except when Linter's own
                        // footnote rules rewrite the same footnotes this plugin
                        // does.
                        name: "Using the Linter plugin?",
                        desc: rich("Turn off Linter's own footnote rules (**footnote after punctuation**, **move footnotes to the bottom**, **re-index footnotes**) so the two plugins don't fight over the same footnotes."),
                        visible: () =>
                            !!(this.app as AppWithPlugins).plugins?.plugins?.[
                                "obsidian-linter"
                            ],
                    },
                    {
                        name: "Lint on save",
                        desc: rich("Lint the note when it is saved by hand (`Ctrl+S`, or `:w` with Vim key bindings)."),
                        control: { type: "toggle", key: "lintOnSave" },
                    },
                    {
                        name: "Lint on footnote creation",
                        desc: rich("Lint the note right after a new footnote is created in it, including when the convert commands or a paste create them."),
                        control: { type: "toggle", key: "lintOnFootnoteCreation" },
                    },
                    {
                        type: "group",
                        heading: "Rules",
                        items: [
                            {
                                name: "Fix footnote reference placement",
                                desc: rich("Linting moves footnote references to the side of punctuation that **Placement relative to punctuation** is set to. Disabled when set to **Don't move**."),
                                control: {
                                    type: "toggle",
                                    key: "lintFixPunctuation",
                                    // under Don't move the rule is idle, so the
                                    // toggle is greyed rather than left looking
                                    // live (Jason, 2026-09-21)
                                    disabled: () => this.plugin.settings.footnotePlacement === "none",
                                },
                            },
                            {
                                name: "Move definitions to the footnote section",
                                desc: rich("Linting gathers all footnote definitions under the note's existing section heading, or at the end of the note when there is none."),
                                control: { type: "toggle", key: "lintMoveToBottom" },
                            },
                            {
                                name: "Fix definitions hidden by a missing blank line",
                                desc: rich("Linting inserts the blank line a footnote definition needs when its `[^7]:` line sits directly under a paragraph, list item, or quote line (Obsidian reads such a line as plain text and shows no footnote). While off, linting alerts you about them instead."),
                                control: { type: "toggle", key: "lintFixLazyDefinitions" },
                            },
                            {
                                name: "Apply the note's footnote prefix",
                                desc: rich("Linting adds the note's `footnote-prefix` to plain footnotes and renumbers the prefixed ones within their namespace. The **Rename footnote** command adds the prefix the same way. While off, prefixed footnotes are treated as named and keep their names."),
                                control: {
                                    type: "toggle",
                                    key: "lintApplyPrefix",
                                    disabled: () => !this.plugin.settings.enableFootnotePrefix,
                                },
                            },
                        ],
                    },
                    {
                        // Orphans and duplicates get a section of their own
                        // (Jason, 2026-08-10 and 2026-08-12). The three toggles
                        // work the same way: while one is off, linting does not
                        // ignore that kind of problem, it alerts you about it
                        // instead. Lint is never silent.
                        type: "group",
                        heading: "Orphans and duplicates",
                        items: [
                            {
                                name: "Delete orphaned references",
                                desc: rich("Linting deletes footnote references that have no definition (a `[^5]` with no `[^5]:` line, which Obsidian renders as plain text). While off, linting alerts you about them instead."),
                                control: {
                                    type: "toggle",
                                    key: "lintDeleteOrphanedReferences",
                                },
                            },
                            {
                                name: "Delete orphaned definitions",
                                desc: rich("Linting deletes footnote definitions that have no references (a `[^6]:` line with no `[^6]`, which Obsidian doesn't render). While off, linting alerts you about them instead and reindexing numbers them after everything else."),
                                control: {
                                    type: "toggle",
                                    key: "lintDeleteOrphanedDefinitions",
                                },
                            },
                            {
                                name: "Merge duplicate definitions",
                                desc: rich("Linting merges later duplicate definitions of the same footnote into the first one, keeping every body (Obsidian only renders the last definition otherwise). While off, linting alerts you about duplicates instead."),
                                control: {
                                    type: "toggle",
                                    key: "lintMergeDuplicateDefinitions",
                                },
                            },
                        ],
                    },
                    {
                        type: "group",
                        heading: "Reindexing",
                        items: [
                            {
                                name: "Reindex",
                                // Jason's pick A of three, 2026-09-22: the value before the action, so
                                // the pairing reads left to right
                                desc: rich(
                                    "Linting also reindexes footnotes and reorders their definitions by order of appearance. **Preferred footnote naming style** decides what happens to names.",
                                ),
                                control: { type: "toggle", key: "lintReindex" },
                            },
                        ],
                    },
                ],
            },
        ];
    }
}
