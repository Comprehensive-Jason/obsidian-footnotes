# Dev environment

What the config files cannot tell you. `TESTING.md` covers the test layers and their commands; `package.json` covers the scripts; the release workflow and `scripts/version-bump.mjs` explain their own checks in comments. Everything below was learned the hard way and dated when it bit.

## Where things live

- The plugin is checked out inside the **Obsidian-Plugin-Sandbox** vault at `.obsidian/plugins/obsidian-footnotes`, on branch master. The vault root is two levels above this folder. Jason keeps his personal "Second Brain" vault open in the same app at the same time.
- Commits are authored as `Comprehensive-Jason <jasonindestructible@gmail.com>` from the global gitconfig. If another author appears, look for a stale override in `.git/config`.
- Pushing needs the `gh auth setup-git` credentials; a bare `git push` can hang on an interactive prompt.
- `main.js` is gitignored but must exist on disk for the vault to load the plugin. `npm run build` runs `tsc -noEmit`, then the minified esbuild bundle; `npm run dev` is the esbuild watch with a readable bundle and inline sourcemap.
- The vault runs the **hot-reload** community plugin: a new `main.js` in this folder reloads the plugin by itself. The installed CLI has no `plugin:reload` command.
- `npm run test:smoke` copies the current `main.js` into place and tests it. It does not build, so a stale bundle passes or fails the wrong code (2026-09-04). Build first.
- Obsidian 1.13's `Plugin` class has its own `settings` property, so the subclass declares it with `declare settings: ...`; a plain class field errors under ES2022 class-field semantics and would shadow the base property.
- eslint runs the `eslint-plugin-obsidianmd` recommended flat config, type-aware. Its key rules forbid `eslint-disable` comments, so quiet a `no-unsafe-*` finding with a typed interface, never a disable.
- `npm run mutation` (Stryker) is a local pre-release audit, never CI: Jason finds Actions too slow. It caches in `reports/stryker-incremental.json`. A Survived verdict on a freshly added test may be a coverage-attribution artifact; hand-apply the mutant to check.
- `test/properties.test.ts` holds fast-check properties with a remark/micromark differential oracle. Soak it with `FC_NUM_RUNS=5000`. It recuses itself from documents with `$` in a footnote name because micromark's math extension disagrees with Obsidian there.

## Driving the live app through the Obsidian CLI

`Obsidian.com` is the CLI on Windows; spawn it directly, never through a shell, because quoting breaks. `obsidian eval` runs code in the app; `app.commands.executeCommandById('obsidian-footnotes:<command>')` presses a command, and `app.plugins.plugins['obsidian-footnotes'].settings` can be mutated in memory without persisting.

Rules that protect Jason's open notes and the app itself:

