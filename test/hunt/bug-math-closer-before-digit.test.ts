import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices, noticed } from "../helpers/notices";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ProtectedCreationNotice } from "../../src/editor/insertion-liveness";
import { maskedLineAt } from "../../src/parsing/markdown-scan";

// Jason's manual pass, sheet 11 (2026-09-11): with the caret at "$5 or |$6",
// the numbered key refused with the protected-text toast, claiming the
// reference would complete a math pair. Obsidian disagrees. Ground truth in
// Reading view (2026-09-11): a closing "$" that is immediately followed by
// a digit does not close inline math, so "pay $5 or [^1]$6" is prose with a
// live reference, while "pay $5 or$ 6", "$5 or$x", and "$5 or$." are math.
// The other two halves of the rule were already right: the opener must not
// be followed by a space, and the closer must not be preceded by one; a
// digit BEFORE the opener ("3$x$") is fine.

describe("inline math never closes on a dollar followed by a digit", () => {
    it.each([
        ["pay $5 or [^1]$6 today", false],
        ["pay $5 or$ 6 today", true],
        ["pay $5 or$x today", true],
        ["pay $5 or$. today", true],
        ["a $5x$ b", true],
        ["a $ x$ b", false],
        ["a $x $ b", false],
        ["a 3$x$ b", true],
        ["a $x+y$ b", true],
    ])("%s", (line, isMath) => {
        const masked = maskedLineAt([line], 0);
        expect(masked.includes("\0")).toBe(isMath);
    });

    it("a later dollar can still close what a digit-blocked one could not", () => {
        // the "$6" cannot close, but "$ b" after it can: "5 or [^1]$6 x" is the math content
        const masked = maskedLineAt(["pay $5 or [^1]$6 x$ b"], 0);
        expect(masked).toBe("pay " + "\0".repeat("$5 or [^1]$6 x$".length) + " b");
    });
});

describe("the press at the spot Jason tested", () => {
    it("inserts the reference between the dollars instead of refusing", async () => {
        resetNotices();
        const line = "pay $5 or $6 today";
        const doc = fakeEditor([line], {
            cursor: { line: 0, ch: "pay $5 or ".length },
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin({ insertAtEndOfWord: false, enablePopupEditor: false }, doc));
        expect(noticed(ProtectedCreationNotice)).toBe(false);
        expect(doc.lines[0]).toBe("pay $5 or [^1]$6 today");
    });
});
