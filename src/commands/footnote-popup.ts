import { MarkdownView, Notice, Scope } from "obsidian";

import type FootnotePlugin from "../main";
import { definitionLabel, referenceText } from "../parsing/footnote-grammar";
import {
    AppWithCommands,
    AppWithEmbedRegistry,
    commandHotkeys,
    EditorWithCm,
    readingViewActive,
} from "../editor/obsidian-internals";
import { popupCanBind, PopupWaitingNotice, retryUntilShown } from "./popup-retry";
import { replaceMinimal } from "../editor/write-back";
import { allDefinitionBlocks, definitionStartLines, maskProtectedLines, scanDocument } from "../parsing/markdown-scan";

import { showNotice } from "../editor/notice";
// A small popup anchored at the cursor. Inside it sits Obsidian's own
// editable markdown embed, pointed at just this footnote's definition
// through the `#[^id]` subpath: the same machinery the core Footnotes view
// uses. What the user types in the popup is saved straight back to the
// definition line at the bottom of the note, so their cursor never has to
// leave the text they are writing.

type ActivePopup = {
    close: (focusEditor: boolean) => void;
};

let activePopup: ActivePopup | null = null;

/** Obsidian's core "Toggle reading view" command. */
const TogglePreviewCommand = "markdown:toggle-preview";

// Resolves once a closed popup's definition has landed in the note.
//
// Since 2026-09-16 the close path writes the popup's text into the note
// through the main editor, so in the ordinary case this resolves as soon as
// that edit is in, without any file write. It still gates the fallback,
// where the embed writes the file itself the old way: that save writes the
// whole file as the EMBED last knew it, so any edit made before it lands
// is wiped out, and the reload that follows dumps the cursor at the top of
// the note (regression, reported 2026-07-16). Every command that edits the
// document waits on this first.
let pendingTeardown: Promise<void> | null = null;

/** True while a popup is open, or while a closed one's save is still in flight. Automatic edits must keep their hands off the document while it is true. */
export function footnotePopupBusy(): boolean {
    return activePopup !== null || pendingTeardown !== null;
}

/**
 * Wait for any pending popup teardown, and tell the user when the wait is
 * noticeable. If it lasts long enough to feel like a dropped keypress, a
 * notice explains what is happening, and it clears the moment the command
 * carries on. The keypress itself is never thrown away: it runs as soon as
 * the pending save has landed.
 */
export async function settleFootnotePopupWithFeedback(): Promise<void> {
    if (!pendingTeardown) return;
    // a holder object rather than a plain variable: the assignment happens
    // inside the timer callback, and TypeScript cannot follow that when it
    // narrows a plain variable's type
    const feedback: { notice: Notice | null } = { notice: null };
    const noticeTimer = window.setTimeout(() => {
        feedback.notice = showNotice("Saving the previous footnote…", 0);
    }, 150);
    try {
        // read the value through a function on each pass. The teardown we
        // await can put a successor into pendingTeardown, and TypeScript
        // would not see that: it has already narrowed the module variable
        // from the guard above.
        const currentTeardown = () => pendingTeardown;
        for (let t = currentTeardown(); t !== null; t = currentTeardown()) {
            await t;
        }
    } finally {
        window.clearTimeout(noticeTimer);
        feedback.notice?.hide();
    }
}

/**
 * Where the text of footnote `name`'s definition sits in `text`, the note
 * as it reads now: from just after `label`, the start of the label line as
 * the popup's embed knew it ("[^1]: ", or "> [^1]: " inside a quote), to
 * the end of the definition's last line. Null when the note no longer has
 * that definition, or its label line no longer starts that way.
 *
 * The definition is read with the scanner, as every other part of the
 * plugin reads one: a fenced or commented copy of the label is not a
 * definition, a quoted definition counts with its quoted continuation
 * (allDefinitionBlocks), and of two definitions of one name the last
 * wins, the one Obsidian renders. The save-back used to bound the section
 * by matching the text the embed had seen after it, and by searching for
 * the label as a plain string, so a line appended right under a last-line
 * definition was wiped, and a fenced copy of the label or a quoted
 * definition made it give up and leave the embed's stale whole-file save
 * to wipe the user's typing (hunt 2026-10-02, pin
 * bug-popup-save-back-wipes-main-editor-edits).
 */
