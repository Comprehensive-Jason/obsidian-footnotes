import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FootnotePlugin from "../src/main";
import { SetFootnotePrefixModal } from "../src/commands/set-footnote-prefix";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";

import { fakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, noticed, resetNotices } from "./helpers/notices";

// Checks lifted off manual sheet 08, "Footnote prefix" (prune of
// 2026-09-20). The sheet's note carries the frontmatter prefix "P-", one
// prefixed footnote, a plain hand-written reference, and a hand-typed
// lowercase prefixed reference.
//
// Replaced here:
//   - "Again right after the new reference chains [^P-3]"
//   - the bare "[^P-]" placeholder refusal, its exact wording, and the
//     sheet's claim that EVERY footnote hotkey behaves the same way
//   - "Toggle the feature OFF: the hotkeys insert plain [^1] / [^]"
//   - the Set footnote prefix modal's two refusals, word for word, with
//     the modal staying open and writing nothing
//   - "The numbered hotkey now inserts [^7.1] ... the P- footnotes are
//     untouched"
//
// Still on the sheet: the modal's prefill (Obsidian's own dialog) and
// whether the command is offered in Reading view (Obsidian's palette).

const NOTE = [
    /* 0 */ "---",
    /* 1 */ "footnote-prefix: P-",
    /* 2 */ "---",
    /* 3 */ "Insert into this sentence. A prefixed one[^P-1] exists, a plain[^tag] waits, and a lowercase[^p-1] sits here.",
    /* 4 */ "",
    /* 5 */ "[^P-1]: the first prefixed footnote",
];

const AFTER_THIS = NOTE[3].indexOf("this") + "this".length;

/** the sheet's settings: the prefix feature on, popup off, no heading */
function settings(enablePrefix: boolean) {
    return {
        insertAtEndOfWord: false,
        enablePopupEditor: false,
        enableFootnotePrefix: enablePrefix,
        enableFootnoteSectionHeading: false,
        footnoteSectionHeading: "",
        enableRemoveBlankLastLines: true,
        lintOnFootnoteCreation: false,
    };
}

function noteEditor(lines: string[], ch: number): FakeEditor {
    return fakeEditor(lines, {
        cursor: { line: 3, ch },
        edits: true,
        wholeDoc: true,
    });
}

describe("sheet 08: inserting under the note's prefix", () => {
    it("the numbered hotkey mints [^P-2], then chains [^P-3] right after it", async () => {
        const doc = noteEditor(NOTE, AFTER_THIS);
        const plugin = fakePlugin(settings(true), doc);
        await insertAutonumFootnote(plugin);
        expect(doc.lines[3]).toContain("Insert into this[^P-2] sentence.");
        expect(doc.lines.at(-1)).toBe("[^P-2]: ");

        // the second press sits directly after the reference the first left
        doc.setCursor({ line: 3, ch: AFTER_THIS + "[^P-2]".length });
        await insertAutonumFootnote(plugin);
        expect(doc.lines[3]).toContain("Insert into this[^P-2][^P-3] sentence.");
        expect(doc.lines.at(-1)).toBe("[^P-3]: ");
    });
});

describe("sheet 08: a press inside the untouched [^P-] placeholder", () => {
    const PLACEHOLDER = [
        "---",
        "footnote-prefix: P-",
        "---",
        "Alpha [^P-] bravo",
    ];
    // strictly inside the brackets, where a name would be typed
    const INSIDE = "Alpha [^P-".length;
    const WORDING =
        "This footnote reference has only the prefix. Type a name after it.";

    beforeEach(resetNotices);

    // every footnote hotkey runs the same caret guards, so all four give
    // the same answer: say what is missing, change nothing, move nothing
    const hotkeys = [
        ["numbered", insertAutonumFootnote],
        ["named", insertNamedFootnote],
        ["inline", insertInlineFootnote],
        ["paste inline", pasteInlineFootnote],
    ] as const;

    for (const [label, press] of hotkeys) {
        it(`the ${label} hotkey asks for a name, keeps the caret put, and writes nothing`, async () => {
            const doc = noteEditor(PLACEHOLDER, INSIDE);
            await press(fakePlugin(settings(true), doc));
            expect(noticed(WORDING)).toBe(true);
            expect(doc.lines).toEqual(PLACEHOLDER);
            expect(doc.cursor).toEqual({ line: 3, ch: INSIDE });
        });
    }
});

