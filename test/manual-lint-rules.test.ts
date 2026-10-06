import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes, lintRulesAllDisabled } from "../src/linting/linter";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The retired manual sheet "the lint rules, alone and together" used to ask Jason
// to set seven settings combos by hand, run Lint footnotes, and eyeball the
// note against a fence of expected text. That is a pure text outcome, so it
// belongs here instead of in six hours of hand-testing.
//
// This file replaces these boxes of that sheet:
//   A  the all-rules-on fence, the orphan alert naming "3" and "lost",
//      and the second lint changing nothing
//   B  the punctuation-only fence, and the closing-mark box under it
//   C  the move-to-bottom-only fence
//   D  the reindex-only fence
//   E  both E boxes: the all-on fence with orphaned definitions deleted,
//      and the same with reindex turned off
//   F  the all-on fence with named footnotes renumbered
//   G  the all-on fence with the "# Footnotes" section heading
//   H  the half of the box that says the note is untouched (the toast that
//      box also asks about is raised from main.ts and stays on sheet 12)
//   I  both boxes: the definition parked below an indented code chunk, and
//      the second lint changing nothing
//
// What stays on the sheet: the fold-and-caret box under A, which only the
// real editor can show.

// The sheet's one fixture, copied line for line. The fullwidth "。" and
// "？!" are there on purpose: they are the CJK punctuation the reference
// has to hop over.
const FIXTURE = [
    'Beta[^2] alpha[^1], named[^note] end. 中文句子[^j1]。 and mixed wait[^j2]？! Para[^m] cite. Closing marks: "quoted[^q]". **bold[^b]** [linked[^k]](https://theindex.moe).',
    "",
    "[^1]: one",
    "[^2]: two",
    "[^note]: the named one",
    "[^j1]: fullwidth one",
    "[^j2]: fullwidth two",
    "[^m]: first line",
    "    continuation line",
    "",
    "    second paragraph, still the same footnote",
    "[^9]: numbered orphan",
    "[^lost]: named orphan",
    "[^q]: quoted",
    "[^b]: bold",
    "[^k]: linked",
    "",
    "Tail prose keeps the definitions from being at the bottom already.",
].join("\n");

// The lines every combo's fence shares: the definition block in its
// post-lint order. Spelling them out per combo would hide the one line
// that actually differs between two fences.
const NAMED_DEFINITIONS = [
    "[^note]: the named one",
    "[^j1]: fullwidth one",
    "[^j2]: fullwidth two",
    "[^m]: first line",
    "    continuation line",
    "",
    "    second paragraph, still the same footnote",
];

const TAIL = "Tail prose keeps the definitions from being at the bottom already.";

const HOPPED_TEXT_ORIGINAL_NUMBERS =
    'Beta[^2] alpha,[^1] named[^note] end. 中文句子。[^j1] and mixed wait？![^j2] Para[^m] cite. Closing marks: "quoted".[^q] **bold**[^b] [linked](https://theindex.moe).[^k]';
const HOPPED_TEXT_REINDEXED =
    'Beta[^1] alpha,[^2] named[^note] end. 中文句子。[^j1] and mixed wait？![^j2] Para[^m] cite. Closing marks: "quoted".[^q] **bold**[^b] [linked](https://theindex.moe).[^k]';

// "run the lint twice and the second run must change nothing" is what the
// sheet checks by asking for a second Lint footnotes that says "No linting
// needed.". Here it is the same text coming back out.
function lintTwice(options: Parameters<typeof lintFootnotes>[1]): {
    once: string;
    twice: string;
} {
    const once = lintFootnotes(FIXTURE, options);
    return { once, twice: lintFootnotes(once, options) };
}

beforeEach(resetNotices);

