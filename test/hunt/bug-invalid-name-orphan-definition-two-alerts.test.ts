import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A definition nothing references, whose name is one a footnote can't have, such
// as "[^C#]: y".
//
// What the user saw: two alerts with opposite advice in one lint: "Add a "[^C#]"
// reference in the text, or delete the definition." and then "Footnote names can't
// contain spaces, backticks, brackets, or "#"."
//
// Hunt 2026-11-06, cycle 9, finding H17. Severity: annoyance. Origin: pre-existing.
//
// Source of truth: the triage of cycle 9 (one alert, not two), mirroring Jason's
// ruling of 2026-09-20 on a reference with an invalid name, in the comment on
// noticeOrphanedReferences: naming it "would ask the user to write a definition
// that could never bind".

const Invalid = (name: string) => `This note has a footnote with an invalid name ("[^${name}]"). Footnote names can't contain spaces, backticks, brackets, or "#".`;

beforeEach(resetNotices);

describe("an orphaned definition with an invalid name", () => {
    it.each(["C#", "`b`"])("[^%s]: only the invalid-name alert speaks", (name) => {
        noticeLintAlerts(fakePlugin(DEFAULT_SETTINGS), `text\n\n[^${name}]: y`);
        expect(messages()).toEqual([Invalid(name)]);
    });

    it("a valid orphan beside it is told alone, and the invalid one is not called what deleting it also takes", () => {
        noticeLintAlerts(fakePlugin(DEFAULT_SETTINGS), "text\n\n[^ok]: x\n\n[^C#]: y");
        expect(messages()).toEqual([
            'This note has a footnote definition nothing references ("[^ok]"). Add a "[^ok]" reference in the text, or delete the definition.',
            Invalid("C#"),
        ]);
    });

    it("control: a definition with an invalid name that only an orphan cites is still what deleting the orphan takes", () => {
        noticeLintAlerts(fakePlugin(DEFAULT_SETTINGS), "text\n\n[^ok]: x[^C#]\n\n[^C#]: y");
        expect(messages()[0]).toBe(
            'This note has a footnote definition nothing references ("[^ok]"), and deleting it also takes "[^C#]", which only it cites. Add a "[^ok]" reference in the text, or delete the definition.',
        );
    });
});
