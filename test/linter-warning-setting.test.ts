import { describe, expect, it } from "vitest";

import FootnotePlugin from "../src/main";
import { DEFAULT_SETTINGS, FootnotePluginSettingTab } from "../src/settings";

// Item 9 of the QOL audit (Jason's hand-test, 2026-08-08): this plugin's
// lint-on-save and the Linter plugin coexist fine UNLESS Linter's own
// footnote rules are enabled too - then both rewrite the same footnotes.
// The Linting settings page therefore leads with a warning row telling
// Linter users to turn those rules off, visible only while the Linter
// plugin is actually enabled.

interface DefinitionNode {
    type?: string;
    name?: string;
    desc?: string;
    items?: DefinitionNode[];
    visible?: () => boolean;
}

function makeTab(withLinter: boolean): FootnotePluginSettingTab {
    const app = {
        plugins: {
            plugins: withLinter ? { "obsidian-linter": {} } : {},
        },
    };
    const plugin = { settings: { ...DEFAULT_SETTINGS } } as unknown as FootnotePlugin;
    const tab = new FootnotePluginSettingTab(app as never, plugin);
    // the mocked PluginSettingTab base has no constructor wiring
    Object.assign(tab, { app, plugin });
    return tab;
}

function lintingPageOf(tab: FootnotePluginSettingTab): DefinitionNode {
    const definitions = tab.getSettingDefinitions() as DefinitionNode[];
    const page = definitions.find(
        (item) => item.type === "page" && item.name === "Linting",
    );
    expect(page).toBeDefined();
    return page as DefinitionNode;
}

describe("Linter-coexistence warning on the Linting page", () => {
    it("is the page's first item and names the conflicting rules", () => {
        const page = lintingPageOf(makeTab(true));
        const first = page.items?.[0];
        expect(first?.name).toBe("Using the Linter plugin?");
        expect(first?.desc).toContain("Turn off Linter's own footnote rules");
        expect(first?.desc).toContain("re-index footnotes");
    });

    it("is visible while the Linter plugin is enabled", () => {
        const first = lintingPageOf(makeTab(true)).items?.[0];
        expect(first?.visible?.()).toBe(true);
    });

    it("is hidden when the Linter plugin is not enabled", () => {
        const first = lintingPageOf(makeTab(false)).items?.[0];
        expect(first?.visible?.()).toBe(false);
    });
});