describe("section A: every rule on, the defaults", () => {
    const { once, twice } = lintTwice({});

    it("matches the sheet's fence", () => {
        expect(once).toBe(
            [
                HOPPED_TEXT_REINDEXED,
                "",
                TAIL,
                "",
                "[^1]: two",
                "[^2]: one",
                ...NAMED_DEFINITIONS,
                "[^q]: quoted",
                "[^b]: bold",
                "[^k]: linked",
                "[^3]: numbered orphan",
                "[^lost]: named orphan",
            ].join("\n"),
        );
    });

    it("a second lint changes nothing, which is what 'No linting needed.' means", () => {
        expect(twice).toBe(once);
    });

    it("the orphan alert names the RENUMBERED orphan and the named one", () => {
        // the alerts describe the text AFTER the lint, so the kept orphan
        // is "3" by then, not the "9" the fixture was written with
        noticeLintAlerts(fakePlugin({}), once);
        expect(messages()).toContain(
            'This note has 2 footnote definitions nothing references ("[^3]", "[^lost]"). Add their references in the text, or delete the definitions.',
        );
    });
});

describe("section B: punctuation only", () => {
    const options = { moveDefinitionsToBottom: false, reindex: false };

    it("only the references hop: numbers, order, and position are untouched", () => {
        expect(lintFootnotes(FIXTURE, options)).toBe(
            [
                HOPPED_TEXT_ORIGINAL_NUMBERS,
                "",
                "[^1]: one",
                "[^2]: two",
                ...NAMED_DEFINITIONS,
                "[^9]: numbered orphan",
                "[^lost]: named orphan",
                "[^q]: quoted",
                "[^b]: bold",
                "[^k]: linked",
                "",
                TAIL,
            ].join("\n"),
        );
    });

    it("closing marks hop too: a quote, a bold pair, and a link's tail", () => {
        // the 2026-09-09 rule: the reference crosses the closing mark as
        // well as the punctuation, so it ends up outside the quote, outside
        // the "**", and after the link's own full stop
        const text = lintFootnotes(FIXTURE, options).split("\n")[0];
        expect(text).toContain('"quoted".[^q]');
        expect(text).toContain("**bold**[^b]");
        expect(text).toContain("[linked](https://theindex.moe).[^k]");
    });
});

describe("section C: move to bottom only", () => {
    it("the definitions relocate below the tail in their original order, nothing renumbered", () => {
        expect(
            lintFootnotes(FIXTURE, { fixPunctuation: false, reindex: false }),
        ).toBe(
            [
                FIXTURE.split("\n")[0],
                "",
                TAIL,
                "",
                "[^1]: one",
                "[^2]: two",
                ...NAMED_DEFINITIONS,
                "[^9]: numbered orphan",
                "[^lost]: named orphan",
                "[^q]: quoted",
                "[^b]: bold",
                "[^k]: linked",
            ].join("\n"),
        );
    });
});

describe("section D: reindex only", () => {
    it("numbers and definition order flip, the comma stays put, the kept orphan is numbered last", () => {
        expect(
            lintFootnotes(FIXTURE, {
                fixPunctuation: false,
                moveDefinitionsToBottom: false,
            }),
        ).toBe(
            [
                'Beta[^1] alpha[^2], named[^note] end. 中文句子[^j1]。 and mixed wait[^j2]？! Para[^m] cite. Closing marks: "quoted[^q]". **bold[^b]** [linked[^k]](https://theindex.moe).',
                "",
                "[^1]: two",
                "[^2]: one",
                ...NAMED_DEFINITIONS,
                "[^q]: quoted",
                "[^b]: bold",
                "[^k]: linked",
                "[^3]: numbered orphan",
                "[^lost]: named orphan",
                "",
                TAIL,
            ].join("\n"),
        );
    });
});

describe("section E: every rule on, plus deleting orphaned definitions", () => {
    // the sheet's fence: combo A with the two orphan definitions gone and
    // nothing else different
    const WITHOUT_ORPHANS = [
        HOPPED_TEXT_REINDEXED,
        "",
        TAIL,
        "",
        "[^1]: two",
        "[^2]: one",
        ...NAMED_DEFINITIONS,
        "[^q]: quoted",
        "[^b]: bold",
        "[^k]: linked",
    ].join("\n");

    it("both orphans go and nothing else differs from combo A", () => {
        expect(
            lintFootnotes(FIXTURE, {
                removeOrphanedDefinitions: true,
            }),
        ).toBe(WITHOUT_ORPHANS);
    });

    it("with reindex off the orphans still go, only the renumbering stops", () => {
        // deletion has been its own rule since 2026-08-10, so it does not
        // need reindex to run
        expect(
            lintFootnotes(FIXTURE, { reindex: false, removeOrphanedDefinitions: true }),
        ).toBe(
            [
                HOPPED_TEXT_ORIGINAL_NUMBERS,
                "",
                TAIL,
                "",
                "[^1]: one",
                "[^2]: two",
                ...NAMED_DEFINITIONS,
                "[^q]: quoted",
                "[^b]: bold",
                "[^k]: linked",
            ].join("\n"),
        );
    });
});

