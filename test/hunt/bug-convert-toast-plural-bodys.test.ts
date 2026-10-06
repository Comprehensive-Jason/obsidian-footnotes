import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";

// BUG (cosmetic): the toast after converting inline footnotes to normal
// spells the plural of "body" as "bodys".
//
// What the user would see: five inline footnotes, three with the same
// text and two with another, are converted. The toast reads "Converted 5
// inline footnotes into 2 normal footnotes (3 identical bodys merged)."
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V6.
//
// Source of truth: English spelling ("bodies"), and AGENTS.md's rule that
// notices get a real rewrite when their wording is wrong.
//
// Fix (2026-10-06): the toast spells the plural "bodies".

beforeEach(resetNotices);

describe("the merge toast of inline to normal", () => {
    it("the merge toast spells the plural of body", () => {
        const doc = fakeEditor(["a^[s] b^[s] c^[s] d^[t] e^[t]"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
        expect(messages().join("\n")).not.toContain("bodys");
    });
});
