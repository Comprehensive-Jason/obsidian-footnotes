import { EditorView } from "@codemirror/view";
import {
    App,
    Editor,
    EditorPosition,
    EventRef,
    Hotkey,
    MarkdownView,
    TFile,
    Vault,
} from "obsidian";

// Typed descriptions of the Obsidian and CodeMirror internals this plugin
// leans on. Obsidian documents none of them, so any release could rename or
// remove one. Two habits keep that risk small: only the members the plugin
// really uses are declared here, and anything a release could take away is
// marked optional, so the code using it checks first and quietly does
// nothing instead of crashing.

/** CodeMirror 6's EditorView, the real editor behind Obsidian's Editor.
 * Reached through the undocumented `Editor.cm`. */
interface ObsidianEditorView {
    state: { selection: { main: { head: number } } };
    coordsAtPos(pos: number): { left: number; top: number; bottom: number } | null;
    /** Turns a DOM element inside the editor into a position in the
     * document's text. It works for elements Obsidian draws itself, such as
     * the table editor. This one is standard CodeMirror 6 API. */
    posAtDOM?(node: Node): number;
    contentDOM: HTMLElement;
    focus(): void;
    /** The old-style (CodeMirror 5) editor the vim extension attaches, which
     * is why the code reads `cm.cm`, two levels deep. `state.vim.insertMode`
     * is how the popup's Escape handling tells one job from the other: leave
     * vim's insert mode, or close the popup. The keypress itself cannot say,
     * because the editor calls preventDefault on EVERY Escape (2026-08-13). */
    cm?: { state?: { vim?: { insertMode?: boolean } } };
}

export interface EditorWithCm extends Editor {
    cm?: ObsidianEditorView;
}

/**
 * The CodeMirror 6 view behind an Obsidian editor, typed as the real
 * thing, for the few places that need its scroll geometry (which line sits
 * at the top of the window, how tall a line is), or undefined where there
 * is none, as with the unit tests' stand-in editor. Obsidian hands plugins
 * its own copy of the CodeMirror modules, so the class here is the class
 * of the live view (write-back.ts relies on that for its scroll effect).
 */
export function codeMirrorViewOf(editor: Editor): EditorView | undefined {
    return (editor as unknown as { cm?: EditorView }).cm;
}

/**
 * The editor of a markdown view, or null when there is not one yet.
 *
 * Obsidian's types promise that every MarkdownView has an editor. That is
 * not true: since Obsidian 1.7 a tab you have not opened yet is only loaded
 * when you need it, and until then it has no editor. Every command entry
 * point asks through this function instead of trusting the declared type.
 */
export function viewEditor(view: MarkdownView): Editor | null {
    return (view as { editor?: Editor }).editor ?? null;
}

/** Obsidian's undocumented record of which type each note property has, the
 * one the Properties panel reads (Obsidian 1.4+). Every member is optional:
 * if a future release renames any of it, the plugin must quietly do nothing
 * rather than crash. */
interface MetadataTypeManager {
    getPropertyInfo?(name: string): { widget?: string } | null | undefined;
    setType?(name: string, type: string): void;
}

interface AppWithMetadataTypeManager extends App {
    metadataTypeManager?: MetadataTypeManager;
}

/**
 * Tell Obsidian that the property `name` holds text, everywhere in the
 * vault.
 *
 * Why it is needed: when nobody has said what type a property is, Obsidian
 * GUESSES from the values it sees. A prefix like "2." looks numeric, so
 * Obsidian filed the footnote-prefix property as a NUMBER, and from then on
 * the Properties panel mangled edits to it as numbers (reported
 * 2026-08-12). Saying "text" outright is saved in types.json and beats the
 * guess.
 *
 * Does nothing when the type is already text, or when the registry is
 * missing.
 */
export function ensureTextPropertyType(app: App, name: string): void {
    const manager = (app as AppWithMetadataTypeManager).metadataTypeManager;
    if (!manager?.setType) return;
    if (manager.getPropertyInfo?.(name)?.widget === "text") return;
    try {
        manager.setType(name, "text");
    } catch {
        // undocumented API: if its shape changes, swallow the error rather
        // than break whatever command asked for this
    }
}

/** Whether `mdView` is showing Reading view. Every text-editing command has
 * to do nothing there: the editor API would happily write, but it would
 * write into the HIDDEN buffer, so you would see no change. The parameter is
 * described by its shape instead of typed as MarkdownView, which keeps
 * getMode honestly optional, so a bare test fake without it counts as
 * editable. It sits next to viewEditor because both answer "what is this
 * view really?" (moved out of doc-context for cleanliness, 2026-08-11
 * review). */
export function readingViewActive(mdView: {
    getMode?: MarkdownView["getMode"];
}): boolean {
    return mdView.getMode?.() === "preview";
}

/**
 * Whether the Live Preview properties box holds the keyboard focus.
 *
 * Obsidian draws that box OUTSIDE CodeMirror's own content element, so
 * while you type in a property the main editor's caret is still sitting
 * wherever you last clicked in the prose. A footnote press that trusted
 * that stale caret created a footnote far from where you were looking
 * (Jason's manual pass, 2026-09-04). In Source mode the same press is refused
 * because the caret is on a protected line; this guard is the Live Preview
 * twin of that refusal.
 *
 * The parameter is described by its shape, so a bare test fake with no
 * container counts as "not the properties box".
 */
export function propertiesWidgetOwnsFocus(mdView: {
    containerEl?: {
        ownerDocument: { activeElement: { closest(selector: string): unknown } | null };
    };
}): boolean {
    const active = mdView.containerEl?.ownerDocument.activeElement;
    return !!active?.closest(".metadata-container");
}

