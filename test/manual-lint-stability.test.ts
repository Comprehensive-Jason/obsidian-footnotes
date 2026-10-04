import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes } from "../src/linting/linter";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The retired manual sheet "lint stability paranoia" had one fixture and two
// boxes, both of them pure text outcomes: what the lint does to a note
// whose very first line is a definition with a "---" right under it, and
// whether a second run churns. Both move here.
//
// This file replaces both boxes of that sheet, so the sheet was retired
// (2026-09-20).
//
// Heads up, and the reason one test below is marked `it.fails`: the sheet's
// first box was written on 2026-08-10, before the 2026-09-16 ruling about
// setext underlines. A "[^t1]: def" line with "---" directly under it is a
// HEADING to Obsidian, not a definition, so the lint deliberately leaves it
// where it is and the underlined-definition alert speaks instead. The sheet
// still describes the old behaviour, where the definition was moved down.

// The sheet's fixture is the top of the sheet note itself: the definition
// on line 0, a "---" right below it, and prose past the second "---" so a
// lint that minted frontmatter would visibly swallow something.
const FIXTURE = [
    "[^t1]: def",
    "---",
    "text[^t1]",
    "---",
    "prose after the second divider keeps the fixture honest.",
].join("\n");

// the same fixture with the rest of a note under it, the way it really sits
// in the sheet
const FIXTURE_IN_A_NOTE = [
    FIXTURE,
    "",
    "# 21: lint stability paranoia (2026-08-10)",
    "",
    "Settings: all lint rules ON.",
].join("\n");

beforeEach(resetNotices);

describe("a definition on line 1 with a divider under it", () => {

    it("what the code does today: the note comes back untouched", () => {
        expect(lintFootnotes(FIXTURE)).toBe(FIXTURE);
        expect(lintFootnotes(FIXTURE_IN_A_NOTE)).toBe(FIXTURE_IN_A_NOTE);
    });

    it("the underlined-definition alert explains why nothing moved", () => {
        noticeLintAlerts(fakePlugin({}), lintFootnotes(FIXTURE));
        expect(messages()).toContain(
            'This note has a footnote definition that Obsidian reads as a heading because a line of "=" or "-" sits right under it ("[^t1]:"). Put a blank line between the definition and that line.',
        );
    });

    it("the top of the note never becomes frontmatter, and no prose is swallowed", () => {
        // the shape that used to tempt the lint into minting frontmatter:
        // a first line followed by "---". Frontmatter would mean the note
        // now STARTS with "---", and the prose past the second divider
        // would be inside it.
        const out = lintFootnotes(FIXTURE_IN_A_NOTE);
        expect(out.startsWith("---")).toBe(false);
        expect(out).toContain("prose after the second divider keeps the fixture honest.");
    });
});

describe("no churn on a second run", () => {
    it("linting twice returns the same text, so a second save rewrites nothing", () => {
        // "lint on save" runs exactly this function before the write, so a
        // stable second pass is what "saving twice never rewrites" means
        const once = lintFootnotes(FIXTURE_IN_A_NOTE);
        expect(lintFootnotes(once)).toBe(once);
    });

    it("holds with the section heading on as well", () => {
        const options = { sectionHeading: "# Footnotes" };
        const once = lintFootnotes(FIXTURE_IN_A_NOTE, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });
});
