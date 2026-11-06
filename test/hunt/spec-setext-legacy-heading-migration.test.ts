import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";

// spec question: when the one-time pre-0.2 migration decides whether a saved
// section heading already "looks like a heading", should a setext heading
// count as one?
//
// The value in question is "Footnotes" on one line with "---" under it. In
// CommonMark (section 4.3) that pair IS a heading: a line of text with a run
// of dashes directly beneath it is a setext H2. The migration's test only
// looks at how the value STARTS - a "# " run, or "---", "***", "___" at the
// front - so it sees plain text and prepends "# ".
//
// Reading one, leave it: the value already renders as a heading, so
// migrating it changes what the user sees. "# Footnotes" followed by "---"
// renders as an H1 with a horizontal rule under it, which is a different
// thing from the H2 they had.
//
// Reading two, migrate it anyway: the pre-0.2 setting was a single-line text
// input, so a two-line value could never have been typed there. It can only
// have arrived by a hand edit of data.json or a sync merge, which is outside
// what the migration was written to carry forward, and an extra rule in the
// test costs more than the case is worth.
//
// What the user would see: a heading of their own making gains a "#" and
// turns into an H1 plus a thematic break, once, on the upgrade. Nothing else
// changes, and the value is theirs to edit afterwards.
//
// Hunt: 2026-09-13. Lens: regressions (the one-shot settings migration).
//
// Source of truth: CommonMark 4.3 on setext headings; the pre-0.2 settings
// UI, a single-line text input, which is why this value cannot come from the
// plugin itself; and bug-heading-migration-mangles-deliberate-value, which
// rules that the migration runs exactly once, so whichever way this is
// settled it happens at most one time.

// Characterization tests (behaviour pinned as they are, 2026-11-05, when the
// spec pins were sorted under Jason's scope rule of 2026-10-07): the plugin's
// pre-0.2 settings could not hold a two-line value, so this takes a hand edit
// of its settings file, it happens once, and no note changes. Reading two
// stands. They were it.fails until then.

// the real Plugin constructor wants (app, manifest); these tests only
// exercise loadSettings, so construct without them
function withSaved(data: Record<string, unknown>): FootnotePlugin {
    const plugin = new (FootnotePlugin as unknown as new () => FootnotePlugin)();
    plugin.loadData = () => Promise.resolve(data);
    plugin.saveData = () => Promise.resolve();
    return plugin;
}

describe("a pre-flag setext heading", () => {
    it("characterization: is migrated like plain text, gaining a '# '", () => {
        const plugin = withSaved({ footnoteSectionHeading: "Footnotes\n---" });
        return plugin.loadSettings().then(() => {
            expect(plugin.settings.footnoteSectionHeading).toBe("# Footnotes\n---");
        });
    });

    it("characterization: the same with an '===' underline, which is a setext H1", () => {
        const plugin = withSaved({ footnoteSectionHeading: "Footnotes\n===" });
        return plugin.loadSettings().then(() => {
            expect(plugin.settings.footnoteSectionHeading).toBe("# Footnotes\n===");
        });
    });

    it("control: a value that STARTS with a divider is already left alone", () => {
        const plugin = withSaved({ footnoteSectionHeading: "---\n## Footnotes" });
        return plugin.loadSettings().then(() => {
            expect(plugin.settings.footnoteSectionHeading).toBe("---\n## Footnotes");
        });
    });

    it("control: plain one-line text is what the migration exists for", () => {
        const plugin = withSaved({ footnoteSectionHeading: "Footnotes" });
        return plugin.loadSettings().then(() => {
            expect(plugin.settings.footnoteSectionHeading).toBe("# Footnotes");
        });
    });
});
