// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { commentedDefinitionNames } from "../../src/linting/rules/remove-orphaned-references";

// A `[^x]:` label that sits BEFORE the `%%` on a block comment's closer
// line is inside the comment: the block runs from its opener through the
// first `%%` on a later line, so everything ahead of that closer is
// comment text, and the definition there is dead. The scanner knows this
// (definitionStartLines starts nothing on that line), and the rules leave
// the line alone. But the commented-definition alert skips EVERY closer
// line outright (`commentBlockCloseAt[i] >= 0` continues), on the reasoning
// that the text AFTER a closer is live - which says nothing about the text
// BEFORE it. So a dead definition the user wrote is neither reported nor
// fixable by any rule, on every lint, silently.
//
// What the user sees: `%%\n[^1]: def %%` renders no footnote (the
// definition is hidden inside the comment), and the lint never tells them
// their definition is commented out. Worse, when the note references
// `[^1]`, the alert they DO get is the missing-definition one ("Write its
// definition or delete the reference") - the wrong advice, since they
// already wrote the definition; it is just hidden.
//
// Source of truth: manual sheet 11 ("a definition inside a `%%` block
// comment is dead"; a block runs "through the next `%%` anywhere"), the
// commented-definition alert's own contract (lint-alerts.ts: definitions
// "written inside a `%%` block comment... the lint names it", Jason's
// ruling A1, 2026-09-15), and ADR-0002 (lint is never silent about
// problems it won't fix). The closer-line skip exists so that a label
// AFTER the closer ("%% [^3]: def", live per Jason's verification
// 2026-09-15) is not falsely reported - the label BEFORE the closer is
// the case that skip over-covers.
//
// Settings involved: none; the commented-definition alert always speaks
// when it has something to say.

describe("a definition label before the closer on a %% comment's closer line", () => {
    beforeEach(resetNotices);

    it("is named by the commented-definition alert (ADR-0002: never silent)", () => {
        expect(commentedDefinitionNames("%%\n[^1]: dead %%\ntail")).toEqual(["1"]);
    });

    it("the lint alert fires for it", () => {
        noticeLintAlerts(fakePlugin({}), "%%\n[^1]: dead %%\ntail");
        expect(messages().some((m) => m.includes("[^1]:"))).toBe(true);
    });

    it("the quoted twin (label before the closer behind a quote marker) is named too", () => {
        expect(commentedDefinitionNames("> %%\n> [^1]: dead %%\n> tail")).toEqual(["1"]);
    });

    it("control: a label AFTER the closer is live and is not reported", () => {
        // Jason's verification 2026-09-15: "%% [^3]: def" renders
        expect(commentedDefinitionNames("%%\nhidden\n%% [^3]: def")).toEqual([]);
    });

    it("control: a label on a comment INTERIOR line is named (the existing behavior)", () => {
        expect(commentedDefinitionNames("%%\n[^1]: dead\ntail\n%%")).toEqual(["1"]);
    });
});
