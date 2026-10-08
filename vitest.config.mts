import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            // the obsidian package is type definitions only; unit tests get
            // a minimal runtime stub instead (see test/mocks/obsidian.ts)
            obsidian: fileURLToPath(new URL("test/mocks/obsidian.ts", import.meta.url)),
        },
    },
    test: {
        include: ["test/**/*.test.ts"],
        // fresh-worker isolation per test file cost 5.5x wall time
        // (17.6s → 3.2s measured 2026-08-10) and buys nothing here: the
        // suite tests pure functions. Caveat to remember: module-level
        // state (footnote-popup's activePopup, linter's hookedVim) now
        // persists across test FILES in a worker — a test that leaves such
        // state dirty can bleed into another file; reset it in the test.
        isolate: false,
        // Half the cores: on the laptop a full run took 59s with half
        // against 68s with all of them, and peaked at 1.3 GB of memory
        // against 2.0 GB (measured 2026-10-06). `--maxWorkers` overrides it.
        maxWorkers: "50%",
        // Caps how many runs go at once on the machine and how long one
        // may take, and gives `npm run tests:stop` its stop switch
        // (Jason, 2026-10-06: leftover test runs took 95% of the laptop).
        globalSetup: ["scripts/test-run-guard.mjs"],
        // Shadow mode's recorder for the result gate: does nothing unless
        // FOOTNOTES_GATE_RECORD names a folder (test/helpers/gate-recorder-setup.ts).
        setupFiles: ["test/helpers/gate-recorder-setup.ts"],
    },
});
