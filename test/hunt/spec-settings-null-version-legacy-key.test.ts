import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";

// spec question: when the saved settings version is damaged, should the
// legacy renumbering toggle still decide the naming style?
//
// What it does now: a 0.2.0 settings file carries the old toggle
// renumberNamedFootnotes. If its settingsVersion has been damaged to null
// (a hand edit or a sync merge, the threat model loadSettings names), the
// plugin counts the file as current, skips the step that turns the old
// toggle into the new dropdown, and the user lands on "Keep as written"
// although their toggle was on. The stale key also stays in the file.
// What a user might expect: the 0.3.0-beta.1 release notes say "Your old
// toggle carries over: if it was on, you are on Numbered." Only a file
// from before version 3 can hold that key, so its presence is evidence of
// the file's age.
// Why it is a question and not a bug: loadSettings deliberately reads a
// missing or unreadable version as current, so that a damaged file never
// re-runs a migration over current data (bug-mistyped-settings-version-
// reruns-migration). Letting a legacy key overrule that rule is a design
// choice for Jason.
//
// Hunt 2026-10-02, round 4, lens settings. Cluster S4.
//
// Source of truth: the 0.3.0-beta.1 release notes, quoted above, and
// loadSettings' comment on how it reads the version.

/** A plugin whose saved data is `data`. */
function withSaved(data: unknown): FootnotePlugin {
    // The real Plugin constructor wants (app, manifest); loadSettings needs neither.
    const plugin = new (FootnotePlugin as unknown as new () => FootnotePlugin)();
    plugin.loadData = () => Promise.resolve(data);
    plugin.saveData = () => Promise.resolve();
    return plugin;
}

describe("spec question: a damaged version beside a legacy key", () => {
    it.fails("null settingsVersion + renumberNamedFootnotes: true still lands on Numbered", async () => {
        const plugin = withSaved({ settingsVersion: null, renumberNamedFootnotes: true });
        await plugin.loadSettings();
        // Today: "keep".
        expect(plugin.settings.footnoteNaming).toBe("numbered");
    });
});
