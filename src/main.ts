// The plugin's entry point. It registers everything: the hotkey commands,
// the settings tab, and the hook that dismisses the popup.
//
// The commands are the numbered and the named footnote (each of those is
// "insert OR navigate" - insert-or-navigate-footnotes.ts holds the cascade
// that decides which), the two inline-footnote inserts, and the
// whole-document cleanups from src/linting/.
//
// This file also loads and saves the settings, and runs the one-time
// migrations that bring old saved values up to date.
import {
  addIcon,
  MarkdownView,
  Plugin,
} from "obsidian";

import { ensureTextPropertyType, readingViewActive, VaultWithConfigEvents, viewEditor } from "./editor/obsidian-internals";
import { undoOrphanNoticeExtension } from "./editor/undo-orphan-notice";
import { FootnotePluginSettingTab, FootnotePluginSettings, DEFAULT_SETTINGS } from "./settings";
import { dismissFootnotePopup } from "./commands/footnote-popup";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote, pasteInlineFootnote } from "./commands/insert-or-navigate-footnotes";
import { footnotePrefixFromEditor } from "./parsing/footnote-prefix";
import { registerRenameFootnoteMenu, renameFootnote } from "./commands/rename-footnote";
import { deleteFootnote, registerDeleteFootnoteMenu } from "./commands/delete-footnote";
import { convertInlineToNormalCommand, convertNormalToInlineCommand } from "./commands/convert-footnotes";
import { installCarryFootnoteHooks, resetCarryRegister, wrapClipboardCommands } from "./commands/carry-footnotes-hooks";
import { SetFootnotePrefixModal } from "./commands/set-footnote-prefix";
import {
  installLintOnSave,
  installVimWriteHook,
  lintRulesAllDisabled,
  runFootnoteTransformCommand,
  lintNote,
} from "./linting/linter";

import { showNotice } from "./editor/notice";
// raise this by one whenever a new one-time settings migration is added
// to loadSettings
const CURRENT_SETTINGS_VERSION = 3;

export default class FootnotePlugin extends Plugin {
  // `declare` narrows the type of the base Plugin.settings (Obsidian
  // 1.13+) without creating a class field of our own that would hide it
  declare settings: FootnotePluginSettings;

  // The note you are looking at, but only when its text can actually be
  // edited on screen. In Reading view the editor API still works, but it
  // writes into a hidden copy of the note: the insertion is invisible and
  // the toasts talk about references you cannot see (reported 2026-08-08).
  // So the text-editing commands drop out of the command palette there.
  // "Set footnote prefix" deliberately stays available in Reading view,
  // because editing the frontmatter is a legitimate thing to do there.

  /** The full id ("plugin:command") of every editor command, noted as each one is registered. The name-the-footnote modal reads this list so that it can answer exactly these commands' hotkeys while it is open. */
  editorCommandIds: string[] = [];

  editableMarkdownView(): MarkdownView | null {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return mdView && !readingViewActive(mdView) ? mdView : null;
  }

