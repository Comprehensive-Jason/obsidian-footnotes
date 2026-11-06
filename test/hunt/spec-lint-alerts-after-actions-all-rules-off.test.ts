import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { deleteFootnote } from "../../src/commands/delete-footnote";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question: with every lint rule switched off, should the 0.3.0
// commands still speak lint alerts?
//
// What it does now: Delete footnote everywhere, both conversions, and the
// carried paste (with Lint on footnote creation off) run the lint alerts
// themselves after they edit. A user who switched every lint rule off still
// gets orphan and duplicate alerts after each of them, here about a stray
// "[^9]" that has nothing to do with the footnote they acted on.
// What a user might expect: linter.ts says "when every rule is off, lint is
// off, and the alerts deliberately stay silent too", and the creation
// trigger was made to honour that (Kimi cycle 2,
// bug-creation-lint-alerts-when-all-rules-off).
// Why it is a question and not a bug: these alerts follow the commands'
// own edits, and the delete's docstring wants them because "a deletion can
// leave something for them to say". Whether "every rule off" silences the
// alerts everywhere, or only around the lint itself, is Jason's call.
//
// Characterization tests (behaviour pinned as they are, 2026-11-05, when the
// spec pins were sorted under Jason's scope rule of 2026-10-07): a user with
// every rule off is rare, and an extra alert loses nothing. They were it.fails
// until then.
//
// Hunt 2026-10-02, round 4, lens settings. Cluster S5.
//
// Source of truth: lintRulesAllDisabled's comment in linter.ts, quoted
// above, and deleteFootnote's docstring.

/** Every lint rule off, and Lint on footnote creation off too. */
const allOff = {
    lintFixPunctuation: false,
    lintFixLazyDefinitions: false,
    lintMoveToBottom: false,
    lintReindex: false,
    lintApplyPrefix: false,
    enableFootnotePrefix: false,
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

describe("lint alerts after the 0.3.0 commands while every lint rule is off", () => {
    it("characterization: Delete footnote everywhere still names an unrelated orphan", async () => {
        const doc = fakeEditor(["a[^1] b", "", "[^1]: one", "[^9]: stray"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 2 },
            selection: { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
        });
        await deleteFootnote(fakePlugin(allOff, doc));
        expect(messages().filter((m) => m.includes("[^9]"))).toHaveLength(1);
    });

    it("characterization: Convert inline to normal still names an unrelated orphan", () => {
        const doc = fakeEditor(["a^[one]", "", "[^9]: stray"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        convertInlineFootnotesToNormal(fakePlugin(allOff, doc), doc);
        expect(messages().filter((m) => m.includes("[^9]"))).toHaveLength(1);
    });
});
