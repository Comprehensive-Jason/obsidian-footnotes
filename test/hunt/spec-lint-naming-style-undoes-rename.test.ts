import { beforeEach, describe, expect, it } from "vitest";

import { planFootnoteRename, showRenamedNotice } from "../../src/commands/rename-footnote";
import { simulateChanges } from "../../src/editor/insertion-liveness";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS, FootnotePluginSettings } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { PREFIXES } from "../helpers/prefixes";

// Jason's ruling, 2026-11-05: with Preferred footnote naming style set to
// Numbered, a rename to a name goes through and says up front that the next
// lint will number it again. The lint does what the setting asks, so it still
// turns the name back into a number.
//
// The case: the user renames [^1] to [^smith]. Before the ruling the rename
// went through quietly, and the next lint renumbered [^smith] straight back to
// [^1], so the rename was simply gone.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R6.

/** Rename `oldName` to `newName` in `lines` and show the toast, then lint the result. Hands back the linted note. */
function renameThenLint(lines: string[], oldName: string, newName: string, settings: Partial<FootnotePluginSettings>, sweepPrefix?: string) {
    const doc = fakeEditor(lines, { wholeDoc: true });
    const plan = planFootnoteRename(doc, oldName, newName, undefined, { sweepPrefix });
    expect(plan.kind).toBe("renamed");
    if (plan.kind !== "renamed") return "";
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, ...settings });
    showRenamedNotice(plugin, oldName, plan, sweepPrefix);
    const renamed = simulateChanges(lines, plan.changes).join("\n");
    return lintFootnotes(renamed, lintOptionsFromSettings(plugin, "", renamed));
}

const Smith = ["Text[^1] here.", "", "[^1]: Smith 2020"];

beforeEach(resetNotices);

describe("a rename against the Numbered naming style (ruling 2026-11-05)", () => {
    it("says up front that the next lint will number it again, and the lint does", () => {
        const after = renameThenLint(Smith, "1", "smith", { footnoteNaming: "numbered" });
        expect(messages()).toEqual(['Renamed to "[^smith]". Your naming style is Numbered, so the next lint will number it again.']);
        expect(after).toBe(Smith.join("\n"));
    });

    it("control: under Keep as written the rename sticks, and the toast says only what changed", () => {
        const after = renameThenLint(Smith, "1", "smith", { footnoteNaming: "keep" });
        expect(messages()).toEqual(['Renamed "[^1]" to "[^smith]" in 2 places.']);
        expect(after).toContain("[^smith]");
    });

    it("control: with the reindex rule off, nothing numbers it, so nothing warns", () => {
        const after = renameThenLint(Smith, "1", "smith", { footnoteNaming: "numbered", lintReindex: false });
        expect(messages()).toEqual(['Renamed "[^1]" to "[^smith]" in 2 places.']);
        expect(after).toContain("[^smith]");
    });

    it("control: a rename to a number stays a number, so nothing warns", () => {
        renameThenLint(["Text[^a] here.", "", "[^a]: Smith 2020"], "a", "7", { footnoteNaming: "numbered" });
        expect(messages()).toEqual(['Renamed "[^a]" to "[^7]" in 2 places.']);
    });

    for (const prefix of PREFIXES) {
        const armed = { footnoteNaming: "numbered", enableFootnotePrefix: true, lintApplyPrefix: true } as const;
        const note = ["---", `footnote-prefix: ${prefix}`, "---", `Text[^${prefix}1] here.`, "", `[^${prefix}1]: Smith 2020`];

        it(`armed with the prefix, the name gets the prefix and the warning names both (${prefix})`, () => {
            const after = renameThenLint(note, `${prefix}1`, "smith", armed, prefix);
            expect(messages()).toEqual([`Renamed to "[^${prefix}smith]". The note's prefix "${prefix}" was added. Your naming style is Numbered, so the next lint will number it again.`]);
            expect(after).toBe(note.join("\n"));
        });

        it(`armed with the prefix, a number behind it stays a number, so nothing warns (${prefix})`, () => {
            renameThenLint(note, `${prefix}1`, `${prefix}7`, armed, prefix);
            expect(messages()).toEqual([`Renamed "[^${prefix}1]" to "[^${prefix}7]" in 2 places.`]);
        });

        it(`with Apply prefix off, a prefixed number counts as named, so it warns and the lint numbers it (${prefix})`, () => {
            const after = renameThenLint(note, `${prefix}1`, `${prefix}7`, { ...armed, lintApplyPrefix: false });
            expect(messages()).toEqual([`Renamed to "[^${prefix}7]". Your naming style is Numbered, so the next lint will number it again.`]);
            expect(after.split("\n")[3]).toBe("Text[^1] here.");
        });
    }
});
