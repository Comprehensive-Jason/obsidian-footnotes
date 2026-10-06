// The test run guard: keeps test runs from piling up on a machine.
//
// Why it exists (Jason, 2026-10-06): agents that were stopped left shell
// loops behind that kept starting test runs, and together they took 95% of
// the laptop's CPU and memory. One full run peaks near 2 GB, so a handful
// at once fills the laptop. The guard puts three limits on every run:
//
// - Slots: only FOOTNOTES_TEST_SLOTS runs (2 by default) go at once on
//   the machine. A run that finds every slot taken waits, and says which
//   runs hold them.
// - A time limit: a run still going after FOOTNOTES_TEST_MAX_MINUTES (30
//   by default) ends itself and every test process it started.
// - A stop switch: `npm run tests:stop` ends the runs going now and
//   refuses new ones for five minutes, long enough for a leftover loop to
//   run out (scripts/stop-test-runs.mjs; `npm run tests:resume` lifts it).
//
// Vitest runs this file once before a run starts (its "globalSetup"), and
// the function it returns once the run is over. Watch mode (`npm test` in
// a terminal) is a person at the keyboard, so the guard leaves it alone,
// and also CI, whose machines are thrown away after each job, and Stryker,
// whose mutation workers are long-lived test runs it manages itself.

import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, closeSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every copy of the repo on the machine (worktrees, scratch copies) shares
// this one folder, so the slots count runs machine-wide.
export const GUARD_DIR = join(tmpdir(), "obsidian-footnotes-test-runs");
export const STOP_FILE = join(GUARD_DIR, "stop");
export const STOP_MINUTES = 5;

const POLL_MS = 2000;

// A slot is a file named slot-<n> holding who took it: the process id
// (pid), when it started, the folder it ran in, and when its time is up.
export function readSlots() {
    let names = [];
    try {
        names = readdirSync(GUARD_DIR).filter((name) => name.startsWith("slot-"));
    } catch {
        return [];
    }
    const slots = [];
    for (const name of names) {
        const path = join(GUARD_DIR, name);
        try {
            slots.push({ path, ...JSON.parse(readFileSync(path, "utf8")) });
        } catch {
            // A slot being written right now reads as empty; skip it.
        }
    }
    return slots;
}

// Asks the system whether a process is still running. Sending signal 0
// checks without touching the process; "EPERM" means it runs as another
// user, which still counts as running.
export function isRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

// Ends a process and every process it started (its "tree"): the test
// workers are children of the run's main process.
export function endProcessTree(pid) {
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        return;
    }
    spawnSync("pkill", ["-KILL", "-P", String(pid)], { stdio: "ignore" });
    try {
        process.kill(pid, "SIGKILL");
    } catch {
        // Already gone.
    }
}

// The stop switch is on while its file says a time still in the future.
export function stoppedUntil() {
    try {
        const until = Number(readFileSync(STOP_FILE, "utf8"));
        return until > Date.now() ? until : 0;
    } catch {
        return 0;
    }
}

// A slot whose run has ended, or is a minute past its time limit, is
// left over (the run crashed or was killed before it could clear it).
function clearLeftoverSlots() {
    for (const slot of readSlots()) {
        if (!isRunning(slot.pid) || Date.now() > slot.deadline + 60_000) {
            rmSync(slot.path, { force: true });
        }
    }
}

function describe(slot) {
    const minutes = Math.round((Date.now() - slot.started) / 60_000);
    return `pid ${slot.pid}, ${minutes} min, in ${slot.cwd}`;
}

function tryTakeSlot(count, record) {
    for (let n = 1; n <= count; n++) {
        const path = join(GUARD_DIR, `slot-${n}`);
        try {
            // "wx" creates the file only if it is not there yet, in one
            // step, so two runs can never take the same slot.
            const fd = openSync(path, "wx");
            writeSync(fd, JSON.stringify(record));
            closeSync(fd);
            return path;
        } catch {
            // Taken; try the next one.
        }
    }
    return undefined;
}

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

export default async function setup(project) {
    const env = process.env;
    if (env.CI || env.STRYKER_MUTATOR_WORKER || env.FOOTNOTES_TEST_GUARD === "off" || project?.config?.watch) {
        return undefined;
    }
    const slotCount = positiveNumber(env.FOOTNOTES_TEST_SLOTS, 2);
    const maxMinutes = positiveNumber(env.FOOTNOTES_TEST_MAX_MINUTES, 30);
    mkdirSync(GUARD_DIR, { recursive: true });

    const refuseIfStopped = () => {
        const until = stoppedUntil();
        if (until) {
            const time = new Date(until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
            throw new Error(`[test guard] Test runs are stopped until ${time} by "npm run tests:stop". "npm run tests:resume" lifts the stop.`);
        }
    };
    refuseIfStopped();

    const started = Date.now();
    const record = { pid: process.pid, started, cwd: process.cwd(), deadline: started + maxMinutes * 60_000 };
    let slotPath;
    let lastNotice = 0;
    while (!slotPath) {
        clearLeftoverSlots();
        slotPath = tryTakeSlot(slotCount, record);
        if (slotPath) break;
        refuseIfStopped();
        if (Date.now() - started > maxMinutes * 60_000) {
            throw new Error(`[test guard] Waited ${maxMinutes} minutes for a test slot and gave up.`);
        }
        if (Date.now() - lastNotice > 60_000) {
            lastNotice = Date.now();
            const holders = readSlots().map(describe).join("; ");
            console.error(`[test guard] ${slotCount} test runs are already going (${holders}); waiting for one to finish. If they are leftovers, "npm run tests:stop" ends them.`);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    // The waiting counts toward nothing: the time limit starts now.
    const deadline = Date.now() + maxMinutes * 60_000;
    writeFileSync(slotPath, JSON.stringify({ ...record, started: Date.now(), deadline }));

    const release = () => {
        try {
            const slot = JSON.parse(readFileSync(slotPath, "utf8"));
            if (slot.pid === process.pid) rmSync(slotPath, { force: true });
        } catch {
            // Already cleared.
        }
    };
    // "exit" also fires when the run ends some other way than finishing,
    // such as a crash or Ctrl+C.
    process.on("exit", release);

    const timer = setTimeout(() => {
        console.error(`[test guard] This test run passed its ${maxMinutes}-minute limit (FOOTNOTES_TEST_MAX_MINUTES) and was ended, with its test workers.`);
        release();
        endProcessTree(process.pid);
        process.exit(1);
    }, maxMinutes * 60_000);
    // unref: the timer alone does not keep a finished run alive.
    timer.unref();

    return () => {
        clearTimeout(timer);
        release();
    };
}
