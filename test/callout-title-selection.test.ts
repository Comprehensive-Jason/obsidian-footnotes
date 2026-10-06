import { describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";

// Converting a selected callout title into a footnote keeps the space after
// the callout's "[!note]" marker. A callout is a quote whose first line
// starts with a "[!type]" marker; the README lists a callout's marker among
// the spots a footnote is never written into, so the reference goes after
// the space, where the title was.
//
// This is the case behind seed 33364060 of test/command-properties.test.ts
// ("converting a selection moves EXACTLY the selected text"). Its oracle,
// attachStart, did not know the callout marker and expected
// "> [!note][^106]"; the plugin was right (hunt 2026-10-06, cycle 3,
// cluster M7).

describe("a selected callout title converted into a footnote", () => {
    it("keeps the space after the callout marker and moves the title into the definition", async () => {
        const lines = ["---", "footnote-prefix: 2~", "---", "> [!note] title", "> [^105]: callout label"];
        const from = { line: 3, ch: 9 };
        const to = { line: 4, ch: 0 };
        const editor = fakeEditor(lines, { cursor: from, selection: { anchor: from, head: to }, edits: true, wholeDoc: true, words: true });
        resetNotices();
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: false,
                    enableFootnoteSectionHeading: false,
                    footnoteSectionHeading: "# Footnotes",
                    enableRemoveBlankLastLines: false,
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    lintOnFootnoteCreation: false,
                },
                editor,
            ),
        );
        expect(editor.lines.join("\n")).toBe("---\nfootnote-prefix: 2~\n---\n> [!note] [^106]\n> [^105]: callout label\n\n[^106]: title");
    });
});