function definitionSection(text: string, name: string, label: string): { start: number; end: number } | null {
    const lines = text.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    const folded = name.toLowerCase();
    const block = allDefinitionBlocks(lines, scan, masked, starts)
        .filter((candidate) => candidate.name.toLowerCase() === folded)
        .pop();
    if (!block || !lines[block.start].startsWith(label)) return null;
    // the offset where line `n` starts: every line above it plus its line break
    const lineStart = (n: number) => lines.slice(0, n).reduce((sum, line) => sum + line.length + 1, 0);
    return { start: lineStart(block.start) + label.length, end: lineStart(block.end) + lines[block.end].length };
}

export function popupEditingAvailable(plugin: FootnotePlugin): boolean {
    // embedRegistry is undocumented Obsidian API. If it ever changes shape,
    // fall back to the old jump-to-bottom behavior rather than breaking.
    const registry = (plugin.app as AppWithEmbedRegistry).embedRegistry;
    return plugin.settings.enablePopupEditor
        && typeof registry?.embedByExtension?.md === "function";
}

// Close the popup from the footnote hotkey. Reports whether a popup was
// open, so that the hotkey can close it instead of inserting a second
// footnote.
export function toggleCloseFootnotePopup(): boolean {
    if (activePopup) {
        activePopup.close(true);
        return true;
    }
    return false;
}

// Close the popup without taking focus back (the user switched panes, or
// the plugin is unloading).
export function dismissFootnotePopup() {
    if (activePopup) {
        activePopup.close(false);
    }
}

