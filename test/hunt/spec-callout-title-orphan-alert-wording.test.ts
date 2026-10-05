import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question (UI text): when the lint cannot delete a definition that
// nothing references because it sits on a callout's title line, what
// should the alert say?
//
// What it does now: the note holds "> [!note] [^o]: on the title line"
// over "> callout body", and nothing references [^o]. With Delete
// orphaned definitions on, the lint leaves the definition in place, and
// the alert says deleting it "would change how the lines around it are
// read, or cut a comment's closer". There is no comment in the note.
// What a user might expect: a reason that names the callout's title
// line, where the definition sits.
// Why it is a question and not a bug: the definition is left in place,
// which is safe, and the first half of the reason is true in a general
// way. Which words fit is Jason's call; offer drafts.
//
// Hunt 2026-10-05, round 1, lens containers. Cluster CN6.
//
// Source of truth: the orphan alert's own text in lint-alerts.ts, and
// the promise that an alert names the reason the lint left something in
// place.

beforeEach(resetNotices);

describe("the orphan alert for a definition on a callout's title line", () => {
    it.fails("an orphaned definition on a callout's title line, deletion on: the alert's reason names the title, not a comment's closer", () => {
        const note = ["a b", "", "> [!note] [^o]: on the title line", "> callout body"];
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, lintDeleteOrphanedDefinitions: true }), note.join("\n"));
        const orphan = messages().find((m) => m.includes("nothing references"));
        expect(orphan).toBeDefined();
        // Today: the reason speaks of the lines around it and a comment's closer.
        expect(orphan).toMatch(/title/);
    });
});
