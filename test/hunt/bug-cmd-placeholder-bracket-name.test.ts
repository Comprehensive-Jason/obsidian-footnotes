// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 1 of 2 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { InvalidNameCharacters } from "../../src/parsing/footnote-grammar";
import { noticeCalls } from "../mocks/obsidian";
import { noticed, resetNotices } from "../helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";

// The named flow: first press plants "[^]" with the caret between the
// brackets, the user types a name, the second press creates the definition.
// When the typed name is invalid the press warns with InvalidNameCharacters
// and creates nothing - and that message explicitly lists BRACKETS. But a
// "]" typed into the placeholder makes the fragment invisible to every
// guard: "[^]]" matches no reference pattern (names exclude "]"), and
// emptyReferenceStart's containment scan requires the caret strictly inside
// "[^]" while the caret now sits one past it. The second press falls all the
// way to createFootnoteReference and PLANTS A SECOND "[^]", leaving
// "note [^][^]]": two placeholders and a dangling bracket, no warning.

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

/** Plant "[^]" via a first press, then type `name` at the caret, exactly like typing. */
async function plantAndType(
    doc: FakeEditor,
    plugin: FootnotePlugin,
    name: string,
): Promise<void> {
    await insertNamedFootnote(plugin);
    const { line, ch } = doc.getCursor();
    doc.lines[line] =
        doc.lines[line].slice(0, ch) + name + doc.lines[line].slice(ch);
    doc.setCursor({ line, ch: ch + name.length });
    resetNotices();
}

describe("a bracket typed into the named-footnote placeholder", () => {
    it("']' warns about the invalid name instead of nesting a second placeholder", async () => {
        const doc = sharedFakeEditor(["note "], {
            cursor: { line: 0, ch: 5 },
            edits: true,
            wholeDoc: true,
        });
        const plugin = fakePlugin(doc);
        await plantAndType(doc, plugin, "]");
        await insertNamedFootnote(plugin);
        expect(noticed(InvalidNameCharacters)).toBe(true);
        expect(doc.lines[0]).toBe("note [^]]");
    });

    it("'[' is read as a reference named '[', whose name cannot work (contrast case)", async () => {
        const doc = sharedFakeEditor(["note "], {
            cursor: { line: 0, ch: 5 },
            edits: true,
            wholeDoc: true,
        });
        const plugin = fakePlugin(doc);
        await plantAndType(doc, plugin, "[");
        await insertNamedFootnote(plugin);
        // the fragment "[^[]" is a reference to a footnote named "[" to
        // Obsidian (the note reading, since step 2 of the runtime swap,
        // 2026-10-03; it used to pass for an empty inline footnote), so the
        // press says the name cannot work and nothing is created
        expect(noticeCalls.length).toBeGreaterThan(0);
        expect(doc.lines[0]).toBe("note [^[]");
    });
});
