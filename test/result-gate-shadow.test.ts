import { afterEach, describe, expect, it } from "vitest";

import { resetNotices } from "./helpers/notices";
import { GateRecord, oldChecksSuspended, setGateRecorder, shadowGate } from "../src/editor/result-gate";
import { removeOrphanedFootnoteReferences } from "../src/linting/rules/remove-orphaned-references";
import { footnotesRenamed } from "../src/linting/rule-intents";

// Shadow mode (stage 2 of the result gate design, 2026-10-07): the write
// paths whose old checks still decide hand their edit to the gate next to
// them, and only a test that installs a recorder pays for it. Stage 3
// (2026-10-08) lets the gate decide one family of write paths at a time.

/** Installs a recorder that keeps every record, and hands back the list. */
function recording(): GateRecord[] {
    const records: GateRecord[] = [];
    setGateRecorder((record) => records.push(record));
    return records;
}

afterEach(() => {
    setGateRecorder(null);
    resetNotices();
});

describe("shadow mode", () => {
    it("works out nothing while no recorder is installed", () => {
        // a run that records the whole suite has one installed
        setGateRecorder(null);
        let asked = false;
        shadowGate("test", null, () => {
            asked = true;
            return null;
        });
        expect(asked).toBe(false);
        expect(oldChecksSuspended()).toBe(false);
    });

    it("records what a lint rule's old checks held back, and leaves the rule's result as it was (pin bug-lint-orphan-cut-leaves-lazy-label)", () => {
        const note = "a[^8]\n\nprose\n[^8][^9]: x\n\n[^8]: d";
        const plain = removeOrphanedFootnoteReferences(note);
        const records = recording();
        expect(removeOrphanedFootnoteReferences(note)).toBe(plain);
        const held = records.find((record) => record.path === "lint:orphan-references" && record.old === "held back");
        expect(held?.verdict).toMatchObject({ pass: false, reason: "formatting" });
        expect(oldChecksSuspended()).toBe(false);
    });
});

describe("the renames a lint rule made, read off the notes", () => {
    it("follows references outside the definitions, then each definition and the references inside it", () => {
        const before = ["body[^b] text[^a].", "", "[^a]: has [^1] inside", "[^b]: has [^2] inside", "", "[^1]: one", "[^2]: two"];
        const after = ["body[^b] text[^a].", "", "[^b]: has [^1] inside", "[^a]: has [^2] inside", "", "[^1]: two", "[^2]: one"];
        expect(Object.fromEntries(footnotesRenamed(before, after).renamed ?? [])).toEqual({ 1: "2", 2: "1" });
    });
});
