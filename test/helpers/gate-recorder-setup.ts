import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

import { GateRecord, setGateRecorder } from "../../src/editor/result-gate";

// Shadow mode's recorder (stage 2 of the result gate design, 2026-10-07).
// With FOOTNOTES_GATE_RECORD set to a folder, every test file run records
// what the result gate said about each edit next to what the old checks
// said (setGateRecorder in src/editor/result-gate.ts). Unset, as in every
// everyday run, this file does nothing.
//
// Each worker writes one file of JSON lines into the folder. An edit the
// gate and the old checks agree on is only counted, by write path; one they
// disagree on is written out whole, once per distinct edit, with the test
// that made it and how often it came up.

const folder = process.env.FOOTNOTES_GATE_RECORD;

/** One disagreement, as written out: the record, the test that first made it, and how many times it came up. */
interface Disagreement {
    record: GateRecord;
    test: string;
    file: string;
    times: number;
}

if (folder) {
    mkdirSync(folder, { recursive: true });
    const out = join(folder, `gate-${String(process.pid)}-${String(Math.random()).slice(2, 8)}.jsonl`);
    let counts = new Map<string, { agree: number; milliseconds: number; calls: number }>();
    let disagreements = new Map<string, Disagreement>();

    beforeAll(() => {
        setGateRecorder((record) => {
            const gateRefused = !record.verdict.pass;
            const oldRefused = record.old !== null;
            const tally = counts.get(record.path) ?? { agree: 0, milliseconds: 0, calls: 0 };
            tally.calls++;
            tally.milliseconds += record.milliseconds;
            if (gateRefused === oldRefused) tally.agree++;
            counts.set(record.path, tally);
            if (gateRefused === oldRefused) return;
            const key = JSON.stringify([record.path, record.old, record.verdict, record.edit?.before, record.edit?.after]);
            const known = disagreements.get(key);
            if (known) {
                known.times++;
                return;
            }
            const state = expect.getState();
            disagreements.set(key, { record, test: state.currentTestName ?? "", file: state.testPath ?? "", times: 1 });
        });
    });

    afterAll(() => {
        setGateRecorder(null);
        const lines: string[] = [];
        for (const [path, tally] of counts) lines.push(JSON.stringify({ type: "counts", path, ...tally }));
        for (const entry of disagreements.values()) {
            const edit = entry.record.edit;
            const renamed = edit?.intent.renamed;
            const intent = edit ? { ...edit.intent, renamed: renamed ? [...renamed] : undefined } : null;
            lines.push(JSON.stringify({ type: "disagreement", ...entry, record: { ...entry.record, edit: edit ? { ...edit, intent } : null } }));
        }
        if (lines.length > 0) appendFileSync(out, lines.join("\n") + "\n");
        counts = new Map();
        disagreements = new Map();
    });
}
