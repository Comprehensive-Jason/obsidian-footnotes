// Ends the test runs going on this machine and holds off new ones for a
// few minutes, so a shell loop left behind by a stopped agent runs out
// instead of starting the next run (Jason, 2026-10-06; the guard itself is
// scripts/test-run-guard.mjs).
//
//   npm run tests:stop     end every run holding a slot; refuse new runs for 5 minutes
//   npm run tests:resume   lift the stop now
//   node scripts/stop-test-runs.mjs --list   show the runs holding slots
//
// It ends only the runs the guard knows, so test runs of other projects
// are never touched.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";

import { endProcessTree, GUARD_DIR, isRunning, readSlots, STOP_FILE, STOP_MINUTES } from "./test-run-guard.mjs";

const mode = process.argv[2];

if (mode === "--resume") {
    rmSync(STOP_FILE, { force: true });
    console.log("Test runs may start again.");
} else if (mode === "--list") {
    const slots = readSlots().filter((slot) => isRunning(slot.pid));
    if (slots.length === 0) console.log("No test runs are going.");
    for (const slot of slots) {
        const minutes = Math.round((Date.now() - slot.started) / 60_000);
        console.log(`pid ${slot.pid}, running ${minutes} min, in ${slot.cwd}`);
    }
} else {
    mkdirSync(GUARD_DIR, { recursive: true });
    // The stop goes up first, so a loop cannot slip a new run in between.
    writeFileSync(STOP_FILE, String(Date.now() + STOP_MINUTES * 60_000));
    let ended = 0;
    for (const slot of readSlots()) {
        if (slot.pid !== process.pid && isRunning(slot.pid)) {
            endProcessTree(slot.pid);
            ended++;
        }
        rmSync(slot.path, { force: true });
    }
    console.log(`Ended ${ended} test run${ended === 1 ? "" : "s"}. New runs are refused for ${STOP_MINUTES} minutes ("npm run tests:resume" lifts that).`);
}