describe("sheet 08: the prefix feature turned off", () => {
    beforeEach(resetNotices);

    it("the numbered hotkey falls back to a plain [^1] and the named one to [^]", async () => {
        const numbered = noteEditor(NOTE, AFTER_THIS);
        await insertAutonumFootnote(fakePlugin(settings(false), numbered));
        // the note's own [^P-1] is a NAMED footnote once the prefix is off,
        // so the plain namespace starts again at 1
        expect(numbered.lines[3]).toContain("Insert into this[^1] sentence.");

        const named = noteEditor(NOTE, AFTER_THIS);
        await insertNamedFootnote(fakePlugin(settings(false), named));
        expect(named.lines[3]).toContain("Insert into this[^] sentence.");
    });
});

describe("sheet 08: the Set footnote prefix modal's refusals", () => {
    // The modal's own DOM never renders in a unit test, so its error line
    // is captured instead. What the sheet checks is the wording and that
    // the modal stays open having written nothing.
    function modalUnderTest() {
        const file = new TFile();
        const writes: Record<string, unknown>[] = [];
        const plugin = {
            settings: { enableFootnotePrefix: true },
            app: {
                workspace: { getActiveViewOfType: () => null },
                fileManager: {
                    processFrontMatter: (
                        _file: TFile,
                        edit: (frontmatter: Record<string, unknown>) => void,
                    ) => {
                        const frontmatter: Record<string, unknown> = {};
                        edit(frontmatter);
                        writes.push(frontmatter);
                        return Promise.resolve();
                    },
                },
            },
        } as unknown as FootnotePlugin;
        const modal = new SetFootnotePrefixModal(plugin, file, "P-");
        const problems: (string | null)[] = [];
        Object.assign(modal, {
            showProblem: (problem: string | null) => {
                problems.push(problem);
            },
            close: vi.fn(),
        });
        return {
            modal: modal as unknown as {
                value: string;
                submit(): Promise<void>;
                close: () => void;
            },
            problems,
            writes,
        };
    }

    beforeEach(resetNotices);

    it("a prefix ending in a number is refused, in those words, with nothing written", async () => {
        const { modal, problems, writes } = modalUnderTest();
        modal.value = "10";
        await modal.submit();
        expect(problems).toEqual([
            "The footnote prefix can't end in a number. Its footnotes would be indistinguishable from plain numbered ones.",
        ]);
        expect(modal.close).not.toHaveBeenCalled();
        expect(writes).toEqual([]);
        expect(messages()).toEqual([]);
    });

    for (const bad of ["a b", "a[b", "a#b"]) {
        it(`"${bad}" is refused for its characters, with nothing written`, async () => {
            const { modal, problems, writes } = modalUnderTest();
            modal.value = bad;
            await modal.submit();
            expect(problems).toEqual([
                `The footnote prefix can't contain spaces, backticks, brackets, or "#".`,
            ]);
            expect(modal.close).not.toHaveBeenCalled();
            expect(writes).toEqual([]);
        });
    }
});

describe("sheet 08: a new prefix opens a fresh namespace", () => {
    it("with the property changed to 7., the numbered hotkey mints [^7.1] and leaves the P- footnotes alone", async () => {
        const switched = NOTE.map((line) =>
            line === "footnote-prefix: P-" ? "footnote-prefix: 7." : line,
        );
        const doc = noteEditor(switched, AFTER_THIS);
        await insertAutonumFootnote(fakePlugin(settings(true), doc));
        expect(doc.lines[3]).toContain("Insert into this[^7.1] sentence.");
        // the old namespace is untouched: its reference and its definition
        expect(doc.lines[3]).toContain("[^P-1]");
        expect(doc.lines[3]).toContain("[^p-1]");
        expect(doc.lines[5]).toBe("[^P-1]: the first prefixed footnote");
    });
});