1. **Pass `vault=Obsidian-Plugin-Sandbox` as the first CLI argument on every call.** Without it the CLI targets whichever vault window has focus, and on 2026-09-08 a probe wrote its scratch note into his personal vault.
2. **Resolve the target note's leaf by file path and activate it** with `app.workspace.setActiveLeaf(leaf, {focus: true})` before pressing any command, and refuse to press when it is not active. The CLI's `open` command does not switch tabs, so anything that reads `activeLeaf` writes into whatever note Jason has in front; that overwrote his working sheets twice (2026-09-05, 2026-09-08). The File Recovery core plugin restores such a note: `app.internalPlugins.plugins['file-recovery'].instance.getLastVersionByPath(path)`, then `vault.modify`. The smoke suite does all of this already; ad-hoc probes must too.
3. **Guard every destructive eval with a file-path check** on `activeLeaf.view.file.path`, because Jason may be editing in the vault while a probe runs.
4. **Keep eval arguments small.** Code over about 4 KB crashed the renderer twice (2026-08-28), and a long argument is chunked on the CLI socket, so Obsidian's main process throws an "Unexpected token" JSON error dialog that Jason has to dismiss (2026-09-24, a 5 KB fixture inside one eval). Write the script to a vault dotfile and eval a tiny loader that runs `adapter.read(...)`.
5. **End every fire-and-forget eval with a sentinel expression** (`...; 'fired'`). The CLI awaits a bare async IIFE, and killing the client mid-eval wedges the eval server until the app relaunches.
6. **Sleep and poll on the Node side, not in the app.** Electron throttles background timers to about one per minute when the window is occluded, so in-app `await sleep()` chains stall. ResizeObserver and requestAnimationFrame callbacks never fire while the window is hidden or minimized either, so anything that must happen deterministically (initial layout, positioning) needs a direct synchronous call.
7. **Wait for the view buffer to catch up.** `MarkdownView.data` lags a tick behind editor API changes, and `Editor.transaction` and `replaceRange` resolve positions against that lagging buffer, so after `setValue` wait for `view.data === editor.getValue()` before any command. Set note content through `editor.setValue`, never by overwriting the file, or the unsaved buffer merges garbage.
8. **Record `app.isMobile` alongside every live-probe result.** Jason uses Obsidian's mobile emulation (`app.emulateMobile(bool)`, which reloads the window; the state survives `app:reload`). Vim does not exist on mobile, layouts and popups differ, so validate fixes in both modes. If the sandbox is stuck emulating mobile: `eval "code=app.emulateMobile(false)"`.
9. **After heavy table-cell testing, run `app:reload`.** Ghost cell editors survive and poison later edits with "RangeError: Invalid change range" from stale sync-backs. `dev:debug on` plus `dev:console level=error` shows swallowed errors. The CLI is also flaky under parallel use (empty results, exit 127): pause and retry.
10. **The settings window is a separate document** (Obsidian 1.13, seen 2026-09-22). `app.setting.open()` and `openTabById('obsidian-footnotes')` work, but `document.querySelectorAll('.setting-item')` in the main window finds nothing; query `app.setting.activeTab.containerEl` instead, and wait a second on the Node side after opening before reading. The plugin's `styles.css` applies there too.

Two proven techniques:

- **Debug capture** (cracked the table bug, 2026-07-15): temporarily instrument the command to snapshot the state in question into `window.__footnoteDebug`, build in place, have Jason perform the real gesture once, read the snapshot through eval, then remove the instrumentation. A real gesture beats a scripted approximation.
- **Ground truth for ambiguous markdown**: `metadataCache.getFileCache(f).sections` says exactly how Obsidian classifies a block (yaml versus thematic break, code versus continuation). Rendering claims are settled against Reading view.

## A headless live app on a Linux machine (optional)

The live checks and the smoke suite can run against a second Obsidian on a Linux machine with no monitor (a server, a VM, a spare PC), so automated runs do not load the machine you work on or touch your own notes. Everything above about the CLI still applies. This is how to set one up; a maintainer's own machine names and paths belong in their local notes, not here.

