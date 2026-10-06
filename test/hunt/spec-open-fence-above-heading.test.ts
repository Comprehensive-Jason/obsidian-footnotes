import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { definitionsHoldingTheMoveBack } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// spec question: when a note ends inside an open code fence (a "```" with
// no closing "```"), should the lint still gather a definition under the
// section heading above that fence, or at least say it left it?
//
// What it does now: the note "Text[^c].", "[^c]: def", "## Footnotes",
// "After text", then "```" and "code" with no closing fence. With the
// Section heading setting "## Footnotes", Ctrl+S leaves [^c] above the
// heading, and the move alert says nothing.
// What a user might expect: [^c] moved under "## Footnotes", which sits
// above the open fence and is a safe place for it; or, failing that, the
// move alert naming [^c] (ADR 0002, the lint is never silent about what it
// leaves).
// Why it is a question and not a bug: the move gives up on any note whose
// end sits inside protected text, because a definition added at the end
// would land inside the fence. That guard is deliberate. Whether it should
// also cover a heading above the fence, and whether that refusal needs an
// alert, is Jason's call on a rare shape.
//
// "Protected text" is text the plugin must never edit or read footnotes
// from: code, math, and comments.
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X33.
//
// Origin: pre-existing.
//
// Source of truth: ADR 0002 (never-silent lint); the move rule's guard in
// src/linting/rules/move-footnotes-to-the-bottom.ts (gathered and
// definitionsHoldingTheMoveBack both return early when
// reading.openRegionFrom is set, before looking for the heading).

describe("a definition above the section heading when the note ends in an open fence", () => {
    // Now: the lint leaves "[^c]: def" above the heading, and
    // definitionsHoldingTheMoveBack gives [].
    it.fails("a definition above the heading is gathered under it, or named, when the note ends in an open fence", () => {
        const note = "Text[^c].\n\n[^c]: def\n\n## Footnotes\n\nAfter text\n\n```\ncode";
        const linted = lintFootnotes(note, { sectionHeading: "## Footnotes" });
        const gathered = linted.indexOf("[^c]: def") > linted.indexOf("## Footnotes");
        expect(gathered || definitionsHoldingTheMoveBack(linted).length > 0).toBe(true);
    });
});
