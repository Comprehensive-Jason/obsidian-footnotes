// Smoke tests: drive the REAL plugin inside a running Obsidian instance via
// the Obsidian CLI and assert on actual note contents. This is the
// integration layer - unit tests (vitest, test/) cover pure logic.
//
// Requirements:
//   - Obsidian is running with the Obsidian-Plugin-Sandbox vault focused
//   - the `obsidian` CLI is on PATH (ships with Obsidian 1.12+)
//   - the hot-reload community plugin is enabled (picks up deployed builds)
//
// Usage:
//   npm run test:smoke              deploys the current build, then tests
//   npm run test:smoke -- --no-deploy   tests whatever is already loaded

import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const NOTE = "Smoke Test - footnotes";
const PLUGIN_ID = "obsidian-footnotes";
const CMD_AUTONUM = "obsidian-footnotes:insert-autonumbered-footnote";
const CMD_NAMED = "obsidian-footnotes:insert-named-footnote";
const CMD_INLINE = "obsidian-footnotes:insert-inline-footnote";
const CMD_PASTE_INLINE = "obsidian-footnotes:paste-inline-footnote";
const CMD_LINT = "obsidian-footnotes:lint-footnotes";

// ---------- CLI plumbing ----------

// spawn the CLI without a shell so multiline/quoted args survive intact;
// on Windows the console entry point is Obsidian.com
const CLI_CANDIDATES = process.env.OBSIDIAN_CLI
    ? [process.env.OBSIDIAN_CLI]
    : process.platform === "win32"
        ? ["Obsidian.com", "obsidian"]
        : ["obsidian"];
let cli = null;

// The vault is named on EVERY call: without it the CLI follows whichever
// vault window is focused, and a run started while the personal vault was
// in front would put the scratch note there (the sanity check below used
// to be the only guard; naming the vault makes the wrong-window case
// impossible rather than merely detected, 2026-09-08).
const VAULT_NAME = "Obsidian-Plugin-Sandbox";
function ob(...args) {
    const candidates = cli ? [cli] : CLI_CANDIDATES;
    let lastErr;
    for (const candidate of candidates) {
        try {
            const out = execFileSync(candidate, [`vault=${VAULT_NAME}`, ...args], { encoding: "utf8" }).trim();
            cli = candidate;
            return out;
        } catch (e) {
            lastErr = e;
            if (e.code !== "ENOENT" && e.code !== "EINVAL") break;
        }
    }
    throw new Error(`obsidian CLI failed (${args[0]}): ${lastErr.message}`);
}

// The CLI occasionally swallows eval output; actions are fire-and-forget and
// state is read back with polling reads instead.
function action(code) {
    if (code.includes("executeCommandById(")) {
        // commands act on the ACTIVE view; refuse rather than press a
        // footnote key into whichever note the user has in front
        if (readJson(ACTIVE_IS_SMOKE) !== true) {
            throw new Error("refusing to run a command: the smoke note is not the active tab");
        }
    }
    ob("eval", `code=${code}`);
}

function read(code) {
    for (let i = 0; i < 3; i++) {
        const out = ob("eval", `code=${code}`);
        const m = out.match(/^=>\s?([\s\S]*)$/);
        if (m) return m[1];
        if (out) return out;
    }
    return "";
}