describe("section F: every rule on, plus renumbering named footnotes", () => {
    it("every footnote becomes a number by appearance order, kept orphans last", () => {
        expect(
            lintFootnotes(FIXTURE, {
                reindexOptions: { renumberNamedFootnotes: true },
            }),
        ).toBe(
            [
                'Beta[^1] alpha,[^2] named[^3] end. 中文句子。[^4] and mixed wait？![^5] Para[^6] cite. Closing marks: "quoted".[^7] **bold**[^8] [linked](https://theindex.moe).[^9]',
                "",
                TAIL,
                "",
                "[^1]: two",
                "[^2]: one",
                "[^3]: the named one",
                "[^4]: fullwidth one",
                "[^5]: fullwidth two",
                "[^6]: first line",
                "    continuation line",
                "",
                "    second paragraph, still the same footnote",
                "[^7]: quoted",
                "[^8]: bold",
                "[^9]: linked",
                "[^10]: numbered orphan",
                "[^11]: named orphan",
            ].join("\n"),
        );
    });
});

describe("section G: every rule on, plus the section heading", () => {
    const options = { sectionHeading: "# Footnotes" };
    const { once, twice } = lintTwice(options);

    it("the definitions gather under a new heading, blank-separated from the tail prose", () => {
        expect(once).toBe(
            [
                HOPPED_TEXT_REINDEXED,
                "",
                TAIL,
                "",
                "# Footnotes",
                "",
                "[^1]: two",
                "[^2]: one",
                ...NAMED_DEFINITIONS,
                "[^q]: quoted",
                "[^b]: bold",
                "[^k]: linked",
                "[^3]: numbered orphan",
                "[^lost]: named orphan",
            ].join("\n"),
        );
    });

    it("a second lint adds no second heading (the 2026-07-17 bug)", () => {
        expect(twice).toBe(once);
        expect(twice.split("\n").filter((line) => line === "# Footnotes")).toHaveLength(1);
    });
});

describe("section H: every rule turned off", () => {
    // the sheet's box also asks about the toast, which is raised from the
    // command in main.ts and from the save trigger; neither is reachable
    // from here, so the toast half stays a hand-check on sheet 12
    const ALL_OFF = {
        lintFixPunctuation: false,
        lintFixLazyDefinitions: false,
        lintMoveToBottom: false,
        lintReindex: false,
        lintApplyPrefix: false,
        enableFootnotePrefix: false,
        lintDeleteOrphanedReferences: false,
        lintDeleteOrphanedDefinitions: false,
        lintMergeDuplicateDefinitions: false,
    };

    it("the plugin knows every rule is off", () => {
        expect(lintRulesAllDisabled(fakePlugin(ALL_OFF))).toBe(true);
    });

    it("the note comes back untouched, character for character", () => {
        expect(
            lintFootnotes(FIXTURE, {
                fixPunctuation: false,
                fixLazyDefinitions: false,
                moveDefinitionsToBottom: false,
                reindex: false,
            }),
        ).toBe(FIXTURE);
    });
});

describe("section I: move to bottom past an indented code chunk", () => {
    // the last line starts with a tab, so it is an indented code block and
    // the "[^89]" in it is dead text. The definition has to be parked BELOW
    // the chunk: parking it above would pull the chunk out of its own block.
    const NOTE = ["[^1]: sees [^1]", "", "# Footnotes", "", "\tcode-shaped[^89]"].join("\n");
    const options = { sectionHeading: "# Footnotes", fixPunctuation: false, reindex: false };
    const once = lintFootnotes(NOTE, options);

    it("the definition is parked below the code chunk, not above it", () => {
        expect(once).toBe(
            ["# Footnotes", "", "\tcode-shaped[^89]", "", "[^1]: sees [^1]"].join("\n"),
        );
    });

    it("a second lint changes nothing", () => {
        expect(lintFootnotes(once, options)).toBe(once);
    });
});
