import { describe, expect, it } from "vitest";

import { listExistingFootnoteDefinitions } from "../../src/editor/doc-context";
import { fakeEditor } from "../helpers/fake-editor";

// spec question: is a footnote name holding a no-break space (U+00A0) a
// real footnote name?
//
// What it does now: the plugin treats every Unicode space as a space, so
// "[^a b]: def" with a no-break space between "a" and "b" is not a
// definition at all. It is missing from the definition list, creating or
// renaming to such a name is refused, and the lint alerts about it. The
// same goes for the ideographic space (U+3000) used in Chinese and
// Japanese text.
// What a user might expect: micromark-extension-gfm-footnote (run
// 2026-10-02) renders "x[^a b] y" with "[^a b]: def" as a working
// footnote. It refuses only an ordinary space, a tab, and a line ending
// inside a name, so a user who pasted such a name would see it work in
// Reading view while the plugin ignores it.
// Why it is a question and not a bug: Obsidian's own Reading view has not
// been checked, and Obsidian's parser need not agree with micromark here.
// A no-break space in a name is also rare and invisible, so refusing it
// may be the kinder behaviour even if Obsidian accepts it.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G8.
//
// Source of truth: micromark-extension-gfm-footnote as referee, pending a
// Reading-view check in Obsidian. In the plugin, isValidFootnoteName and
// DefinitionStart (src/parsing/footnote-grammar.ts,
// src/parsing/markdown-scan.ts) both use JavaScript's \s, which matches
// every Unicode space.

describe("spec question: a no-break space inside a footnote name", () => {
    it.fails("the NBSP-named definition is listed", () => {
        const name = "a\u00A0b";
        const doc = fakeEditor([`x[^${name}] y`, "", `[^${name}]: def`], { cursor: { line: 0, ch: 3 } });
        // Today: [], the definition is not seen
        expect(listExistingFootnoteDefinitions(doc)).toEqual([name]);
    });
});
