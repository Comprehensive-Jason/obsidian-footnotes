import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";

// BUG (wrong output): a settingsVersion saved as an empty or blank string
// re-runs the one-time heading migration over current settings.
//
// What the user would see: a section heading they deliberately set to
// "**Footnotes**" comes back as "# **Footnotes**" after a restart, and the
// plugin saves that change, so the mangled value is now what is on disk.
// It takes a damaged data.json (a hand edit or a sync merge, the threat
// model loadSettings names) whose version reads "" or " ".
//
// Hunt 2026-10-02, round 4, lens settings. Cluster S3.
//
// Source of truth: bug-mistyped-settings-version-reruns-migration, the
// fixed regression this re-opens through a third door, and loadSettings'
// own comment: "a numeric string is read as its number and anything else
// counts as current". An empty or blank string is not a numeric string.
//
// Severity: low. It takes a damaged settings file, but the change it makes
// is silent and saved.
//
// Cause: Number("") and Number(" ") are both 0, so the version reads as 0
// and the version-1 heading rewrite runs again.

/** A plugin whose saved data is `data`, counting how many times it saves. */
function withSaved(data: unknown): { plugin: FootnotePlugin; saves: () => number } {
    // The real Plugin constructor wants (app, manifest); loadSettings needs neither.
    const plugin = new (FootnotePlugin as unknown as new () => FootnotePlugin)();
    let saveCount = 0;
    plugin.loadData = () => Promise.resolve(data);
    plugin.saveData = () => {
        saveCount++;
        return Promise.resolve();
    };
    return { plugin, saves: () => saveCount };
}

describe("a settingsVersion saved as an empty or blank string", () => {
    for (const version of ["", " "]) {
        it.fails(`version ${JSON.stringify(version)} leaves a deliberate heading alone and writes nothing`, async () => {
            const { plugin, saves } = withSaved({ settingsVersion: version, footnoteSectionHeading: "**Footnotes**" });
            await plugin.loadSettings();
            // Today: "# **Footnotes**", and the change is saved.
            expect(plugin.settings.footnoteSectionHeading).toBe("**Footnotes**");
            expect(saves()).toBe(0);
        });
    }
});