function readJson(code) {
    const out = read(`JSON.stringify(${code})`);
    try {
        return JSON.parse(out);
    } catch {
        return undefined;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A value embedded into code that the app will eval. JSON.stringify leaves
// the U+2028/U+2029 line separators raw, and a raw one inside a JS string
// literal is a syntax error (or worse) once evaluated - escape them so the
// literal is always well-formed (CodeQL js/bad-code-sanitization, 2026-09-08).
function jsLiteral(value) {
    return JSON.stringify(value)
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

async function pollUntil(desc, code, predicate, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = readJson(code);
        if (predicate(last)) return last;
        await sleep(250);
    }
    throw new Error(`timed out waiting for ${desc}; last value: ${jsLiteral(last)}`);
}

// ---------- vault helpers ----------

// The smoke note's OWN view, found by file path - never the active tab.
// The suite used to read app.workspace.activeLeaf.view, and the CLI's
// "open" command does not switch tabs: with another note focused, every
// setValue and every command press landed in THAT note (it overwrote one
// of Jason's working test sheets, 2026-09-08). Resolving by path makes a
// wrong-tab run fail loudly instead.
const NOTE_PATH = `${NOTE}.md`;
// the vault folder on disk (the plugin dir sits under its .obsidian), for a
// fixture too long to travel through one CLI argument
const VAULT_DIR = process.cwd().slice(0, process.cwd().indexOf(".obsidian"));
const EDITOR =
    `(() => { let leaf = null; app.workspace.iterateAllLeaves((l) => { ` +
    `if (l.view && l.view.file && l.view.file.path === ${jsLiteral(NOTE_PATH)} && l.view.editor) leaf = l; }); ` +
    `if (!leaf) throw new Error('smoke note is not open'); return leaf.view; })()`;
// true only while the smoke note is the active tab - commands act on the
// active view, so a press with another tab in front would edit that note
const ACTIVE_IS_SMOKE =
    `(() => { const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view; ` +
    `return !!(v && v.file && v.file.path === ${jsLiteral(NOTE_PATH)}); })()`;
// open the smoke note in its own tab (reusing one if it is already open)
// and make it the active tab
const ACTIVATE_SMOKE =
    `(async () => { const f = app.vault.getAbstractFileByPath(${jsLiteral(NOTE_PATH)}); if (!f) return; ` +
    `let leaf = null; app.workspace.iterateAllLeaves((l) => { if (l.view && l.view.getViewType && l.view.getViewType() === 'markdown' && l.view.file && l.view.file.path === f.path) leaf = l; }); ` +
    `if (!leaf) { leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); } ` +
    `app.workspace.setActiveLeaf(leaf, { focus: true }); })();`;

// content is set through the editor (not the file) so there is never a
// disk-vs-unsaved-buffer conflict between tests
let noteReady = false;
async function setupNote(content) {
    if (!noteReady) {
        ob("create", `name=${NOTE}`, "content=placeholder", "overwrite", "silent");
        // the CLI's "open" does not switch tabs - open and activate in-app
        ob("eval", `code=${ACTIVATE_SMOKE}`);
        await pollUntil("smoke note open and active", ACTIVE_IS_SMOKE, (v) => v === true);
        // the suite REQUIRES live preview: raw source mode renders no
        // table widgets (the cell tests just time out), and the leaf
        // inherits whatever mode its previous note used - force the mode
        // instead of depending on it (repeatability, 2026-08-10)
        action(
            `(async () => { const v=${EDITOR}; ` +
            `await v.setState({...v.getState(), mode:'source', source:false}, {history:false}); })();`,
        );
        await sleep(300);
        noteReady = true;
    }
    // the user may have clicked another tab mid-run: bring the smoke note
    // back in front before anything is written or pressed
    if (readJson(ACTIVE_IS_SMOKE) !== true) {
        ob("eval", `code=${ACTIVATE_SMOKE}`);
        await pollUntil("smoke note active again", ACTIVE_IS_SMOKE, (v) => v === true);
    }
    // close any popup a previous test left open (Escape routes through the
    // plugin's own close path, keeping its internal state consistent)
    action(
        `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
        `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
    );
    // park the cursor at the top first: if a previous test left a table
    // cell sub-editor open, moving the selection out closes it, and the
    // brief wait lets its sync-back finish before the content is replaced
    action(`const v=${EDITOR}; v.editor.focus(); v.editor.setCursor({line:0,ch:0});`);
    await sleep(150);
    action(`(${EDITOR}).editor.setValue(${jsLiteral(content)});`);
    await waitForEditorText(content);
    // the view's data buffer lags editor changes by a tick and the plugin
    // numbers footnotes from it; wait for it to sync so tests are stable
    await pollUntil(
        "view data buffer to sync",
        `(${EDITOR}).data`,
        (v) => v === content,
    );
}

// every test starts from the same settings baseline so one test's failure
// can't leak configuration into the next
const BASELINE_SETTINGS = {
    enablePopupEditor: false,
    insertAtEndOfWord: true,
    // OFF in the baseline so the selection-conversion tests keep their
    // exact-selection expectations; the whole-word expansion has its own
    // unit coverage (2026-08-29)
    expandSelectionToWholeWords: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    enableRemoveBlankLastLines: true,
    // the keys that replaced older ones sit here too, so a test that sets
    // one cannot leak it into the tests after it (the second-pane test set
    // Numbered and five lint tests then renumbered named footnotes, 2026-09-24)
    footnoteNaming: "keep",
    footnotePlacement: "after",
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    // both missing from the baseline until 2026-09-09 (review D8): a test
    // that turned merging on would have leaked it into every later test
    lintMergeDuplicateDefinitions: false,
    lintFixPunctuation: true,
    lintMoveToBottom: true,
    lintReindex: true,
    lintApplyPrefix: true,
    lintOnSave: false,
    lintOnFootnoteCreation: false,
};
function resetSettings(overrides = {}) {
    setSettings({ ...BASELINE_SETTINGS, ...overrides });
}

async function waitForEditorText(expected) {
    await pollUntil(
        `editor to contain ${jsLiteral(expected)}`,
        `(${EDITOR}).editor ? (${EDITOR}).editor.getValue() : null`,
        (v) => v === expected,
    );
}

function document_hasPopup() {
    return readJson(`!!document.querySelector('.footnote-shortcut-popup')`) === true;
}

function setCursorAndRun(line, ch, commandId) {
    action(
        `const v=${EDITOR}; v.editor.setCursor({line:${line},ch:${ch}}); ` +
        `app.commands.executeCommandById('${commandId}');`,
    );
}

function setSettings(patch) {
    action(
        `Object.assign(app.plugins.plugins['${PLUGIN_ID}'].settings, ${jsLiteral(patch)});`,
    );
}

// ---------- test runner ----------

let failures = 0;
let skips = 0;
let filtered = 0;
let ran = 0;

// --filter <substring> runs only the tests whose name contains the
// substring (case-insensitive) - the suite is 70+ sequential tests
// against the live app, so iterating on one new test shouldn't cost a
// full run every time. Deploy, settings backup/restore, and the scratch
// note still happen; only the test bodies are skipped.
const filterFlagIdx = process.argv.indexOf("--filter");
const nameFilter =
    filterFlagIdx !== -1 ? (process.argv[filterFlagIdx + 1] ?? "") : null;
if (filterFlagIdx !== -1 && !nameFilter) {
    console.error("--filter needs a substring, e.g. --filter \"multi-caret\"");
    process.exit(2);
}

class SkipTest extends Error {}

// The table widget only opens its cell sub-editor from a FOCUSED window's
// render loop - hidden stalls it entirely, and merely-visible-but-unfocused
// leaves the editor focus() a no-op (observed 2026-08-10: showInactive made
// the tests FAIL instead of skip). Tests that need the cell editor call
// this; it grabs focus once when necessary (the suite is run deliberately,
// so a brief front is acceptable) and SKIPs loudly when even that fails.
async function requireVisibleWindow() {
    const usable = () =>
        readJson("document.hidden") === false &&
        readJson("document.hasFocus()") === true;
    if (usable()) return;
    action(
        `(() => { try { const w = require('electron').remote?.getCurrentWindow?.(); ` +
        `if (w?.isMinimized()) w.restore(); w?.show(); w?.focus(); } catch (e) {} })();`,
    );
    await sleep(500);
    if (usable()) return;
    throw new SkipTest(
        "Obsidian window is hidden or cannot take focus - table cell editing can't render",
    );
}

// Open the table cell on `line` that contains `landmark` and put FOCUS
// inside its sub-editor. The main caret parks on `outsideLine` (a
// non-table line) first: focusing while the caret already sits inside the
// table opens whatever cell HOLDS it - right after setValue that is the
// FIRST cell, and the command then edits the wrong cell (root-caused
// 2026-08-27). The poll also verifies the opened cell really is the
// landmark's, kicking the selection back out when a wrong cell grabbed
// the focus, and re-focuses the cell's own contentDOM - a td-level focus
// makes the command's cell resolution (findFromDOM) see the MAIN view.
async function activateTableCell(line, outsideLine, landmark) {
    action(`(${EDITOR}).editor.setCursor({line:${outsideLine}, ch:0});`);
    await sleep(200);
    await pollUntil(
        "table cell sub-editor open and focused on the target cell",
        `(() => { const v=${EDITOR}; const t=v.containerEl.querySelector('.markdown-source-view table'); ` +
        `const cc = t && t.querySelector('.cm-content'); ` +
        `if (cc && cc.textContent.includes(${jsLiteral(landmark)})) { ` +
        `if (cc.contains(document.activeElement)) return true; cc.focus(); return false; } ` +
        `if (cc) { v.editor.setCursor({line:${outsideLine}, ch:0}); return false; } ` +
        `v.editor.cm.contentDOM.focus(); ` +
        `const ch=v.editor.getLine(${line}).indexOf(${jsLiteral(landmark)})+1; ` +
        `v.editor.setCursor({line:${line}, ch}); return false; })()`,
        (v) => v === true,
    );
}

async function test(name, fn) {
    if (nameFilter !== null && !name.toLowerCase().includes(nameFilter.toLowerCase())) {
        filtered++;
        return;
    }
    ran++;
    try {
        await fn();
        console.log(`  PASS  ${name}`);
    } catch (e) {
        if (e instanceof SkipTest) {
            skips++;
            console.log(`  SKIP  ${name}\n        ${e.message}`);
            return;
        }
        failures++;
        console.error(`  FAIL  ${name}\n        ${e.message}`);
    }
}

async function expectEditorText(expected) {
    await pollUntil(
        `editor text ${jsLiteral(expected)}`,
        `(${EDITOR}).editor.getValue()`,
        (v) => v === expected,
    );
}

// ---------- settings safety net ----------
// The suite patches the live plugin settings per test. Restoration must
// survive EVERY exit path - a failed assertion, a thrown poll timeout,
// Ctrl+C - or Jason has to re-edit his settings by hand after each run
// (observed 2026-08-10, when aborted runs left lint-on-save + a section
// heading behind). The pre-run snapshot also lands in a sidecar file, so
// even a hard-killed run heals on the NEXT invocation.

const SETTINGS_BACKUP = join(
    dirname(fileURLToPath(import.meta.url)),
    ".smoke-settings.bak.json",
);
let savedSettings = null;
let cleanupDone = false;

function restoreState(reason) {
    if (cleanupDone) return;
    cleanupDone = true;
    try {
        ob("delete", `path=${NOTE}.md`);
    } catch {
        // the note may never have been created - nothing to delete
    }
    if (!savedSettings) return;
    try {
        setSettings(savedSettings);
        const now = readJson(`app.plugins.plugins['${PLUGIN_ID}'].settings`);
        if (JSON.stringify(now) === JSON.stringify(savedSettings)) {
            if (existsSync(SETTINGS_BACKUP)) unlinkSync(SETTINGS_BACKUP);
            console.log(`settings restored (${reason})`);
        } else {
            console.error(
                `settings restore could not be verified (${reason}) - backup kept at ${SETTINGS_BACKUP}`,
            );
        }
    } catch (e) {
        console.error(
            `settings restore failed (${reason}): ${e.message} - backup kept at ${SETTINGS_BACKUP}`,
        );
    }
}

process.on("SIGINT", () => {
    restoreState("interrupted");
    process.exit(130);
});

// ---------- suite ----------

async function main() {
    const deploy = !process.argv.includes("--no-deploy");

    // sanity: right vault, plugin loaded
    const vault = read("app.vault.getName()");
    if (!vault.includes("Sandbox")) {
        throw new Error(`refusing to run against vault "${vault}" - smoke tests mutate notes`);
    }
    if (readJson(`!!app.plugins.plugins['${PLUGIN_ID}']`) !== true) {
        throw new Error(`plugin ${PLUGIN_ID} is not loaded`);
    }

    if (deploy) {
        // repo root may be the plugin dir itself or a worktree beneath it
        const root = process.cwd();
        const idx = root.indexOf(".obsidian");
        if (idx === -1) throw new Error("cannot locate plugin dir from cwd");
        const pluginDir = join(root.slice(0, idx), ".obsidian", "plugins", PLUGIN_ID);
        for (const f of ["main.js", "styles.css"]) {
            const src = resolve(root, f);
            const dest = join(pluginDir, f);
            // when run from the plugin dir itself there is nothing to copy
            if (existsSync(src) && resolve(src) !== resolve(dest)) copyFileSync(src, dest);
        }
        console.log(`deployed build to ${pluginDir}; waiting for hot-reload...`);
        // let hot-reload's own cycle finish first - then reload explicitly
        // anyway: hot-reload has repeatedly left a STALE or DEAD instance
        // behind after a deploy (whole-suite failures, 2026-08-05), and an
        // explicit disable/enable cycle re-evaluates main.js from disk
        // deterministically
        await sleep(2500);
        // enablePluginAndSave PERSISTS the enablement: plain enablePlugin
        // is session-only, and since the plugin isn't in the vault's saved
        // community-plugins.json by default, an Obsidian restart after a
        // session-only enable brought the vault up with the plugin OFF -
        // every hotkey silently dead (Jason hit this 2026-08-21, reported
        // as "footnote hotkeys do nothing")
        action(
            `(async () => { await app.plugins.disablePlugin('${PLUGIN_ID}'); ` +
            `await app.plugins.enablePluginAndSave('${PLUGIN_ID}'); })();`,
        );
        await pollUntil(
            "the reloaded plugin's commands",
            `!!app.commands.commands['${CMD_AUTONUM}']`,
            (v) => v === true,
            10000,
        );
        await sleep(300);
    }

    // snapshot the settings - or, when a sidecar backup survived a killed
    // run, treat THAT as the true pre-smoke state and heal it first. Read
    // first and act on the outcome rather than checking existence and then
    // reading (CodeQL js/file-system-race, 2026-09-08).
    let backup = null;
    try {
        backup = readFileSync(SETTINGS_BACKUP, "utf8");
    } catch (e) {
        if (e.code !== "ENOENT") throw e;
    }
    if (backup !== null) {
        savedSettings = JSON.parse(backup);
        console.log(
            "found settings backup from an interrupted run - restoring it before starting",
        );
        setSettings(savedSettings);
    } else {
        savedSettings = readJson(
            `app.plugins.plugins['${PLUGIN_ID}'].settings`,
        );
        writeFileSync(SETTINGS_BACKUP, JSON.stringify(savedSettings, null, 2));
    }

    // an occluded/minimized window stalls the render loop (table cells,
    // toasts, data-buffer sync) and wedges the suite - nudge it visible
    // without stealing focus, and say so when that wasn't enough
    action(
        `(() => { try { const w = require('electron').remote?.getCurrentWindow?.(); ` +
        `if (w?.isMinimized()) w.restore(); w?.showInactive?.(); } catch (e) {} })();`,
    );
    await sleep(300);
    if (readJson("document.hidden") === true) {
        console.log(
            "NOTE: the Obsidian window is still hidden/occluded - table-cell tests will skip, and toast-dependent tests may be unreliable",
        );
    }

    // a previous failed run (or a plugin reload mid-popup) can leave stray
    // popup elements in the DOM; they'd poison every popup assertion below
    action(`document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => el.remove());`);

    console.log(`running smoke tests against vault "${vault}"\n`);

    await test("numbered footnote inserts at end of word", async () => {
        resetSettings();
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM); // mid "bravo"
        await expectEditorText("Alpha bravo[^1] charlie\n\n[^1]: ");
    });

    await test("next footnote gets the next number", async () => {
        resetSettings();
        await setupNote("Alpha bravo[^1] charlie\n\n[^1]: existing");
        setCursorAndRun(0, 18, CMD_AUTONUM); // mid "charlie"
        await expectEditorText("Alpha bravo[^1] charlie[^2]\n\n[^1]: existing\n[^2]: ");
    });

    await test("hotkey right after an existing reference inserts a consecutive footnote", async () => {
        // issue #49: this used to jump to [^1]'s definition because the caret
        // touching the reference's outer edge counted as "on" it
        resetSettings();
        await setupNote("Alpha bravo[^1] charlie\n\n[^1]: existing");
        setCursorAndRun(0, 15, CMD_AUTONUM); // caret immediately after "[^1]"
        await expectEditorText("Alpha bravo[^1][^2] charlie\n\n[^1]: existing\n[^2]: ");
    });

    await test("hotkey inside an existing reference still navigates to its definition", async () => {
        resetSettings();
        await setupNote("Alpha bravo[^1] charlie\n\n[^1]: existing");
        setCursorAndRun(0, 13, CMD_AUTONUM); // caret inside "[^1]"
        await pollUntil(
            "cursor on the definition line",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 2,
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== "Alpha bravo[^1] charlie\n\n[^1]: existing") {
            throw new Error(`navigation changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("jumping between reference and definition centers the cursor in view", async () => {
        // regression (reported 2026-07-16): Obsidian's minimal scrolling
        // parked the cursor at the very edge of the viewport after a jump -
        // on mobile, nearly off screen. Jumps should land centered.
        resetSettings();
        const lines = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1} lorem ipsum.`);
        lines[60] += "[^1]";
        lines.push("", "[^1]: the definition");
        await setupNote(lines.join("\n"));
        // start on the definition line (last line) and jump UP to the reference
        setCursorAndRun(122, 5, CMD_AUTONUM);
        await pollUntil(
            "cursor on the reference line",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 60,
        );
        const ratio = await pollUntil(
            "cursor vertically inside the middle band of the viewport",
            `(() => { const cm = (${EDITOR}).editor.cm; ` +
            `const c = cm.coordsAtPos(cm.state.selection.main.head); ` +
            `const r = cm.scrollDOM.getBoundingClientRect(); ` +
            `return c && r.height > 0 ? (c.top - r.top) / r.height : null; })()`,
            (v) => typeof v === "number" && v > 0.25 && v < 0.75,
        );
        void ratio;
    });

    await test("named footnote inserts empty reference with cursor inside", async () => {
        resetSettings();
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_NAMED);
        await expectEditorText("Alpha bravo[^] charlie");
        const cursor = await pollUntil(
            "cursor inside reference",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 0,
        );
        if (cursor.ch !== 13) throw new Error(`cursor at ch ${cursor.ch}, expected 13 (inside [^])`);
    });

    await test("section heading with divider gets a blank line above", async () => {
        resetSettings({ enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "---\n## Footnotes" });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM);
        await expectEditorText("Alpha bravo[^1] charlie\n\n---\n## Footnotes\n\n[^1]: ");
    });

    await test("blank lines at end of note survive when trimming is off", async () => {
        resetSettings({ enableRemoveBlankLastLines: false });
        await setupNote("Alpha bravo charlie\n\n\n");
        setCursorAndRun(0, 8, CMD_AUTONUM);
        // the first footnote in a note always adds one separator blank line
        // on top of whatever trailing blank lines were kept
        await expectEditorText("Alpha bravo[^1] charlie\n\n\n\n\n[^1]: ");
    });

    await test("popup opens focused on footnote creation, cursor stays put", async () => {
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM);
        await pollUntil(
            "popup visible and focused",
            `(() => { const p = document.querySelector('.footnote-shortcut-popup');
                return { open: !!p, visible: p ? p.style.visibility === '' : false,
                    focused: p ? p.contains(document.activeElement) : false }; })()`,
            (s) => s && s.open && s.visible && s.focused,
        );
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (!cursor || cursor.line !== 0) {
            throw new Error(`cursor left line 0: ${jsLiteral(cursor)}`);
        }
    });

    await test("footnote hotkey toggles the popup closed", async () => {
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "popup closed with focus back in editor",
            `(() => ({ gone: !document.querySelector('.footnote-shortcut-popup'),
                focusBack: (${EDITOR}).containerEl.contains(document.activeElement) }))()`,
            (s) => s && s.gone && s.focusBack,
        );
        const line0 = readJson(`(${EDITOR}).editor.getLine(0)`);
        if (line0 !== "Alpha bravo[^1] charlie") {
            throw new Error(`toggle-close inserted an extra footnote: ${jsLiteral(line0)}`);
        }
    });

    await test("typing right after the popup closes is never wiped by the popup's own save (B31, 2026-09-16)", async () => {
        // Verification note 19 (Kimi/Claude sweeps, reproduced on video
        // 2026-09-14): the popup's embedded editor saved the WHOLE file on
        // its own delay, and when that write landed after the popup had
        // closed, Obsidian folded the file back into the main editor and
        // wiped whatever had been typed there in between. The close and
        // the typing happen in ONE eval here, so the typing always beats
        // the write; before the fix this test lost " echo foxtrot" every
        // time, after it the main editor is the only writer.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM);
        await pollUntil(
            "popup open and focused",
            `(() => { const p = document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-loading)');
                return !!p && p.contains(document.activeElement); })()`,
            (v) => v === true,
        );
        // type the definition in the popup, as a person would
        action(`document.execCommand('insertText', false, 'the definition');`);
        await pollUntil(
            "definition typed into the popup",
            `(() => { const c = document.querySelector('.footnote-shortcut-popup .cm-content'); return c ? c.textContent : null; })()`,
            (v) => typeof v === "string" && v.includes("the definition"),
        );
        // close with the hotkey and type in the note in the same tick,
        // before any write from the embed can land. The typing goes
        // through the editor API: a keystroke is an editor edit, and the
        // race is between that edit and the embed's file write, however
        // the edit is made (execCommand right after the focus hand-back
        // did not reliably reach the main editor from the CLI).
        action(
            `app.commands.executeCommandById('${CMD_AUTONUM}'); ` +
            `const v=${EDITOR}; v.editor.replaceRange(' echo foxtrot', {line:0, ch: v.editor.getLine(0).length});`,
        );
        await pollUntil(
            "the typed words on the line",
            `(${EDITOR}).editor.getLine(0)`,
            (v) => v === "Alpha bravo[^1] charlie echo foxtrot",
        );
        // the embed's delayed save used to land in this window
        await sleep(3000);
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        const expected = "Alpha bravo[^1] charlie echo foxtrot\n\n[^1]: the definition";
        if (typeof text !== "string" || text.replace(/\n+$/, "") !== expected) {
            throw new Error(`typed text or definition lost: ${jsLiteral(text)}`);
        }
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (!cursor || cursor.line !== 0) {
            throw new Error(`caret jumped after the close: ${jsLiteral(cursor)}`);
        }
    });

    // A carried paste into the popup (hunt 2026-10-02, round 4, cluster U6;
    // pin bug-carry-paste-into-popup-ignores-note). The popup's editor holds
    // only [^2]'s text, and the embed joins every line of it into the note
    // as [^2]'s own text, so the paste is planned against the whole note:
    // the pasted [^1] clashes with the note's own [^1] and becomes [^3], and
    // its definition goes into the note after the last definition, not into
    // the popup. Both routes a paste can take are driven: the paste event,
    // and the input-method route a phone keyboard's clipboard history takes
    // (CodeMirror's input handlers, called in order the way CodeMirror
    // calls them, until one takes the text).
    for (const route of ["paste event", "input method"]) {
        await test(`a carried paste into the popup renames a clashing footnote and puts its definition in the note (${route}, 2026-10-06)`, async () => {
            resetSettings({ enablePopupEditor: true, carryFootnotesOnCopy: true });
            await setupNote("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ");
            setCursorAndRun(0, 19, CMD_AUTONUM); // inside [^2]: opens its popup
            const popupContent = `document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-loading) .cm-content')`;
            await pollUntil("popup open on [^2]", `!!${popupContent}`, (v) => v === true);
            await sleep(300);
            const clipboard = jsLiteral("see x[^1]\n\n[^1]: their source");
            const popupView = `(${EDITOR}).editor.cm.constructor.findFromDOM(${popupContent})`;
            if (route === "paste event") {
                action(
                    `(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${clipboard}); ` +
                    `${popupContent}.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })();`,
                );
            } else {
                // when no handler takes the text, CodeMirror inserts it as typed
                action(
                    `(() => { const view = ${popupView}; const end = view.state.doc.length; ` +
                    `const typed = () => view.state.update({ changes: { from: end, insert: ${clipboard} } }); ` +
                    `for (const handler of view.state.facet(view.constructor.inputHandler)) { ` +
                    `if (handler(view, end, end, ${clipboard}, typed)) return; } view.dispatch(typed()); })();`,
                );
            }
            const expected = "Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: see x[^3]\n[^3]: their source";
            // the main editor shows the note as the embed joins it, at once
            await expectEditorText(expected);
            const popupText = readJson(`${popupView}.state.doc.toString()`);
            if (popupText !== "see x[^3]") throw new Error(`the popup holds ${jsLiteral(popupText)}, expected "see x[^3]"`);
            // past the embed's own delayed save, then closed: the definition
            // the paste put outside the popup stays
            await sleep(2500);
            action(`${popupContent}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));`);
            await pollUntil("popup closed", `!document.querySelector('.footnote-shortcut-popup')`, (v) => v === true);
            await sleep(800);
            await expectEditorText(expected);
        });
    }

    await test("popup opens promptly despite a definition-shaped decoy in a code span", async () => {
        // regression (reported 2026-08-26): the popup's buffer-caught-up
        // poll searched the RAW view buffer for "[^id]:", so a code-span
        // decoy (like a manual sheet's own "`[^name]: …`" checkbox text) matched the
        // STALE buffer instantly, the pre-open save was skipped (buffer
        // still equal to disk), and the popup sat invisible ~2s until
        // Obsidian's own debounced autosave finally put the definition on
        // disk for the embed to find
        resetSettings({ enablePopupEditor: true });
        // a REALISTIC note size: the buffer's catch-up lag grows with the
        // note, and only a lag longer than the cachedRead await trips the
        // skipped save (a one-liner syncs too fast to reproduce)
        const filler = Array.from(
            { length: 40 },
            (_, i) => `Paragraph ${i + 1} lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
        ).join("\n");
        await setupNote(`Alpha bravo charlie\n\nDecoy text: \`[^1]: fake\` stays code.\n\n${filler}`);
        // the note must be CLEAN ON DISK before the press - that's the
        // idle-note state the bug needs (buffer === disk skips the save)
        action(`window.__decoySaved = false; (async () => { await (${EDITOR}).save(); window.__decoySaved = true; })();`);
        await pollUntil("note saved to disk", `window.__decoySaved`, (v) => v === true);
        action(
            `window.__popupPromptness = null; const t0 = performance.now(); ` +
            `const mo = new MutationObserver(() => { ` +
            `const p = document.querySelector('.footnote-shortcut-popup'); ` +
            `if (p && !p.classList.contains('footnote-shortcut-popup-loading')) { ` +
            `window.__popupPromptness = Math.round(performance.now() - t0); mo.disconnect(); } }); ` +
            `mo.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']}); ` +
            `const v=${EDITOR}; v.editor.setCursor({line:0,ch:8}); ` +
            `app.commands.executeCommandById('${CMD_AUTONUM}');`,
        );
        const delay = await pollUntil(
            "popup visible with its open latency recorded",
            `window.__popupPromptness`,
            (v) => typeof v === "number",
            8000,
        );
        // healthy runs measure 100-300ms; the decoy stall measures
        // 1100-2000ms+ (down to ~1.1s when a nearby save's cache reindex
        // happens to cut the wait short) - 700ms splits the modes cleanly
        if (delay > 700) {
            throw new Error(`popup took ${delay}ms to become visible (decoy stall)`);
        }
        // leave no popup behind for the next test
        action(
            `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
            `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
        );
        await sleep(800);
    });

    await test("popup still opens (no jump) when the metadata cache is slow to index (2026-09-04)", async () => {
        // Jason's report 2026-09-04: with the popup ON, a busy PC sometimes
        // JUMPED to the definition instead - the popup's bind retries ran
        // on a 3s wall clock and fell back to the legacy jump when the
        // cache hadn't re-indexed the note in time. Simulate the slow
        // machine: serve the PRE-press cache for this note for 4.5s (the
        // embed's subpath can't resolve), then restore it and fire the
        // cache's own "changed" event. Old code: jump at 3s. New code:
        // the waiting notice, then the popup once the event lands.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        action(`window.__slowSaved = false; (async () => { await (${EDITOR}).save(); window.__slowSaved = true; })();`);
        await pollUntil("note saved to disk", `window.__slowSaved`, (v) => v === true);
        action(
            `(() => { const v=${EDITOR}; const mc = app.metadataCache; ` +
            `const orig = mc.getFileCache; const path = v.file.path; ` +
            `const snap = JSON.parse(JSON.stringify(orig.call(mc, v.file))); ` +
            `window.__slowCache = { restored: false, restore: () => { if (mc.getFileCache !== orig) mc.getFileCache = orig; window.__slowCache.restored = true; } }; ` +
            `mc.getFileCache = function (f) { return f && f.path === path ? snap : orig.call(this, f); }; ` +
            `window.__slowPopup = { visibleAt: null, noticeSeen: false, jumped: false }; const t0 = performance.now(); ` +
            `const mo = new MutationObserver(() => { ` +
            `const p = document.querySelector('.footnote-shortcut-popup'); ` +
            `if (p && !p.classList.contains('footnote-shortcut-popup-loading') && window.__slowPopup.visibleAt === null) { window.__slowPopup.visibleAt = Math.round(performance.now() - t0); } ` +
            `for (const n of document.querySelectorAll('.notice')) { if (n.textContent.includes('Waiting for Obsidian to index')) window.__slowPopup.noticeSeen = true; } }); ` +
            `mo.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']}); ` +
            `window.__slowPopup.stop = () => mo.disconnect(); ` +
            `setTimeout(() => { window.__slowCache.restore(); mc.trigger('changed', v.file, v.editor.getValue(), orig.call(mc, v.file)); }, 4500); ` +
            `v.editor.setCursor({line:0,ch:5}); app.commands.executeCommandById('${CMD_AUTONUM}'); })();`,
        );
        try {
            const result = await pollUntil(
                "popup visible after the stalled index",
                `window.__slowPopup`,
                (v) => v && typeof v.visibleAt === "number",
                15000,
            );
            // the stall was real: nothing could bind before the restore
            if (result.visibleAt < 3500) {
                throw new Error(`popup visible at ${result.visibleAt}ms - the cache stall didn't take, this run proves nothing`);
            }
            if (!result.noticeSeen) {
                throw new Error("the waiting notice never appeared during the stall");
            }
            // ... and the caret never jumped to the definition line
            const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
            if (!cursor || cursor.line !== 0) {
                throw new Error(`caret at ${jsLiteral(cursor)} - the popup fell back to the jump`);
            }
            await expectEditorText("Alpha[^1] bravo charlie\n\n[^1]: ");
        } finally {
            action(`window.__slowCache?.restore(); window.__slowPopup?.stop?.();`);
            action(
                `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
                `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
            );
            await sleep(800);
        }
    });

    await test("a hotkey pressed inside the Live Preview Properties widget refuses instead of editing the stale caret (2026-09-04)", async () => {
        // Jason's manual pass: source mode refuses a frontmatter caret, but in
        // Live Preview the frontmatter is the Properties widget, which
        // lives outside CodeMirror's contentDOM - the main editor's caret
        // stayed where the user last clicked in the prose, and the hotkey
        // minted a footnote THERE. Focus in the widget must refuse like
        // source mode does.
        resetSettings();
        const before = "---\ntitle: fixture\n---\nAlpha bravo charlie";
        await setupNote(before);
        // the stale caret: mid-prose, where the footnote used to land
        action(`const v=${EDITOR}; v.editor.focus(); v.editor.setCursor({line:3,ch:5});`);
        const field = await pollUntil(
            "a Properties value field rendered",
            `(() => { const v=${EDITOR}; const f = v.containerEl.querySelector('.metadata-container .metadata-input-longtext, .metadata-container input.metadata-input-text'); return f ? f.className : null; })()`,
            (v) => typeof v === "string",
        );
        if (!field) throw new Error("no Properties field to focus");
        action(
            `(() => { const v=${EDITOR}; const f = v.containerEl.querySelector('.metadata-container .metadata-input-longtext, .metadata-container input.metadata-input-text'); ` +
            `window.__propsNotice = false; const mo = new MutationObserver(() => { for (const n of document.querySelectorAll('.notice')) { if (n.textContent.includes('No footnote was created')) window.__propsNotice = true; } }); ` +
            `mo.observe(document.body, {childList: true, subtree: true}); window.__propsStop = () => mo.disconnect(); ` +
            `f.focus(); window.__propsFocused = document.activeElement === f || f.contains(document.activeElement); ` +
            `app.commands.executeCommandById('${CMD_AUTONUM}'); })();`,
        );
        try {
            const focused = readJson(`window.__propsFocused`);
            if (focused !== true) throw new SkipTest("could not focus the Properties field (window not focused?)");
            await pollUntil("the protected-text toast", `window.__propsNotice`, (v) => v === true);
            await sleep(300);
            await expectEditorText(before);
        } finally {
            action(`window.__propsStop?.(); const v=${EDITOR}; v.editor.focus();`);
        }
    });

    await test("Escape pressed in the NOTE closes an open popup (2026-09-04)", async () => {
        // Jason's report: after a reading-view round trip the caret sits in
        // the note, and Escape there did nothing while a click outside or
        // the hotkey still closed the popup. Escape now closes it from the
        // note as well as from inside it.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 5, CMD_AUTONUM);
        await pollUntil("popup open", `!!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-loading)')`, (v) => v === true);
        action(
            `(() => { const v=${EDITOR}; v.editor.cm.focus(); ` +
            `v.editor.cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})); })();`,
        );
        await pollUntil("popup closed by Escape from the note", `!document.querySelector('.footnote-shortcut-popup')`, (v) => v === true);
        await sleep(800);
    });

    await test("the reading-view hotkey pressed INSIDE the popup closes it and toggles the note in ONE press (2026-09-04)", async () => {
        // the popup's editor counts as Obsidian's active editor, so the
        // toggle used to flip the EMBED's mode - a swallowed press that only
        // dropped focus to the note. The popup's scope now catches the
        // command's hotkey, closes the popup, and toggles the note.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 5, CMD_AUTONUM);
        await pollUntil("popup open", `!!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-loading)')`, (v) => v === true);
        action(
            `(() => { const hk = (app.hotkeyManager.getHotkeys('markdown:toggle-preview') ?? app.hotkeyManager.getDefaultHotkeys('markdown:toggle-preview'))[0]; ` +
            `const mods = hk.modifiers; const mac = navigator.platform.startsWith('Mac'); ` +
            `const inner = document.querySelector('.footnote-shortcut-popup .cm-content'); window.__toggleTarget = !!inner; ` +
            `(inner ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {key: hk.key.toLowerCase(), code: 'Key' + hk.key.toUpperCase(), ` +
            `ctrlKey: mods.includes('Ctrl') || (mods.includes('Mod') && !mac), metaKey: mods.includes('Meta') || (mods.includes('Mod') && mac), ` +
            `shiftKey: mods.includes('Shift'), altKey: mods.includes('Alt'), bubbles: true, cancelable: true})); })();`,
        );
        try {
            if (readJson(`window.__toggleTarget`) !== true) throw new Error("no inline editor inside the popup to press the key in");
            await pollUntil("popup closed by the toggle hotkey", `!document.querySelector('.footnote-shortcut-popup')`, (v) => v === true);
            await pollUntil("reading view", `(${EDITOR}).getMode()`, (v) => v === "preview");
            // exactly ONE toggle: still Reading view half a second later
            await sleep(500);
            const mode = readJson(`(${EDITOR}).getMode()`);
            if (mode !== "preview") throw new Error(`mode is ${jsLiteral(mode)} after the press: the toggle ran twice`);
        } finally {
            action(
                `(async () => { const v=${EDITOR}; ` +
                `await v.setState({...v.getState(), mode:'source', source:false}, {history:false}); })();`,
            );
            await pollUntil("editing view", `(${EDITOR}).getMode()`, (v) => v === "source");
            await sleep(800);
        }
    });

    await test("switching to Reading view by any route closes an open popup (2026-09-04)", async () => {
        // the pen icon / a palette pick: no hotkey for the popup's scope to
        // catch, so the layout-change listener closes it instead
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 5, CMD_AUTONUM);
        await pollUntil("popup open", `!!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-loading)')`, (v) => v === true);
        // toggleMode is what the pen icon, the palette command, and the
        // hotkey all call, and it fires layout-change; a programmatic
        // setState flip does NOT (probed live 2026-09-04), so this test
        // must take the user's route
        action(`(async () => { await (${EDITOR}).toggleMode(); })();`);
        try {
            await pollUntil("popup closed by the mode switch", `!document.querySelector('.footnote-shortcut-popup')`, (v) => v === true);
        } finally {
            action(
                `(async () => { const v=${EDITOR}; ` +
                `await v.setState({...v.getState(), mode:'source', source:false}, {history:false}); })();`,
            );
            await pollUntil("editing view", `(${EDITOR}).getMode()`, (v) => v === "source");
            await sleep(800);
        }
    });

    await test("creation lint is applied BEFORE the popup opens (2026-08-27)", async () => {
        // Jason's ask 2026-08-27: with the popup on, the lint used to wait
        // until the popup CLOSED - the note looked unlinted the whole time
        // the popup was up. It now lints right after the creation edit,
        // before the popup appears (which also lets the popup bind to the
        // post-lint id instead of dodging a mid-popup rename).
        resetSettings({
            enablePopupEditor: true,
            lintOnFootnoteCreation: true,
            insertAtEndOfWord: false,
        });
        await setupNote("Alpha, bravo");
        setCursorAndRun(0, 5, CMD_AUTONUM); // just before the comma
        await pollUntil(
            "popup open",
            `!!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
        // the punctuation fix is already applied WHILE the popup is up
        await expectEditorText("Alpha,[^1] bravo\n\n[^1]: ");
        action(
            `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
            `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
        );
        await sleep(800);
        // closing changes nothing further - the lint already ran
        await expectEditorText("Alpha,[^1] bravo\n\n[^1]: ");
    });

    await test("popup binds to the RENUMBERED id when the creation lint renames the new footnote", async () => {
        // the reason pre-popup linting is safe at all: the popup opens on
        // the post-lint id (lintAfterFootnoteCreation returns the
        // relocated name), so a reindex renaming the just-created
        // footnote can no longer strand the popup on a dead id
        resetSettings({
            enablePopupEditor: true,
            lintOnFootnoteCreation: true,
            insertAtEndOfWord: false,
        });
        await setupNote("zeta[^5] quick\n\n[^5]: five");
        setCursorAndRun(0, 11, CMD_AUTONUM); // mid "quick" - mints [^6]
        await pollUntil(
            "popup open",
            `!!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
        // reindex renamed 5→1 and the new 6→2 before the popup opened...
        await expectEditorText("zeta[^1] qu[^2]ick\n\n[^1]: five\n[^2]: ");
        // ...and the popup is bound to the RENAMED id, not the minted one
        const label = await pollUntil(
            "popup label",
            `document.querySelector('.footnote-shortcut-popup-label')?.textContent ?? null`,
            (v) => typeof v === "string",
        );
        if (label !== "[^2]:") {
            throw new Error(`popup bound to ${jsLiteral(label)}, expected "[^2]:"`);
        }
        // ... and the caret sits just past the NEW reference, so the popup
        // anchors there too - the lint's minimal-diff rewrite maps a caret
        // inside its span to the span START (the FIRST footnote) unless it
        // is re-landed semantically (Jason's report 2026-08-27)
        const atRef = { line: 0, ch: "zeta[^1] qu[^2]".length };
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (!cursor || cursor.line !== atRef.line || cursor.ch !== atRef.ch) {
            throw new Error(
                `caret at ${jsLiteral(cursor)} while the popup is up, expected just past [^2] at ${jsLiteral(atRef)}`,
            );
        }
        action(
            `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
            `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
        );
        await pollUntil(
            "popup closed",
            `!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
        // closing hands the caret back just past the new reference as well
        const after = readJson(`(${EDITOR}).editor.getCursor()`);
        if (!after || after.line !== atRef.line || after.ch !== atRef.ch) {
            throw new Error(
                `caret at ${jsLiteral(after)} after closing, expected just past [^2] at ${jsLiteral(atRef)}`,
            );
        }
        await sleep(800);
    });

    await test("multi-caret named continuation returns the caret after the FIRST reference when the popup closes (2026-08-29)", async () => {
        // Jason's consistency ruling: every multi-caret flow ends with the
        // caret after the FIRST reference. The popup arm is the case units
        // can't reach - it parks the caret wherever the continuation
        // collapsed the multi-cursor and hands it back on close.
        resetSettings({ enablePopupEditor: true });
        await setupNote("alpha bravo charlie delta echo");
        action(
            `(() => { const v=${EDITOR}; v.editor.focus(); ` +
            `v.editor.setSelections([{anchor:{line:0,ch:5},head:{line:0,ch:5}},{anchor:{line:0,ch:19},head:{line:0,ch:19}}]); ` +
            `app.commands.executeCommandById('${CMD_NAMED}'); })();`,
        );
        await expectEditorText("alpha[^] bravo charlie[^] delta echo");
        action(`(${EDITOR}).editor.replaceSelection('cite');`);
        await expectEditorText("alpha[^cite] bravo charlie[^cite] delta echo");
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        await pollUntil(
            "popup bound to the shared definition",
            `document.querySelector('.footnote-shortcut-popup-label')?.textContent ?? null`,
            (v) => v === "[^cite]:",
        );
        action(
            `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
            `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
        );
        await pollUntil(
            "popup closed",
            `!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        const want = { line: 0, ch: "alpha[^cite]".length };
        if (!cursor || cursor.line !== want.line || cursor.ch !== want.ch) {
            throw new Error(`caret at ${jsLiteral(cursor)}, expected after the FIRST reference at ${jsLiteral(want)}`);
        }
        await sleep(800);
    });

    await test("inline footnote inserts ^[] at end of word with cursor inside", async () => {
        resetSettings();
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_INLINE); // mid "bravo"
        await expectEditorText("Alpha bravo^[] charlie");
        const cursor = await pollUntil(
            "cursor inside the inline footnote",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 0,
        );
        // "Alpha bravo^[" is 13 chars - the caret belongs between the brackets
        if (cursor.ch !== 13) throw new Error(`cursor at ch ${cursor.ch}, expected 13 (inside ^[])`);
    });

    await test("second inline press warns while empty, hops once filled", async () => {
        // empty half (Jason, 2026-08-08): the second press used to hop the
        // caret out of the untouched ^[], stranding an empty inline
        // footnote - it now warns like the empty [^] reference and stays put
        resetSettings();
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_INLINE); // creates ^[] with cursor inside
        await expectEditorText("Alpha bravo^[] charlie");
        action(`app.commands.executeCommandById('${CMD_INLINE}');`);
        await pollUntil(
            "the empty inline footnote warning",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("inline footnote is empty"),
        );
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (!cursor || cursor.ch !== 13) {
            throw new Error(`caret moved to ${jsLiteral(cursor)}, expected ch 13 (inside ^[])`);
        }
        // filled half: with text between the brackets, the second press is
        // the "done typing" hop past the closing bracket
        action(`(${EDITOR}).editor.replaceRange('filled', {line:0,ch:13});`);
        await expectEditorText("Alpha bravo^[filled] charlie");
        action(`app.commands.executeCommandById('${CMD_INLINE}');`);
        await pollUntil(
            "cursor just past the filled inline footnote",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 0 && c.ch === "Alpha bravo^[filled]".length,
        );
        const line = readJson(`(${EDITOR}).editor.getLine(0)`);
        if (line !== "Alpha bravo^[filled] charlie") {
            throw new Error(`second press changed the text: ${jsLiteral(line)}`);
        }
    });

    await test("inline footnote from clipboard pastes sanitized content", async () => {
        resetSettings();
        await setupNote("Alpha bravo charlie");
        // the real OS clipboard can't be driven headlessly (navigator.clipboard
        // requires document focus, and Electron's clipboard module is inert in
        // Obsidian's renderer), so stub the read at the platform boundary -
        // the command path from clipboard text to editor is still exercised.
        // The stub content needs sanitizing (newline) to prove that runs too.
        // Stub + command run in ONE eval: something on this machine restores
        // readText to native between CLI invocations (observed 2026-07-17,
        // likely a clipboard-monitoring agent), so a stub installed in a
        // separate call can vanish before the command reads it. The delayed
        // delete restores the native method after the command has finished.
        action(
            `(() => { window.__pasteCalls = 0; ` +
            `Object.defineProperty(navigator.clipboard, 'readText', ` +
            `{ value: async () => { window.__pasteCalls++; return ${jsLiteral("pasted\nsource")}; }, configurable: true }); ` +
            `const v=${EDITOR}; v.editor.setCursor({line:0,ch:8}); ` +
            `app.commands.executeCommandById('${CMD_PASTE_INLINE}'); ` +
            `setTimeout(() => { delete navigator.clipboard.readText; }, 3000); })();`,
        );
        try {
            await expectEditorText("Alpha bravo^[pasted source] charlie");
        } catch (e) {
            // 0 calls = the command stalled before the clipboard (popup
            // settle, view lookup); undefined = the stub eval never ran
            const calls = readJson("window.__pasteCalls");
            throw new Error(`${e.message} (readText calls: ${jsLiteral(calls)})`);
        }
    });

    await test("rapid double press creates one footnote and toggles its popup", async () => {
        // regression (reported 2026-07-16): the popup handle used to be
        // registered only after async setup, so a second press during that
        // window opened a SECOND popup instead of toggle-closing the first -
        // and the two popups' save machinery raced, eating later footnotes
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        action(
            `const v=${EDITOR}; v.editor.setCursor({line:0,ch:8}); ` +
            `app.commands.executeCommandById('${CMD_AUTONUM}'); ` +
            `app.commands.executeCommandById('${CMD_AUTONUM}');`,
        );
        await pollUntil(
            "exactly one footnote, popup closed",
            `(() => ({ text: (${EDITOR}).editor.getValue(), ` +
            `popup: !!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-closed)') }))()`,
            (s) => s && s.text === "Alpha bravo[^1] charlie\n\n[^1]: " && !s.popup,
        );
        // the next rapid pair chains the second footnote the same way
        action(
            `app.commands.executeCommandById('${CMD_AUTONUM}'); ` +
            `app.commands.executeCommandById('${CMD_AUTONUM}');`,
        );
        await pollUntil(
            "second consecutive footnote created",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "Alpha bravo[^1][^2] charlie\n\n[^1]: \n[^2]: ",
        );
    });

    await test("closed untouched popups never save stale content over new footnotes", async () => {
        // regression (reported 2026-07-16, sequence captured live): the
        // popup embed marks itself dirty just from rendering, so a closed
        // untouched popup's debounced save wrote its STALE file snapshot
        // over footnotes added after it loaded - the external-change reload
        // then dumped the cursor at the top of the note
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie delta");
        setCursorAndRun(0, 8, CMD_AUTONUM); // [^1] + popup
        await sleep(1600); // popup fully shown; embed self-dirties
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // close
        await sleep(300);
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // [^2] + popup
        await sleep(300);
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // close
        // the window where embed 1's stale save used to clobber [^2]
        await sleep(3500);
        const state = readJson(
            `(() => { const ed=(${EDITOR}).editor; ` +
            `return { text: ed.getValue(), cursor: ed.getCursor() }; })()`,
        );
        const expected = "Alpha bravo[^1][^2] charlie delta\n\n[^1]: \n[^2]: ";
        if (!state || state.text !== expected) {
            throw new Error(`stale save clobbered the note: ${jsLiteral(state)}`);
        }
        if (state.cursor.line === 0 && state.cursor.ch === 0) {
            throw new Error("cursor was dumped at the start of the note");
        }
    });

    await test("typed popup definition survives an immediately-following footnote", async () => {
        // regression (reported 2026-07-16, third round): the user's real flow
        // - type a definition in the popup, close, immediately insert the next
        // footnote. The popup's (legitimate) debounced save wrote the file
        // WITHOUT the just-inserted next footnote, clobbering it; the
        // conflict reload then dumped the cursor at the top.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM); // [^1] + popup
        await pollUntil(
            "popup focused for typing",
            `(() => { const p = document.querySelector('.footnote-shortcut-popup');
                return !!(p && p.contains(document.activeElement)); })()`,
            (v) => v === true,
        );
        // type through the DOM so the full real input path runs
        action(`document.execCommand('insertText', false, 'my note');`);
        await sleep(200);
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // close popup
        await sleep(150); // press again while the popup's save is still pending
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // [^2]
        await pollUntil(
            "both footnotes and the typed definition present",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "Alpha bravo[^1][^2] charlie\n\n[^1]: my note\n[^2]: ",
            12000,
        );
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (cursor && cursor.line === 0 && cursor.ch === 0) {
            throw new Error("cursor was dumped at the start of the note");
        }
        // close [^2]'s popup so it can't leak into the next test
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "trailing popup closed",
            `!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-closed)')`,
            (v) => v === true,
        );
    });

    await test("rapid typed popups keep their texts apart and never crash the save chain", async () => {
        // regression (reported 2026-08-13, root-caused live): the teardown's
        // save flush called embed.save() with NO ARGUMENTS - current
        // Obsidian's save(t, n) feeds t straight into set(), so
        // set(undefined) threw deep in the save chain AND poisoned
        // embed.text, making the embed's own debounced saves crash uncaught
        // ("Cannot read properties of undefined (reading 'split')"). The
        // stalled dirty flag also dragged every teardown out for seconds,
        // and the closed popup's still-mounted editor could swallow
        // keystrokes meant for the NEXT footnote's popup.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        action(
            `window.__popupErrs = []; if (!window.__popupErrHook) { ` +
            `window.__popupErrHook = true; ` +
            `window.addEventListener('unhandledrejection', ` +
            `(e) => window.__popupErrs && window.__popupErrs.push(String(e.reason))); }`,
        );
        setCursorAndRun(0, 8, CMD_AUTONUM); // [^1] + popup
        for (let round = 0; round < 3; round++) {
            await pollUntil(
                `popup ${round + 1} focused for typing`,
                `(() => { const p = document.querySelector('.footnote-shortcut-popup');
                    return !!(p && p.contains(document.activeElement)); })()`,
                (v) => v === true,
            );
            action(`document.execCommand('insertText', false, 'note ${round}');`);
            await sleep(150);
            action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // close
            await sleep(120);
            if (round < 2) {
                action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // next
            }
        }
        await pollUntil(
            "every typed definition in its own footnote",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "Alpha bravo[^1][^2][^3] charlie\n\n[^1]: note 0\n[^2]: note 1\n[^3]: note 2",
            12000,
        );
        await sleep(2500); // outlive the embeds' own save debounce
        const errs = readJson("window.__popupErrs");
        if (errs && errs.length) {
            throw new Error(`popup save chain crashed: ${jsLiteral(errs)}`);
        }
    });

    await test("rename under an armed apply-prefix sweep adds the note's prefix and says so (2026-08-29)", async () => {
        // Jason's ruling: instead of refusing a bare new name (the
        // 2026-08-25 fix), the rename writes it behind the note's prefix -
        // what the next lint would do anyway - and the toast says so
        resetSettings({ enableFootnotePrefix: true, lintApplyPrefix: true });
        await setupNote("---\nfootnote-prefix: p.\n---\ntext with a ref[^p.1] here\n\n[^p.1]: body");
        setCursorAndRun(3, 18, "obsidian-footnotes:rename-footnote");
        await pollUntil(
            "rename modal open with only the suffix selected",
            `(() => { const i = document.querySelector('.modal-container input'); return i ? [i.value, i.selectionStart, i.selectionEnd] : null; })()`,
            (v) => Array.isArray(v) && v[0] === "p.1" && v[1] === 2 && v[2] === 3,
        );
        action(
            `(() => { const i = document.querySelector('.modal-container input'); i.value = '5'; ` +
            `i.dispatchEvent(new Event('input', {bubbles: true})); ` +
            `i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); })();`,
        );
        await expectEditorText("---\nfootnote-prefix: p.\n---\ntext with a ref[^p.5] here\n\n[^p.5]: body");
        await pollUntil(
            "the toast names the added prefix",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("prefix " + String.fromCharCode(34) + "p." + String.fromCharCode(34) + " was added."),
        );
    });

    await test("right-click on a footnote offers Rename footnote, prose does not", async () => {
        // the editor-menu hook (Jason's ask 2026-08-13): parity with the
        // native "Rename this heading" on heading lines. Triggered
        // programmatically with a recording menu stub - the caret stands in
        // for the click point, which Obsidian resolves before the event.
        resetSettings({});
        await setupNote("Alpha bravo[^x] charlie\n\n[^x]: def");
        const menuProbe = (line, ch) =>
            `(() => { const v=${EDITOR}; v.editor.setCursor({line:${line},ch:${ch}}); ` +
            `const items=[]; const item={ setTitle(t){ items.push(t); return item; }, ` +
            `setIcon(){ return item; }, setSection(){ return item; }, onClick(){ return item; } }; ` +
            `const menu={ addItem(cb){ cb(item); return menu; } }; ` +
            `app.workspace.trigger('editor-menu', menu, v.editor, v); return items; })()`;
        const onReference = readJson(menuProbe(0, 13));
        if (!onReference || !onReference.includes("Rename footnote")) {
            throw new Error(`no menu item on the reference: ${jsLiteral(onReference)}`);
        }
        const onLabel = readJson(menuProbe(2, 2));
        if (!onLabel || !onLabel.includes("Rename footnote")) {
            throw new Error(`no menu item on the definition label: ${jsLiteral(onLabel)}`);
        }
        const onProse = readJson(menuProbe(0, 2));
        if (!onProse || onProse.includes("Rename footnote")) {
            throw new Error(`menu item leaked onto plain prose: ${jsLiteral(onProse)}`);
        }
    });

    await test("Escape closes the popup (regression 2026-08-13)", async () => {
        // the embedded editor preventDefaults every Escape, so the old
        // defaultPrevented-based close never fired - caught by Jason's popup
        // manual pass; the fix reads the vim state directly in capture phase
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM);
        await pollUntil(
            "popup open and focused",
            `(() => { const p = document.querySelector('.footnote-shortcut-popup');
                return !!(p && p.contains(document.activeElement)); })()`,
            (v) => v === true,
        );
        action(
            `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', ` +
            `{key:'Escape', code:'Escape', bubbles:true, cancelable:true}));`,
        );
        await pollUntil(
            "popup closed by Escape",
            `!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
    });

    await test("a selection + the named key names the footnote through a modal", async () => {
        // issue #35's named flavor (2026-08-13): the named flow's usual
        // second press can't carry a body statelessly, so a selection press
        // asks for the name in a modal and converts on Enter
        resetSettings({ enablePopupEditor: false });
        await setupNote("Alpha bravo charlie");
        action(
            `(() => { const v=${EDITOR}; ` +
            `v.editor.setSelection({line:0,ch:6},{line:0,ch:11}); })();`,
        );
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        await pollUntil(
            "name modal open",
            `!!document.querySelector('.modal-container input')`,
            (v) => v === true,
        );
        action(
            `(() => { const input = document.querySelector('.modal-container input'); ` +
            `input.value = 'brv'; input.dispatchEvent(new Event('input')); ` +
            `input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); })();`,
        );
        await pollUntil(
            "selection converted under the typed name",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "Alpha[^brv] charlie\n\n[^brv]: bravo",
            8000,
        );
    });

    await test("a footnote command submits the open name modal, like Enter (2026-08-22)", async () => {
        resetSettings({ enablePopupEditor: false });
        await setupNote("Alpha bravo charlie");
        action(
            `(() => { const v=${EDITOR}; ` +
            `v.editor.setSelection({line:0,ch:6},{line:0,ch:11}); })();`,
        );
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        await pollUntil(
            "name modal open",
            `!!document.querySelector('.modal-container input')`,
            (v) => v === true,
        );
        action(
            `(() => { const input = document.querySelector('.modal-container input'); ` +
            `input.value = 'cmd'; input.dispatchEvent(new Event('input')); })();`,
        );
        // the REAL keyboard path - a modal's scope owns the keyboard, so
        // executeCommandById proving the registry is NOT enough (Jason's
        // 2026-08-22 report: the first ship passed that way while actual
        // keypresses were swallowed). Synthesize the assigned hotkey; when
        // none is assigned, fall back to the command entry point.
        const combo = readJson(
            `(app.hotkeyManager.getHotkeys('${CMD_AUTONUM}') ?? ` +
            `app.hotkeyManager.getDefaultHotkeys?.('${CMD_AUTONUM}') ?? [])[0] ?? null`,
        );
        if (combo) {
            const mods = combo.modifiers ?? [];
            const flag = (name) =>
                mods.includes(name) ||
                (name === (process.platform === "darwin" ? "Meta" : "Ctrl") &&
                    mods.includes("Mod"));
            action(
                `document.querySelector('.modal-container input').dispatchEvent(` +
                `new KeyboardEvent('keydown', {key:'${combo.key}', bubbles:true, ` +
                `altKey:${flag("Alt")}, ctrlKey:${flag("Ctrl")}, ` +
                `shiftKey:${flag("Shift")}, metaKey:${flag("Meta")}}));`,
            );
        } else {
            action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        }
        await pollUntil(
            "command press converted under the typed name and closed the modal",
            `JSON.stringify({value: (${EDITOR}).editor.getValue(), ` +
            `modal: !!document.querySelector('.modal-container input')})`,
            (v) =>
                v ===
                JSON.stringify({
                    value: "Alpha[^cmd] charlie\n\n[^cmd]: bravo",
                    modal: false,
                }),
            8000,
        );
    });

    await test("a multi-line selection becomes a multi-paragraph definition (2026-08-19)", async () => {
        // the academic shape: whole paragraphs move into ONE definition,
        // continuation lines indented four spaces under the label
        resetSettings({ enablePopupEditor: false });
        await setupNote("Intro line.\nFirst para body\n\nSecond para body\nOutro line.");
        action(
            `(() => { const v=${EDITOR}; ` +
            `v.editor.setSelection({line:1,ch:0},{line:3,ch:16}); })();`,
        );
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "selection converted into an indented multi-paragraph body",
            `(${EDITOR}).editor.getValue()`,
            (v) =>
                v ===
                // the body's paragraph separator is an INDENTED blank -
                // "    " - flush with the continuations (Jason, 2026-08-21)
                "Intro line.\n[^1]\nOutro line.\n\n[^1]: First para body\n    \n    Second para body",
            8000,
        );
        // the caret must land at the end of the LAST body line, ready to edit
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (cursor.line !== 6 || cursor.ch !== "    Second para body".length) {
            throw new Error(`caret landed at ${jsLiteral(cursor)}`);
        }
    });

    await test("TWO Alt-dragged selections toast and change nothing (Jason's report 2026-08-21)", async () => {
        // the report itself was environmental (plugin left session-enabled
        // only - see the deploy step), but this pins the real multi-range
        // path end to end: refusal toast, document untouched
        resetSettings({ enablePopupEditor: false });
        await setupNote("alpha bravo\ncharlie delta");
        action(
            `(${EDITOR}).editor.setSelections([` +
            `{anchor:{line:0,ch:0},head:{line:0,ch:5}},` +
            `{anchor:{line:1,ch:0},head:{line:1,ch:7}}]);`,
        );
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "the one-continuous-stretch toast",
            `Array.from(document.querySelectorAll('.notice')).some(n => ` +
            `n.textContent.includes('one continuous stretch'))`,
            (v) => v === true,
            6000,
        );
        const value = readJson(`(${EDITOR}).editor.getValue()`);
        if (value !== "alpha bravo\ncharlie delta") {
            throw new Error(`multi-range press edited the note: ${jsLiteral(value)}`);
        }
    });

    await test("multiple Alt-clicked CARETS get the SAME footnote at every one (2026-08-22)", async () => {
        resetSettings({ enablePopupEditor: false });
        await setupNote("alpha bravo\ncharlie delta");
        action(
            `(${EDITOR}).editor.setSelections([` +
            `{anchor:{line:0,ch:5},head:{line:0,ch:5}},` +
            `{anchor:{line:1,ch:7},head:{line:1,ch:7}}]);`,
        );
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "the same reference at both carets, one definition",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "alpha[^1] bravo\ncharlie[^1] delta\n\n[^1]: ",
            8000,
        );
    });

    await test("NAMED at several carets: skeletons everywhere, typing names them all", async () => {
        resetSettings({ enablePopupEditor: false });
        await setupNote("alpha bravo\ncharlie delta");
        action(
            `(${EDITOR}).editor.setSelections([` +
            `{anchor:{line:0,ch:5},head:{line:0,ch:5}},` +
            `{anchor:{line:1,ch:7},head:{line:1,ch:7}}]);`,
        );
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        await pollUntil(
            "[^] skeletons at both carets",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "alpha[^] bravo\ncharlie[^] delta",
            8000,
        );
        // replaceSelection writes at EVERY cursor - the same mechanism
        // real multi-cursor typing uses
        action(`(${EDITOR}).editor.replaceSelection('src');`);
        await pollUntil(
            "typing filled BOTH brackets",
            `(${EDITOR}).editor.getValue()`,
            (v) => v === "alpha[^src] bravo\ncharlie[^src] delta",
            8000,
        );
        // second press with the caret on one filled reference completes
        // the flow: its definition is created, shared by both references
        action(`(${EDITOR}).editor.setCursor({line:0,ch:8});`);
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        await pollUntil(
            "one shared definition created",
            `(${EDITOR}).editor.getValue()`,
            (v) =>
                v === "alpha[^src] bravo\ncharlie[^src] delta\n\n[^src]: ",
            8000,
        );
    });

    await test("popup edits propagate live into the main editor (stock parity)", async () => {
        // DELIBERATE behavior (Jason, 2026-08-08): while the popup is open
        // it saves on the embed's own debounce, exactly like Obsidian's
        // stock footnote hover editor, so the note text updates while you
        // type. A save-gate variant (one net edit per session, cleaner
        // main-editor undo) was tried and REVERTED: edits visibly NOT
        // appearing in the note was more disconcerting than the undo quirk
        // it fixed. Known accepted quirk: undoing a popup session from the
        // main editor can need an extra undo step, same as the stock hover
        // editor.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Alpha bravo charlie");
        setCursorAndRun(0, 8, CMD_AUTONUM); // [^1] + popup
        await pollUntil(
            "popup focused for typing",
            `(() => { const p = document.querySelector('.footnote-shortcut-popup');
                return !!(p && p.contains(document.activeElement)); })()`,
            (v) => v === true,
        );
        action(`document.execCommand('insertText', false, 'live text');`);
        // the debounced save must reach the main editor WHILE the popup is
        // still open - that is the whole point of the stock-parity model
        await pollUntil(
            "typed definition visible in the main editor mid-session",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("[^1]: live text"),
            8000,
        );
        const stillOpen = readJson(
            `!!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-closed)')`,
        );
        if (!stillOpen) {
            throw new Error("popup closed before the mid-session save landed");
        }
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`); // close
        await pollUntil(
            "popup closed",
            `!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-closed)')`,
            (v) => v === true,
        );
    });

    await test("rapid presses deep in a long note keep every footnote and the cursor", async () => {
        // regression (reported 2026-07-16): rapid create/close cycles could
        // lose a footnote AND reload the view, dumping the cursor at the top
        resetSettings({ enablePopupEditor: true });
        const body = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} lorem ipsum.`).join("\n");
        await setupNote(body);
        // six presses 120ms apart at line 30: presses 1/3/5 create
        // [^1][^2][^3], presses 2/4/6 toggle-close each pending popup
        action(
            `(() => { const v=${EDITOR}; v.editor.setCursor({line:30,ch:12}); ` +
            `const run = () => app.commands.executeCommandById('${CMD_AUTONUM}'); ` +
            `run(); for (let i=1;i<6;i++) setTimeout(run, i*120); })();`,
        );
        const state = await pollUntil(
            "three footnotes present with the cursor still on line 30",
            `(() => { const ed=(${EDITOR}).editor; return { ` +
            `line30: ed.getLine(30), cursor: ed.getCursor(), ` +
            `definitions: ['1','2','3'].filter(n => ed.getValue().includes('[^'+n+']: ')).length, ` +
            `popup: !!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-closed)') }; })()`,
            (s) =>
                s &&
                s.line30 === "Paragraph 31[^1][^2][^3] lorem ipsum." &&
                s.definitions === 3 &&
                !s.popup &&
                s.cursor.line === 30,
            10000,
        );
        if (state.cursor.ch === 0) throw new Error("cursor was dumped at the start");
    });

    await test("popup shows the NEW definition when the creation lint renumbers an older footnote out of its way (2026-09-09)", async () => {
        // Jason's report: creating a footnote BEFORE the existing
        // [^1] with the creation lint on made the new one [^1] and the old
        // one [^2]; the metadata cache still held the OLD [^1] position, so
        // the popup's embed showed a slice of the note from there
        resetSettings({
            enablePopupEditor: true,
            lintOnFootnoteCreation: true,
            insertAtEndOfWord: false,
        });
        await setupNote("Fixture reference to navigate from: jump me[^1] now.)\n\n[^1]: the definition");
        setCursorAndRun(0, 8, CMD_AUTONUM); // inside "reference", before the existing [^1]
        await pollUntil(
            "popup open and bound to the renumbered new footnote",
            `document.querySelector('.footnote-shortcut-popup-label')?.textContent ?? null`,
            (v) => v === "[^1]:",
        );
        await expectEditorText("Fixture [^1]reference to navigate from: jump me[^2] now.)\n\n[^1]: \n[^2]: the definition");
        const popupText = await pollUntil(
            "popup editor content",
            `document.querySelector('.footnote-shortcut-popup .cm-content')?.textContent ?? null`,
            (v) => typeof v === "string",
        );
        if (popupText.includes("the definition") || popupText.includes(".)")) {
            throw new Error(`popup shows the wrong slice of the note: ${jsLiteral(popupText)}`);
        }
        action(
            `document.querySelectorAll('.footnote-shortcut-popup').forEach((el) => ` +
            `el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})));`,
        );
        await sleep(800);
        await expectEditorText("Fixture [^1]reference to navigate from: jump me[^2] now.)\n\n[^1]: \n[^2]: the definition");
    });

    await test("a duplicated footnote jumps to its LAST definition instead of opening the popup (2026-09-09)", async () => {
        resetSettings({ enablePopupEditor: true });
        await setupNote("dup here[^dup] and one[^one]\n\n[^one]: single\n[^dup]: body\n[^dup]: another body");
        setCursorAndRun(0, 10, CMD_AUTONUM); // inside [^dup]
        await sleep(1200);
        const popup = readJson(`!!document.querySelector('.footnote-shortcut-popup')`);
        if (popup) throw new Error("the popup opened on a duplicated footnote");
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (cursor.line !== 4) throw new Error(`caret on line ${cursor.line}, expected the LAST [^dup]: line (4)`);
    });

    await test("a note that is only a table: a footnote from its last cell lands whole and the table survives (2026-09-09)", async () => {
        await requireVisibleWindow();
        // Jason's report: with the table as the note's last line,
        // the definition append was built from a context read BEFORE the
        // cell edit, so it landed four characters short of the row's new
        // end - inside the reference - and the table widget normalised the
        // remains ("only [^ is inserted and the last pipe disappears")
        resetSettings();
        // the row stays the note's last non-blank line; the trailing newline
        // gives the shared cell activation a line outside the table to park on
        const table = ["| AAA | BBB |", "| --- | --- |", "| CCC | DDD |", ""].join("\n");
        await setupNote("table pending");
        action(`(${EDITOR}).editor.setValue(${jsLiteral(table)});`);
        await pollUntil("table content in editor", `(${EDITOR}).editor.getValue()`, (v) => typeof v === "string" && v.includes("DDD"));
        await pollUntil("table content in data buffer", `(${EDITOR}).data`, (v) => typeof v === "string" && v.includes("DDD"));
        await activateTableCell(2, 3, "DDD");
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "the reference in the cell and the definition below the table",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && /\| CCC +\| DDD\[\^1\] +\|\n+\[\^1\]: $/.test(v),
        );
    });

    await test("the reading-view toggle from the command palette closes the popup and flips the NOTE (2026-09-11)", async () => {
        // Jason's report: with the popup open, Toggle reading view
        // picked from the palette put the popup's embed into reading view
        // and left the note as it was
        resetSettings({ enablePopupEditor: true, insertAtEndOfWord: false });
        await setupNote("Alpha bravo");
        setCursorAndRun(0, 5, CMD_AUTONUM);
        await pollUntil("popup open", `!!document.querySelector('.footnote-shortcut-popup .cm-content')`, (v) => v === true);
        // the palette route: the command itself, with no hotkey for the scope to catch
        action(`app.commands.executeCommandById('markdown:toggle-preview');`);
        await pollUntil("popup gone", `!!document.querySelector('.footnote-shortcut-popup')`, (v) => v === false);
        await pollUntil("the NOTE in reading view", `(${EDITOR}).getMode()`, (v) => v === "preview");
        action(`app.commands.executeCommandById('markdown:toggle-preview');`);
        await pollUntil("the note back in source view", `(${EDITOR}).getMode()`, (v) => v === "source");
        await expectEditorText("Alpha[^1] bravo\n\n[^1]: ");
    });

    await test("lint keeps the caret where it was and leaves folds folded (2026-09-11)", async () => {
        // Jason's report: linting unfolded every folded heading and
        // list and jumped the caret to a linted spot. The rewrite is now a
        // set of line edits, so untouched lines keep their folds and the
        // caret maps through untouched text unchanged
        resetSettings();
        // the folded section CONTAINS the line the lint edits (Obsidian
        // drops such a fold on any edit inside it, so the plugin puts it
        // back); the caret sits on an untouched line further down
        await setupNote("# Folded section\n\nword[^1]. inside the fold\nline b\n\n# Where the caret sits\n\nkeep the caret HERE\n\n[^1]: one");
        action(`(${EDITOR}).editor.setCursor({line:0, ch:0});`);
        action(`app.commands.executeCommandById('editor:toggle-fold');`);
        await sleep(200);
        const foldsBefore = readJson(`JSON.stringify(((${EDITOR}).currentMode.getFoldInfo?.() || {folds:[]}).folds)`);
        if (foldsBefore !== '[{"from":0,"to":4}]') throw new Error(`expected the section folded before the lint, got ${foldsBefore}`);
        setCursorAndRun(7, "keep the ".length, CMD_LINT);
        await expectEditorText("# Folded section\n\nword.[^1] inside the fold\nline b\n\n# Where the caret sits\n\nkeep the caret HERE\n\n[^1]: one");
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (cursor.line !== 7 || cursor.ch !== "keep the ".length) {
            throw new Error(`caret moved to ${jsLiteral(cursor)}`);
        }
        await pollUntil(
            "the section still folded after the lint",
            `JSON.stringify(((${EDITOR}).currentMode.getFoldInfo?.() || {folds:[]}).folds)`,
            (v) => v === '[{"from":0,"to":4}]',
        );
    });

    await test("lint leaves a second pane on the same note where it was (caret and scroll)", async () => {
        // Jason's report from the feature-round sheet (2026-09-24): with the note split into two
        // panes, linting from one made the other jump. Obsidian copies the
        // rewrite into the other pane a moment later as one whole
        // replacement, which drops that pane's caret to the top of the note;
        // the plugin now notes the caret and scroll of every other pane on
        // the note before it writes and puts them back once the copy lands.
        // Jason's second report the same day: the caret came back but its
        // line sat near the bottom of the window. Lines that wrap in a
        // narrow pane have only estimated heights until drawn, and the copy
        // resets the estimates, so a pixel scroll lands on the wrong line;
        // the restore now anchors on the line at the top edge. Hence a
        // VERTICAL split, long lines of varied length, and the check is the
        // line at the top edge plus the caret's place in the window.
        resetSettings({ footnoteNaming: "numbered" });
        const filler = Array.from({ length: 70 }, (_, i) => `Filler line ${i + 1} of the long body, padded so it wraps in a narrow pane: ${"lorem ipsum dolor sit amet ".repeat(2 + (i % 5))}end.`).join("\n");
        const before = `Top line with a named footnote[^alpha] here.\n\n${filler}\n\n[^alpha]: the definition at the bottom`;
        const after = before.replace(/\[\^alpha\]/g, "[^1]");
        // the fixture is far too long for one CLI argument (a long eval is
        // chunked on the socket and throws a JSON error in Obsidian's main
        // process), so it goes through a dotfile the vault ignores
        const fixtureFile = ".smoke-fixture.txt";
        writeFileSync(join(VAULT_DIR, fixtureFile), before, "utf8");
        await setupNote("fixture pending");
        action(`(async () => { const text = await app.vault.adapter.read(${jsLiteral(fixtureFile)}); (${EDITOR}).editor.setValue(text); })();`);
        await waitForEditorText(before);
        await pollUntil("view data buffer to sync", `(${EDITOR}).data`, (v) => v === before);
        const caretLine = 40;
        // every pane on the smoke note, in workspace order: the original first
        const PANES = `app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file && l.view.file.path === ${jsLiteral(NOTE_PATH)})`;
        action(`(async () => { const f = app.vault.getAbstractFileByPath(${jsLiteral(NOTE_PATH)}); const b = app.workspace.getLeaf('split', 'vertical'); await b.openFile(f); })();`);
        await pollUntil("a second pane on the smoke note", `(${PANES}).length`, (v) => v === 2);
        try {
            // pane B: caret on line 40, that line centred in the window (a
            // CodeMirror scroll request, re-applied until it holds); pane A
            // active with its caret near the top
            action(
                `const [a, b] = ${PANES}; const cm = b.view.editor.cm; const pos = b.view.editor.posToOffset({line:${caretLine}, ch:4}); ` +
                `cm.dispatch({ selection: { anchor: pos, head: pos }, effects: cm.constructor.scrollIntoView(pos, { y: 'center' }) }); ` +
                `a.view.editor.setCursor({line:5, ch:3}); app.workspace.setActiveLeaf(a, {focus:true});`,
            );
            await sleep(500);
            // where pane B is: its caret, the line at the top edge of its
            // window and how far into that line the edge sits, and where the
            // caret line sits in the window
            const paneB = `(() => { const b = (${PANES})[1]; const ed = b.view.editor; const cm = ed.cm; const st = cm.scrollDOM.scrollTop; const blk = cm.lineBlockAtHeight(st); const c = cm.coordsAtPos(cm.state.selection.main.head); const box = cm.scrollDOM.getBoundingClientRect(); ` +
                `return { cursor: ed.getCursor(), topLine: cm.state.doc.lineAt(blk.from).number - 1, topOffset: Math.round(st - blk.top), caretY: c ? Math.round(c.top - box.top) : null, text: ed.getValue() }; })()`;
            const was = readJson(paneB);
            if (was.cursor.line !== caretLine || was.caretY === null || was.topLine < 5) throw new Error(`pane B not arranged: ${jsLiteral({ cursor: was.cursor, topLine: was.topLine, caretY: was.caretY })}`);
            action(`app.commands.executeCommandById('${CMD_LINT}');`);
            await pollUntil("the lint copied into pane B", `(${paneB}).text`, (v) => v === after);
            // the plugin's restore runs a beat after the copy lands, and its
            // pixel correction a beat after that
            await sleep(600);
            const now = readJson(paneB);
            if (now.cursor.line !== caretLine) throw new Error(`pane B's caret moved to ${jsLiteral(now.cursor)}`);
            if (now.topLine !== was.topLine || Math.abs(now.topOffset - was.topOffset) > 3) {
                throw new Error(`pane B's top edge moved from line ${was.topLine} (+${was.topOffset}px) to line ${now.topLine} (+${now.topOffset}px)`);
            }
            if (Math.abs(now.caretY - was.caretY) > 3) throw new Error(`pane B's caret line moved from ${was.caretY}px to ${now.caretY}px down the window`);
        } finally {
            action(`const panes = ${PANES}; if (panes[1]) panes[1].detach();`);
            await pollUntil("the second pane closed", `(${PANES}).length`, (v) => v === 1);
            unlinkSync(join(VAULT_DIR, fixtureFile));
        }
    });

    await test("footnote lands at the caret inside an actively edited table cell", async () => {
        await requireVisibleWindow();
        // regression (reported 2026-07-14): running the command while a
        // table cell sub-editor owned focus raced the cell's sync-back -
        // the insert was swallowed or the row's pipes were displaced and
        // escaped, shredding the table
        resetSettings();
        const table = [
            "| Lorem[^1]     | Ipsum[^2]          | fdssad [^five] [^six] [^2]<br> |",
            "| ------------- | ------------------ | ------------------------------ |",
            "| Dolor[^three] | Sit[^four] [^five] () | fddad [^bobthebuilder]         |",
            "",
            "tail",
        ].join("\n");
        // the table widget re-normalizes column padding after load, so a
        // byte-exact setupNote wait would never match - set the content and
        // wait for the "()" landmark on both the editor and the data buffer
        await setupNote("table pending");
        action(`(${EDITOR}).editor.setValue(${jsLiteral(table)});`);
        await pollUntil(
            "table content in editor",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("()"),
        );
        await pollUntil(
            "table content in data buffer",
            `(${EDITOR}).data`,
            (v) => typeof v === "string" && v.includes("()"),
        );
        // the shared activation opens the "()" cell with real focus inside
        // its sub-editor (see activateTableCell - the one-shot recipe
        // opened the FIRST cell instead, 2026-08-27)
        await activateTableCell(2, 4, "()");
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        await pollUntil(
            "reference inserted between the parens",
            `(${EDITOR}).editor.getLine(2)`,
            (v) => typeof v === "string" && v.includes("([^])"),
        );
        const line = readJson(`(${EDITOR}).editor.getLine(2)`);
        if (line.includes("\\|")) throw new Error(`table pipe got escaped: ${line}`);
        const pipes = (line.match(/\|/g) ?? []).length;
        if (pipes !== 4) throw new Error(`table row has ${pipes} pipes, expected 4: ${line}`);
    });

    await test("undoing a table-cell footnote warns about the orphaned reference (2026-08-27)", async () => {
        await requireVisibleWindow();
        // creating from a cell takes TWO undo steps by construction: the
        // reference rides the cell sub-editor's dispatch, the definition a
        // main-editor transaction, and CodeMirror's history can never
        // group the two. The first undo used to silently strand an
        // orphaned reference in the table (Jason's report 2026-08-27) -
        // the partial-undo notice now says so.
        resetSettings();
        const table = [
            "| alpha | beta |",
            "| ----- | ---- |",
            "| word here () | x |",
            "",
            "tail",
        ].join("\n");
        await setupNote("table pending");
        action(`(${EDITOR}).editor.setValue(${jsLiteral(table)});`);
        await pollUntil(
            "table content in editor",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("()"),
        );
        await pollUntil(
            "table content in data buffer",
            `(${EDITOR}).data`,
            (v) => typeof v === "string" && v.includes("()"),
        );
        // the shared activation opens the "()" cell with real focus inside
        // its sub-editor (see activateTableCell)
        await activateTableCell(2, 4, "()");
        action(`app.commands.executeCommandById('${CMD_AUTONUM}');`);
        await pollUntil(
            "definition appended below the table",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("[^1]: "),
        );
        await sleep(600); // let the cell's sync-back settle into history
        action(`(${EDITOR}).editor.undo();`);
        await pollUntil(
            "the orphaned-reference notice",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("Undo again to remove the reference too."),
        );
        // the state the notice describes: reference stranded, definition gone
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (!text.includes("[^1]") || text.includes("[^1]: ")) {
            throw new Error(`unexpected post-undo state: ${jsLiteral(text)}`);
        }
        // the second undo removes the reference and completes the revert
        action(`(${EDITOR}).editor.undo();`);
        await pollUntil(
            "reference removed by the second undo",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && !v.includes("[^1]"),
        );
    });

    await test("the partial-undo notice dismisses itself when the next undo finishes the job (2026-08-29)", async () => {
        // the notice guides the second undo; once that undo lands, the
        // guidance is moot and the toast hides itself instead of lingering
        // its full 8s (Jason's ask 2026-08-29)
        resetSettings();
        await setupNote("see[^q] here");
        // a separate history entry for the definition: past CodeMirror's
        // ~500ms group window, so undo #1 removes ONLY the definition
        await sleep(900);
        action(`(${EDITOR}).editor.replaceRange('\\n\\n[^q]: body', {line: 0, ch: 12});`);
        await sleep(900);
        action(`(${EDITOR}).editor.undo();`);
        // This creation was not split by the plugin, so the notice states
        // the fact and makes no "undo again" promise (Jason's report
        // 2026-09-11; until 2026-09-16 the promise leaked in from the
        // cell test above, whose name stayed registered for ever, B27).
        // The cell test above covers the promise itself.
        const stranded = 'the footnote reference "[^q]" is still in the note.';
        await pollUntil(
            "the orphaned-reference notice",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes(stranded) && !v.includes("Undo again"),
        );
        action(`(${EDITOR}).editor.undo();`);
        await pollUntil(
            "the notice dismissed itself",
            `[...document.querySelectorAll('.notice')].every(n => !n.textContent.includes(${jsLiteral(stranded)}))`,
            (v) => v === true,
            3000,
        );
    });

    await test("lint with only reindex on renumbers and reorders footnotes", async () => {
        resetSettings({ lintFixPunctuation: false, lintMoveToBottom: false });
        await setupNote("Beta[^2] alpha[^1].\n\n[^1]: one\n[^2]: two");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Beta[^1] alpha[^2].\n\n[^1]: two\n[^2]: one");
    });

    await test("lint with only move-to-bottom on relocates a mid-note definition", async () => {
        resetSettings({ lintFixPunctuation: false, lintReindex: false });
        await setupNote("Para one[^1].\n\n[^1]: def\n\nPara two.");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Para one[^1].\n\nPara two.\n\n[^1]: def");
    });

    await test("lint with only punctuation on swaps references across punctuation", async () => {
        resetSettings({ lintMoveToBottom: false, lintReindex: false });
        await setupNote("Word[^1].\n\n[^1]: def");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Word.[^1]\n\n[^1]: def");
    });

    await test("lint command runs all three cleanups and adds the heading", async () => {
        resetSettings({
            enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "# Footnotes",
        });
        await setupNote("Alpha[^2], bravo[^1].\n\n[^2]: two\n\nCharlie tail.");
        setCursorAndRun(0, 0, CMD_LINT);
        // punctuation fixed, definition gathered under the heading at the
        // bottom (blank line above the heading), numbering redone by
        // appearance ([^2]→[^1], [^1]→[^2])
        await expectEditorText(
            "Alpha,[^1] bravo.[^2]\n\nCharlie tail.\n\n# Footnotes\n\n[^1]: two",
        );
    });

    await test("jump works for named footnotes with ':' in the name (issue #50)", async () => {
        resetSettings();
        const note = "Ref [^arXiv:1234.5678] end.\n\n[^arXiv:1234.5678]: Content 2";
        await setupNote(note);
        setCursorAndRun(0, 8, CMD_NAMED); // caret inside the reference
        await pollUntil(
            "cursor on the definition line",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 2,
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`jump changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("popup binds to a named footnote with ':' in the name (issue #50)", async () => {
        resetSettings({ enablePopupEditor: true });
        await setupNote(
            "Ref [^arXiv:1234.5678] end.\n\n[^arXiv:1234.5678]: Content 2",
        );
        setCursorAndRun(0, 8, CMD_NAMED);
        await pollUntil(
            "popup visible with the right definition loaded",
            `(() => { const p = document.querySelector('.footnote-shortcut-popup');
                return { open: !!p, text: p ? p.textContent : '' }; })()`,
            (s) => s && s.open && s.text.includes("Content 2"),
        );
        action(`app.commands.executeCommandById('${CMD_NAMED}');`); // close
        await pollUntil(
            "popup closed again",
            `!document.querySelector('.footnote-shortcut-popup:not(.footnote-shortcut-popup-closed)')`,
            (v) => v === true,
        );
    });

    await test('an id containing "#" skips the popup and jumps at once, no waiting notice (2026-09-05)', async () => {
        // Jason's report: a "#chapter-" prefix minted "[^#chapter-1]", the
        // popup never came up (its "#[^id]" subpath splits on "#"), and the
        // waiting notice sat there until the retry cap. The prefix rule now
        // refuses "#"; for an id that already exists the popup must not
        // even try - straight to the jump.
        resetSettings({ enablePopupEditor: true });
        await setupNote("Ref [^#x] end.\n\n[^#x]: hash def");
        action(
            `window.__hashNotice = false; const mo = new MutationObserver(() => { ` +
            `for (const n of document.querySelectorAll('.notice')) { if (n.textContent.includes('Waiting for Obsidian to index')) window.__hashNotice = true; } }); ` +
            `mo.observe(document.body, {childList: true, subtree: true}); window.__hashStop = () => mo.disconnect();`,
        );
        const t0 = Date.now();
        setCursorAndRun(0, 6, CMD_NAMED); // inside [^#x]
        try {
            await pollUntil(
                "caret on the definition line",
                `(${EDITOR}).editor.getCursor().line`,
                (v) => v === 2,
                5000,
            );
            const took = Date.now() - t0;
            if (took > 2500) throw new Error(`jump took ${took}ms - the popup retried instead of giving up at once`);
            await sleep(400);
            if (document_hasPopup()) throw new Error("a popup element was created for an id the subpath can't resolve");
            if (readJson(`window.__hashNotice`) === true) throw new Error("the waiting notice appeared");
        } finally {
            action(`window.__hashStop?.();`);
        }
    });

    await test("autonumbering ignores [^x] inside code blocks (issue #41)", async () => {
        // fenced fake reference+definition used to reserve numbers and suppress
        // the first-footnote handling
        resetSettings();
        await setupNote("```\nfake[^7]\n[^9]: fake\n```\nAlpha bravo");
        setCursorAndRun(4, 3, CMD_AUTONUM); // mid "Alpha"
        await expectEditorText(
            "```\nfake[^7]\n[^9]: fake\n```\nAlpha[^1] bravo\n\n[^1]: ",
        );
    });

    await test("new definitions land under the existing footnote group, not at EOF (issue #55)", async () => {
        resetSettings();
        const note = [
            "Alpha[^1] bravo",
            "",
            "#### Citations",
            "[^1]: one",
            "",
            "#### Images",
            "picture here",
        ].join("\n");
        await setupNote(note);
        setCursorAndRun(0, 12, CMD_AUTONUM); // mid "bravo"
        await expectEditorText([
            "Alpha[^1] bravo[^2]",
            "",
            "#### Citations",
            "[^1]: one",
            "[^2]: ",
            "",
            "#### Images",
            "picture here",
        ].join("\n"));
    });

    await test("footnote-prefix property namespaces numbered footnotes (issue #31)", async () => {
        resetSettings({ enableFootnotePrefix: true });
        await setupNote("---\nfootnote-prefix: 2-\n---\nAlpha bravo");
        setCursorAndRun(3, 8, CMD_AUTONUM); // mid "bravo"
        await expectEditorText(
            "---\nfootnote-prefix: 2-\n---\nAlpha bravo[^2-1]\n\n[^2-1]: ",
        );
        // the next press right after the reference chains [^2-2]
        setCursorAndRun(3, 17, CMD_AUTONUM);
        await expectEditorText(
            "---\nfootnote-prefix: 2-\n---\nAlpha bravo[^2-1][^2-2]\n\n[^2-1]: \n[^2-2]: ",
        );
    });

    await test("footnote-prefix is ignored while its toggle is off (the default)", async () => {
        resetSettings();
        await setupNote("---\nfootnote-prefix: 2.\n---\nAlpha bravo");
        setCursorAndRun(3, 8, CMD_AUTONUM);
        await expectEditorText(
            "---\nfootnote-prefix: 2.\n---\nAlpha bravo[^1]\n\n[^1]: ",
        );
    });

    await test("lint deletes orphaned definitions when the setting says so", async () => {
        resetSettings({
            lintDeleteOrphanedDefinitions: true,
            lintFixPunctuation: false,
            lintMoveToBottom: false,
        });
        await setupNote("Text[^2].\n\n[^2]: used\n[^9]: orphan");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Text[^1].\n\n[^1]: used");
    });

    await test("orphaned-definition deletion works with reindex OFF (2026-08-10)", async () => {
        // the deletion used to live inside reindex; it is its own rule now
        resetSettings({
            lintDeleteOrphanedDefinitions: true,
            lintReindex: false,
            lintFixPunctuation: false,
            lintMoveToBottom: false,
        });
        await setupNote("Text[^2].\n\n[^2]: used\n[^9]: orphan");
        setCursorAndRun(0, 0, CMD_LINT);
        // no renumbering (reindex off) - just the orphan gone
        await expectEditorText("Text[^2].\n\n[^2]: used");
    });

    await test("lint skips the reindex step when its toggle is off", async () => {
        resetSettings({ lintReindex: false });
        // no reference touches punctuation and definitions sit at the bottom,
        // so with reindex off the whole lint must be a no-op
        await setupNote("Beta[^2] alpha[^1] end.\n\n[^1]: one\n[^2]: two");
        setCursorAndRun(0, 0, CMD_LINT);
        await sleep(800);
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== "Beta[^2] alpha[^1] end.\n\n[^1]: one\n[^2]: two") {
            throw new Error(`lint reindexed anyway: ${jsLiteral(text)}`);
        }
    });

    await test("the lint command does not fire while a table cell is being edited until focus returns", async () => {
        await requireVisibleWindow();
        // the runOutsideTableCell guard: running the whole-document lint
        // while a cell sub-editor owns focus must not corrupt the table.
        // Only the reindex step runs, matching the assertions below.
        resetSettings({ lintFixPunctuation: false, lintMoveToBottom: false });
        const table = [
            "| Head     | Col     |",
            "| -------- | ------- |",
            "| Left[^2] | Right() |",
            "",
            "[^2]: def",
        ].join("\n");
        await setupNote("table pending");
        action(`(${EDITOR}).editor.setValue(${jsLiteral(table)});`);
        await pollUntil(
            "table content in editor",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("()"),
        );
        // the table widget renders from the data buffer, which lags the
        // editor by a tick - the cell sub-editor can't open before that
        await pollUntil(
            "table content in data buffer",
            `(${EDITOR}).data`,
            (v) => typeof v === "string" && v.includes("()"),
        );
        // editor.focus() can silently no-op when nothing in the editor had
        // DOM focus (same quirk the popup-close path works around), and
        // without real focus the cell editor never opens - focus the CM
        // contentDOM directly and jiggle the cursor until the widget bites
        await pollUntil(
            "table cell sub-editor to open",
            `(() => { const t=(${EDITOR}).containerEl.querySelector('.markdown-source-view table'); ` +
            `const v=${EDITOR}; ` +
            `const cm = !!(t && t.querySelector('.cm-content')); ` +
            `if (!cm) { v.editor.cm.contentDOM.focus(); ` +
            `const ch=v.editor.getLine(2).indexOf('()')+1; ` +
            `v.editor.setCursor({line:2, ch:0}); v.editor.setCursor({line:2, ch}); } ` +
            `return cm; })()`,
            (v) => v === true,
        );
        action(`app.commands.executeCommandById('${CMD_LINT}');`);
        await pollUntil(
            "lint applied without shredding the table",
            `(${EDITOR}).editor.getValue()`,
            (v) =>
                typeof v === "string" &&
                v.includes("[^1]") &&
                !v.includes("\\|") &&
                (v.match(/\|/g) ?? []).length === 9,
        );
    });

    await test("lint on save lints before the write when enabled", async () => {
        resetSettings({ lintOnSave: true });
        await setupNote("Beta[^2] alpha[^1] end\n\n[^1]: one\n[^2]: two");
        setCursorAndRun(0, 0, "editor:save-file");
        await expectEditorText("Beta[^1] alpha[^2] end\n\n[^1]: two\n[^2]: one");
    });

    await test("a clean manual save still reports 'No linting needed.'", async () => {
        // a manual save is an explicit user command, so it reports its
        // outcome either way (Jason, 2026-08-08, revisiting an earlier
        // quiet-on-clean change); only lint-on-footnote-creation is silent
        resetSettings({ lintOnSave: true });
        await setupNote("Alpha[^1] end\n\n[^1]: one");
        setCursorAndRun(0, 0, "editor:save-file");
        await pollUntil(
            "the no-op notice on a clean save",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("No linting needed."),
        );
    });

    await test("saving does not lint while the toggle is off (the default)", async () => {
        resetSettings();
        const note = "Beta[^2] alpha[^1] end\n\n[^1]: one\n[^2]: two";
        await setupNote(note);
        setCursorAndRun(0, 0, "editor:save-file");
        await sleep(800);
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`save linted anyway: ${jsLiteral(text)}`);
        }
    });

    await test("vim :w routes through the save command and lints (Linter parity)", async () => {
        // vim does not exist on mobile - under Obsidian's mobile emulation
        // (app.emulateMobile) the CM5 shim never attaches and this test
        // can only fail confusingly (burned 2026-08-13: an evening chasing
        // "broken vim" that was just the emulator being on)
        if (readJson("app.isMobile") === true) {
            console.log("        (skipped: mobile emulation active, no vim)");
            return;
        }
        resetSettings({ lintOnSave: true });
        // enabling vim loads the CM5 adapter; the plugin's leaf-change hook
        // then redefines :w - reopening the note fires that hook
        action(`app.vault.setConfig('vimMode', true);`);
        await sleep(600);
        await setupNote("Beta[^2] alpha[^1] end\n\n[^1]: one\n[^2]: two");
        try {
            action(
                `(() => { const v=${EDITOR}; const cm5 = v.editor.cm?.cm; ` +
                `if (cm5) window.CodeMirrorAdapter.Vim.handleEx(cm5, 'w'); })();`,
            );
            await expectEditorText(
                "Beta[^1] alpha[^2] end\n\n[^1]: two\n[^2]: one",
            );
        } finally {
            action(`app.vault.setConfig('vimMode', false);`);
        }
    });

    await test("autosave alone never triggers lint on save", async () => {
        // the hook wraps the SAVE COMMAND: Obsidian's background autosave
        // writes through the view directly and must not lint
        resetSettings({ lintOnSave: true });
        const note = "Beta[^2] alpha[^1] end\n\n[^1]: one\n[^2]: two";
        await setupNote(note);
        await sleep(3500); // well past the ~2s autosave debounce
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`autosave linted: ${jsLiteral(text)}`);
        }
    });

    await test("creating a footnote lints the note when enabled", async () => {
        resetSettings({ lintOnFootnoteCreation: true });
        // inserting mid "alpha" puts the new reference BEFORE [^1] in reading
        // order - the creation-time lint renumbers everything and the
        // caret still lands on the (renamed) new empty definition
        await setupNote("alpha bravo[^1] end.\n\n[^1]: one");
        setCursorAndRun(0, 3, CMD_AUTONUM); // mid "alpha"
        await expectEditorText(
            "alpha[^1] bravo[^2] end.\n\n[^1]: \n[^2]: one",
        );
        await pollUntil(
            "caret at the end of the new empty definition",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 2 && c.ch === "[^1]: ".length,
        );
    });

    await test("creating a footnote in a clean note lints nothing, silently", async () => {
        resetSettings({ lintOnFootnoteCreation: true });
        await setupNote("Alpha bravo\n\n");
        setCursorAndRun(0, 8, CMD_AUTONUM); // mid "bravo"
        await expectEditorText("Alpha bravo[^1]\n\n[^1]: ");
    });

    await test("lint gathers definitions under the existing heading, not at EOF (issue #55)", async () => {
        resetSettings({
            enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "# Footnotes",
        });
        // the section lives MID-NOTE with a stray definition at the end;
        // lint pulls the stray UP under the heading and leaves the
        // section where the user put it
        await setupNote(
            "Intro[^2] a[^1]\n\n# Footnotes\n\n[^1]: one\n\n## Other\nstuff\n\n[^2]: two",
        );
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText(
            "Intro[^1] a[^2]\n\n# Footnotes\n\n[^1]: two\n[^2]: one\n\n## Other\nstuff",
        );
    });

    await test("first footnote slots under an existing section heading (QOL)", async () => {
        resetSettings({
            enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "# Footnotes",
        });
        await setupNote("Alpha bravo\n\n# Footnotes\n\ntail here");
        setCursorAndRun(0, 8, CMD_AUTONUM); // mid "bravo"
        // a blank line separates the definition from "tail here" - otherwise
        // Obsidian lazily pulls the prose into the footnote (the swallowed-prose bug, 2026-07-20)
        await expectEditorText(
            "Alpha bravo[^1]\n\n# Footnotes\n\n[^1]: \n\ntail here",
        );
    });

    await test("definition slotted above prose keeps a blank line between them (2026-07-20)", async () => {
        resetSettings({
            enableFootnoteSectionHeading: true,
            footnoteSectionHeading: "# Footnotes",
        });
        // the heading has prose DIRECTLY below it, no blank line at all
        await setupNote("Alpha bravo\n\n# Footnotes\nprose right after");
        setCursorAndRun(0, 8, CMD_AUTONUM); // mid "bravo"
        await expectEditorText(
            "Alpha bravo[^1]\n\n# Footnotes\n\n[^1]: \n\nprose right after",
        );
    });

    await test("named command prefills the note's prefix into the reference (QOL)", async () => {
        resetSettings({ enableFootnotePrefix: true });
        await setupNote("---\nfootnote-prefix: 2~\n---\nAlpha bravo");
        setCursorAndRun(3, 8, CMD_NAMED); // mid "bravo" → end of word
        await expectEditorText(
            "---\nfootnote-prefix: 2~\n---\nAlpha bravo[^2~]",
        );
        await pollUntil(
            "caret between the prefix and the bracket",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 3 && c.ch === "Alpha bravo[^2.".length,
        );
        // type the name, press again inside → definition for the full name
        action(
            `const v=${EDITOR}; v.editor.replaceRange('tag', v.editor.getCursor());`,
        );
        setCursorAndRun(3, "Alpha bravo[^2.ta".length, CMD_NAMED);
        await expectEditorText(
            "---\nfootnote-prefix: 2~\n---\nAlpha bravo[^2~tag]\n\n[^2~tag]: ",
        );
    });

    await test("press inside the untouched [^2~] placeholder asks for a suffix (QOL)", async () => {
        resetSettings({ enableFootnotePrefix: true });
        const note = "---\nfootnote-prefix: 2~\n---\nAlpha [^2~] bravo";
        await setupNote(note);
        setCursorAndRun(3, 8, CMD_NAMED); // inside the placeholder
        await pollUntil(
            "the add-a-suffix toast",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("only the prefix"),
        );
        // the caret stays put and nothing was inserted
        const cursor = readJson(`(${EDITOR}).editor.getCursor()`);
        if (!cursor || cursor.line !== 3 || cursor.ch !== 8) {
            throw new Error(`caret moved: ${jsLiteral(cursor)}`);
        }
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`the toast changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("numbered hotkey inside an inline footnote hops out (QOL)", async () => {
        resetSettings();
        const note = "text ^[inline note] more";
        await setupNote(note);
        setCursorAndRun(0, 9, CMD_AUTONUM); // inside the inline footnote
        await pollUntil(
            "caret just past the closing bracket",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 0 && c.ch === note.indexOf("]") + 1,
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`hop changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("inline hotkey inside a reference navigates like the named key (QOL)", async () => {
        resetSettings();
        const note = "Alpha [^1] end.\n\n[^1]: one";
        await setupNote(note);
        setCursorAndRun(0, 8, CMD_INLINE); // inside the [^1] reference
        await pollUntil(
            "caret at the end of the definition",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 2 && c.ch === "[^1]: one".length,
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`navigation changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("inline hotkey on a definition-less reference creates its definition (QOL)", async () => {
        resetSettings();
        await setupNote("Alpha [^tag] end.");
        setCursorAndRun(0, 8, CMD_INLINE); // inside the [^tag] reference
        await expectEditorText("Alpha [^tag] end.\n\n[^tag]: ");
    });

    await test("clean note lint reports 'No linting needed.'", async () => {
        resetSettings();
        await setupNote("Alpha.[^1] done\n\n[^1]: one");
        setCursorAndRun(0, 0, "obsidian-footnotes:lint-footnotes");
        await pollUntil(
            "the no-op notice",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("No linting needed."),
        );
    });

    await test("an invalid footnote-prefix blocks the insert with a toast only", async () => {
        // it used to fall back to an unprefixed footnote the user then
        // had to delete (reported 2026-08-07)
        resetSettings({ enableFootnotePrefix: true });
        const note = "---\nfootnote-prefix: 10\n---\nAlpha bravo";
        await setupNote(note);
        setCursorAndRun(3, 8, CMD_AUTONUM); // mid "bravo"
        await pollUntil(
            "the no-footnote-created toast",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("No footnote was created"),
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`insert still changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("lint cancels on a digit-ending footnote-prefix (QOL)", async () => {
        // the prefix is only read while its toggle is on (Jason's triage,
        // 2026-09-24: with it off the lint says nothing and runs, with it
        // on it cancels with the invalid-prefix toast); the baseline keeps
        // the toggle off, so this scenario turns it on
        resetSettings({ enableFootnotePrefix: true });
        const note =
            "---\nfootnote-prefix: 10\n---\nb[^2] a[^1] end\n\n[^1]: one\n[^2]: two";
        await setupNote(note);
        setCursorAndRun(3, 0, "obsidian-footnotes:lint-footnotes");
        await pollUntil(
            "the cancellation alert",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("Linting canceled"),
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`canceled lint still changed text: ${jsLiteral(text)}`);
        }
    });

    await test("lint applies the note's footnote prefix to plain footnotes (QOL)", async () => {
        // plain strays adopt the prefix AND the whole namespace renumbers
        // by reading order - the pre-existing [^3=5] is a numbered
        // footnote of the namespace, not a named one; named footnotes
        // keep their name behind the prefix (a bug of 2026-07-20)
        resetSettings({ enableFootnotePrefix: true });
        await setupNote(
            "---\nfootnote-prefix: 3=\n---\nb[^2] a[^1] pre[^3=5] n[^note] end\n\n[^1]: one\n[^2]: two\n[^3=5]: already prefixed\n[^note]: named",
        );
        setCursorAndRun(3, 0, CMD_LINT);
        await expectEditorText(
            "---\nfootnote-prefix: 3=\n---\nb[^3=1] a[^3=2] pre[^3=3] n[^3=note] end\n\n[^3=1]: two\n[^3=2]: one\n[^3=3]: already prefixed\n[^3=note]: named",
        );
    });

    await test("set-footnote-prefix modal validates, then writes the property", async () => {
        resetSettings();
        await setupNote("Modal target note");
        action(`app.commands.executeCommandById('obsidian-footnotes:set-footnote-prefix');`);
        await pollUntil(
            "the modal's text input",
            `!!document.querySelector('.modal-container input[type=\"text\"]')`,
            (v) => v === true,
        );
        // a digit-ending prefix is refused: inline error, modal stays open
        action(
            `(() => { const input = document.querySelector('.modal-container input[type=\"text\"]'); ` +
            `input.value = '10'; input.dispatchEvent(new Event('input', {bubbles: true})); ` +
            `input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'})); })();`,
        );
        await pollUntil(
            "the inline validation error",
            `(() => { const err = document.querySelector('.footnote-shortcut-prefix-error'); ` +
            `return { open: !!document.querySelector('.modal-container'), error: err ? err.textContent : '' }; })()`,
            (s) => s && s.open && s.error.includes("end in a number"),
        );
        // a valid prefix closes the modal and lands in the frontmatter
        action(
            `(() => { const input = document.querySelector('.modal-container input[type=\"text\"]'); ` +
            `input.value = '5.'; input.dispatchEvent(new Event('input', {bubbles: true})); ` +
            `input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'})); })();`,
        );
        await pollUntil(
            "the property in the note",
            `(${EDITOR}).editor.getValue()`,
            // processFrontMatter may quote the YAML value; the plugin's
            // parser strips symmetric quotes, so both forms are fine
            (v) =>
                typeof v === "string" &&
                /footnote-prefix: "?5\."?/.test(v),
        );
    });

    await test("case-variant prefixed reference reserves its number (2026-08-10 A3)", async () => {
        // ids are case-insensitive in Obsidian: [^p-1] lives in prefix
        // "P-"'s namespace, so the next insert must mint 2, not a
        // colliding 1 that silently merges two footnotes
        resetSettings({ enableFootnotePrefix: true });
        await setupNote("---\nfootnote-prefix: P-\n---\nAlpha [^p-1] bravo\n\n[^p-1]: one");
        setCursorAndRun(3, 15, CMD_AUTONUM); // mid "bravo"
        await expectEditorText(
            "---\nfootnote-prefix: P-\n---\nAlpha [^p-1] bravo[^P-2]\n\n[^p-1]: one\n[^P-2]: ",
        );
    });

    await test("press inside a code-span-named reference navigates, never duplicates (2026-08-10 A2)", async () => {
        // the masked scan used to read the name as NUL bytes: the press
        // appended a duplicate definition containing literal NULs instead of
        // jumping to the existing one
        resetSettings();
        const note = "See[^`1`] end\n\n[^`1`]: definition";
        await setupNote(note);
        setCursorAndRun(0, 6, CMD_AUTONUM); // inside the [^`1`] reference
        await pollUntil(
            "cursor on the definition line",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 2,
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`navigation changed the text: ${jsLiteral(text)}`);
        }
    });

    await test("caret after an escaped pipe still counts as inside a reference (2026-08-10 A9)", async () => {
        await requireVisibleWindow();
        // the cell editor shows "\|" as "|", so the caret used to resolve
        // one source column short - read as OUTSIDE the reference, the named
        // command nested a fresh "[^]" into it instead of continuing it
        resetSettings();
        const table = [
            "| Head |",
            "| ---- |",
            "| left \\| right[^note] |",
        ].join("\n");
        await setupNote("table pending");
        action(`(${EDITOR}).editor.setValue(${jsLiteral(table)});`);
        await pollUntil(
            "table content in editor",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("[^note]"),
        );
        await pollUntil(
            "table content in data buffer",
            `(${EDITOR}).data`,
            (v) => typeof v === "string" && v.includes("[^note]"),
        );
        // caret between "[" and "^" - strictly inside, and past the escape
        action(
            `(() => { const v=${EDITOR}; v.editor.focus(); ` +
            `const ch=v.editor.getLine(2).indexOf('[^note]')+1; ` +
            `v.editor.setCursor({line:2, ch}); })();`,
        );
        await pollUntil(
            "table cell sub-editor to open",
            `(() => { const t=(${EDITOR}).containerEl.querySelector('.markdown-source-view table'); ` +
            `return !!(t && t.querySelector('.cm-content')); })()`,
            (v) => v === true,
        );
        action(`app.commands.executeCommandById('${CMD_NAMED}');`);
        // inside a definition-less reference the press continues the footnote:
        // its definition appears and the row itself stays untouched
        await pollUntil(
            "the created definition line",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("[^note]: "),
        );
        const line = readJson(`(${EDITOR}).editor.getLine(2)`);
        if (line.includes("[^]")) throw new Error(`nested a reference into the reference: ${line}`);
        if (!line.includes("\\|")) throw new Error(`the escaped pipe was lost: ${line}`);
    });

    await test("lint alerts about references with no definition (2026-08-10)", async () => {
        resetSettings(); // "Orphaned references" defaults to Alert
        await setupNote("Ref[^1] and stray[^stray] end\n\n[^1]: one");
        setCursorAndRun(0, 0, CMD_LINT);
        await pollUntil(
            "the orphaned-reference alert",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) =>
                typeof v === "string" &&
                v.includes("no definition") &&
                v.includes("[^stray]"),
        );
        // alert only - the reference itself stays in the text
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (!text.includes("[^stray]")) {
            throw new Error(`alert mode removed the reference: ${jsLiteral(text)}`);
        }
    });

    await test("lint deletes orphaned references when the setting says so (2026-08-10)", async () => {
        resetSettings({ lintDeleteOrphanedReferences: true });
        await setupNote("Keep[^1] drop[^stray] end\n\n[^1]: one");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Keep[^1] drop end\n\n[^1]: one");
    });

    await test("lint fixes a definition hidden by a missing blank line and gathers it (2026-09-09)", async () => {
        resetSettings({ lintReindex: false }); // the fix toggle defaults to on
        await setupNote("Alpha[^1] here.\n[^1]: def\n\nTail.");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Alpha[^1] here.\n\nTail.\n\n[^1]: def");
    });

    await test("with the fix off, lint leaves the hidden definition and alerts instead (2026-09-09)", async () => {
        resetSettings({ lintReindex: false, lintFixLazyDefinitions: false });
        await setupNote("Alpha[^1] here.\n[^1]: def\n\nTail.");
        setCursorAndRun(0, 0, CMD_LINT);
        await pollUntil(
            "the lazy-definition alert",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("reads as plain text") && v.includes("[^1]:"),
        );
        await expectEditorText("Alpha[^1] here.\n[^1]: def\n\nTail.");
    });

    await test("a definition inside a %% block comment is dead: lint leaves it and reports the reference (2026-09-09)", async () => {
        resetSettings();
        await setupNote("x[^1] here.\n\n%%\n[^1]: commented out\n%%");
        setCursorAndRun(0, 0, CMD_LINT);
        await pollUntil(
            "the missing-definition alert",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) => typeof v === "string" && v.includes("no definition") && v.includes("[^1]"),
        );
        await expectEditorText("x[^1] here.\n\n%%\n[^1]: commented out\n%%");
    });

    await test("a reference inside a %% block comment is live: its definition is no orphan (2026-09-09)", async () => {
        resetSettings({ lintDeleteOrphanedDefinitions: true, lintReindex: false });
        await setupNote("x[^1] here.\n\n%%\nhidden[^2]\n%%\n\n[^1]: one\n[^2]: two");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("x[^1] here.\n\n%%\nhidden[^2]\n%%\n\n[^1]: one\n[^2]: two");
    });

    await test("lint alerts about kept orphaned definitions (2026-08-10)", async () => {
        resetSettings(); // orphaned-definition deletion defaults to off
        await setupNote("plain text[^1]\n\n[^1]: used\n[^stray]: unused");
        setCursorAndRun(0, 0, CMD_LINT);
        await pollUntil(
            "the orphaned-definition alert",
            `[...document.querySelectorAll('.notice')].map(n => n.textContent).join('|')`,
            (v) =>
                typeof v === "string" &&
                v.includes("nothing references") &&
                v.includes("[^stray]"),
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (!text.includes("[^stray]: unused")) {
            throw new Error(`the kept orphan was altered: ${jsLiteral(text)}`);
        }
    });

    await test("lint merges duplicate definitions when the setting says so (2026-08-12)", async () => {
        // the one shipped rule with no live exercise until 2026-09-09
        // (review D8): the later body folds into the first as a
        // continuation line, and the punctuation rule still runs
        resetSettings({ lintMergeDuplicateDefinitions: true });
        await setupNote("dup here[^d].\n\n[^d]: body\n[^d]: another body");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("dup here.[^d]\n\n[^d]: body\n    another body");
    });

    await test("comment boundary lines stay live outside the comment (2026-08-10 A4)", async () => {
        // the opener/closer lines of a multi-line comment used to be
        // whole-line protected: the swap-worthy reference before "<!--"
        // was invisible and autonumbering reused hidden numbers
        resetSettings({ lintMoveToBottom: false, lintReindex: false });
        await setupNote("Alpha[^1]. <!-- draft\n--> done\n\n[^1]: one");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("Alpha.[^1] <!-- draft\n--> done\n\n[^1]: one");
        // and the next autonumber respects a reference on a boundary line
        setCursorAndRun(1, 8, CMD_AUTONUM); // after "done"
        await pollUntil(
            "the [^2] reference",
            `(${EDITOR}).editor.getValue()`,
            (v) => typeof v === "string" && v.includes("done[^2]"),
        );
    });

    await test("a blockquoted fence ends at the blank line after its quote (2026-08-10 A5/A6, probed 2026-09-16)", async () => {
        // the fence used to run to EOF, hiding the rest of the note: the
        // press below saw no live text and autonumbering counted [^9].
        // The blank line matters: a plain line directly under the quoted
        // fence is swallowed by it (Reading view, probed 2026-09-16, and
        // Jason's triage 2026-09-24 of the old fixture, which had no blank
        // line and rightly got no footnote); a blank line ends the quote
        // and the fence with it
        resetSettings();
        await setupNote("> ```\n> fake[^9]\n\nAlpha done");
        setCursorAndRun(3, 8, CMD_AUTONUM); // mid "done" - LIVE text
        await expectEditorText("> ```\n> fake[^9]\n\nAlpha done[^1]\n\n[^1]: ");
    });

    await test("footnotes navigate inside a callout (2026-08-10 C22)", async () => {
        resetSettings();
        // the ">" blank line matters: a label directly under the callout's
        // body line is lazy paragraph text to Obsidian (ground truth
        // 2026-09-09), so this fixture carries the blank
        const note = "> [!note]\n> body[^1] here\n>\n> [^1]: def";
        await setupNote(note);
        setCursorAndRun(1, 8, CMD_AUTONUM); // inside [^1] - must navigate
        await pollUntil(
            "cursor on the callout definition line",
            `(${EDITOR}).editor.getCursor()`,
            (c) => c && c.line === 3,
        );
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        if (text !== note) {
            throw new Error(`navigation duplicated the definition: ${jsLiteral(text)}`);
        }
    });

    await test("lint leaves math alone, swaps real punctuation (2026-08-10 C20)", async () => {
        resetSettings({ lintMoveToBottom: false, lintReindex: false });
        await setupNote("$x[^9].$ real[^1].\n\n[^1]: one");
        setCursorAndRun(0, 0, CMD_LINT);
        await expectEditorText("$x[^9].$ real.[^1]\n\n[^1]: one");
    });

    // LAST before cleanup: this test flips the view mode, and a failure
    // between flip and flip-back must not poison the tests after it
    await test("closing the popup in Reading view edits nothing (creation lint already ran, 2026-08-27)", async () => {
        // historically this pinned the DEFERRED creation lint staying
        // inert after a Reading-view flip (2026-08-10 A7); since
        // 2026-08-27 the lint runs BEFORE the popup opens, so the pin is
        // now: the linted text is in place while the popup is up, and
        // closing the popup from Reading view performs no further edit
        // on the hidden buffer
        resetSettings({
            enablePopupEditor: true,
            lintOnFootnoteCreation: true,
            insertAtEndOfWord: false,
        });
        await setupNote("Alpha, bravo");
        setCursorAndRun(0, 5, CMD_AUTONUM); // just before the comma
        await pollUntil(
            "popup open",
            `!!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
        // the punctuation fix applied at creation, before the popup
        const created = "Alpha,[^1] bravo\n\n[^1]: ";
        await expectEditorText(created);
        // flip to Reading view WITHOUT a leaf change, by the user's route
        // (toggleMode fires layout-change; a programmatic setState flip
        // does not) - the mode switch itself closes the popup (2026-09-04;
        // it used to stay up until the hotkey's toggle path closed it)
        action(`(async () => { await (${EDITOR}).toggleMode(); })();`);
        await pollUntil("reading view", `(${EDITOR}).getMode()`, (v) => v === "preview");
        // nothing may edit the hidden buffer afterwards
        await pollUntil(
            "popup closed",
            `!document.querySelector('.footnote-shortcut-popup')`,
            (v) => v === true,
        );
        await sleep(1200); // teardown save + settle beat
        const text = readJson(`(${EDITOR}).editor.getValue()`);
        // flip back BEFORE asserting so a failure can't strand Reading view
        action(
            `(async () => { const v=${EDITOR}; ` +
            `await v.setState({...v.getState(), mode:'source'}, {history:false}); })();`,
        );
        await pollUntil("editing view", `(${EDITOR}).getMode()`, (v) => v === "source");
        if (text !== created) {
            throw new Error(`the popup close edited the hidden buffer: ${jsLiteral(text)}`);
        }
    });

    // restore state and clean up (restoreState also covers every abort path)
    restoreState("suite finished");

    if (nameFilter !== null && ran === 0) {
        console.error(`\n--filter "${nameFilter}" matched no test names`);
        process.exit(2);
    }
    const skipNote = skips > 0 ? ` (${skips} skipped - rerun with the Obsidian window visible)` : "";
    const filterNote =
        nameFilter !== null
            ? ` (--filter "${nameFilter}": ${filtered} test(s) not run)`
            : "";
    console.log(failures === 0 ? `\nall smoke tests passed${skipNote}${filterNote}` : `\n${failures} smoke test(s) FAILED${skipNote}${filterNote}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(`smoke tests aborted: ${e.message}`);
    restoreState("aborted");
    process.exit(1);
});
