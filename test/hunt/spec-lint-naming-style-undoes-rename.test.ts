import { describe, expect, it } from "vitest";

import { planFootnoteRename } from "../../src/commands/rename-footnote";
import { simulateChanges } from "../../src/editor/insertion-liveness";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: with Preferred footnote naming style set to "numbered",
// should the rename command warn that the next lint will undo a rename to
// a name, or should the lint leave a renamed footnote alone?
//
// What it does now: the user renames [^1] to [^smith]. The rename goes
// through quietly. The next lint, following the naming style, renumbers
// [^smith] straight back to [^1], and the rename is gone.
// What a user might expect: the rename sticks, or the rename says up front
// that the naming style will turn it back into a number.
// Why it is a question and not a bug: the rename planner already does this
// for the apply-prefix sweep (Jason's ruling 2026-08-29: do the lint's
// work up front and say so), but the naming style came later (2026-09-22)
// and the planner does not know it. The lint is doing what the user asked
// for in settings, so which of the two wins, and what the toast should
// say, is Jason's call.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R6.
//
// Source of truth: the ruling of 2026-08-29 (src/commands/rename-footnote.ts,
// the `prefixed` flag) and the naming style setting of 2026-09-22.

/** Rename `oldName` to `newName` in `lines`, then lint the result with the given naming style, and hand back the linted note. */
function renameThenLint(lines: string[], oldName: string, newName: string, naming: "numbered" | "named") {
    const doc = fakeEditor(lines, { wholeDoc: true });
    const plan = planFootnoteRename(doc, oldName, newName);
    expect(plan.kind).toBe("renamed");
    if (plan.kind !== "renamed") return "";
    const renamed = simulateChanges(lines, plan.changes).join("\n");
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, footnoteNaming: naming });
    return lintFootnotes(renamed, lintOptionsFromSettings(plugin, "", renamed));
}

describe("spec question: a rename against the naming style", () => {
    it.fails("naming 'numbered': a rename to a name survives the next lint", () => {
        const after = renameThenLint(["Text[^1] here.", "", "[^1]: Smith 2020"], "1", "smith", "numbered");
        // Today: "Text[^1] here.\n\n[^1]: Smith 2020".
        expect(after).toContain("[^smith]");
    });
});
