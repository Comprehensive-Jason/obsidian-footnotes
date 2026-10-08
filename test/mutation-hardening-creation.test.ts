import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { noticeCalls } from "./mocks/obsidian";
import { messages, noticed, resetNotices } from "./helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

import FootnotePlugin from "../src/main";
import {
    createAutonumFootnote,
    createFootnoteReference,
    createMatchingFootnoteDefinition,
    insertInTableCell,
    replaceInTableCell,
} from "../src/commands/create-footnote";
import {
    ProtectedSelectionNotice,
    selectionPressHandled,
    InlineSelectionNotice,
    SelectionCommandNotice,
    SelectionSpanNotice,
} from "../src/commands/selection-footnote";
import {
} from "../src/commands/rename-footnote";
import { ProtectedCreationNotice } from "../src/editor/insertion-liveness";
import { DeadFootnoteNotice } from "../src/editor/notice";
import { TableCellEditor } from "../src/editor/table-cursor";

// Mutation hardening for the creation trio (Stryker re-baseline 2026-08-12:
// create-footnote 50%, rename-footnote 58%, selection-footnote 72%). The
// existing suites pin the happy paths; what survived were the GATES - the
// cell writer's born-dead branches, the isFirstFootnote/prefix/masking
// conditions, the trim-loop boundaries of the selection claim, and the
// rename planner's shift arithmetic and collision scan. Each test below is
// built to diverge from one specific surviving mutant; the trailing comment
// block lists the ones deliberately left alone (popup-only and equivalent).

// the fake's `transactions` is a COUNT here (shared fake), not the raw
// spec list the old local fake kept - assertions below compare against
// numbers accordingly. `scrolls` has no shared-fake equivalent (its
// scrollIntoView is a fixed no-op), so this thin wrapper counts scroll
// calls itself on top of the shared editor.
type FakeDoc = FakeEditor & { scrolls: number };

function fakeEditor(
    lines: string[],
    cursor: EditorPosition = { line: 0, ch: 0 },
    selection?: { anchor: EditorPosition; head: EditorPosition },
): FakeDoc {
    const doc = sharedFakeEditor(lines, {
        cursor,
        selection,
        edits: true,
        wholeDoc: true,
        words: true,
    }) as FakeDoc;
    doc.scrolls = 0;
    // the shared fake's scrollIntoView is already a no-op - just count calls
    doc.scrollIntoView = () => {
        doc.scrolls++;
    };
    return doc;
}

type Settings = FootnotePlugin["settings"];

function fakePlugin(
    doc: FakeDoc,
    settings: Partial<Settings> = {},
): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
            ...settings,
        },
        doc,
    );
}

function fakeCell(text: string, head: number, anchor: number = head) {
    const dispatched: {
        changes?: { from: number; to?: number; insert: string };
        selection?: { anchor: number };
    }[] = [];
    const cell: TableCellEditor = {
        state: {
            doc: { toString: () => text },
            selection: { main: { head, anchor } },
        },
        dispatch: (spec) => {
            dispatched.push(spec);
        },
    };
    return { cell, dispatched };
}

beforeEach(() => {
    resetNotices();
});

const INVALID_PREFIX_NOTICE =
    'No footnote was created: this note\'s footnote-prefix ("10") is invalid. The footnote prefix can\'t end in a number. Its footnotes would be indistinguishable from plain numbered ones.';

// ---------------------------------------------------------------------------
// The shared cell writer (insertInTableCell / replaceInTableCell)
// ---------------------------------------------------------------------------

