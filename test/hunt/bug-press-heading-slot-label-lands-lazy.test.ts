import { beforeEach, describe, expect, it } from "vitest";

import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { definitionStartLines, findDefinitionBlocks, maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";
import { DEFAULT_SETTINGS, type FootnotePluginSettings } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong output): in a note that has its section heading but no
// definitions yet, a footnote made on the blank line under that heading
// goes wrong.
//
// What the user would see: Section heading is on ("## Notes") and the note
// already has the heading with a blank line under it, but no definitions.
// The caret is on that blank line.
// - A numbered press there is refused with "No footnote was created:
//   footnotes can't go inside code, math, or other protected text.", which
//   is false: the caret is on an ordinary blank line.
// - When that blank line is the note's last line, the press does not make
//   a working footnote either.
// - A paste of "a[^1] b" carrying its definition lands the definition
//   directly under the pasted line, where Obsidian reads it as more of
//   that paragraph: the footnote has no definition in Reading view.
//
// Hunt 2026-10-02, round 4, lens root causes. Cluster O1 (root 1, "the
// append is planned against the note before the edit"). Rounds 1 to 3
// pinned the other branches: the trailing-blank trim
// (bug-press-trailing-empty-line-self-reference,
// bug-paste-trailing-blank-glues-body), the blank line under the last
// definition, and the empty note with a divider heading.
//
// Source of truth: definition-append.ts's own comment ("a line with text
// on it directly below the new definition gets pulled INTO the
// definition"); the lazy-label ruling (a label directly under a paragraph
// line is paragraph text, Reading view 2026-09-09); ADR 0001 (the plugin
// never creates a nested footnote).
//
// Severity: medium. The press is refused with a misleading toast; the
// paste leaves a footnote with no definition.
//
// Cause: with no definitions yet, the definition goes into the blank line
// under the heading, and the reference (or the pasted text) is written at
// the start of that same blank line in the same edit. Both land at one
// offset, the reference first, so the new label ends up directly under the
// reference's line.
//
// The assertions do not fix the shape of the repair. Either no toast
// claims protected text, every new label is a live definition, and no
// definition holds a reference; or nothing changed and a toast that does
// not claim protected text says why.

const PROTECTED = /protected text/;

/** The plugin on its shipped defaults with Section heading "## Notes", the popup off so the caret stays in the note. */
function settings(s: Partial<FootnotePluginSettings> = {}): Partial<FootnotePluginSettings> {
    return {
        ...DEFAULT_SETTINGS,
        enablePopupEditor: false,
        insertAtEndOfWord: false,
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: "## Notes",
        ...s,
    };
}

/** Is every left-margin label in `lines` a live definition (not a lazy line of the paragraph above)? */
function everyLabelLive(lines: string[]): boolean {
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    const labels = lines.map((l, i) => (/^\[\^[^\]]+\]:/.test(l) ? i : -1)).filter((i) => i >= 0);
    return labels.length > 0 && labels.every((i) => starts[i]);
}

/** Does some definition block hold a reference in its text (after its own label)? */
function blockHoldsReference(lines: string[]): boolean {
    return findDefinitionBlocks(lines, scanDocument(lines)).some((b) =>
        lines.slice(b.start, b.end + 1).some((l, k) => {
            const text = k === 0 ? l.replace(/^\[\^[^\]]+\]:/, "") : l;
            return /\[\^[^\]]+\](?!:)/.test(text);
        }),
    );
}

/** The repair this pin accepts (see the header). */
function acceptable(before: string[], after: string[]): boolean {
    if (messages().some((m) => PROTECTED.test(m))) return false;
    if (everyLabelLive(after) && !blockHoldsReference(after)) return true;
    return after.join("\n") === before.join("\n") && messages().length > 0;
}

/** A stand-in for the browser's paste event, holding `text` on the clipboard. */
function clipboardEvent(text = "") {
    const event = {
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData() {},
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a numbered press on the blank line under an existing section heading", () => {
    it.fails("makes a live definition, or refuses without claiming protected text", async () => {
        const lines = ["Intro.", "", "## Notes", "", "More prose."];
        const doc = fakeEditor(lines, { cursor: { line: 3, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(settings(), doc));
        // Today: nothing written, and the protected-text toast.
        expect(acceptable(lines, doc.lines)).toBe(true);
    });

    it.fails("on the trailing blank line under a heading that ends the note", async () => {
        const lines = ["Intro.", "", "## Notes", ""];
        const doc = fakeEditor(lines, { cursor: { line: 3, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(settings(), doc));
        expect(acceptable(lines, doc.lines)).toBe(true);
    });

    it.fails("two carets, one of them on the blank line under the heading", async () => {
        const lines = ["Alpha bravo", "", "## Notes", "", "More prose."];
        const doc = fakeEditor(lines, {
            carets: [
                { line: 0, ch: 5 },
                { line: 3, ch: 0 },
            ],
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(settings(), doc));
        expect(acceptable(lines, doc.lines)).toBe(true);
    });
});

describe("a carried paste on the blank line under an existing section heading", () => {
    it.fails("the carried definition lands live, not glued under the pasted paragraph", () => {
        const lines = ["Intro.", "", "## Notes", "", "More prose."];
        const at = { line: 3, ch: 0 };
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at }, words: true });
        handlePaste(fakePlugin(settings({ carryFootnotesOnCopy: true }), doc), clipboardEvent("a[^1] b\n\n[^1]: one") as never, doc);
        // Today: "[^1]: one" sits directly under "a[^1] b", a lazy line of that paragraph.
        expect(acceptable(lines, doc.lines)).toBe(true);
    });
});