/** The editable markdown embed that Obsidian's embed registry hands back. */
interface MarkdownEmbed {
    editable: boolean;
    dirty?: boolean;
    saving?: boolean;
    saveAgain?: boolean;
    subpathNotFound?: boolean;
    /** The section's text as it stood at the last set() call, NOT what the
     * editor is showing right now. save() reads this when it retries. */
    text?: string;
    /**
     * The whole file as the embed last joined it: the text before the
     * section, the section, and the text after. save(text, false) fills it
     * with the join for `text` WITHOUT writing the file (probed live
     * 2026-09-16), which is how the popup hands its definition to the main
     * editor instead of letting the embed write the file itself.
     */
    data?: string;
    /** The file's text in front of the section the embed edits, label included ("...\n\n[^1]: "), and the text after it. Stable across saves. */
    before?: string;
    after?: string;
    editMode?: {
        editor?: {
            focus(): void;
            lastLine?(): number;
            getLine?(line: number): string;
            getValue?(): string;
            setCursor?(pos: EditorPosition): void;
        };
    };
    load(): void;
    unload(): void;
    loadFile(): Promise<void>;
    showEditor(): void;
    /**
     * Save right now. (`requestSave` is the same thing on a delay.)
     *
     * Both arguments are REQUIRED. Obsidian's save(t, n) hands t straight
     * to set(), and set(undefined) throws deep inside the save chain and
     * also poisons `this.text`, so the embed's own later saves crash where
     * nothing catches them. That was the console error when saves arrived
     * in rapid succession, root-caused against the live app 2026-08-13. And
     * n defaults to FALSE, which skips writing to disk altogether.
     */
    save?(text: string, write: boolean): Promise<void> | void;
    /** The delayed save and fold-save wrappers (Obsidian debounce objects).
     * A timer still armed when the embed unloads fires against embed state
     * that has already been CLEARED and throws deep in the save chain
     * (reported 2026-08-13), so teardown cancels both. */
    requestSave?: { cancel?(): void };
    requestSaveFolds?: { cancel?(): void };
}

type EmbedCreator = (
    context: {
        app: App;
        linktext: string;
        sourcePath: string;
        containerEl: HTMLElement;
        depth: number;
    },
    file: TFile,
    subpath: string,
) => MarkdownEmbed;

export interface AppWithEmbedRegistry extends App {
    embedRegistry?: {
        embedByExtension?: Partial<Record<string, EmbedCreator>>;
    };
}

/** Obsidian's list of community plugins. A plugin's id is in it exactly
 * while that plugin is enabled. The settings tab uses it to show the
 * Linter-coexistence warning only to people who actually run Linter. */
export interface AppWithPlugins extends App {
    plugins?: {
        plugins?: Record<string, unknown>;
    };
}

/** Obsidian's registry of every command. "Lint on save" finds the core save
 * command here and wraps it. */
export interface AppWithCommands extends App {
    commands?: {
        commands?: Record<
            string,
            // Declared as boolean | undefined, not Obsidian's
            // `boolean | void`: the wrapper keeps the result and passes it
            // on, and TypeScript's strict-type-checked rules do not allow
            // void inside a union like this
            | { checkCallback?: (checking: boolean) => boolean | undefined }
            | undefined
        >;
        executeCommandById?(id: string): boolean;
    };
}

/** `Vault.getConfig` reads an editor setting, such as `vimMode`. */
export interface VaultWithConfig extends Vault {
    getConfig?(key: string): unknown;
}

/**
 * The Vault's undocumented "config-changed" event, which fires when a
 * setting such as vim mode is switched on or off.
 *
 * It is written as its own standalone shape rather than as an extension of
 * Vault: adding this event to an interface that extends Vault clashes with
 * the event signatures Vault already declares.
 */
export interface VaultWithConfigEvents {
    on(name: "config-changed", callback: () => void): EventRef;
}

/** The vim adapter's global object (the CodeMirror 5 one), present on the
 * window only while vim mode is active. */
export interface WindowWithVim extends Window {
    CodeMirrorAdapter?: {
        Vim: {
            getVimGlobalState_(): {
                jumpList: {
                    add(cm: unknown, from: EditorPosition, to: EditorPosition): void;
                };
            };
            /** Add a vim ex command such as ":w", or replace an existing one. */
            defineEx?(
                name: string,
                shortName: string,
                handler: () => void,
            ): void;
        };
    };
}

/**
 * The undocumented record of which keys are bound to which command: what
 * Settings → Hotkeys shows you. Every member is optional, so if a future
 * release renames it the answer becomes "no key combos" rather than a
 * crash.
 */
interface HotkeyManager {
    getHotkeys?(commandId: string): Hotkey[] | null | undefined;
    getDefaultHotkeys?(commandId: string): Hotkey[] | null | undefined;
}

interface AppWithHotkeyManager extends App {
    hotkeyManager?: HotkeyManager;
}

/**
 * The key combos that currently run `commandId`: the ones the user
 * assigned if there are any, otherwise the command's own defaults,
 * otherwise none.
 *
 * The name-the-footnote modal registers these combos on its own keyboard
 * scope. While a modal is open a keypress never reaches Obsidian's global
 * hotkeys, so the modal has to listen for the commands' combos itself
 * (2026-08-22).
 */
export function commandHotkeys(app: App, commandId: string): Hotkey[] {
    const manager = (app as AppWithHotkeyManager).hotkeyManager;
    return (
        manager?.getHotkeys?.(commandId) ??
        manager?.getDefaultHotkeys?.(commandId) ??
        []
    );
}
