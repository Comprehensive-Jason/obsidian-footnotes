// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); 4 of 7 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { lintFootnotes } from "../../src/linting/linter";

// A `[^x]:` label sitting INSIDE a one-line `%%` comment pair
// ("%% [^1]: x %%") is dead text: Obsidian hides inline comments, so no
// blank line can ever make it a definition. Yet the lazy-definition
// machinery reports it as "one blank line short of working" and the
// fix-lazy rule inserts that blank line - on EVERY lint. The label is
// still dead afterwards (still inside the comment), so the next lint
// inserts another one. With Lint on save, every single save pushes the
// text one line further down the note, forever, and the lazy-definition
// alert fires every time with advice ("Add a blank line above it") that
// can never work.
//
// What the user sees: a note containing `%% [^1]: x %%` grows one stray
// blank line at the top per lint/save, and the alert never clears.
//
// Source of truth: manual sheet 11 ("a mid-line `%%` pairs only within its
// own line"; references inside an inline pair are live, a definition
// inside one is dead - the `%% [^1]: x %%` line is an inline pair, not a
// block opener, because it has two `%%`), plus the lazy-label code's own
// contract in lazyDefinitionLabelLines ("a label inside a `%%` block
// comment is dead text, not a definition one blank line short of working,
// so there is nothing to report and nothing to fix" - the block case is
// skipped, the inline-pair case is not), plus the lint idempotence
// contract of the manual lint-rules and lint-stability tests ("run lint AGAIN - it must say 'No linting
// needed.'").
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (default ON) drives the non-idempotent insertions; the lazy-definition
// alert speaks when it is OFF (and still fires when it is ON, because the
// "fix" never fixes).

const INLINE_LABEL = "%% [^1]: x %%";

describe("a definition label inside an inline %% comment pair", () => {
    beforeEach(resetNotices);

    it("fix-lazy leaves it alone: the label is commented out, not one blank line short", () => {
        expect(fixLazyDefinitions(INLINE_LABEL)).toBe(INLINE_LABEL);
    });

    it("the full lint is idempotent on it (no creeping blank line per run)", () => {
        const once = lintFootnotes(INLINE_LABEL, {});
        expect(once).toBe(INLINE_LABEL);
        expect(lintFootnotes(once, {})).toBe(once);
    });

    it("the lazy-definition alert does not name it (the advice can never work)", () => {
        noticeLintAlerts(fakePlugin({}), INLINE_LABEL);
        expect(messages().some((m) => m.includes("[^1]:"))).toBe(false);
    });

    it("the same shape inside a blockquote is left alone too", () => {
        const quoted = "> %% [^1]: x %%";
        const once = lintFootnotes(quoted, {});
        expect(once).toBe(quoted);
        expect(lintFootnotes(once, {})).toBe(once);
    });

    it("control: an ordinary lazy label still gets its blank line", () => {
        expect(fixLazyDefinitions("para\n[^1]: x")).toBe("para\n\n[^1]: x");
    });

    it("control: a label after a real block closer IS a definition (Jason's verification, sheet 11)", () => {
        const doc = "%%\nhidden\n%% [^1]: x";
        expect(fixLazyDefinitions(doc)).toBe(doc);
    });

    it("control: a single unpaired %% opens a block comment, whose label is dead and untouched", () => {
        const doc = "%% [^1]: x";
        expect(lintFootnotes(doc, {})).toBe(doc);
    });
});