export async function openFootnotePopup(
    plugin: FootnotePlugin,
    footnoteId: string,
    onUnavailable?: () => void,
) {
    dismissFootnotePopup();

    // a name the subpath could never resolve: go straight to the jump, with
    // no waiting notice and no 20 seconds of retries (see popupCanBind)
    if (!popupCanBind(footnoteId)) {
        onUnavailable?.();
        return;
    }

    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView || !mdView.file) {
        // fall back the same way a missing registry does. Without the
        // fallback the caller's jump and the lint it defers would both be
        // left stranded, and a callback armed to run after the settle would
        // later fire against a stale file path (2026-08-11 review bug #13)
        onUnavailable?.();
        return;
    }

    // callers already check popupEditingAvailable, but check again here so
    // that a change in the registry's shape falls back to the old jump
    // instead of throwing
    const createEmbed = (plugin.app as AppWithEmbedRegistry).embedRegistry?.embedByExtension?.md;
    if (!createEmbed) {
        onUnavailable?.();
        return;
    }
    // copy it into a local: the null check above does not carry over into
    // the buildEmbed closure below, as far as TypeScript is concerned
    const file = mdView.file;

    // a definition that was just inserted is only indexed once the file is
    // saved. But mdView.data lags a tick behind changes made through the
    // editor API, so saving too early would write the pre-insertion text to
    // disk. Wait for that buffer to catch up first. Finishing the save (and
    // the fold-state event it fires) before the embed exists also keeps
    // that event from reaching a half-built embed.
    const editor = mdView.editor;
    const doc = mdView.containerEl.ownerDocument;
    const win = doc.defaultView || window;

    // Register the popup handle BEFORE the first await. A hotkey press
    // during this setup must close THIS half-built popup, not start a
    // second one whose file save then races this one's. Creating footnotes
    // in quick succession used to lose the later references in exactly that
    // way (regression, reported 2026-07-16). Until the DOM exists, closing
    // simply abandons the setup.
    //
    // `close` flips the flag from event handlers while the awaits below are
    // running, which TypeScript's narrowing cannot follow, so every
    // re-check goes through popupClosed(): the result of a function call is
    // never narrowed.
    let closed = false;
    const popupClosed = () => closed;
    let domTeardown: ((focusEditor: boolean) => void) | null = null;

    const focusMainEditor = () => {
        // editor.focus() can quietly do nothing right after the popup's
        // embed held focus, because Obsidian's own focus bookkeeping lags
        // behind. Focus the underlying CodeMirror view directly instead.
        const cmView = (editor as EditorWithCm).cm;
        if (cmView) cmView.focus();
        else editor.focus();
    };
    // put the cursor right after the reference so the user can carry on
    // typing the sentence. A named footnote would otherwise leave the
    // cursor inside the brackets.
    // A plain string search, because a footnote name is not regex-safe.
    const placeCursorAfterReference = () => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const reference = referenceText(footnoteId);
        for (let idx = line.indexOf(reference); idx !== -1; idx = line.indexOf(reference, idx + 1)) {
            if (cursor.ch >= idx && cursor.ch <= idx + reference.length) {
                editor.setCursor({ line: cursor.line, ch: idx + reference.length });
                break;
            }
        }
    };
    // filled in once the view hooks below exist. close() is the one and
    // only way out.
    let releaseViewHooks = () => {};
    const close = (focusEditor: boolean) => {
        if (closed) return;
        closed = true;
        activePopup = null;
        releaseViewHooks();
        if (domTeardown) {
            domTeardown(focusEditor);
        } else if (focusEditor) {
            focusMainEditor();
            placeCursorAfterReference();
        }
    };
    activePopup = { close };

    // Pressing the reading-view toggle while the popup (or the note under
    // it) had focus used to be SWALLOWED. The popup's editor counts as
    // Obsidian's active editor, so the toggle flipped the EMBED's own mode,
    // which merely dropped focus back to the note. The next press toggled
    // the note, and the one after that left the caret in the note with
    // Escape doing nothing (Jason's report 2026-09-04).
    //
    // The fix: a keymap scope, pushed for as long as the popup lives, that
    // catches that command's own hotkeys first, closes the popup, and runs
    // the toggle against the note. One press, exactly as if the popup were
    // not there.
    // the observers armed by tryShow (one per attempt), released on close
    const modeWatchers: MutationObserver[] = [];
    const scope = new Scope(plugin.app.scope);
    for (const hotkey of commandHotkeys(plugin.app, TogglePreviewCommand)) {
        scope.register([...hotkey.modifiers], hotkey.key, () => {
            close(true);
            (plugin.app as AppWithCommands).commands?.executeCommandById?.(TogglePreviewCommand);
            return false;
        });
    }
    plugin.app.keymap.pushScope(scope);
    // ... and switching to Reading view by any other route (the pen icon, a
    // pick from the command palette) closes the popup too. Editing a
    // footnote in a popup floating over a rendered note is not a state
    // worth keeping. Every route a user can take goes through the view's
    // toggleMode, which fires layout-change. A programmatic setState flip
    // does not fire it (probed live 2026-09-04), and no user gesture takes
    // that route.
    const layoutRef = plugin.app.workspace.on("layout-change", () => {
        if (readingViewActive(mdView)) close(false);
    });
    releaseViewHooks = () => {
        plugin.app.keymap.popScope(scope);
        plugin.app.workspace.offref(layoutRef);
        for (const watcher of modeWatchers) watcher.disconnect();
        modeWatchers.length = 0;
    };

    const dataDeadline = Date.now() + 2000;
    // the data buffer usually catches up within a tick, so check again
    // almost immediately before dropping to coarse 50ms polls. Otherwise
    // the popup spends a blind 50ms on what is typically a 1ms wait.
    //
    // Note that this compares the buffer to the editor for EQUALITY. It
    // used to search the buffer for the "[^id]:" substring, which went
    // wrong: definition-shaped text inside a code span (the A8 sheet's own
    // "`[^name]: …`" checkbox line) matched the STALE buffer straight away.
    // The save below was then skipped, because that stale buffer still
    // equalled what was on disk, and the popup sat there invisible for
    // about 2 seconds until Obsidian's own delayed autosave finally wrote
    // the new definition for the embed to find. If the retry deadline ran
    // out first, the popup died and fell back to the jump instead (Jason's
    // report 2026-08-26, ground-truthed with a live gesture watcher).
    let pollDelay = 0;
    while (!popupClosed() && mdView.data !== editor.getValue() && Date.now() < dataDeadline) {
        await new Promise((resolve) => win.setTimeout(resolve, pollDelay));
        pollDelay = pollDelay === 0 ? 10 : 50;
    }
    if (popupClosed()) return;
    // the embed reads the FILE, so unsaved changes in the view have to be
    // written first. Only when the view really differs from disk, though:
    // saving on every popup would cost disk latency and churn the user's
    // sync.
    if (mdView.data !== (await plugin.app.vault.cachedRead(file))) {
        // The embed resolves "#[^id]" through the metadata cache, which is
        // re-indexed a moment AFTER the save. When the id already existed
        // before this press - the creation lint renumbered an older
        // footnote out of the way, so the new footnote took its number -
        // the stale cache resolved the subpath at once, to the OLD
        // definition's position, and the popup showed a slice of the note
        // from there (Jason's report, sheet 02, 2026-09-09: ".)", a blank
        // line, then both definitions). So: listen for this file's cache
        // change before saving, then wait for it, with a cap in case the
        // cache has nothing new to report.
        const reindexed = new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                plugin.app.metadataCache.offref(ref);
                resolve();
            };
            const ref = plugin.app.metadataCache.on("changed", (changed) => {
                if (changed.path === file.path) finish();
            });
            win.setTimeout(finish, 2000);
        });
        await mdView.save();
        await reindexed;
    }
    if (popupClosed()) return;

    // Anchor the popup just below the cursor, flipping it above when the
    // cursor is near the bottom of the window.
    //
    // Working out where the cursor is takes two routes. When focus is in a
    // sub-editor (a table cell being edited), the main editor's coordsAtPos
    // only knows where the table widget's edge is, which pins the popup to
    // the screen border, while the browser's own DOM selection does track
    // the real caret. When the main editor has focus it is the other way
    // round: coordsAtPos is the reliable one, because the DOM selection can
    // lag behind the editor API.
    const cm = (editor as EditorWithCm).cm;
    let coords: { left: number; top: number; bottom: number } | null = null;
    // focus sits ON the contentDOM element itself. A table cell's
    // sub-editor has its own contentDOM nested inside the main one, so this
    // has to ask "is it this exact element", not "is it inside it".
    const mainEditorFocused = !!cm && doc.activeElement === cm.contentDOM;
    if (!mainEditorFocused) {
        const sel = win.getSelection();
        if (sel && sel.rangeCount > 0) {
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            if (rect.height > 0) coords = rect;
        }
    }
    if (!coords && cm) coords = cm.coordsAtPos(cm.state.selection.main.head);
    const anchor = {
        left: coords ? coords.left : 100,
        top: coords ? coords.top : 100,
        bottom: coords ? coords.bottom : 100,
    };
    const width = Math.min(480, win.innerWidth - 32);
    const left = Math.max(16, Math.min(anchor.left, win.innerWidth - width - 16));

    const containerEl = doc.body.createDiv("footnote-shortcut-popup");
    containerEl.setCssProps({
        left: `${left}px`,
        top: `${anchor.bottom + 6}px`,
        width: `${width}px`,
    });

    // Keep the popup tight against the caret: just below it, or just above
    // when there is no room underneath.
    //
    // The popup's real height is only known once the embed has rendered,
    // and it changes as the user types, so re-anchor on every size change.
    // The earlier approach reserved worst-case space up front, which
    // stranded the popup far above a caret near the bottom of the screen.
    // When the popup is flipped above the caret, its bottom edge stays put,
    // so it grows upwards.
    //
    // tryShow calls this directly as well, because observer callbacks ride
    // the render loop, and that stalls completely while the window is
    // hidden or covered.
    const positionPopup = () => {
        const height = containerEl.offsetHeight;
        let top = anchor.bottom + 6;
        if (top + height > win.innerHeight - 8) {
            top = Math.max(8, anchor.top - 6 - height);
        }
        containerEl.setCssProps({ top: `${top}px` });
    };
    const resizeObserver = new win.ResizeObserver(positionPopup);
    resizeObserver.observe(containerEl);
    // stay invisible until the footnote's definition has actually loaded
    containerEl.addClass("footnote-shortcut-popup-loading");

    // show the name of the footnote being edited, so the user can tell one
    // reference from another
    containerEl.createDiv({
        cls: "footnote-shortcut-popup-label",
        text: definitionLabel(footnoteId),
    });
    const embedEl = containerEl.createDiv("footnote-shortcut-popup-embed");

    // footnote names are case-insensitive in markdown, and the metadata
    // cache stores them lowercased. A subpath written in the reference's
    // original casing (say "[^arXiv:…]") resolves to nothing, and the popup
    // then quietly fell back to the old jump (the popup half of issue #50).
    const subpath = `#[^${footnoteId.toLowerCase()}]`;
    const buildEmbed = () => {
        const built = createEmbed(
            { app: plugin.app, linktext: subpath, sourcePath: file.path, containerEl: embedEl, depth: 0 },
            file,
            subpath,
        );
        built.editable = true;
        built.load();
        return built;
    };
    let embed = buildEmbed();

    const onDocMouseDown = (evt: MouseEvent) => {
        // Element, not HTMLElement. An SVG icon is a common thing to click
        // outside the popup and must still dismiss it, and a target that is
        // not an Element at all (none has been seen from the UI) must not
        // make closest() throw. The keydown handler below checks its target
        // the same way (review A8).
        const target = evt.target instanceof Element ? evt.target : null;
        if (!target) return;
        if (containerEl.contains(target)) return;
        // taps that launch a command (the mobile navbar or toolbar, the
        // command palette, the ribbon) must not dismiss the popup. On
        // mobile they are the only way to press the footnote "hotkey", and
        // closing here would strand the cursor instead of letting the
        // command's own close path return it to the text.
        if (target.closest(".mobile-navbar, .mobile-toolbar, .modal-container, .prompt, .workspace-ribbon")) {
            return;
        }
        close(false);
    };
    doc.addEventListener("mousedown", onDocMouseDown, true);

    // Escape closes the popup, both from INSIDE it and from the note
    // underneath it (Jason's report 2026-09-04: after a round trip through
    // Reading view the caret sat in the note, and Escape there did nothing,
    // while a click outside or the hotkey still closed the popup). Escape
    // from anywhere else, a modal or the command palette, is not ours.
    //
    // This listens in the CAPTURE phase on the document and reads the vim
    // state directly. Both editors call preventDefault on EVERY Escape, not
    // just vim's, so the earlier check for defaultPrevented in the bubble
    // phase never closed the popup at all: a regression from the E28
    // cleanup, caught by the A3 manual pass (2026-08-13).
    //
    // E28's real rule survives by asking vim itself. Whichever editor holds
    // focus and is still in INSERT mode keeps the key, because leaving
    // insert mode must not also close the popup. Anything else means
    // "close me".
    const onDocKeydown = (evt: KeyboardEvent) => {
        if (evt.key !== "Escape") return;
        const target = evt.target instanceof Node ? evt.target : null;
        const inPopup = !!target && containerEl.contains(target);
        if (!inPopup && !(target && mdView.containerEl.contains(target))) return;
        const focused = inPopup
            ? (embed.editMode?.editor as EditorWithCm | undefined)
            : (editor as EditorWithCm);
        if (focused?.cm?.cm?.state?.vim?.insertMode) return;
        evt.preventDefault();
        evt.stopPropagation();
        close(true);
    };
    doc.addEventListener("keydown", onDocKeydown, true);

    // from here on, closing must also take down the DOM and the embed
    domTeardown = (focusEditor: boolean) => {
        resizeObserver.disconnect();
        doc.removeEventListener("mousedown", onDocMouseDown, true);
        doc.removeEventListener("keydown", onDocKeydown, true);
        // take the popup OUT of the document straight away, rather than
        // just hiding it. The embed's inline editor stays alive while its
        // save settles, which can take up to about 5 seconds, and
        // keystrokes from someone already typing the NEXT footnote were
        // landing in it. That appended text to the WRONG definition and
        // re-armed the embed's delayed save, which then fired against the
        // unloaded embed's cleared state ("Cannot read properties of
        // undefined (reading 'split')", reported and reproduced
        // 2026-08-13). A detached embed still saves fine; all that changes
        // is that typing can no longer reach it.
        containerEl.remove();
        if (focusEditor) {
            focusMainEditor();
            placeCursorAfterReference();
        }

        // hold document edits back until the popup's definition has landed
        // in the note (that is what settleFootnotePopupWithFeedback waits
        // on), so nothing edits the note halfway through
        let settle: () => void;
        const teardownPromise = new Promise<void>((resolve) => {
            settle = resolve;
        });
        pendingTeardown = teardownPromise;

        // The embed's own delayed save is cancelled FIRST. It was armed two
        // seconds after each keystroke inside the popup and wrote the whole
        // file as the embed knew it; when it landed after the popup had
        // closed, Obsidian folded the file back into the main editor and
        // wiped whatever had been typed there in the meantime (verification
        // note 19, reproduced on video roughly one take in four,
        // 2026-09-14). From here on the MAIN EDITOR is the only writer: the
        // popup's final text goes into the note as an ordinary edit below,
        // and the embed never writes the file after the popup is gone. (A
        // timer still armed at unload would also have fired against
        // cleared embed state and thrown, 2026-08-13.)
        try {
            embed.requestSave?.cancel?.();
            embed.requestSaveFolds?.cancel?.();
        } catch {
            // private API: a throw here changes nothing below
        }

        // Obsidian's own join of the popup's text into the file, worked out
        // by the embed's save with writing switched off (probed live
        // 2026-09-16: save(text, false) fills embed.data with the joined
        // file and touches nothing on disk), written into the note through
        // the main editor as the smallest edit that gets there. The note is
        // read AFTER that join, because the user may already be typing in
        // it: that typing is the whole point, and it must survive. The
        // section is found the way the rest of the plugin finds a
        // definition, by reading the note as it is now (definitionSection),
        // rather than by its old offset or by matching the old text around
        // it. Reports false only when the definition is gone from the note,
        // in which case the embed stays the writer.
        const writeThroughMainEditor = async (): Promise<boolean> => {
            const text = embed.editMode?.editor?.getValue?.() ?? embed.text;
            const { before, after } = embed;
            if (
                typeof text !== "string" ||
                typeof embed.save !== "function" ||
                typeof before !== "string" ||
                typeof after !== "string"
            ) {
                return false;
            }
            await embed.save(text, false);
            const joined = embed.data;
            if (
                typeof joined !== "string" ||
                joined.length < before.length + after.length ||
                !joined.startsWith(before) ||
                !joined.endsWith(after)
            ) {
                return false;
            }
            // the definition's new text, continuation indent and all, as
            // Obsidian itself would have written it
            const section = joined.slice(before.length, joined.length - after.length);
            const current = editor.getValue();
            // `before` ends with the label line's start ("[^1]: ", or
            // "> [^1]: " inside a quote), which is where the section starts
            const label = before.slice(before.lastIndexOf("\n") + 1);
            const bounds = definitionSection(current, footnoteId, label);
            if (!bounds) return false;
            const updated = current.slice(0, bounds.start) + section + current.slice(bounds.end);
            if (updated !== current) replaceMinimal(editor, current, updated, mdView);
            embed.dirty = false;
            return true;
        };

        void (async () => {
            const pause = (ms: number) => new Promise<void>((resolve) => win.setTimeout(resolve, ms));
            // A save the embed already had in flight lands on disk whatever
            // happens here, so wait for it, and then give Obsidian one beat
            // to fold the written file back into the view; the edit below
            // then carries only what was typed after that save started. In
            // practice this clears on the first check.
            let wroteToDisk = false;
            let attempts = 0;
            while ((embed.saving || embed.saveAgain) && attempts++ < 160) {
                wroteToDisk = true;
                await pause(30);
            }
            if (wroteToDisk) await pause(50);

            let landed = !embed.dirty;
            if (!landed) {
                try {
                    landed = await writeThroughMainEditor();
                } catch {
                    landed = false;
                }
            }
            if (!landed) {
                // The fallback, the old route: the embed writes the file
                // itself, now, with the inline editor's CURRENT text and
                // write=true (see the note on the save signature in
                // obsidian-internals), and the busy gate holds every
                // command until the write has landed.
                wroteToDisk = true;
                try {
                    const text = embed.editMode?.editor?.getValue?.() ?? embed.text;
                    if (embed.dirty && !embed.saving && typeof text === "string") {
                        await embed.save?.(text, true);
                    }
                } catch {
                    // carry on regardless: the polling below is the safety net
                }
                attempts = 0;
                while ((embed.dirty || embed.saving || embed.saveAgain) && attempts++ < 160) {
                    await pause(30);
                }
            }
            try {
                embed.requestSave?.cancel?.();
                embed.requestSaveFolds?.cancel?.();
                embed.unload();
            } catch {
                // this is private API. A throw here must not skip the
                // settle below, or every later footnote command would
                // wait on pendingTeardown for ever (E29).
            }
            const finish = () => {
                // only clear the slot if a LATER teardown has not already
                // taken it. Clearing a successor's promise would drop the
                // busy gate while that successor's save is still in flight
                // (2026-08-11 review bug #14).
                if (pendingTeardown === teardownPromise) {
                    pendingTeardown = null;
                }
                settle();
            };
            // after a disk write, give Obsidian one beat to fold the file
            // back into the main view before anyone edits it. A timer on
            // purpose, not requestAnimationFrame: rAF stalls completely
            // while the window is hidden.
            if (wroteToDisk) win.setTimeout(finish, 50);
            else finish();
        })();
    };

    const tryShow = async (): Promise<boolean> => {
        await embed.loadFile();
        // a quick second press closes the popup while loadFile is still in
        // flight. By then the teardown has already UNLOADED the embed, and
        // showing the editor on an unloaded embed leaves a live inline
        // editor whose save chain later fires against the cleared embed
        // state ("Cannot read properties of undefined (reading 'split')",
        // reported and reproduced 2026-08-13). Closed means handled, so
        // show nothing.
        if (popupClosed()) return true;
        if (embed.subpathNotFound) return false;
        containerEl.removeClass("footnote-shortcut-popup-loading");
        embed.showEditor();
        // The label takes the embedded editor's own base text metrics, so
        // the two line up on every device and theme: the stylesheet's
        // guesses (the app's text size and normal line height) matched on
        // the desktop but sat the phone's body text a little above the
        // label (Jason's phone pass, 2026-09-11). Read from the editor's
        // content box, not its first line: a heading first line carries
        // the heading's size, and a label that copied it grew to heading
        // size too (Jason's phone recheck, 2026-09-11).
        const contentBox = embedEl.querySelector(".cm-content");
        const labelEl = containerEl.querySelector<HTMLElement>(".footnote-shortcut-popup-label");
        if (contentBox && labelEl) {
            const metrics = win.getComputedStyle(contentBox);
            labelEl.style.fontSize = metrics.fontSize;
            labelEl.style.lineHeight = metrics.lineHeight;
            labelEl.style.fontFamily = metrics.fontFamily;
        }
        positionPopup();
        // The reading-view toggle picked from the COMMAND PALETTE (or any
        // route with no hotkey for the scope above to catch) acts on
        // Obsidian's active editor, which is the popup's own embed - so the
        // popup flipped into Reading view and the note did not (Jason's
        // report, sheet 02, 2026-09-11). The embed keeps a rendered view in
        // its DOM the whole time, so that is no signal; its EDITOR being
        // taken out of the DOM is (probed live 2026-09-11). When that
        // happens while the popup is open: close the popup and hand the
        // toggle to the note, exactly what the hotkey route does.
        const modeWatch = new MutationObserver(() => {
            if (popupClosed() || embedEl.querySelector(".cm-editor")) return;
            modeWatch.disconnect();
            close(true);
            (plugin.app as AppWithCommands).commands?.executeCommandById?.(TogglePreviewCommand);
        });
        modeWatch.observe(embedEl, { childList: true, subtree: true });
        modeWatchers.push(modeWatch);
        const inner = embed.editMode?.editor;
        if (inner) {
            inner.focus();
            // put the cursor at the END of the definition, so the user can
            // backspace or carry on writing without reaching for the arrow
            // keys
            if (inner.lastLine && inner.getLine && inner.setCursor) {
                const last = inner.lastLine();
                inner.setCursor({ line: last, ch: inner.getLine(last).length });
            }
        }
        return true;
    };

    // keep retrying while the metadata cache catches up with the saved
    // file. The retries are driven by the cache's own change events, and
    // the policy behind them (how often to try when idle, the waiting
    // notice, the safety cap) lives in popup-retry.ts, where unit tests pin
    // it. A slow machine used to run past the old 3 second deadline and
    // JUMP instead (Jason's report 2026-09-04).
    const showEditor = () =>
        retryUntilShown({
            tryShow,
            // An embed that has already loaded never looks up its subpath again,
            // so every retry has to build a fresh one.
            rebuild: () => {
                embed.unload();
                embedEl.empty();
                embed = buildEmbed();
            },
            closed: popupClosed,
            now: () => Date.now(),
            delay: (ms) => new Promise<void>((resolve) => win.setTimeout(resolve, ms)),
            onCacheChange: (listener) => {
                const ref = plugin.app.metadataCache.on("changed", (changedFile) => {
                    if (changedFile === mdView.file) listener();
                });
                return () => {
                    plugin.app.metadataCache.offref(ref);
                };
            },
            showWaitingNotice: () => {
                const notice = showNotice(PopupWaitingNotice, 0);
                return () => {
                    notice.hide();
                };
            },
        });

    showEditor()
        .then((shown) => {
            if (!shown && !popupClosed()) {
                close(false);
                onUnavailable?.();
            }
        })
        .catch(() => {
            if (!popupClosed()) {
                close(false);
                onUnavailable?.();
            }
        });
}
