import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { DEFAULT_SETTINGS } from "../../src/settings";

// Bug: a saved settings file holding a key named like a property every
// object inherits ("toString", "constructor", "valueOf") stopped the plugin
// from loading at all. Such a key can come from a hand edit or a sync merge,
// the same routes parseSavedSettings already guards against for wrongly
// typed values.
//
// The check "key in FIXED_CHOICES" also finds inherited properties, so for
// "toString" it read Object.prototype.toString, a function, and calling
// .includes on it threw. loadSettings then failed, and onload with it.
// Unknown keys are meant to pass through untouched.
//
// Found by the GLM 5.3 review (2026-11-11); Jason chose to fix it.

function pluginWithSavedData(data: Record<string, unknown>): FootnotePlugin {
    const plugin = new (FootnotePlugin as unknown as new () => FootnotePlugin)();
    plugin.loadData = () => Promise.resolve(data);
    plugin.saveData = () => Promise.resolve();
    return plugin;
}

describe("a saved key named like an inherited property", () => {
    it("a saved \"toString\" key does not stop the plugin loading", async () => {
        const plugin = pluginWithSavedData({ settingsVersion: 3, toString: "merged junk" });
        await plugin.loadSettings();
        expect(plugin.settings.lintReindex).toBe(DEFAULT_SETTINGS.lintReindex);
    });

    it("a saved \"constructor\" key does not either", async () => {
        const plugin = pluginWithSavedData({ settingsVersion: 3, constructor: "merged junk" });
        await plugin.loadSettings();
        expect(plugin.settings.footnotePlacement).toBe(DEFAULT_SETTINGS.footnotePlacement);
    });
});