**Install** (Debian or Ubuntu): the Obsidian `.deb` from the obsidianmd/obsidian-releases GitHub releases (check it against the release's published sha256), plus `xvfb` (the virtual display), `xdotool` (clicks and keys), `imagemagick` (screenshots), and optionally `x11vnc` (to watch it). The `.deb` does not declare every library Electron needs: on Ubuntu 24.04 it also needed `libasound2t64`, and it exits with code 127 until that is installed (`ldd /opt/Obsidian/obsidian | grep "not found"` lists what is missing).

**A vault of its own.** Copy the sandbox vault (the notes and `.obsidian`, without `node_modules`) to a folder outside any sync tool, so nothing the automation writes reaches anyone's devices. Clone this repo into its `.obsidian/plugins/obsidian-footnotes`, `npm ci`, `npm run build`, and keep the hot-reload plugin enabled so a new `main.js` reloads itself. If the clone is only for testing, disable pushing from it (`git remote set-url --push origin no-push`) and move work in and out through your own machine.

**Register the vault and turn the CLI on before the first start.** Write `~/.config/obsidian/obsidian.json` with the vault and the CLI flag: `{"vaults": {"<16 hex digits>": {"path": "<vault folder>", "ts": <now in ms>, "open": true}}, "cli": true}`.

**Run it as a user service** on a virtual display with a fixed auth file, so other tools can reach the display:

```ini
[Service]
Environment=DISPLAY=:99
Environment=XAUTHORITY=%t/obsidian-headless.xauth
ExecStart=/usr/bin/xvfb-run --server-num=99 --auth-file=%t/obsidian-headless.xauth --server-args="-screen 0 1600x1000x24" /usr/bin/obsidian
Restart=on-failure
CPUQuota=200%
MemoryMax=4G
```

**The first start** shows "Do you trust the author of this vault?". Take a screenshot (`DISPLAY=:99 XAUTHORITY=$XDG_RUNTIME_DIR/obsidian-headless.xauth import -window root shot.png`), find "Trust author and enable plugins", and click it with `xdotool mousemove <x> <y> click 1` under the same two variables. Check with `obsidian vault=Obsidian-Plugin-Sandbox eval "code=Object.keys(app.plugins.plugins).join()"`.

**The CLI needs the display too.** Obsidian's CLI is the app itself, so without `DISPLAY` and `XAUTHORITY` every call fails with exit 1 and prints nothing (2026-10-06). Put a wrapper named `obsidian` earlier on the PATH than `/usr/bin` that sets both and execs `/usr/bin/obsidian "$@"`, so `npm run test:smoke` and `npm run oracle` work unchanged. A non-interactive ssh shell may not have that folder on its PATH, so call the wrapper by its full path there.

**The smoke suite** runs from the clone inside that vault, since it finds its vault from its own path: `npm run build && npm run test:smoke`. The first run after Obsidian starts can time out a few tests that pass on a rerun (2026-10-06).

**One app, one probe at a time.** Parallel agents never drive it; one session runs live probes serially. Put probe notes in a folder of their own, reuse one leaf (`app.workspace.getLeaf(false)`, then `leaf.setViewState({type: "markdown", state: {file, mode: "preview"}})`), and delete the folder and any dotfile afterwards. Never detach the last leaf: the workspace is left with no tab group and every later open fails with "No tab group found" until the app restarts (2026-10-06). Load longer scripts with the dotfile loader of rule 4, store results on `window`, and read them in a second eval.

**Copying files in over ssh:** quote a remote path that holds a space as one argument (`scp f "host:vault/Probe notes/"`); a backslash-escaped space made a folder literally named with the backslash (2026-10-06).

**Watching it:** `x11vnc -display :99 -auth $XDG_RUNTIME_DIR/obsidian-headless.xauth -localhost -once` on the machine, and a VNC viewer through `ssh -L 5900:localhost:5900 <host>`.

**Recording what it says.** An answer that should last becomes a saved answer in `test/obsidian-answers/` (listed in `AnswerFiles` in `test/obsidian-referee.test.ts`) and, where it settles a rule, a line in `docs/obsidian-reading-rules.md`.

**Check before you claim.** Any claim about how Reading view draws a note is checked on a live app (or against the reading rules and saved answers) before it goes into a question for the maintainer. On 2026-10-08 an unchecked claim that "---" under a continuation line makes a heading was wrong (rule D3).

**Agents running there unattended** as `claude -p` jobs do not show up in Claude's Remote Control (a print-mode run cannot register with it), so whoever starts them needs their own way to see when each ends.

## Table cells

Obsidian's table editor runs a sub-editor per focused cell that syncs back asynchronously.

- The main editor's `getCursor()` does not track a cell's caret, and the cell's DOM exposes no `cmView`. Recover the cell's EditorView through CodeMirror's registry: `editor.cm.constructor.findFromDOM(document.activeElement)`, guarding `view !== cm`. That is `resolveTableCellCursor()` in src.
- Never edit a table row through the main editor while a cell has focus: the sync-back and the full-table re-normalization on close shred the row. Dispatch insertions into the cell view itself (`activeTableCellEditor()` and `insertInTableCell()`), and the widget writes the markdown back.
- Several `Editor` dispatches in one tick race the sync ("Applying change set to a document with the wrong length"). Bundle every mutation into one `Editor.transaction({changes, selection})`; Obsidian resolves the selection against the post-change document. `editorCallback` hands you the document editor, never a cell-scoped one.
- Live repro: `editor.focus(); editor.setCursor(<pos inside table>)` activates cell editing (an editing cell's `td.textContent` doubles, "appleapple"). Synthetic MouseEvents do not reliably focus cells.
- Smoke tests poll for a landmark substring instead of byte-exact table content (the widget re-normalizes padding), and `setupNote` parks the cursor at {0,0} and waits about 150 ms before `setValue`, so a lingering cell editor closes before the next test's content lands.

## Popup editor and embeds

- The markdown embed's `save(t, n)` needs the section text and `n = true` to write to disk; `n` defaults to in-memory only. An argless `embed.save()` feeds `undefined` into the parent `set()`, which throws and first assigns `this.text = undefined`, so the embed's own debounced saves crash afterwards (Obsidian 1.13.6, 2026-08-13). Prototype-patch logging (wrapping the embed's save, set, and onunload through eval) is how this was pinned.
- Anything that saves right after editor edits waits for the view buffer first (rule 7 above); the popup editor does.
- The popup is Obsidian's **editable embed** machinery (the same the core Footnotes sidebar uses), reached through `app.embedRegistry.embedByExtension.md(...)` with the subpath `#[^id]`, `embed.editable = true`, `showEditor()`. Hover-link popovers were tried first and rejected: they self-hide without a real mouse hover. Lessons from making it solid (2026-07-13): `embed.loadFile()` is a no-op on an already-loaded embed, so a retry after the cache indexes a new footnote rebuilds the embed instance; `await mdView.save()` before creating the embed, or the save's fold-state event crashes a half-initialized one; on close, poll `embed.dirty || embed.saving || embed.saveAgain` and unload once the embed's own save cycle settles; Escape handling is bubble-phase so vim's Escape wins inside the popup; return focus with `view.editor.cm.focus()`, because `view.editor.focus()` silently no-ops right after the embed held focus. The undocumented shapes (embedRegistry, `Editor.cm`, MarkdownEmbed, the vim adapter) are typed in `src/obsidian-internals.ts`; extend those interfaces rather than casting.

## Release and beta flow

`npm version <patch|minor|x.y.z|x.y.z-beta.N>` on a clean tree does the whole local step: the version script syncs the manifests and versions file (a version with a "-" is a BRAT beta and touches `manifest-beta.json` only; a stable version sets all three and lifts `manifest-beta.json` to the same version so BRAT testers leave the beta), and npm commits and tags without a "v" prefix. Then `git push origin master <version>` and publish the draft the workflow creates; BRAT cannot see drafts. The workflow fails fast when the tag matches neither manifest, and marks beta tags as pre-releases shipping `manifest-beta.json` renamed as the asset. Manual test mode: Actions, "Release Obsidian plugin", Run workflow, which drafts `<version>-manual-test` with no tag; delete the draft after checking.

## README GIFs

`scripts/readme-gifs/record.mjs <scene>` runs one `scene-<name>.js` in-app through `inapp.js` and `scene-shared.js`. Facts from 2026-09-08:

- A scene whose first line is `// @mobile` gets emulation toggled on either side by the driver, because `app.emulateMobile` reloads the window and kills the scene mid-run.
- The Settings dialog opens in its own popout window on this build: `document.querySelectorAll('.modal')` in the main window is empty. Use `app.setting.modalEl` and capture through that window's webContents (match `getContentSize()[0]` to `modalEl.ownerDocument.defaultView.innerWidth` across `remote.BrowserWindow.getAllWindows()`).
- The sandbox window is maximized with DevTools docked beside the page, so `setBounds` is ignored until `unmaximize()` and page `innerWidth` sits far below the window width; size to a target page width by measuring and correcting in a loop, then restore the bounds and maximize.
- GIF frames need the window visible, or typing outruns the command awaits.