  async onload() {
    // Jason's hand-drawn "action style" icon family, from icons/action
    // style/. Each icon has two parts.
    //
    // The main glyph says what the command does: a hash for numbered, an
    // I-beam text cursor for named and for writing an inline footnote, a
    // clipboard for paste, an alert triangle for lint, a left arrow into a
    // dashed divider for prefix, a pencil for rename.
    //
    // The small mark says which kind of footnote: a down ARROW (the jump to
    // the bottom of the note) for a regular footnote, an up chevron (the
    // "^" of "^[...]") for an inline one. The arrows sit one step lower
    // since 2026-08-13, Jason's rebalance.
    //
    // The files in icons/action style/ are raw Inkscape saves.
    // scripts/strip-inkscape-icons.mjs strips out the editor's own metadata
    // and swaps Inkscape's stroke="#000" for currentColor so themes can
    // recolor it. Paste what lands in icons/optimized/ here.
    addIcon("footnote-numbered", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g transform="translate(0,1)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><g transform="translate(-3,-1)"><path d="M 5,9 H 19" /><path d="M 5,15 H 16" /><line x1="10" x2="8" y1="3" y2="21" /><path d="M 16,3 14,21" /></g><path d="m 22,17 -3,3 -3,-3" /><path d="M 19,19 V 12" /></g></svg>`);
    addIcon("footnote-named", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g transform="translate(24,-62)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><g transform="translate(-24,27)"><path d="m12 53v-12c0-2.209 1.791-4 4-4h1" /><path d="m7 57h1a4 4 0 0 0 4-4" /><path d="m7 37h1a4 4 0 0 1 4 4" /></g><path d="m -2,80 -3,3 -3,-3" /><path d="M -5,82 V 75" /></g></svg>`);
    addIcon("footnote-lint", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m 22,18 -3,3 -3,-3" stroke="currentColor" /><path d="M 19,20 V 13" stroke="currentColor" /><g transform="translate(.006 -.019)" stroke="currentColor"><path d="M 16.588,9.019 13.73,4 c -0.766,-1.352 -2.714,-1.352 -3.48,0 l -8,14 c -0.774,1.34 0.202,3.014 1.75,3 h 8.994" fill="none" /><path d="m 11.994,9.019 v 4" /><path d="m 12,17 -0.006,0.019" /></g></g></svg>`);
    addIcon("footnote-prefix", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M 19,20 V 13" stroke="currentColor" /><path d="m 22,18 -3,3 -3,-3" stroke="currentColor" /><g stroke="currentColor"><path d="m8 7-5 5 5 5v-10" /><path d="m12 20v2" /><path d="m12 14v2" /><path d="m12 8v2" /><path d="m12 2v2" /></g></g></svg>`);
    // Delete footnote everywhere (T4, 2026-09-21; Jason's
    // icon, drawn 2026-09-21: the family's bin with the footnote arrow).
    addIcon("footnote-delete", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g transform="translate(-1)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m10 11v6" /><path d="m14 11v4" /><path d="m15 22h-8c-1.105 0-2-0.895-2-2v-14" fill="none" /><path d="M 19,6 V 9" fill="none" /><path d="m3 6h18" /><path d="m8 6v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path transform="translate(1)" d="m19 20v-7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /><path transform="translate(1)" d="m22 18-3 3-3-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></g></svg>`);
    // Convert inline footnotes to normal, and back (T6, 2026-09-21; Jason's
    // icons, drawn 2026-09-21 from the replace glyph: a dashed box and a bent
    // arrow, with the family's corner marker for the destination style).
    addIcon("footnote-to-normal", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(-1)"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M 19,20 V 13" transform="translate(1)" /><path d="m 22,18 -3,3 -3,-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(1)" /></g><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-90,12,12)"><path d="M 14,4 A 1,1 0 0 1 15,3" /><path d="M 15,10 A 1,1 0 0 1 14,9" /><path d="M 21,4 A 1,1 0 0 0 20,3" /><path d="m 21,9 a 1,1 0 0 1 -1,1" /><path d="M 3,7 6,10 9,7" /><path d="M 6,10 V 5 A 2,2 0 0 1 8,3 h 2" /></g></svg>`);
    addIcon("footnote-to-inline", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-90,12,12)"><path d="M 14,4 A 1,1 0 0 1 15,3" /><path d="M 15,10 A 1,1 0 0 1 14,9" /><path d="M 21,4 A 1,1 0 0 0 20,3" /><path d="m 21,9 a 1,1 0 0 1 -1,1" /><path d="M 3,7 6,10 9,7" /><path d="M 6,10 V 5 A 2,2 0 0 1 8,3 h 2" /></g><path d="m 22,19 -3,-3 -3,3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`);
    addIcon("footnote-rename", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M 19,20 V 13" /><path d="m 22,18 -3,3 -3,-3" /><path d="M 19.005,8.96 21.174,6.812 v 0 C 23.832,4.155 19.846,0.168 17.188,2.825 L 3.842,16.174 c -0.232,0.232 -0.404,0.517 -0.5,0.83 l -1.321,4.352 c -0.114,0.381 0.242,0.737 0.623,0.622 l 4.353,-1.32 c 0.313,-0.095 0.598,-0.266 0.83,-0.497 l 7.177,-7.197" /></g></svg>`);
    addIcon("footnote-inline-cursor", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="translate(0,-62)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><g transform="translate(0,62)"><path d="m12 18v-12c0-2.2091 1.7909-4 4-4h1"/><path d="m7 22h1a4 4 0 0 0 4-4"/><path d="m7 2h1a4 4 0 0 1 4 4"/></g><path d="m22 81-3-3-3 3"/></g></svg>`);
    addIcon("footnote-inline-paste", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><g transform="translate(0,-27)"><rect x="8" y="29" width="8" height="4" rx="1" ry="1"/><path d="m16 31h2c1.1046 0 2 0.89543 2 2v6m-7 10h-7c-1.1046 0-2-0.89543-2-2v-14c0-1.1046 0.89543-2 2-2h2"/></g><path d="m22 19-3-3-3 3"/></g></svg>`);

    await this.loadSettings();

    // No default hotkeys, which is what Obsidian's plugin guidelines ask
    // for (considered and reverted 2026-08-07). The README tells users to
    // bind their own and recommends Alt+0 and Alt+- for these two core
    // commands. All four insert commands register the same way: available
    // exactly while an editable markdown view is active.
    const insertCommands: Array<{
      id: string;
      name: string;
      icon: string;
      run: (plugin: FootnotePlugin) => Promise<void>;
    }> = [
      {
        id: "insert-autonumbered-footnote",
        name: "Insert / navigate numbered footnote",
        icon: "footnote-numbered",
        run: insertAutonumFootnote,
      },
      {
        id: "insert-named-footnote",
        name: "Insert / navigate named footnote",
        icon: "footnote-named",
        run: insertNamedFootnote,
      },
      {
        id: "insert-inline-footnote",
        name: "Insert inline footnote",
        icon: "footnote-inline-cursor",
        run: insertInlineFootnote,
      },
      {
        id: "paste-inline-footnote",
        name: "Insert inline footnote from clipboard",
        icon: "footnote-inline-paste",
        run: pasteInlineFootnote,
      },
    ];
    for (const command of insertCommands) {
      this.addCommand({
        id: command.id,
        name: command.name,
        icon: command.icon,
        checkCallback: (checking: boolean) => {
          if (checking) return !!this.editableMarkdownView();
          void command.run(this);
        },
      });
      // record every editor command's FULL id as it registers. The
      // name-the-footnote modal turns these into hotkey combos on its own
      // keyboard scope, and building the list right here means it can never
      // drift from what is actually registered
      this.editorCommandIds.push(`${this.manifest.id}:${command.id}`);
    }
    this.addCommand({
      id: "rename-footnote",
      name: "Rename footnote",
      icon: "footnote-rename",
      checkCallback: (checking: boolean) => {
        if (checking) return !!this.editableMarkdownView();
        void renameFootnote(this);
      },
    });
    this.editorCommandIds.push(`${this.manifest.id}:rename-footnote`);
    // right-click, or long-press on mobile, on a footnote also offers the
    // rename, the way Obsidian's own "Rename this heading" does on a
    // heading line
    registerRenameFootnoteMenu(this);
    // Delete a footnote everywhere: its definition and EVERY reference to
    // it, in one step. Obsidian's own right-click "Delete footnote and
    // reference" removes only the clicked reference, so a footnote cited
    // twice keeps a dangling reference (Jason's report 2026-09-19; T4 of
    // the 2026-09 feature round). The command, the right-click item and the
    // phone's toolbar icon all run the same thing.
    this.addCommand({
      id: "delete-footnote",
      name: "Delete footnote everywhere",
      icon: "footnote-delete",
      checkCallback: (checking: boolean) => {
        if (checking) return !!this.editableMarkdownView();
        void deleteFootnote(this);
      },
    });
    this.editorCommandIds.push(`${this.manifest.id}:delete-footnote`);
    registerDeleteFootnoteMenu(this);
    // Convert a whole note's footnotes between the two styles (T6 of the
    // 2026-09 feature round). Obsidian's embed renderer drops normal
    // footnote definitions, so people switched to inline by hand before
    // transcluding, permanently; these make it one keystroke each way, and
    // the merge on the way back restores a shared definition.
    this.addCommand({
      id: "convert-inline-to-normal",
      name: "Convert inline footnotes to normal footnotes",
      icon: "footnote-to-normal",
      checkCallback: (checking: boolean) => {
        if (checking) return !!this.editableMarkdownView();
        void convertInlineToNormalCommand(this);
      },
    });
    this.editorCommandIds.push(`${this.manifest.id}:convert-inline-to-normal`);
    this.addCommand({
      id: "convert-normal-to-inline",
      name: "Convert normal footnotes to inline footnotes",
      icon: "footnote-to-inline",
      checkCallback: (checking: boolean) => {
        if (checking) return !!this.editableMarkdownView();
        void convertNormalToInlineCommand(this);
      },
    });
    this.editorCommandIds.push(`${this.manifest.id}:convert-normal-to-inline`);
    // Copy, cut, and paste carry footnote definitions along (issue #59).
    // Nothing to register in the palette: the hooks sit on the keys people
    // already press, and the setting turns them off.
    installCarryFootnoteHooks(this);
    this.addCommand({
      id: "set-footnote-prefix",
      name: "Set footnote prefix",
      icon: "footnote-prefix",
      checkCallback: (checking: boolean) => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (checking) return !!mdView?.file;
        if (!mdView?.file) return;
        // prefill the box with the note's current prefix, so changing it is
        // one step. Only the frontmatter block is read, not the whole
        // document getValue() would hand back (2026-08-11 review,
        // performance item)
        const editor = viewEditor(mdView);
        new SetFootnotePrefixModal(
          this,
          mdView.file,
          editor ? footnotePrefixFromEditor(editor) : "",
        ).open();
      },
    });
  
    // The ONE whole-document cleanup command, the way the Linter plugin
    // does it. The individual rules are toggles in the settings rather than
    // commands of their own, which keeps the palette uncluttered.
    this.addCommand({
      id: "lint-footnotes",
      name: "Lint footnotes",
      icon: "footnote-lint",
      checkCallback: (checking: boolean) => {
        if (checking) return !!this.editableMarkdownView();
        // with every rule turned off the lint does nothing at all, so say
        // that plainly instead of the misleading "No linting needed."
        if (lintRulesAllDisabled(this)) {
          showNotice(
            "All lint rules are turned off in the plugin settings, so there is nothing to lint.",
          );
          return;
        }
        void runFootnoteTransformCommand(
          this,
          (markdown, sectionHeading) =>
            lintNote(this, markdown, sectionHeading),
          {
            done: "Footnotes linted.",
            noop: "No linting needed.",
          },
        );
      },
    });

    this.addSettingTab(new FootnotePluginSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        dismissFootnotePopup();
        // vim mode can be switched on at any moment, and until it is
        // hooked its ":w" goes around the save command, so re-check on
        // every leaf change
        installVimWriteHook(this);
      })
    );
    // "Lint on save" wraps the core save command; the original is put back
    // on unload
    installLintOnSave(this);
    // partial-undo feedback: an undo that leaves a reference with no
    // definition (the two-step table-cell undo, the definition press of the
    // named flow) says so, instead of leaving a half-reverted note with no
    // explanation (2026-08-27)
    this.registerEditorExtension(undoOrphanNoticeExtension());
    this.app.workspace.onLayoutReady(() => {
      installVimWriteHook(this);
      // Obsidian's own Cut, Copy, and Paste commands on a phone carry
      // footnote definitions too, once the app has registered them
      // (wrapClipboardCommands, 2026-10-04)
      wrapClipboardCommands(this);
      // with the prefix feature on, pin the plugin's own footnote-prefix
      // property to TEXT. Otherwise a value that looks numeric ("2.")
      // teaches Obsidian's type guessing to file it as a number, and the
      // Properties panel then mangles edits to it as numbers (reported
      // 2026-08-12; the Set-footnote-prefix modal pins it on write too)
      if (this.settings.enableFootnotePrefix) {
        ensureTextPropertyType(this.app, "footnote-prefix");
      }
    });
    // switching vim mode on mid-session loads the adapter without any leaf
    // change happening, and config-changed is what catches that moment
    this.registerEvent(
      (this.app.vault as unknown as VaultWithConfigEvents).on(
        "config-changed",
        () => {
          installVimWriteHook(this);
        },
      ),
    );
  }

  onunload() {
    dismissFootnotePopup();
    resetCarryRegister();
  }

  async loadSettings() {
    const raw: unknown = await this.loadData();
    const saved = parseSavedSettings(raw);
    // The parser drops a settingsVersion saved with the wrong type (the
    // string "2", or null, from a hand edit or a sync merge), and version
    // 0 would then re-run every shape-based migration over data a current
    // build wrote: the heading-mangle bug through a different door (Claude
    // sweep 2026-09-13). A file that has the key at all was written by a
    // build that knew about versions, so a numeric string is read as its
    // number and anything else counts as current. An empty or blank
    // string is no number, though JavaScript's Number() reads it as 0,
    // which re-ran the heading migration (hunt 2026-10-02, pin
    // bug-settings-blank-version-reruns-migration).
    const rawVersion =
      typeof raw === "object" && raw !== null && "settingsVersion" in raw
        ? (raw as Record<string, unknown>).settingsVersion
        : undefined;
    if (rawVersion !== undefined && typeof rawVersion !== "number") {
      const asNumber = typeof rawVersion === "string" && rawVersion.trim() !== "" ? Number(rawVersion) : NaN;
      saved.settingsVersion = Number.isFinite(asNumber) ? asNumber : CURRENT_SETTINGS_VERSION;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    // One-time migrations of legacy settings, gated on settingsVersion.
    //
    // The gate matters because some of them rewrite a saved value based on
    // its SHAPE, so re-running them on every load can mangle a value the
    // user chose deliberately in the new style: a saved "**Footnotes**"
    // heading used to gain a "# " on every restart (bug confirmed against
    // the live app 2026-08-08, pinned in test/hunt/).
    //
    // Version 0 means either data from before the flag existed or a fresh
    // install, where everything below does nothing. All the migrations
    // share ONE save at the end.
    if (this.settings.settingsVersion < CURRENT_SETTINGS_VERSION) {
      // each migration is gated on the version it upgrades FROM, so a
      // later version bump can never re-run an earlier shape-based rewrite
      // over values the user saved deliberately in the meantime (that is
      // the heading-mangle bug)
      if (this.settings.settingsVersion < 1) {
        migrateSettingsToV1(this.settings, saved);
      }
      if (this.settings.settingsVersion < 2) {
        migrateSettingsToV2(this.settings);
      }
      if (this.settings.settingsVersion < 3) {
        migrateSettingsToV3(this.settings);
      }
      this.settings.settingsVersion = CURRENT_SETTINGS_VERSION;
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/**
 * The saved data.json, trusted only where a value's type matches the type
 * of its default.
 *
 * Why: a hand edit or a sync merge can leave something like
 * `"lintReindex": "no"` in the file. The old cast let that straight into
 * plugin.settings, where every `if (settings.lintReindex)` read the string
 * as true, so the toggle showed ON and the lint renumbered (review A9,
 * Jason confirmed against the live app 2026-09-08). A mistyped value now
 * falls back to the default.
 *
 * Keys the defaults know nothing about pass through untouched, because the
 * one-time migrations below read the legacy keys out of them (and delete
 * them).
 */
/** The settings whose value is one of a few names, and those names. */
const FIXED_CHOICES: Record<string, readonly string[]> = {
  footnotePlacement: ["after", "before", "none"],
  footnoteNaming: ["keep", "numbered", "named"],
};

function parseSavedSettings(saved: unknown): Partial<FootnotePluginSettings> {
  if (typeof saved !== "object" || saved === null) return {};
  const defaultTypes = new Map(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, typeof value]),
  );
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(saved)) {
    const expected = defaultTypes.get(key);
    if (expected !== undefined && typeof value !== expected) continue;
    // a string setting with a fixed set of values is trusted only for one
    // of those values: any other string would reach every reader and be
    // treated as none of them (T5, 2026-09-21)
    if (key in FIXED_CHOICES && !FIXED_CHOICES[key].includes(value as string)) continue;
    parsed[key] = value;
  }
  return parsed;
}

// ---- one-time settings migrations, one function per version bump ----
// (loadSettings decides which of them run, based on the version being
// upgraded FROM)

/** v1: everything that changed between the 0.1.x shape and 0.2.0-beta. The
 * PascalCase heading key, heading text that implied an H1, the autosuggest
 * toggle that no longer exists, and the beta.5/6 rename of the tidy* keys
 * to their lint* names. */
function migrateSettingsToV1(
  settings: FootnotePluginSettings,
  saved: Partial<FootnotePluginSettings> | null,
) {
  // data saved by 0.1.x used a PascalCase key for the section heading
  const legacySettings = settings as FootnotePluginSettings & {
    FootnoteSectionHeading?: string;
    enableAutoSuggest?: boolean;
  };
  // if the saved data SOMEHOW carries both keys (a downgrade, or a
  // data.json merged by sync; no real upgrade path produces it), the
  // newer camelCase value wins (decided 2026-08-10)
  if (
    typeof legacySettings.FootnoteSectionHeading === "string" &&
    typeof saved?.footnoteSectionHeading !== "string"
  ) {
    settings.footnoteSectionHeading = legacySettings.FootnoteSectionHeading;
  }
  delete legacySettings.FootnoteSectionHeading;

  // bring pre-0.2.0 section heading values forward: the old text input
  // implied an H1, while the textarea that replaced it takes literal
  // markdown
  const heading = settings.footnoteSectionHeading;
  if (heading && !/^(#{1,6} |---|\*\*\*|___)/.test(heading)) {
    settings.footnoteSectionHeading = `# ${heading}`;
  }

  // drop the setting for the autosuggest feature that was removed
  // (Obsidian suggests footnotes itself now)
  delete legacySettings.enableAutoSuggest;

  // The linting settings shipped under tidy* key names in beta.5/6. Copy
  // each saved tidy* value onto its lint* name and drop the old key, so
  // beta testers keep the toggle choices they made.
  //
  // Each key is written out one at a time, rather than looped over a rename
  // map, so TypeScript can check every move. withTidyKeys is the very same
  // object as `settings`, so writing through it sets the real lint* setting
  const withTidyKeys = settings as FootnotePluginSettings & {
    tidyFixPunctuation?: boolean;
    tidyMoveToBottom?: boolean;
    tidyReindex?: boolean;
    tidyOnSave?: boolean;
    lintOnFileChange?: unknown;
    tidyOnFileChange?: unknown;
  };
  // each copy is guarded by a typeof check, like migrateSettingsToV2's.
  // parseSavedSettings knows nothing about the tidy* keys, so without the
  // guard a mistyped one would land on its lint* name as a string that
  // counts as true (second review 2026-09-09)
  if (typeof withTidyKeys.tidyFixPunctuation === "boolean") {
    withTidyKeys.lintFixPunctuation = withTidyKeys.tidyFixPunctuation;
  }
  delete withTidyKeys.tidyFixPunctuation;
  if (typeof withTidyKeys.tidyMoveToBottom === "boolean") {
    withTidyKeys.lintMoveToBottom = withTidyKeys.tidyMoveToBottom;
  }
  delete withTidyKeys.tidyMoveToBottom;
  if (typeof withTidyKeys.tidyReindex === "boolean") {
    withTidyKeys.lintReindex = withTidyKeys.tidyReindex;
  }
  delete withTidyKeys.tidyReindex;
  if (typeof withTidyKeys.tidyOnSave === "boolean") {
    withTidyKeys.lintOnSave = withTidyKeys.tidyOnSave;
  }
  delete withTidyKeys.tidyOnSave;
  // the lint-on-focused-file-change trigger was replaced by lint on
  // footnote creation (2026-08-05). Its saved keys are dropped rather than
  // carried over, because the two mean different things
  delete withTidyKeys.lintOnFileChange;
  delete withTidyKeys.tidyOnFileChange;
}

/** v2 (2026-08-10): the two orphan settings became a matching pair of
 * delete toggles. keepOrphanedDefinitions, which shipped in the betas,
 * carries over with its true and false swapped. The short-lived
 * lintOrphanedMarkers dropdown only ever existed in dev builds, but mapping
 * it across costs just as little. */
/** v3: the Renumber named footnotes toggle and the converter's own naming
 * dropdown folded into one Preferred footnote naming style choice (Jason, 2026-09-22). A
 * user who renumbered named footnotes is on Numbered; one who named
 * converted footnotes is on Named; everyone else keeps names as written,
 * which is what their notes had. */
function migrateSettingsToV3(settings: FootnotePluginSettings) {
  const legacy = settings as FootnotePluginSettings & {
    renumberNamedFootnotes?: boolean;
    convertedFootnoteNames?: string;
  };
  if (legacy.renumberNamedFootnotes === true) {
    settings.footnoteNaming = "numbered";
  } else if (legacy.convertedFootnoteNames === "named") {
    settings.footnoteNaming = "named";
  }
  delete legacy.renumberNamedFootnotes;
  delete legacy.convertedFootnoteNames;
}

function migrateSettingsToV2(settings: FootnotePluginSettings) {
  const legacyOrphans = settings as FootnotePluginSettings & {
    keepOrphanedDefinitions?: boolean;
    lintOrphanedMarkers?: string;
  };
  if (typeof legacyOrphans.keepOrphanedDefinitions === "boolean") {
    settings.lintDeleteOrphanedDefinitions =
      !legacyOrphans.keepOrphanedDefinitions;
    delete legacyOrphans.keepOrphanedDefinitions;
  }
  if (legacyOrphans.lintOrphanedMarkers !== undefined) {
    settings.lintDeleteOrphanedReferences =
      legacyOrphans.lintOrphanedMarkers === "delete";
    delete legacyOrphans.lintOrphanedMarkers;
  }
}