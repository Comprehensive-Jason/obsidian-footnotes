import { afterEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";
import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { GateRecord, oldChecksSuspended, setGateRecorder, shadowGate } from "../src/editor/result-gate";
import { removeOrphanedFootnoteReferences } from "../src/linting/rules/remove-orphaned-references";
import { footnotesRenamed } from "../src/linting/rule-intents";

// Shadow mode (stage 2 of the result gate design, 2026-10-07): every write
// path hands its edit to the gate next to the old checks, which still
// decide, and only a test that installs a recorder pays for it.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

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

    it("records a numbered press next to what the old checks decided", async () => {
        const records = recording();
        const doc = fakeEditor(["Some text."], { cursor: { line: 0, ch: 10 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        const press = records.find((record) => record.path === "press:numbered");
        expect(press?.old).toBeNull();
        expect(press?.verdict).toEqual({ pass: true });
        expect(press?.after).toContain("[^1]");
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
