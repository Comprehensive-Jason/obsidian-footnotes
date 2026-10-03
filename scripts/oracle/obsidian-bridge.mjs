// The Node side of the oracle's conversation with the live Obsidian app.
//
// It follows the live-app rules in docs/agents/dev-setup.md. Every CLI call
// names the sandbox vault first, so a probe can never land in Jason's
// personal vault. Notes and scripts travel through files in a dotfolder of
// the sandbox vault, never inside a long eval argument, because a long
// argument crashed the renderer and raised an error dialog (2026-08-28,
// 2026-09-24). Every eval that starts work ends with a sentinel, so the CLI
// never waits on it, and the waiting happens here in Node by polling the
// result file on disk (Electron throttles timers inside a hidden window).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// The plugin folder is two levels below the vault root (.obsidian/plugins).
const PLUGIN_DIR = resolve(HERE, "..", "..");
const VAULT_DIR = resolve(PLUGIN_DIR, "..", "..", "..");
const VAULT_NAME = "Obsidian-Plugin-Sandbox";
// The dotfolder Obsidian does not index; jobs, scripts, and results live here.
const ORACLE_DIR = ".footnote-oracle";
// (The Reading-view scratch notes go in a visible folder, "Footnote Oracle",
// which inapp-render.js names, because Obsidian has to index a note to open it.)

const CLI = process.env.OBSIDIAN_CLI ?? (process.platform === "win32" ? "Obsidian.com" : "obsidian");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One CLI call, spawned directly (never through a shell, which breaks the quoting), the vault named first. */
function cli(...args) {
    return execFileSync(CLI, [`vault=${VAULT_NAME}`, ...args], { encoding: "utf8", timeout: 60000 }).trim();
}

/** Evaluates a SHORT expression in the app and returns its printed value (the "=> " prefix stripped). */
function evalRead(code) {
    if (code.length > 1500) throw new Error("eval argument too long; pass data through a vault dotfile");
    for (let attempt = 0; attempt < 3; attempt++) {
        const out = cli("eval", `code=${code}`);
        const m = out.match(/^=>\s?([\s\S]*)$/);
        if (m) return m[1];
        if (out) return out;
    }
    return "";
}

/** The vault-relative path as a path on disk. */
function onDisk(vaultPath) {
    return join(VAULT_DIR, ...vaultPath.split("/"));
}

/** Refuses to run unless the CLI really reaches the sandbox vault; returns app facts to record with every result. */
export function appFacts() {
    const raw = evalRead("JSON.stringify({vault:app.vault.getName(),isMobile:app.isMobile,hasCompute:typeof app.metadataCache.computeMetadataAsync})");
    const facts = JSON.parse(raw);
    if (facts.vault !== VAULT_NAME) throw new Error(`the CLI reached vault "${facts.vault}", not the sandbox; stopping`);
    if (facts.hasCompute !== "function") throw new Error("app.metadataCache.computeMetadataAsync is gone in this Obsidian build");
    facts.version = cli("version");
    return facts;
}

/**
 * Runs one in-app script (a file next to this one) over a job, and waits
 * for its result file. The script is copied into the vault dotfolder; the
 * eval only reads and starts it, then returns the sentinel at once.
 */
export async function runInApp(script, job, { timeoutMs = 600000, pollMs = 500 } = {}) {
    // a bare name is a script next to this file; an absolute path is an ad hoc probe
    const source = isAbsolute(script) ? script : join(HERE, script);
    const scriptName = basename(source);
    const dir = onDisk(ORACLE_DIR);
    mkdirSync(dir, { recursive: true });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const resultPath = join(dir, `result-${id}.json`);
    writeFileSync(join(dir, `job-${id}.json`), JSON.stringify({ ...job, id }), "utf8");
    writeFileSync(join(dir, scriptName), readFileSync(source, "utf8"), "utf8");
    // The loader passes the job id in; the script reads its job file itself.
    const loader =
        `app.vault.adapter.read(${JSON.stringify(`${ORACLE_DIR}/${scriptName}`)})` +
        `.then((s)=>(0,eval)(s)(${JSON.stringify(id)}));'fired'`;
    const fired = evalRead(loader);
    if (!/fired/.test(fired)) throw new Error(`the loader eval did not fire: ${fired}`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(resultPath)) {
            let result;
            try {
                result = JSON.parse(readFileSync(resultPath, "utf8"));
            } catch {
                // the app may still be writing it
                await sleep(pollMs);
                continue;
            }
            rmSync(resultPath, { force: true });
            rmSync(join(dir, `job-${id}.json`), { force: true });
            if (result.error) throw new Error(`in-app ${scriptName} failed: ${result.error}`);
            return result;
        }
        await sleep(pollMs);
    }
    throw new Error(`timed out waiting for ${scriptName} (job ${id}); the app may be busy or the window asleep`);
}