describe("the table-cell writer's born-dead refusal", () => {
    // L97 MethodExpression, `cellText.slice(to)` -> `cellText`: the simulated
    // cell must drop the REPLACED range. Keeping it re-appends a "$" that
    // pairs around the insertion and kills a perfectly live edit.
    it("simulates the replacement without the text it replaces", () => {
        //                                     0123
        const { cell, dispatched } = fakeCell("$abc", 1);
        expect(replaceInTableCell(cell, "[^1]", 1, 4, 4)).toBe(true);
        expect(dispatched).toEqual([
            { changes: { from: 1, to: 4, insert: "[^1]" }, selection: { anchor: 5 } },
        ]);
    });

    // L99 MethodExpression, `startsWith("^[")` -> `endsWith("^[")`, and
    // L102 ConditionalExpression -> true: a pasted inline footnote whose BODY
    // carries inline code masks to NULs, so the plain-slice branch would
    // refuse it - only the inline-SPAN check accepts it.
    it("accepts an inline footnote whose body carries backticked code", () => {
        const { cell, dispatched } = fakeCell("plain here", 6);
        const text = "^[a `b` c]";
        expect(replaceInTableCell(cell, text, 6, 6, text.length)).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 6, to: 6, insert: text },
                selection: { anchor: 6 + text.length },
            },
        ]);
        expect(noticeCalls).toEqual([]);
    });

    // L102 OptionalChaining (`?.open` -> `.open`) and L102 ConditionalExpression
    // -> true: an inline footnote written into a cell's code span has NO
    // surviving span at all, so the lookup returns null. The original reads
    // through the optional chain and refuses; the mutant dereferences null.
    it("refuses (without throwing) an inline footnote whose whole span is masked", () => {
        const { cell, dispatched } = fakeCell("a `code` b", 3);
        expect(() => replaceInTableCell(cell, "^[x]", 3, 7, 4)).not.toThrow();
        expect(replaceInTableCell(cell, "^[x]", 3, 7, 4)).toBe(false);
        expect(dispatched).toEqual([]);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    // L103 ConditionalExpression -> true, L104 ConditionalExpression -> false
    // (and its BlockStatement/BooleanLiteral siblings): a plain reference the
    // surrounding dollars would swallow must be refused, dispatch nothing,
    // and report false.
    it("refuses a plain reference that the insertion itself would mask", () => {
        //                                     0123456
        const { cell, dispatched } = fakeCell("a $b $c", 5);
        expect(insertInTableCell(cell, fakePlugin(fakeEditor([""])), "[^1]", 4)).toBe(
            false,
        );
        expect(dispatched).toEqual([]);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// createAutonumFootnote
// ---------------------------------------------------------------------------

describe("createAutonumFootnote", () => {
    // L172 BooleanLiteral, `return true` -> `return false`: a refused press
    // is still CONSUMED, so the cascade must not continue past it.
    it("consumes the press when the caret sits in protected text", () => {
        const before = ["```", "code here", "```"];
        const doc = fakeEditor(before, { line: 1, ch: 4 });
        expect(
            createAutonumFootnote("code here", { line: 1, ch: 4 }, fakePlugin(doc), doc),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    // L184 BooleanLiteral, `if (prefix === null) return true` -> `return false`.
    it("consumes the press when the note's footnote-prefix is invalid", () => {
        const doc = fakeEditor(["---", "footnote-prefix: 10", "---", "Alpha"], {
            line: 3,
            ch: 5,
        });
        expect(
            createAutonumFootnote(
                "Alpha",
                { line: 3, ch: 5 },
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
            ),
        ).toBe(true);
        expect(doc.lines).toEqual(["---", "footnote-prefix: 10", "---", "Alpha"]);
        expect(noticed(INVALID_PREFIX_NOTICE)).toBe(true);
    });

    // L188 StringLiteral, `maskedLines().join("\n")` -> `join("")`: gluing the
    // lines together fabricates a "[^9]" across the line break, which the
    // numbering scan would then count.
    it("numbers against the masked lines joined by NEWLINES, not glued", () => {
        const doc = fakeEditor(["a [^", "9] b", "tail"], { line: 2, ch: 4 });
        createAutonumFootnote("tail", { line: 2, ch: 4 }, fakePlugin(doc), doc);
        expect(doc.lines).toEqual(["a [^", "9] b", "tail[^1]", "", "[^1]: "]);
    });

    // L198 ConditionalExpression, `isFirstFootnote` -> true: a blockquote
    // definition ("> [^q]: …", C22) is a definition for the id list but not a
    // top-level block, so the note has definitions while the append still
    // takes the no-blocks path - the one place isFirstFootnote is visible.
    it("counts a blockquote definition as an existing footnote", () => {
        // the blank line keeps "prose" outside the quoted footnote: a plain
        // line directly under a quoted definition is its lazy body in
        // Reading view, where the press refuses to nest (GLM hunt cycle 9,
        // probed 2026-09-16)
        const doc = fakeEditor(["> [^q]: quoted def", "", "prose"], { line: 2, ch: 5 });
        createAutonumFootnote("prose", { line: 2, ch: 5 }, fakePlugin(doc), doc);
        // NOT the note's first footnote (no heading slot), but the label
        // still gets its blank separator: directly under the prose line it
        // would be lazy paragraph text to Obsidian (2026-09-09)
        expect(doc.lines).toEqual([
            "> [^q]: quoted def",
            "",
            "prose[^1]",
            "",
            "[^1]: ",
        ]);
        expect(doc.cursor).toEqual({ line: 4, ch: "[^1]: ".length });
    });

    // The isFirstFootnote twin: with no definition anywhere the blank
    // separator DOES appear (kills the `!== 0` inversion of the same check).
    it("gives the note's first footnote its blank separator", () => {
        const doc = fakeEditor(["prose"], { line: 0, ch: 5 });
        createAutonumFootnote("prose", { line: 0, ch: 5 }, fakePlugin(doc), doc);
        expect(doc.lines).toEqual(["prose[^1]", "", "[^1]: "]);
    });

    // L266 BooleanLiteral, `return true` -> `return false`, plus the
    // ConditionalExpression -> true on the popup gate at L269 (the non-popup
    // path is the one that must run): a reference that would demote the quote
    // and strand its own definition refuses, consumes the press, and edits
    // nothing.
    it("refuses and consumes the press when the insertion would land the reference in dead text", () => {
        // "$5 or [^1]$x" completes an inline-math pair the moment the
        // reference lands (the old fixture, "[^1]" at column 0 of "> $$",
        // no longer strands anything: an unclosed opener is literal text unless a later line of its paragraph closes it (Kimi hunt cycle 3, probed in Reading view 2026-09-16))
        const before = ["$5 or $x tail"];
        const doc = fakeEditor(before, { line: 0, ch: 6 });
        expect(
            createAutonumFootnote("$5 or $x tail", { line: 0, ch: 6 }, fakePlugin(doc), doc),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    // L276 BooleanLiteral, `center` -> false: the jump to the definition
    // scrolls the view centered; a local insert would not.
    it("jumps to the definition centered, in one transaction", () => {
        const doc = fakeEditor(["prose"], { line: 0, ch: 5 });
        expect(
            createAutonumFootnote("prose", { line: 0, ch: 5 }, fakePlugin(doc), doc),
        ).toBe(true);
        expect(doc.transactions).toBe(1);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^1]: ".length });
        expect(doc.scrolls).toBe(1);
    });
});

describe("createAutonumFootnote inside an actively edited table cell", () => {
    // L200 ConditionalExpression -> false (the whole cell branch), L207
    // (`!insertInTableCell(...)` -> unnegated / true), L216-L217
    // ArrayDeclaration -> [], L218 ConditionalExpression -> true, L224
    // BooleanLiteral (center), L226 BooleanLiteral (return): the reference
    // goes through the CELL's editor and the definition through the main one.
    it("writes the reference through the cell and appends the definition to the note", () => {
        const { cell, dispatched } = fakeCell("plain here", 5);
        const doc = fakeEditor(["| plain here |", "| --- |", "| x |"], {
            line: 0,
            ch: 7,
        });
        expect(
            createAutonumFootnote(
                "| plain here |",
                { line: 0, ch: 7 },
                fakePlugin(doc),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 5, to: 5, insert: "[^1]" },
                selection: { anchor: 5 + "[^1]".length },
            },
        ]);
        expect(doc.lines).toEqual([
            "| plain here |",
            "| --- |",
            "| x |",
            "",
            "[^1]: ",
        ]);
        expect(doc.cursor).toEqual({ line: 4, ch: "[^1]: ".length });
        expect(doc.scrolls).toBe(1);
    });

    // L207 ConditionalExpression -> false and L209 BooleanLiteral: the
    // refused-cell contract - a born-dead cell insertion must leave NO
    // orphaned definition behind on the main editor.
    it("appends no definition when the cell insertion is refused", () => {
        const before = ["| a $b $c |", "| --- |", "| x |"];
        //                                       0123456
        const { cell, dispatched } = fakeCell("a $b $c", 5);
        const doc = fakeEditor(before, { line: 0, ch: 7 });
        expect(
            createAutonumFootnote(
                "| a $b $c |",
                { line: 0, ch: 7 },
                fakePlugin(doc),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(doc.lines).toEqual(before);
        expect(doc.transactions).toBe(0);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// createMatchingFootnoteDefinition
// ---------------------------------------------------------------------------

describe("createMatchingFootnoteDefinition", () => {
    // L315 ConditionalExpression, `if (target !== null)` -> `if (true)`: the
    // raw gate passes on a code-spanned reference shape but the masked
    // re-check finds nothing, so the mutant dereferences null.
    it("falls through (not throws) when the raw hit has no masked twin", () => {
        const doc = fakeEditor(["a `[^x]` b"], { line: 0, ch: 4 });
        expect(
            createMatchingFootnoteDefinition(
                "a `[^x]` b",
                { line: 0, ch: 4 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(false);
        expect(doc.lines).toEqual(["a `[^x]` b"]);
    });

    it('a "#" name warns that the preview and sidebar can\'t find it, and creates nothing (2026-09-05)', () => {
        const doc = fakeEditor(["see [^#x] x"], { line: 0, ch: 7 });
        expect(
            createMatchingFootnoteDefinition(
                "see [^#x] x",
                { line: 0, ch: 7 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(true);
        expect(
            noticed(
                '"[^#x]" won\'t work as a footnote. Footnote names can\'t contain spaces, backticks, brackets, or "#".',
            ),
        ).toBe(true);
        expect(doc.lines).toEqual(["see [^#x] x"]);
    });

    // L321 StringLiteral (`includes("`")` -> `includes("")`), L323 StringLiteral
    // ("spaces" -> "") and L325 StringLiteral (the whole message): the exact
    // wording, with the SPACES offender named twice.
    it("names spaces as the offender in the invalid-name warning", () => {
        const doc = fakeEditor(["see [^a b] x"], { line: 0, ch: 7 });
        expect(
            createMatchingFootnoteDefinition(
                "see [^a b] x",
                { line: 0, ch: 7 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(true);
        expect(
            noticed(
                '"[^a b]" won\'t work as a footnote. Footnote names can\'t contain spaces, backticks, brackets, or "#".',
            ),
        ).toBe(true);
        expect(doc.lines).toEqual(["see [^a b] x"]);
    });

    // L322 StringLiteral ("backticks" -> "") and L325: the backticked twin.
    it("names backticks as the offender in the invalid-name warning", () => {
        const doc = fakeEditor(["see [^a`b] x"], { line: 0, ch: 7 });
        expect(
            createMatchingFootnoteDefinition(
                "see [^a`b] x",
                { line: 0, ch: 7 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(true);
        expect(
            noticed(
                '"[^a`b]" won\'t work as a footnote. Footnote names can\'t contain spaces, backticks, brackets, or "#".',
            ),
        ).toBe(true);
    });

    // L336 ConditionalExpression, `list.length === 0` -> true: same blockquote
    // definition trick as the autonum command - the note already has one, so
    // no blank separator is added.
    it("counts a blockquote definition when placing the matching definition", () => {
        // the blank line keeps the prose outside the quoted footnote (GLM
        // hunt cycle 9, probed 2026-09-16)
        const doc = fakeEditor(["> [^q]: d", "", "see [^tag] x"], { line: 2, ch: 7 });
        expect(
            createMatchingFootnoteDefinition(
                "see [^tag] x",
                { line: 2, ch: 7 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(true);
        // the blank separator: under the prose line the label would be lazy
        // paragraph text to Obsidian (2026-09-09)
        expect(doc.lines).toEqual(["> [^q]: d", "", "see [^tag] x", "", "[^tag]: "]);
    });

    // L349 BooleanLiteral (`center` -> false) and L357/L359 BooleanLiterals
    // (`return false` -> true): the jump is centered, and a reference that
    // ALREADY has a definition is not this step's press.
    it("jumps to the new definition centered", () => {
        const doc = fakeEditor(["see [^tag] x"], { line: 0, ch: 7 });
        createMatchingFootnoteDefinition(
            "see [^tag] x",
            { line: 0, ch: 7 },
            fakePlugin(doc),
            doc,
        );
        expect(doc.scrolls).toBe(1);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^tag]: ".length });
    });

    it("declines the press when the reference already has a definition", () => {
        const doc = fakeEditor(["see [^tag] x", "", "[^tag]: d"], { line: 0, ch: 7 });
        expect(
            createMatchingFootnoteDefinition(
                "see [^tag] x",
                { line: 0, ch: 7 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(false);
        expect(doc.lines).toEqual(["see [^tag] x", "", "[^tag]: d"]);
    });

    it("declines the press when the caret is on no reference at all", () => {
        const doc = fakeEditor(["plain prose"], { line: 0, ch: 3 });
        expect(
            createMatchingFootnoteDefinition(
                "plain prose",
                { line: 0, ch: 3 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// createFootnoteReference
// ---------------------------------------------------------------------------

describe("createFootnoteReference in a table cell", () => {
    // L383 ConditionalExpression -> false, L389 (`inEmpty === null`, `||`,
    // -> false), L390 (`=== null`), L395 (ObjectLiteral, `inEmpty - …`,
    // `"".length`) and L396 BooleanLiteral: a second press inside a live
    // "[^]" hops the CELL caret past the placeholder instead of nesting.
    it("hops the cell caret out of a live empty placeholder", () => {
        //                                     0123456
        const { cell, dispatched } = fakeCell("a [^] b", 4);
        const doc = fakeEditor(["| a [^] b |"], { line: 0, ch: 5 });
        expect(
            createFootnoteReference(
                "| a [^] b |",
                { line: 0, ch: 5 },
                fakePlugin(doc),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([{ selection: { anchor: 5 } }]);
        expect(doc.lines).toEqual(["| a [^] b |"]);
    });

    // L389 LogicalOperator (`&&` -> `||`) and L389/L390 ConditionalExpression
    // -> true: a "[^]"-shaped fragment inside the cell's inline code is plain
    // text (#41), so there is nothing to hop out of - the protected guard
    // owns the press instead.
    it("does not hop out of a code-spanned placeholder shape", () => {
        const { cell, dispatched } = fakeCell("a `[^]` b", 4);
        const doc = fakeEditor(["| a `[^]` b |"], { line: 0, ch: 5 });
        expect(
            createFootnoteReference(
                "| a `[^]` b |",
                { line: 0, ch: 5 },
                fakePlugin(doc),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    // L399 ConditionalExpression -> false (and its BlockStatement sibling):
    // the protected guard runs BEFORE the prefix resolution, so a protected
    // caret in a note with an invalid prefix gets the protected toast - never
    // the prefix one.
    it("blocks a protected cell caret before it ever reads the prefix", () => {
        const { cell, dispatched } = fakeCell("a `code` b", 5);
        const doc = fakeEditor(
            ["---", "footnote-prefix: 10", "---", "| a `code` b |"],
            { line: 3, ch: 6 },
        );
        expect(
            createFootnoteReference(
                "| a `code` b |",
                { line: 3, ch: 6 },
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });

    // L403 (`if (prefix === null)` -> true / `!== null`) and L407 StringLiteral
    // / ArithmeticOperator: a valid prefix is prefilled into the cell with the
    // caret right after it.
    it("prefills the note's prefix into the cell placeholder", () => {
        const { cell, dispatched } = fakeCell("Alpha", 5);
        const doc = fakeEditor(
            ["---", "footnote-prefix: 7-", "---", "| Alpha |"],
            { line: 3, ch: 7 },
        );
        expect(
            createFootnoteReference(
                "| Alpha |",
                { line: 3, ch: 7 },
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 5, to: 5, insert: "[^7-]" },
                selection: { anchor: 5 + "[^7-".length },
            },
        ]);
    });

    // L403 ConditionalExpression -> false and L403 BooleanLiteral: an invalid
    // prefix blocks the cell insert outright (nothing to clean up) but still
    // consumes the press.
    it("consumes the press and writes nothing on an invalid prefix", () => {
        const { cell, dispatched } = fakeCell("Alpha", 5);
        const doc = fakeEditor(
            ["---", "footnote-prefix: 10", "---", "| Alpha |"],
            { line: 3, ch: 7 },
        );
        expect(
            createFootnoteReference(
                "| Alpha |",
                { line: 3, ch: 7 },
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
                cell,
            ),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(messages()).toEqual([INVALID_PREFIX_NOTICE]);
    });
});

describe("createFootnoteReference in the main editor", () => {
    // L417 (EqualityOperator `inEmpty === null`, ConditionalExpression ->
    // false), L422 BlockStatement, L423 (ObjectLiteral, `inEmpty - …`,
    // `"".length`) and L424 BooleanLiteral: the caret hops past a live "[^]"
    // instead of nesting a second one inside it.
    it("hops the caret out of a live empty placeholder", () => {
        //                       0123456
        const doc = fakeEditor(["a [^] b"], { line: 0, ch: 4 });
        expect(
            createFootnoteReference(
                "a [^] b",
                { line: 0, ch: 4 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(true);
        expect(doc.cursor).toEqual({ line: 0, ch: 5 });
        expect(doc.lines).toEqual(["a [^] b"]);
        expect(doc.transactions).toBe(0);
    });

    // L417 ConditionalExpression -> true: with no placeholder under the caret
    // the hop must NOT fire - the press creates a placeholder instead.
    it("creates a placeholder when there is nothing to hop out of", () => {
        const doc = fakeEditor(["Alpha"], { line: 0, ch: 5 });
        expect(
            createFootnoteReference("Alpha", { line: 0, ch: 5 }, fakePlugin(doc), doc),
        ).toBe(true);
        expect(doc.lines).toEqual(["Alpha[^]"]);
        expect(doc.cursor).toEqual({ line: 0, ch: 7 });
    });

    // L430 ConditionalExpression -> false (and its BooleanLiteral sibling):
    // the protected guard runs before the prefix resolution, so a protected
    // caret never reaches the invalid-prefix toast.
    it("blocks a protected caret before it ever reads the prefix", () => {
        const before = ["---", "footnote-prefix: 10", "---", "```", "code", "```"];
        const doc = fakeEditor(before, { line: 4, ch: 2 });
        expect(
            createFootnoteReference(
                "code",
                { line: 4, ch: 2 },
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
            ),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });

    // L433 BooleanLiteral, `if (prefix === null) return true` -> `return false`.
    it("consumes the press on an invalid prefix", () => {
        const doc = fakeEditor(["---", "footnote-prefix: 10", "---", "Alpha"], {
            line: 3,
            ch: 5,
        });
        expect(
            createFootnoteReference(
                "Alpha",
                { line: 3, ch: 5 },
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
            ),
        ).toBe(true);
        expect(doc.transactions).toBe(0);
        expect(messages()).toEqual([INVALID_PREFIX_NOTICE]);
    });

    // L446 BooleanLiteral, `return true` -> `return false`: a placeholder that
    // would be born masked is refused, and the press is still consumed.
    it("consumes the press when the placeholder would be born dead", () => {
        const before = ["a $b $c"];
        const doc = fakeEditor(before, { line: 0, ch: 5 });
        expect(
            createFootnoteReference(
                "a $b $c",
                { line: 0, ch: 5 },
                fakePlugin(doc),
                doc,
            ),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });

    // L455 BooleanLiteral, the tail `return true` -> `return false`.
    it("reports the ordinary creation press as handled", () => {
        const doc = fakeEditor(["Alpha"], { line: 0, ch: 5 });
        expect(
            createFootnoteReference("Alpha", { line: 0, ch: 5 }, fakePlugin(doc), doc),
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// selectionPressHandled
// ---------------------------------------------------------------------------

describe("the selection notices", () => {
    // L38 / L40 StringLiteral -> "": the existing suite compares the toasts
    // against the exported constants, which a mutated constant satisfies.
    it("read exactly as written", () => {
        expect(SelectionSpanNotice).toBe(
            "Select one continuous stretch of text to turn it into a footnote.",
        );
        expect(SelectionCommandNotice).toBe(
            "To turn the selected text into a footnote, use the numbered, named, or inline footnote command.",
        );
        expect(InlineSelectionNotice).toBe(
            "Inline footnotes are single-line. Use the numbered or named footnote command to convert a multi-line selection.",
        );
    });
});

describe("the cell selection claim", () => {
    // L71 (UpdateOperator `from--`, `while (false)`, `from >= to`) and L72
    // (`while (false)`, UpdateOperator `to++`, `cellText[to + 1]`): both trims
    // shed exactly the whitespace edges and nothing else.
    it("sheds both whitespace edges of a cell selection", () => {
        //                                     0123456789
        const { cell, dispatched } = fakeCell("a  word  b", 1, 9);
        const doc = fakeEditor(["| a  word  b |"], { line: 0, ch: 5 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 1, to: 7, insert: "^[word]" },
                selection: { anchor: 1 + "^[word]".length },
            },
        ]);
    });

    // L71 (`from <= to`, `while (true && …)`), L72 (`to >= from`,
    // `while (true && …)`) and L73 (`if (false)`, `return true`): a
    // whitespace-only cell selection is no selection at all - the boundary
    // mutants all walk an index past its partner and convert anyway.
    it("treats a whitespace-only cell selection as no claim", () => {
        //                                     012345
        const { cell, dispatched } = fakeCell("a     ", 1, 5);
        const doc = fakeEditor(["| a     |"], { line: 0, ch: 4 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(false);
        expect(dispatched).toEqual([]);
    });

    // L74 ConditionalExpression (`|| false`) and StringLiteral (`=== ""`):
    // the PASTE key redirects on a cell selection too (the existing suite
    // only pins the named key).
    it("redirects the paste key on a cell selection", () => {
        const { cell, dispatched } = fakeCell("plain word here", 6, 10);
        const doc = fakeEditor(["| plain word here |"], { line: 0, ch: 8 });
        expect(selectionPressHandled(fakePlugin(doc), doc, cell, "paste")).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(SelectionCommandNotice)).toBe(true);
    });

    // L82 MethodExpression (the `.slice(from, to)` dropped): protected text
    // ELSEWHERE in the cell is none of this selection's business.
    it("converts a clean cell selection even when the cell holds code elsewhere", () => {
        //                                     0123456789
        const { cell, dispatched } = fakeCell("`code` word", 7, 11);
        const doc = fakeEditor(["| `code` word |"], { line: 0, ch: 9 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 6, to: 11, insert: "^[word]" },
                selection: { anchor: 6 + "^[word]".length },
            },
        ]);
    });

    // the caretInsideMaskedSpan edge pair (ConditionalExpression -> false,
    // `||` -> `&&`): a cell selection CUTTING a math span refuses up front -
    // the simulated result would survive precisely because the construct
    // got destroyed. Both edges must be checked: the from-cut and the
    // to-cut each catch a mutant the other leaves alive.
    it("refuses a cell selection whose FROM edge cuts a math span", () => {
        //                                     0123456
        const { cell, dispatched } = fakeCell("a $x$ b", 3, 7);
        const doc = fakeEditor(["| a $x$ b |"], { line: 0, ch: 5 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("refuses a cell selection whose TO edge cuts a math span", () => {
        //                                     0123456
        const { cell, dispatched } = fakeCell("a $x$ b", 0, 4);
        const doc = fakeEditor(["| a $x$ b |"], { line: 0, ch: 2 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    // the containment flip (Jason's ruling 2026-08-19): a span selected
    // WHOLE travels into the footnote - a mutant that refuses on any
    // masked character in the span (the pre-2026-08-19 rule) dies here.
    it("converts a cell selection that swallows a whole math span", () => {
        //                                     0123456
        const { cell, dispatched } = fakeCell("a $x$ b", 2, 5);
        const doc = fakeEditor(["| a $x$ b |"], { line: 0, ch: 4 });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, cell, "inline"),
        ).toBe(true);
        expect(dispatched).toEqual([
            {
                changes: { from: 1, to: 5, insert: "^[$x$]" },
                selection: { anchor: 1 + "^[$x$]".length },
            },
        ]);
    });
});

describe("the main-editor selection claim", () => {
    // L115 (`fromCh <= toCh`, `while (true && …)`) and L117
    // ConditionalExpression -> false: same boundary story as the cell trim.
    it("treats a whitespace-only selection as no claim", () => {
        //                       012345
        const doc = fakeEditor(["a     "], { line: 0, ch: 1 }, {
            anchor: { line: 0, ch: 1 },
            head: { line: 0, ch: 5 },
        });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).toBe(false);
        expect(doc.transactions).toBe(0);
    });

    // the main-editor edge-cut twins: strictly-inside edges refuse up front
    // (the simulated result would survive because the construct got
    // destroyed), while a span selected WHOLE converts - killing both the
    // dropped-edge-check mutants and any regression to the pre-2026-08-19
    // any-masked-character rule.
    it("refuses a selection whose FROM edge cuts a math span", () => {
        const before = ["a $x$ b"];
        const doc = fakeEditor(before, { line: 0, ch: 3 }, {
            anchor: { line: 0, ch: 3 },
            head: { line: 0, ch: 7 },
        });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("refuses a selection whose TO edge cuts a math span", () => {
        const before = ["a $x$ b"];
        const doc = fakeEditor(before, { line: 0, ch: 0 }, {
            anchor: { line: 0, ch: 0 },
            head: { line: 0, ch: 4 },
        });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
    });

    it("converts a selection that swallows a whole math span", () => {
        const doc = fakeEditor(["a $x$ b"], { line: 0, ch: 2 }, {
            anchor: { line: 0, ch: 2 },
            head: { line: 0, ch: 5 },
        });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).toBe(true);
        expect(doc.lines).toEqual(["a^[$x$] b"]);
    });

    // L132 MethodExpression (the `.slice(fromCh, toCh)` dropped): code
    // elsewhere on the line is none of this selection's business.
    it("converts a clean selection on a line that holds code elsewhere", () => {
        const doc = fakeEditor(["`code` word here"], { line: 0, ch: 7 }, {
            anchor: { line: 0, ch: 7 },
            head: { line: 0, ch: 11 },
        });
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).toBe(true);
        expect(doc.lines).toEqual(["`code`^[word] here"]);
    });

    // CONTRACT FLIP (hunt 2026-08-25,
    // bug-mixed-selection-extra-caret-dropped): a real range plus a stray
    // collapsed caret used to convert the selection and silently DISCARD
    // the caret; it now refuses atomically like any other multi-range
    // press. The old filter mutants stay dead elsewhere: dropping the
    // `.filter(…)` turns all-collapsed presses into "multi" (the
    // multi-caret pins fail), and forcing the multi condition true breaks
    // every plain conversion above.
    it("refuses a real selection with a stray collapsed caret alongside", () => {
        const doc = fakeEditor(["alpha beta gamma"], { line: 0, ch: 0 });
        (doc as unknown as { listSelections: () => unknown }).listSelections =
            () => [
                { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
                { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 10 } },
            ];
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).toBe(true);
        expect(doc.lines).toEqual(["alpha beta gamma"]);
        expect(messages()).toContain(SelectionSpanNotice);
    });

    // the trimSelectionEdges line-walk mutants (the `fromCh >= length` hop
    // -> `>`, the `toCh === 0` hop -> `!== 0`, either while -> false): a
    // drag ending at ch 0 two lines down sheds the whole blank tail -
    // converting exactly the first line's core, not a body with trailing
    // blank paragraphs (and never a whitespace text that would throw the
    // conversion off).
    it("sheds a trailing blank line AND the ch-0 overhang from a drag", () => {
        const doc = fakeEditor(
            ["first line", "", "third line"],
            { line: 0, ch: 2 },
            {
                anchor: { line: 0, ch: 2 },
                head: { line: 2, ch: 0 },
            },
        );
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "autonum"),
        ).toBe(true);
        expect(doc.lines).toEqual([
            "fi[^1]",
            "",
            "third line",
            "",
            "[^1]: rst line",
        ]);
    });

    // the leading-edge twin: blank lines and indentation ahead of the text
    // core stay in the prose, so the body's first line starts on content
    it("sheds leading blank lines from a multi-line drag", () => {
        const doc = fakeEditor(
            ["head", "", "  payload text", "tail"],
            { line: 0, ch: 4 },
            {
                anchor: { line: 0, ch: 4 },
                head: { line: 2, ch: 14 },
            },
        );
        expect(
            selectionPressHandled(fakePlugin(doc), doc, null, "autonum"),
        ).toBe(true);
        expect(doc.lines).toEqual([
            "head",
            "",
            "  [^1]",
            "tail",
            "",
            "[^1]: payload text",
        ]);
    });
});

describe("the inline selection conversion", () => {
    // L190 OptionalChaining (`?.open` -> `.open`) and ConditionalExpression
    // -> false: a wrapper planted directly after an escaping backslash is
    // swallowed - the span scanner steps over the escaped caret, so there is
    // no span at all to compare.
    it("refuses (without throwing) a wrapper an escape would swallow", () => {
        const before = ["x\\abc"];
        const doc = fakeEditor(before, { line: 0, ch: 2 }, {
            anchor: { line: 0, ch: 2 },
            head: { line: 0, ch: 5 },
        });
        expect(() =>
            selectionPressHandled(fakePlugin(doc), doc, null, "inline"),
        ).not.toThrow();
        expect(doc.lines).toEqual(before);
        // Expectation changed (ruling 7 of the cycle 6 rulings,
        // 2026-10-08): the gate's reason here is "dead", which has its own
        // notice now. It was the selection's protected-text notice (B27,
        // 2026-09-16), though no code or math is in the way.
        expect(noticed(DeadFootnoteNotice)).toBe(true);
    });
});

describe("the numbered selection conversion", () => {
    // L215 ConditionalExpression, `if (prefix === null) return` -> false: an
    // invalid prefix blocks the conversion outright.
    it("blocks the conversion on an invalid prefix", () => {
        const before = ["---", "footnote-prefix: 10", "---", "The quick fox"];
        const doc = fakeEditor(before, { line: 3, ch: 4 }, {
            anchor: { line: 3, ch: 4 },
            head: { line: 3, ch: 9 },
        });
        expect(
            selectionPressHandled(
                fakePlugin(doc, { enableFootnotePrefix: true }),
                doc,
                null,
                "autonum",
            ),
        ).toBe(true);
        expect(doc.lines).toEqual(before);
        expect(messages()).toEqual([INVALID_PREFIX_NOTICE]);
    });

    // L216 StringLiteral, `maskedLines().join("\n")` -> `join("")`.
    it("numbers against the masked lines joined by NEWLINES", () => {
        const doc = fakeEditor(["a [^", "9] b", "tail word"], { line: 2, ch: 5 }, {
            anchor: { line: 2, ch: 5 },
            head: { line: 2, ch: 9 },
        });
        selectionPressHandled(fakePlugin(doc), doc, null, "autonum");
        expect(doc.lines).toEqual([
            "a [^",
            "9] b",
            "tail[^1]",
            "",
            "[^1]: word",
        ]);
    });

    // L219 ConditionalExpression, `isFirstFootnote` -> true / false, and the
    // `!== 0` inversion: the blockquote definition counts.
    it("counts a blockquote definition as an existing footnote", () => {
        // the blank line keeps the prose outside the quoted footnote (GLM
        // hunt cycle 9, probed 2026-09-16)
        const doc = fakeEditor(["> [^q]: d", "", "tail word"], { line: 2, ch: 5 }, {
            anchor: { line: 2, ch: 5 },
            head: { line: 2, ch: 9 },
        });
        selectionPressHandled(fakePlugin(doc), doc, null, "autonum");
        expect(doc.lines).toEqual(["> [^q]: d", "", "tail[^1]", "", "[^1]: word"]);
    });

    // L267 BooleanLiteral, `center` -> false.
    it("jumps to the seeded definition centered", () => {
        const doc = fakeEditor(["tail word"], { line: 0, ch: 5 }, {
            anchor: { line: 0, ch: 5 },
            head: { line: 0, ch: 9 },
        });
        selectionPressHandled(fakePlugin(doc), doc, null, "autonum");
        expect(doc.scrolls).toBe(1);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^1]: word".length });
    });
});

describe("the numbered cell selection conversion", () => {
    // L286 ConditionalExpression, `if (prefix === null) return` -> false: the
    // cell twin of the invalid-prefix block - and nothing is written to the
    // cell either.
    it("blocks the conversion on an invalid prefix", () => {
        const before = ["---", "footnote-prefix: 10", "---", "| plain word |"];
        const { cell, dispatched } = fakeCell("plain word", 6, 10);
        const doc = fakeEditor(before, { line: 3, ch: 8 });
        selectionPressHandled(
            fakePlugin(doc, { enableFootnotePrefix: true }),
            doc,
            cell,
            "autonum",
            { line: 3, ch: 8 },
        );
        expect(dispatched).toEqual([]);
        expect(doc.lines).toEqual(before);
        expect(messages()).toEqual([INVALID_PREFIX_NOTICE]);
    });

    // L287 StringLiteral, `join("\n")` -> `join("")`.
    it("numbers against the masked lines joined by NEWLINES", () => {
        const { cell, dispatched } = fakeCell("plain word", 6, 10);
        const doc = fakeEditor(["a [^", "9] b", "| plain word |"], {
            line: 2,
            ch: 8,
        });
        selectionPressHandled(fakePlugin(doc), doc, cell, "autonum", {
            line: 2,
            ch: 8,
        });
        expect(dispatched).toEqual([
            {
                changes: { from: 5, to: 10, insert: "[^1]" },
                selection: { anchor: 5 + "[^1]".length },
            },
        ]);
    });

    // L290 ConditionalExpression / EqualityOperator on isFirstFootnote.
    it("counts a blockquote definition as an existing footnote", () => {
        const { cell } = fakeCell("plain word", 6, 10);
        const doc = fakeEditor(["> [^q]: d", "| plain word |"], { line: 1, ch: 8 });
        selectionPressHandled(fakePlugin(doc), doc, cell, "autonum", {
            line: 1,
            ch: 8,
        });
        expect(doc.lines).toEqual([
            "> [^q]: d",
            "| plain word |",
            "",
            "[^1]: word",
        ]);
    });

    // L311 BooleanLiteral, `center` -> false.
    it("jumps to the seeded definition centered", () => {
        const { cell } = fakeCell("plain word", 6, 10);
        const doc = fakeEditor(["| plain word |"], { line: 0, ch: 8 });
        selectionPressHandled(fakePlugin(doc), doc, cell, "autonum", {
            line: 0,
            ch: 8,
        });
        expect(doc.scrolls).toBe(1);
        expect(doc.cursor).toEqual({ line: 2, ch: "[^1]: word".length });
    });
});

// ---------------------------------------------------------------------------
// Popup-only and equivalent mutants deliberately not targeted above - see the
// report accompanying this file for the full list with diffs.
// ---------------------------------------------------------------------------
