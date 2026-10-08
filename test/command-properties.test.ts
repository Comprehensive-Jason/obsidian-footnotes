import { readNote } from "../src/parsing/note-reading";
import { underlinedDefinitionLabelNames } from "../src/linting/rules/remove-orphaned-references";
import { lazyDefinitionLabelNames } from "../src/linting/rules/remove-orphaned-references";
import { Editor, EditorChange, EditorPosition } from "obsidian";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { docArb } from "./arbitraries";
import { noticeCalls } from "./mocks/obsidian";
import { resetNotices } from "./helpers/notices";
import { fakeEditor as fakeMultiEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import FootnotePlugin from "../src/main";
import { simulateChanges } from "../src/editor/insertion-liveness";
import { judgeEdit } from "../src/editor/result-gate";
import { planDefinitionAppend } from "../src/commands/definition-append";
import {
    InlineSelectionNotice,
    SelectionCommandNotice,
    SelectionSpanNotice,
} from "../src/commands/selection-footnote";
import { computeNextFootnoteNumber, footnoteNameProblem } from "../src/parsing/footnote-grammar";

import { definitionLabelWithName } from "../src/parsing/label-shapes";
import { docContext } from "../src/editor/doc-context";
import { endOfWordForSelection, startOfWordOffset } from "../src/editor/cursor-motion";
import { planFootnoteRename } from "../src/commands/rename-footnote";
import { sanitizeInlineFootnoteContent } from "../src/commands/inline-footnotes";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { orphanedFootnoteDefinitionNames } from "../src/linting/rules/remove-orphaned-definitions";
import { orphanedFootnoteReferenceNames } from "../src/linting/rules/remove-orphaned-references";
import { normalizeEol } from "../src/parsing/line-edits";

// Property tests for the CREATION COMMANDS (2026-08-12, Jason's ask):
// the same document generator that fuzzes the lint transforms drives the
// four real command entry points against a transaction-APPLYING fake
// editor, at randomly generated caret positions and settings. What the
// transform properties are to the rules, these are to the press cascade.
// Out of scope by construction (smoke territory): the popup editor, table
// cell sub-editors, and Reading view - the fake has no `cm` and no modes.

fc.configureGlobal({ numRuns: Number(process.env.FC_NUM_RUNS ?? 200) });
const SOAK_TIMEOUT = Math.max(30_000, Number(process.env.FC_NUM_RUNS ?? 200) * 60);
const soakIt = (name: string, fn: () => void | Promise<void>) =>
    { it(name, fn, SOAK_TIMEOUT); };

// ---------- a fake editor that APPLIES its transactions ----------

interface PressDoc extends Editor {
    lines: string[];
    cursor: EditorPosition;
}

// every change in one transaction addresses the ORIGINAL document
// (CodeMirror semantics - the commands rely on this for the
// reference+definition+prepend bundles). Applied through the production
// simulator: this harness used to carry its own back-to-front splice, the
// exact algorithm insertion-liveness dropped on 2026-08-25 because it
// resolves a tied replace's `to` against the already-mutated string and
// drops a character of the tied insert (test/hunt/bug-simulate-changes-
// tie-drops-text) - so every conversion property was judged against a
// document CodeMirror would never produce (review D1, 2026-09-09)

function pressEditor(
    lines: string[],
    cursor: EditorPosition,
    // a live selection for the conversion properties (issue #35); the
    // caret-press properties leave it collapsed
    selection?: { anchor: EditorPosition; head: EditorPosition },
): PressDoc {
    const doc = {
        lines: lines.slice(),
        cursor,
        getCursor: () => doc.cursor,
        listSelections: () =>
            selection ? [selection] : [{ anchor: doc.cursor, head: doc.cursor }],
        getLine: (n: number) => doc.lines[n],
        getValue: () => doc.lines.join("\n"),
        lineCount: () => doc.lines.length,
        lastLine: () => doc.lines.length - 1,
        setCursor(pos: EditorPosition) {
            doc.cursor = pos;
        },
        // the end-of-word setting reads Editor.wordAt - a word-char run
        // around the caret, or null (unit harnesses kept the setting off
        // and never needed it; the press generator varies it)
        wordAt(pos: EditorPosition) {
            const line = doc.lines[pos.line] ?? "";
            const isWord = (c: string | undefined) =>
                !!c && /[\p{L}\p{N}_]/u.test(c);
            let start = pos.ch;
            if (!isWord(line[start]) && isWord(line[start - 1])) start--;
            if (!isWord(line[start])) return null;
            let end = start;
            while (isWord(line[start - 1])) start--;
            while (isWord(line[end])) end++;
            return {
                from: { line: pos.line, ch: start },
                to: { line: pos.line, ch: end },
            };
        },
        scrollIntoView() {},
        transaction(spec: {
            changes?: EditorChange[];
            selection?: { from: EditorPosition };
        }) {
            if (spec.changes) doc.lines = simulateChanges(doc.lines, spec.changes);
            if (spec.selection) doc.cursor = spec.selection.from;
        },
    };
    return doc as unknown as PressDoc;
}

interface PressSettings {
    insertAtEndOfWord: boolean;
    enableFootnoteSectionHeading: boolean;
    enableRemoveBlankLastLines: boolean;
}

function fakePlugin(doc: PressDoc, settings: PressSettings): FootnotePlugin {
    return sharedFakePlugin(
        {
            ...settings,
            footnoteSectionHeading: "# Footnotes",
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

// ---------- the generated press ----------

const COMMANDS = {
    autonum: insertAutonumFootnote,
    named: insertNamedFootnote,
    inline: insertInlineFootnote,
    paste: pasteInlineFootnote,
} as const;
type CommandName = keyof typeof COMMANDS;

const settingsArb: fc.Arbitrary<PressSettings> = fc.record({
    insertAtEndOfWord: fc.boolean(),
    enableFootnoteSectionHeading: fc.boolean(),
    enableRemoveBlankLastLines: fc.boolean(),
});

// a doc, a caret somewhere inside it (line/ch picked by modulo so shrinking
// stays meaningful), a command, and the settings that shape insertion
const pressArb = fc
    .tuple(
        docArb,
        fc.nat(1000),
        fc.nat(1000),
        fc.constantFrom<CommandName>("autonum", "named", "inline", "paste"),
        settingsArb,
    )
    .map(([doc, linePick, chPick, command, settings]) => {
        // the editor layer is always LF - EOL round-tripping belongs to the
        // file layer the transform properties cover
        const lines = normalizeEol(doc).text.split("\n");
        const line = linePick % lines.length;
        const ch = chPick % (lines[line].length + 1);
        return { lines, cursor: { line, ch }, command, settings };
    });

async function press(
    lines: string[],
    cursor: EditorPosition,
    command: CommandName,
    settings: PressSettings,
): Promise<PressDoc> {
    const doc = pressEditor(lines, cursor);
    await COMMANDS[command](fakePlugin(doc, settings));
    return doc;
}

// ---------- counting helpers ----------

// RAW reference-shaped substrings ("[^name]", labels included), counted
// context-free: a press can legitimately RECLASSIFY surrounding markdown
// exactly like typing would (inserting at a heading's column 0 demotes it,
// filling the blank line above an indented chunk makes the chunk a lazy
// continuation), so masked counts can jump in ways no contract can bound -
// but the raw shapes the press physically ADDS to the text are exact.
const RawReferenceShape = /\[\^[^[\]\n]+\]/g;

function rawShapeCount(lines: string[]): number {
    return lines.join("\n").match(RawReferenceShape)?.length ?? 0;
}

/** Every reference-shaped name in the raw text, folded - live, masked, escaped, or label. */
function rawNamesFolded(lines: string[]): Set<string> {
    const names = new Set<string>();
    for (const match of lines.join("\n").matchAll(RawReferenceShape)) {
        names.add(match[0].slice(2, -1).toLowerCase());
    }
    return names;
}

// raw shapes each command's cascade may physically add: nothing (guard/
// toast/hop/navigation), a definition label for a definition-less
// reference (every command via its navigate step), or - autonum only - a
// reference AND its label together
const ALLOWED_SHAPE_DELTAS: Record<CommandName, number[]> = {
    autonum: [0, 1, 2],
    named: [0, 1],
    inline: [0, 1],
    paste: [0, 1],
};

// the paste command reads THIS on every press - the invariant properties
// keep the benign default so their contracts stay tight, and the dedicated
// hostile-clipboard property swaps in generated strings per run
let clipboardText = "generated clipboard text";
beforeAll(() => {
    vi.stubGlobal("navigator", {
        clipboard: { readText: () => Promise.resolve(clipboardText) },
    });
});
afterAll(() => {
    vi.unstubAllGlobals();
});

// ---------- typed content (Jason's ask 2026-08-12: fuzz the INSIDES) ----------

/** Splice `text` at the caret, exactly like typing - the caret rides to the end of it. */
function typeText(doc: PressDoc, text: string) {
    const { line, ch } = doc.cursor;
    const current = doc.lines[line];
    doc.lines[line] = current.slice(0, ch) + text + current.slice(ch);
    doc.cursor = { line, ch: ch + text.length };
}

/** Whether the press just planted `placeholder` with the caret sitting one short of its closing bracket ("[^]" for named, "^[]" for inline). */
function plantedPlaceholder(doc: PressDoc, placeholder: string): boolean {
    const line = doc.lines[doc.cursor.line] ?? "";
    return (
        line.slice(doc.cursor.ch - 2, doc.cursor.ch + 1) === placeholder
    );
}

/** Every name the note defines, folded, wherever the definition sits (Jason's ruling 1, option a, 2026-10-03: a definition the press's edit pulls into a list item is still one). */
function definitionNamesFolded(lines: string[]): Set<string> {
    return new Set(readNote(lines).definitions.map((definition) => definition.name.toLowerCase()));
}

/** The names on label-shaped lines that are lazy prose today (or heading text under an underline): a press that fills the blank line above such a label can lawfully turn it into a definition, exactly as typing there would. */
function promotableLabelNamesFolded(lines: string[]): Set<string> {
    return new Set(
        [
            ...lazyDefinitionLabelNames(lines),
            ...underlinedDefinitionLabelNames(lines),
        ].map((name) => name.toLowerCase()),
    );
}

// names a user might type into the "[^]" placeholder: pool names that
// collide with the generator's own definitions (case variants included),
// fresh names the document has never seen, deliberately INVALID names
// (spaces, backticks - warned about, never created), and random word-ish
// strings
const typedNameArb = fc.oneof(
    fc.constantFrom("note", "Note", "9", "a$1", "ch-2", "x"),
    fc.constantFrom("fresh", "Fresh-Name", "注釈", "x.y", "$start"),
    fc.constantFrom("bad name", "tick`name", "#tag", "a#b"),
    fc
        .string({ minLength: 1, maxLength: 12 })
        .map((s) => s.replace(/[[\]\s`\\^$\n\r]/g, ""))
        .filter((s) => s.length > 0),
);

// bodies a user might type after the label / between inline brackets -
// bracketless random text plus a few deliberate balanced-bracket shapes
// (dollars and backslashes excluded here: a stray "$" pairing with later
// line text or a trailing "\" changes the SURROUNDING structure, which is
// the swallow-guards' territory, not the typing flow's)
const typedBodyArb = fc.oneof(
    fc.constantFrom(
        "a quick aside",
        "see [link](https://example.org) for more",
        "中文注释内容",
        "",
    ),
    fc
        .string({ maxLength: 24 })
        .map((s) => s.replace(/[[\]`\\^$\n\r]/g, " ").trim()),
);

describe("creation-command invariants over random documents", () => {
    soakIt("a press never throws and never loses a protected line", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                const protectedBefore = readNote(lines).protectedLines;
                const doc = await press(lines, cursor, command, settings);
                // multiset conservation, like the lint property: protected
                // text is never edited, only ever shifted whole
                const counts = new Map<string, number>();
                for (const line of doc.lines) {
                    counts.set(line, (counts.get(line) ?? 0) + 1);
                }
                for (let i = 0; i < lines.length; i++) {
                    if (!protectedBefore[i]) continue;
                    const left = counts.get(lines[i]) ?? 0;
                    expect(
                        left,
                        `protected line lost: ${JSON.stringify(lines[i])}`,
                    ).toBeGreaterThan(0);
                    counts.set(lines[i], left - 1);
                }
            }),
        );
    });

    soakIt("a press with the caret on a protected line edits nothing", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                if (!readNote(lines).protectedLines[cursor.line]) return;
                const doc = await press(lines, cursor, command, settings);
                // the CURSOR may still move: a protected math/comment
                // interior can be a definition block's continuation, and
                // jumping back to the reference from there is by design
                expect(doc.lines.join("\n")).toBe(lines.join("\n"));
            }),
        );
    });

    // Jason's block-syntax ruling (2026-10-03): a press never writes into the
    // block syntax at the start of a line (quote and list markers, task
    // boxes, a heading's marks, thematic breaks, setext underlines), since
    // that would un-list an item, drop a line out of its quote, or turn a
    // heading back into prose. Inside a definition the nesting guard refuses
    // instead, so those lines are left to it.
    soakIt("a press with the caret in a line's block syntax edits nothing", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                const reading = readNote(lines);
                if (cursor.ch >= reading.blockSyntaxEnd(cursor.line) || reading.definitionAt(cursor.line) !== null) return;
                const doc = await press(lines, cursor, command, settings);
                expect(doc.lines.join("\n")).toBe(lines.join("\n"));
            }),
        );
    });

    soakIt("raw-shape deltas stay inside each command's contract", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                const shapesBefore = rawShapeCount(lines);
                // a caret strictly inside an existing raw shape (an escaped
                // "\[^80]" is lifeless text no guard owns) lets the
                // insertion SPLIT that shape - one extra allowed -1
                let insideShape = false;
                for (const match of lines[cursor.line].matchAll(RawReferenceShape)) {
                    const start = match.index;
                    if (cursor.ch > start && cursor.ch < start + match[0].length) {
                        insideShape = true;
                    }
                }
                const doc = await press(lines, cursor, command, settings);
                const delta = rawShapeCount(doc.lines) - shapesBefore;
                const allowed = insideShape
                    ? [
                          ...ALLOWED_SHAPE_DELTAS[command],
                          ...ALLOWED_SHAPE_DELTAS[command].map((d) => d - 1),
                      ]
                    : ALLOWED_SHAPE_DELTAS[command];
                expect(
                    allowed,
                    `${command} produced raw-shape delta ${delta}`,
                ).toContain(delta);
            }),
        );
    });

    soakIt("a press never mints an orphan of ITS OWN making", async () => {
        // reclassifying pre-existing text is a text editor's reality (see
        // rawShapeCount) - but any orphaned reference or definition whose
        // name did not exist ANYWHERE in the raw before-text must have been
        // created dead by the press itself (the escaped-"[^N]" and
        // "^"-swallowed insertion bugs this suite caught)
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                const namesBefore = rawNamesFolded(lines);
                const doc = await press(lines, cursor, command, settings);
                const after = doc.lines.join("\n");
                for (const name of orphanedFootnoteReferenceNames(after)) {
                    expect(
                        namesBefore.has(name.toLowerCase()),
                        `press minted dead reference [^${name}]`,
                    ).toBe(true);
                }
                for (const name of orphanedFootnoteDefinitionNames(after)) {
                    expect(
                        namesBefore.has(name.toLowerCase()),
                        `press minted orphaned definition [^${name}]:`,
                    ).toBe(true);
                }
            }),
        );
    });

    soakIt("the FULL NAMED FLOW: plant, type a name, re-press, type the definition", async () => {
        await fc.assert(
            fc.asyncProperty(
                pressArb,
                typedNameArb,
                typedBodyArb,
                async ({ lines, cursor, settings }, name, body) => {
                    const doc = pressEditor(lines, cursor);
                    const plugin = fakePlugin(doc, settings);
                    await insertNamedFootnote(plugin);
                    // the press may have warned/hopped/navigated instead -
                    // only a planted "[^]" starts the typing flow
                    if (!plantedPlaceholder(doc, "[^]")) return;
                    // A plant on a setext underline line ("===" under a
                    // one-line paragraph) or in front of a quote marker
                    // changes how the lines around it are read (the heading
                    // above turns back into prose; the quoted line leaves
                    // its quote), which can drop the typed reference into a
                    // quoted definition's continuation. Where such a press
                    // should land is an open ruling (2026-09-16), so the
                    // flow is not judged there.
                    const pressedLine = lines[cursor.line] ?? "";
                    if (
                        /^(?: {0,3}> ?)* {0,3}(=+|-+) *$/.test(pressedLine) ||
                        (/^ {0,3}>/.test(pressedLine) && cursor.ch <= pressedLine.indexOf(">"))
                    ) {
                        return;
                    }

                    typeText(doc, name);
                    // A name that completes an autolink around the
                    // placeholder ("<[^a@b]ftp:x>" holds an "@", so the
                    // angle brackets become an email autolink) is dead
                    // text the moment it is typed, and so is one that
                    // closes a math block over it ("$$[^x]" on a math
                    // block's last line is no closer to Obsidian, so the
                    // block runs on and takes the reference and any
                    // definition appended after it). The press rightly
                    // creates nothing for it, so the flow is not judged
                    // there: the typed reference must be live to the note
                    // reading.
                    {
                        const at = doc.getCursor().line;
                        if (!readNote(doc.lines).referencesOn(at).some((o) => o.name.toLowerCase() === name.toLowerCase())) {
                            return;
                        }
                    }
                    const definitionsBefore = definitionNamesFolded(doc.lines);
                    // A placeholder planted on the blank line right under a
                    // definition and then named turns that line into the
                    // definition's lazy continuation (Reading view, GLM hunt
                    // cycle 1, 2026-09-16), so the second press now sits
                    // inside a definition and refuses to nest: no new
                    // definition is the right outcome there.
                    const typedLine = doc.getCursor().line;
                    const typedStarts = readNote(doc.lines).labelLines;
                    // a quoted definition's lines and any label line count
                    // too (the guard knows them since cycle 3, 2026-09-16)
                    const insideDefinition =
                        readNote(doc.lines).blocks.some(
                            (block) => typedLine >= block.start && typedLine <= block.end,
                        ) ||
                        typedStarts[typedLine] ||
                        readNote(doc.lines).definitionAt(typedLine) !== null;
                    await insertNamedFootnote(plugin);
                    const folded = name.toLowerCase();
                    const definitionsAfter = definitionNamesFolded(doc.lines);
                    if (insideDefinition) {
                        expect([...definitionsAfter].sort()).toEqual(
                            [...definitionsBefore].sort(),
                        );
                        return;
                    }

                    if (footnoteNameProblem(name) !== null) {
                        // spaces/backticks/"#": warned about, nothing
                        // created (the creation rule, stricter than the
                        // render rule - "#" renders but is refused,
                        // 2026-09-05)
                        expect([...definitionsAfter].sort()).toEqual(
                            [...definitionsBefore].sort(),
                        );
                        return;
                    }
                    if (definitionsBefore.has(folded)) {
                        // an existing definition (any casing) means the
                        // second press NAVIGATES - no duplicate is created
                        expect([...definitionsAfter].sort()).toEqual(
                            [...definitionsBefore].sort(),
                        );
                        return;
                    }
                    // fresh valid name: its definition now exists, and the
                    // caret sits at the label's end - type the body there
                    expect(definitionsAfter.has(folded)).toBe(true);
                    typeText(doc, body);
                    const after = doc.lines.join("\n");
                    expect(after).toContain(`[^${name}]: ${body}`);
                    // the flow ends with a WHOLE footnote: reference and
                    // definition alive, neither orphaned
                    const fold = (n: string) => n.toLowerCase();
                    expect(
                        orphanedFootnoteReferenceNames(after).map(fold),
                    ).not.toContain(folded);
                    expect(
                        orphanedFootnoteDefinitionNames(after).map(fold),
                    ).not.toContain(folded);
                },
            ),
        );
    });

    soakIt("the FULL INLINE FLOW: plant, type the body, re-press hops out (or warns while empty)", async () => {
        await fc.assert(
            fc.asyncProperty(
                pressArb,
                typedBodyArb,
                async ({ lines, cursor, settings }, body) => {
                    const doc = pressEditor(lines, cursor);
                    const plugin = fakePlugin(doc, settings);
                    await insertInlineFootnote(plugin);
                    if (!plantedPlaceholder(doc, "^[]")) return;

                    typeText(doc, body);
                    const afterTyping = doc.lines.join("\n");
                    const caretAfterTyping = { ...doc.cursor };
                    // A typed body can break the wrapper the way typing it
                    // by hand would: a "|" typed into a table row splits the
                    // cell, so "^[" and "]" land in different cells and
                    // Obsidian reads no inline footnote there (the note
                    // reading follows it since step 2 of the runtime swap,
                    // 2026-10-03). The flow is not judged then.
                    if (readNote(doc.lines).inlineNoteAt(caretAfterTyping.line, caretAfterTyping.ch) === null) return;
                    await insertInlineFootnote(plugin);
                    // the second press never edits - it hops (filled) or
                    // warns and stays (empty)
                    expect(doc.lines.join("\n")).toBe(afterTyping);
                    if (body === "") {
                        expect(doc.cursor).toEqual(caretAfterTyping);
                    } else {
                        // hop lands just past the closing bracket:
                        // "^[" + body + "]" ends one past the typed text
                        expect(doc.cursor).toEqual({
                            line: caretAfterTyping.line,
                            ch: caretAfterTyping.ch + 1,
                        });
                        expect(
                            doc.lines[caretAfterTyping.line],
                        ).toContain(`^[${body}]`);
                    }
                },
            ),
        );
    });

    soakIt("paste survives ARBITRARY clipboard content end to end", async () => {
        await fc.assert(
            fc.asyncProperty(
                pressArb,
                // multi-line, tabbed, CJK, padded clipboards too - bare
                // fc.string never produces a newline (review D7)
                fc.oneof(
                    { weight: 3, arbitrary: fc.string({ maxLength: 40, unit: "grapheme" }) },
                    {
                        weight: 1,
                        arbitrary: fc.constantFrom("a\r\nb", "x\ny\n\nz", "tab\there", "  padded  ", "中文\n第二行"),
                    },
                ),
                async ({ lines, cursor, settings }, clip) => {
                    clipboardText = clip;
                    try {
                        const doc = await press(lines, cursor, "paste", settings);
                        const before = lines.join("\n");
                        const after = doc.lines.join("\n");
                        if (after === before) return; // guard/warn/empty path
                        const content = sanitizeInlineFootnoteContent(clip);
                        const inserted = `^[${content}]`;
                        const count = (text: string) =>
                            text.split(inserted).length - 1;
                        if (content !== "" && count(after) === count(before) + 1) {
                            // the pasted inline footnote must CLOSE where the
                            // sanitizer promised - an unbalanced clipboard
                            // that escaped sanitizing would run away here
                            const at = doc.lines.findIndex(
                                (l, i) => l !== lines[i] && l.includes(inserted),
                            );
                            expect(at).not.toBe(-1);
                            const start = doc.lines[at].indexOf(inserted);
                            const span = readNote(doc.lines).inlineNoteAt(at, start + 1);
                            expect(span).not.toBeNull();
                            if (span?.open === start) {
                                expect(span.close).toBe(
                                    start + inserted.length - 1,
                                );
                            }
                        } else {
                            // the only other edit paste makes: creating the
                            // definition for a definition-less reference
                            // under the caret (navigate step)
                            expect(
                                definitionNamesFolded(doc.lines).size,
                            ).toBeGreaterThan(
                                definitionNamesFolded(lines).size,
                            );
                        }
                    } finally {
                        clipboardText = "generated clipboard text";
                    }
                },
            ),
        );
    });

    // ---------- selection conversion (issue #35 / multi-line 2026-08-19) ----------

    // a random selection: single-line half the time, spanning up to four
    // lines otherwise, possibly reversed, possibly empty or whitespace-only
    // (both fall through to the caret cascade)
    const selectionPressArb = fc
        .tuple(
            docArb,
            fc.nat(1000),
            fc.nat(1000),
            fc.nat(30),
            fc.nat(1000),
            fc.nat(4),
            fc.boolean(),
            settingsArb,
        )
        .map(
            ([doc, linePick, chPick, lenPick, chPick2, linesDown, reversed, settings]) => {
                const lines = normalizeEol(doc).text.split("\n");
                const line = linePick % lines.length;
                const a = chPick % (lines[line].length + 1);
                const toLine = Math.min(line + linesDown, lines.length - 1);
                const b =
                    toLine === line
                        ? Math.min(a + (lenPick % 25), lines[line].length)
                        : chPick2 % (lines[toLine].length + 1);
                const from = { line, ch: a };
                const to = { line: toLine, ch: b };
                const [anchor, head] = reversed ? [to, from] : [from, to];
                return {
                    lines,
                    span: { from, to },
                    selection: { anchor, head },
                    settings,
                };
            },
        );

    // ---- an INDEPENDENT reading of the conversion rules ----
    // Written from the README and sheet 04, not from the production
    // functions, so the oracle cannot agree with a bug in trimSelectionEdges,
    // absorbLeadingSpace, or indentDefinitionBody by construction (review
    // D6, 2026-09-09: the property used to call all three).

    /** Offset of a position within the LF-joined document. */
    function offsetAt(lines: string[], pos: EditorPosition): number {
        let offset = 0;
        for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
        return offset + pos.ch;
    }

    /** The position of an offset within the LF-joined document. */
    function positionAt(lines: string[], offset: number): EditorPosition {
        let line = 0;
        let rest = offset;
        while (line < lines.length - 1 && rest > lines[line].length) {
            rest -= lines[line].length + 1;
            line++;
        }
        return { line, ch: rest };
    }

    /**
     * Rule: the selection converts its non-whitespace core; whitespace at
     * either edge stays behind, line breaks included, so a drag that ends
     * at the start of the next line converts the dragged line only.
     * Nothing but whitespace means no selection to convert.
     */
    function trimmedSpan(
        lines: string[],
        from: EditorPosition,
        to: EditorPosition,
    ): { from: EditorPosition; to: EditorPosition } | null {
        const text = lines.join("\n");
        let start = offsetAt(lines, from);
        let end = offsetAt(lines, to);
        while (start < end && /\s/.test(text[start])) start++;
        while (end > start && /\s/.test(text[end - 1])) end--;
        if (start >= end) return null;
        return { from: positionAt(lines, start), to: positionAt(lines, end) };
    }

    /**
     * Rule: a reference attaches to the text before it, so the spaces
     * between that text and the selection go with the replacement - unless
     * what precedes them is a list, task, or heading marker, a quote
     * marker, a callout's "[!type]" marker after its quote markers, a
     * table pipe, or nothing at all.
     */
    function attachStart(line: string, ch: number): number {
        let start = ch;
        while (start > 0 && (line[start - 1] === " " || line[start - 1] === "\t")) start--;
        if (start === ch) return ch;
        const before = line.slice(0, start);
        if (before === "") return ch;
        if (before.endsWith("|")) return ch;
        // A ">" counts as a quote marker only when everything before it is
        // more quote markers or list or task markers ("> >", "- >",
        // "> - [ ] >"). A ">" that closes an HTML comment ("-->") or a tag
        // ("<b>"), or ends a word ("x >"), is text the reference attaches
        // to (hunt 2026-10-06, cycle 4, test defect T1, seeds 2653,
        // -123456789, and 1167636531).
        if (/^(?:\s*>|\s*(?:[-*+]|\d+[.)])(?:\s+\[.\])?\s)*\s*>$/.test(before)) return ch;
        const marker = before.trim().replace(/^(?:>\s*)+/, "");
        if (/^(?:[-*+]|\d+[.)])(?: \[[ xX]\])?$/.test(marker)) return ch;
        if (/^#{1,6}$/.test(marker)) return ch;
        // A callout's "[!note]" (with an optional "+" or "-" that sets it
        // folded or open) is a marker too, so the space after it stays on
        // the line: the README lists a callout's marker among the spots a
        // footnote is never written into (hunt 2026-10-06, cycle 3,
        // cluster M7, seed 33364060).
        if (/^\s*>/.test(before) && /^\[![^\]\s]+\][+-]?$/.test(marker)) return ch;
        return start;
    }

    /** Rule: the body's first line rides the label; every later line is indented four spaces, blank lines becoming exactly four spaces. */
    function bodyOf(text: string): string {
        return text
            .split("\n")
            .map((line, i) => (i === 0 ? line : line.trim() === "" ? "    " : `    ${line}`))
            .join("\n");
    }

    /**
     * Rule: a list item's line selected whole converts the item's text, not
     * the line. The bullet, number, or task box stays on the line and holds
     * the reference ("- [^1]"), so the span that moves starts after them.
     * A span that is anything else comes back as it is. (Jason's ruling
     * Q27, 2026-10-08, which the rulings job extended to numbered and task
     * items; hunt 2026-10-08 cycle 7, test defect Y13, seeds 1729, 577215,
     * and 662607, where this property still expected the whole line.)
     */
    function wholeItemToItsText(
        lines: string[],
        span: { from: EditorPosition; to: EditorPosition } | null,
    ): { from: EditorPosition; to: EditorPosition } | null {
        if (span === null || span.from.line !== span.to.line) return span;
        const line = lines[span.from.line];
        if (line.slice(0, span.from.ch).trim() !== "" || line.slice(span.to.ch).trim() !== "") return span;
        // The item's marker: a bullet or a number with "." or ")", then
        // an optional task box, then the gap before the item's text.
        const marker = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[.\])?[ \t]+(?=\S)/.exec(line.slice(span.from.ch));
        if (marker === null) return span;
        // Only a line that really starts a list item counts; a line inside
        // code or a lazy line that only looks like one is left alone.
        const blocks = readNote(lines).lineBlocks[span.from.line] ?? "";
        if (!blocks.split(" ").includes("^listItem")) return span;
        return { from: { line: span.from.line, ch: span.from.ch + marker[0].length }, to: span.to };
    }

    /** The LF-joined text of `[from, to)`. */
    function spanText(
        lines: string[],
        from: EditorPosition,
        to: EditorPosition,
    ): string {
        if (from.line === to.line) {
            return lines[from.line].slice(from.ch, to.ch);
        }
        return [
            lines[from.line].slice(from.ch),
            ...lines.slice(from.line + 1, to.line),
            lines[to.line].slice(0, to.ch),
        ].join("\n");
    }

    soakIt("converting a selection moves EXACTLY the selected text", async () => {
        await fc.assert(
            fc.asyncProperty(
                selectionPressArb,
                fc.constantFrom<CommandName>("autonum", "inline"),
                async ({ lines, span, selection, settings }, command) => {
                    const trimmed = wholeItemToItsText(lines, trimmedSpan(lines, span.from, span.to));
                    const protectedBefore = readNote(lines).protectedLines;
                    resetNotices();
                    const doc = pressEditor(lines, span.from, selection);
                    await COMMANDS[command](fakePlugin(doc, settings));
                    const unchanged =
                        doc.lines.join("\n") === lines.join("\n");
                    // the inline key never converts a line-spanning
                    // selection (Jason's revert of the flatten, 2026-08-20)
                    // - it refuses with its own notice and edits nothing
                    if (
                        command === "inline" &&
                        trimmed !== null &&
                        trimmed.from.line !== trimmed.to.line
                    ) {
                        expect(unchanged).toBe(true);
                        expect(
                            noticeCalls.some(
                                (args) => args[0] === InlineSelectionNotice,
                            ),
                        ).toBe(true);
                        return;
                    }
                    // protected text is never LOST, converted or not: a
                    // refusal (or fallthrough) conserves every protected
                    // line verbatim; an autonum conversion may carry
                    // protected lines the selection contained WHOLE into
                    // the definition body, four-space-indented (2026-08-19).
                    // (The inline key is single-line-only, so it can never
                    // legitimately move a protected line - a regression
                    // would fail the exact-conservation branch.)
                    const strictlyInside = (i: number) =>
                        trimmed !== null &&
                        (i > trimmed.from.line ||
                            (i === trimmed.from.line && trimmed.from.ch === 0)) &&
                        (i < trimmed.to.line ||
                            (i === trimmed.to.line &&
                                trimmed.to.ch === lines[i].length));
                    const counts = new Map<string, number>();
                    for (const line of doc.lines) {
                        counts.set(line, (counts.get(line) ?? 0) + 1);
                    }
                    for (let i = 0; i < lines.length; i++) {
                        if (!protectedBefore[i]) continue;
                        if (
                            !unchanged &&
                            trimmed !== null &&
                            command !== "inline" &&
                            strictlyInside(i)
                        ) {
                            // a fence opener never shares the label line:
                            // the conversion starts such a body on the line
                            // after the label, so even the first selected
                            // line arrives indented (2026-09-09)
                            const opensFence = /^ {0,3}(?:`{3,}|~{3,})/.test(
                                lines[trimmed.from.line].slice(trimmed.from.ch),
                            );
                            const firstLine = lines[trimmed.from.line].slice(trimmed.from.ch);
                            const carried =
                                i === trimmed.from.line
                                    ? opensFence
                                        ? `    ${firstLine}`
                                        : firstLine
                                    : `    ${lines[i]}`;
                            expect(
                                doc.lines.join("\n"),
                                `contained protected line lost: ${JSON.stringify(lines[i])}`,
                            ).toContain(carried);
                            continue;
                        }
                        const left = counts.get(lines[i]) ?? 0;
                        expect(
                            left,
                            `protected line lost: ${JSON.stringify(lines[i])}`,
                        ).toBeGreaterThan(0);
                        counts.set(lines[i], left - 1);
                    }
                    // an empty/whitespace-only selection falls through to
                    // the caret cascade - the other properties own that
                    if (trimmed === null) return;
                    if (unchanged) {
                        // a refusal always explains itself
                        expect(noticeCalls.length).toBeGreaterThan(0);
                        return;
                    }
                    // converted: the boundary lines keep their prefix and
                    // suffix (stitched onto ONE line), and ONLY the trimmed
                    // span became the footnote. Lines inserted ABOVE the
                    // selection (a definition appended after a mid-document
                    // block, the phantom-frontmatter prepend) shift the
                    // converted line down - search the whole possible shift
                    // window, and require the middle to PARSE as the
                    // conversion (an empty prefix+suffix would otherwise
                    // let any line match).
                    // the reference attaches to the text before the
                    // selection: the whitespace run in front of it is
                    // replaced too (absorbLeadingSpace, 2026-09-08)
                    const prefix = lines[trimmed.from.line].slice(
                        0,
                        attachStart(lines[trimmed.from.line], trimmed.from.ch),
                    );
                    const suffix = lines[trimmed.to.line].slice(trimmed.to.ch);
                    const selText = spanText(lines, trimmed.from, trimmed.to);
                    const removedLines = trimmed.to.line - trimmed.from.line;
                    const shiftWindow =
                        doc.lines.length - lines.length + removedLines;
                    const converted = (l: string | undefined) => {
                        if (
                            l === undefined ||
                            !l.startsWith(prefix) ||
                            !l.endsWith(suffix) ||
                            l.length < prefix.length + suffix.length
                        ) {
                            return null;
                        }
                        const middle = l.slice(prefix.length, l.length - suffix.length);
                        if (command === "inline") {
                            return middle ===
                                `^[${sanitizeInlineFootnoteContent(selText)}]`
                                ? middle
                                : null;
                        }
                        return /^\[\^([^\]]+)\]$/.test(middle) ? middle : null;
                    };
                    // a candidate line only counts when its OWN definition
                    // carries the seeded body - with an empty prefix and
                    // suffix, a pre-existing bare "[^1]" line sliding into
                    // the window would otherwise satisfy the shape check
                    // (30k-soak oracle bug, 2026-08-20)
                    let found = false;
                    for (let shift = 0; shift <= shiftWindow && !found; shift++) {
                        const middle = converted(doc.lines[trimmed.from.line + shift]);
                        if (middle === null) continue;
                        if (command === "inline") {
                            found = true;
                            break;
                        }
                        const reference = /^\[\^([^\]]+)\]$/.exec(middle);
                        // a fence-first body starts on the line after the
                        // label, every line indented (2026-09-09)
                        const fenceFirst = /^ {0,3}(?:`{3,}|~{3,})/.test(selText.split("\n")[0]);
                        const seeded = fenceFirst ? bodyOf(`\n${selText}`) : bodyOf(selText);
                        found =
                            reference !== null &&
                            doc.lines.join("\n").includes(`[^${reference[1]}]: ${seeded}`);
                    }
                    expect(
                        found,
                        `no line in the shift window converted ${JSON.stringify(selText)}`,
                    ).toBe(true);
                },
            ),
        );
    });

    soakIt("on a selection, paste REDIRECTS and named DEFERS to its modal - neither edits", async () => {
        await fc.assert(
            fc.asyncProperty(
                selectionPressArb,
                fc.constantFrom<CommandName>("named", "paste"),
                async ({ lines, span, selection, settings }, command) => {
                    if (trimmedSpan(lines, span.from, span.to) === null) {
                        return; // falls through to the cascade
                    }
                    resetNotices();
                    const doc = pressEditor(lines, span.from, selection);
                    await COMMANDS[command](fakePlugin(doc, settings));
                    // the press itself never edits: paste explains itself,
                    // named hands off to the name modal (whose submit is
                    // covered by the deterministic pins - units can't
                    // render it)
                    expect(doc.lines.join("\n")).toBe(lines.join("\n"));
                    if (command === "paste") {
                        expect(
                            noticeCalls.some(
                                (args) => args[0] === SelectionCommandNotice,
                            ),
                        ).toBe(true);
                    } else {
                        expect(
                            noticeCalls.some(
                                (args) => args[0] === SelectionCommandNotice,
                            ),
                        ).toBe(false);
                    }
                },
            ),
        );
    });

    soakIt("multiple selection ranges warn and edit nothing (all four keys)", async () => {
        await fc.assert(
            fc.asyncProperty(
                pressArb,
                fc.nat(1000),
                fc.nat(1000),
                async ({ lines, cursor, command, settings }, linePick, chPick) => {
                    // two disjoint non-empty ranges - a stray multi-cursor:
                    // one footnote can't stand in for both, whatever the key
                    const line = linePick % lines.length;
                    const lineText = lines[line];
                    if (lineText.length < 2) return;
                    const cut = 1 + (chPick % (lineText.length - 1));
                    const doc = pressEditor(lines, cursor);
                    (doc as unknown as { listSelections: () => unknown }).listSelections =
                        () => [
                            { anchor: { line, ch: 0 }, head: { line, ch: cut } },
                            {
                                anchor: { line, ch: cut },
                                head: { line, ch: lineText.length },
                            },
                        ];
                    resetNotices();
                    await COMMANDS[command](fakePlugin(doc, settings));
                    expect(doc.lines.join("\n")).toBe(lines.join("\n"));
                    // the paste key never converts a selection, so it gives
                    // its own redirect even here (Jason's report, 2026-09-08);
                    // the converting keys ask for one stretch
                    const expected =
                        command === "paste" ? SelectionCommandNotice : SelectionSpanNotice;
                    expect(noticeCalls.some((args) => args[0] === expected)).toBe(true);
                },
            ),
        );
    });

    soakIt("the autonum press mints exactly the next free number (2026-09-16 hunt)", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                if (command !== "autonum") return;
                const shapesBefore = rawShapeCount(lines);
                const defsBefore = definitionNamesFolded(lines);
                const doc = await press(lines, cursor, command, settings);
                // only a fresh creation adds exactly a reference and its label
                if (rawShapeCount(doc.lines) !== shapesBefore + 2) return;
                const defsAfter = definitionNamesFolded(doc.lines);
                // the minted name is the one whose shape is NEW to the note:
                // a press that fills the blank line under a definition can
                // lawfully promote a lazy label further down into a
                // definition (a label under a definition's lazy line is a
                // definition), and that promoted name is not the minted one
                // (found by the 5000-run soak, 2026-09-20)
                // (a shape that only sat in dead text before, "fake[^1]" in
                // a fence, reserves nothing and CAN be the minted name)
                const promotable = promotableLabelNamesFolded(lines);
                const minted = [...defsAfter].find((name) => !defsBefore.has(name) && !promotable.has(name));
                // the minted name is the next free number over the masked
                // twin: dead text reserves nothing (the #41 rule)
                expect(minted).toBe(String(computeNextFootnoteNumber(lines.join("\n"))));
            }),
        );
    });

    soakIt("two consecutive presses never nest footnote brackets", async () => {
        await fc.assert(
            fc.asyncProperty(
                pressArb,
                fc.constantFrom<CommandName>("autonum", "named", "inline", "paste"),
                async ({ lines, cursor, command, settings }, secondCommand) => {
                    const cleanBefore = !lines.join("\n").includes("[^[^");
                    const doc = await press(lines, cursor, command, settings);
                    // the second press continues from wherever the first
                    // left the caret - the rapid-double-press shape that
                    // produced "[^[^]]" nesting historically
                    await COMMANDS[secondCommand](fakePlugin(doc, settings));
                    if (cleanBefore) {
                        expect(doc.lines.join("\n")).not.toContain("[^[^");
                    }
                },
            ),
        );
    });
});

// ---------- multi-caret presses (added 2026-09-16, hunt) ----------
// The two-caret twin of the single-caret invariants above: same footnote
// at every caret, atomically (one transaction), and inside the same
// raw-shape envelope the single-caret contract implies. The shared fake
// editor (test/helpers/fake-editor.ts) reports the generated carets and
// applies transactions through simulateChanges, exactly like the single
// -caret harness here.

const multiPressArb = fc
    .tuple(
        docArb,
        fc.nat(1000),
        fc.nat(1000),
        fc.nat(1000),
        fc.nat(1000),
        fc.constantFrom<CommandName>("autonum", "named", "inline", "paste"),
        settingsArb,
    )
    .map(([doc, linePick, chPick, linePick2, chPick2, command, settings]) => {
        const lines = normalizeEol(doc).text.split("\n");
        const line = linePick % lines.length;
        const line2 = linePick2 % lines.length;
        return {
            lines,
            carets: [
                { line, ch: chPick % (lines[line].length + 1) },
                { line: line2, ch: chPick2 % (lines[line2].length + 1) },
            ],
            command,
            settings,
        };
    });

// raw shapes a two-caret press may physically add: nothing (guard/toast/
// hop/navigation), a definition label for a definition-less reference
// (every command), or - autonum only - the shared reference at up to two
// carets plus its one label
const ALLOWED_MULTI_DELTAS: Record<CommandName, number[]> = {
    autonum: [0, 1, 2, 3],
    named: [0, 1],
    inline: [0, 1],
    paste: [0, 1],
};

describe("multi-caret press invariants over random documents", () => {
    soakIt("the FULL MULTI-CARET NAMED flow: plant, type the name once, re-press creates the ONE shared definition (2026-09-16 hunt)", async () => {
        await fc.assert(
            fc.asyncProperty(multiPressArb, typedNameArb, async ({ lines, carets, settings }, name) => {
                const plugin0 = sharedFakePlugin(
                    {
                        ...settings,
                        footnoteSectionHeading: "# Footnotes",
                        enablePopupEditor: false,
                        enableFootnotePrefix: false,
                        lintOnFootnoteCreation: false,
                    },
                    undefined,
                );
                const doc = fakeMultiEditor(lines, { carets, edits: true, wholeDoc: true, words: true });
                await insertNamedFootnote(
                    sharedFakePlugin(
                        { ...settings, footnoteSectionHeading: "# Footnotes", enablePopupEditor: false, enableFootnotePrefix: false, lintOnFootnoteCreation: false },
                        doc,
                    ),
                );
                void plugin0;
                // the flow starts only when both carets got a "[^]" with a cursor inside each
                const planted = doc.selections;
                if (!planted || planted.length !== 2) return;
                for (const sel of planted) {
                    const line = doc.lines[sel.from.line] ?? "";
                    if (line.slice(sel.from.ch - 2, sel.from.ch + 1) !== "[^]") return;
                }
                // type the name once: CodeMirror repeats it at every cursor
                const typedLines = simulateChanges(
                    doc.lines,
                    planted.map((sel) => ({ from: sel.from, text: name })),
                );
                // each caret rides to the end of its own typed name; when both
                // sit on one line the earlier insertion shifts the later one
                const sameLine = planted[0].from.line === planted[1].from.line;
                const newCarets = sameLine
                    ? planted[0].from.ch < planted[1].from.ch
                        ? [
                              { line: planted[0].from.line, ch: planted[0].from.ch + name.length },
                              { line: planted[1].from.line, ch: planted[1].from.ch + 2 * name.length },
                          ]
                        : [
                              { line: planted[1].from.line, ch: planted[1].from.ch + name.length },
                              { line: planted[0].from.line, ch: planted[0].from.ch + 2 * name.length },
                          ]
                    : planted.map((sel) => ({ line: sel.from.line, ch: sel.from.ch + name.length }));
                const doc2 = fakeMultiEditor(typedLines, { carets: newCarets, edits: true, wholeDoc: true, words: true });
                // typing the placeholder can itself reclassify a neighbour
                // (a lone "[^name]" is a paragraph line, so a label directly
                // under it goes lazy) - that is legitimate, exactly like
                // typing the text by hand, and outside the press's contract
                const defsTyped = definitionNamesFolded(typedLines);
                if ([...defsTyped].sort().join() !== [...definitionNamesFolded(lines)].sort().join()) {
                    return;
                }
                // a name typed on the line right under a definition turns
                // that line into the definition's lazy continuation (Reading
                // view, 2026-09-16), so the second press sits inside a
                // definition and refuses to nest: no shared definition then
                // a quoted definition (label line and quoted continuation
                // lines) and any other definition label line count as well:
                // the guard refuses there since cycle 3 (2026-09-16)
                const typedStarts = readNote(typedLines).labelLines;
                const typedInsideDefinition =
                    readNote(typedLines).blocks.some((block) =>
                        newCarets.some((caret) => caret.line >= block.start && caret.line <= block.end),
                    ) ||
                    newCarets.some(
                        (caret) =>
                            typedStarts[caret.line] ||
                            readNote(typedLines).definitionAt(caret.line) !== null,
                    );
                // A caret in front of a quote marker (column 0 of "> ===")
                // plants the reference outside the quote and un-quotes the
                // line, which can turn the line above into a quoted
                // definition's lazy continuation; where such a press should
                // land is an open ruling (2026-09-16), so the flow is not
                // judged there.
                if (planted.some((sel) => /^ {0,3}>/.test(doc.lines[sel.from.line] ?? "") && sel.from.ch - 2 <= (doc.lines[sel.from.line] ?? "").indexOf(">"))) {
                    return;
                }
                await insertNamedFootnote(
                    sharedFakePlugin(
                        { ...settings, footnoteSectionHeading: "# Footnotes", enablePopupEditor: false, enableFootnotePrefix: false, lintOnFootnoteCreation: false },
                        doc2,
                    ),
                );
                const defsAfter = definitionNamesFolded(doc2.lines);
                if (footnoteNameProblem(name) !== null || typedInsideDefinition) {
                    // spaces/backticks/"#": warned about, nothing created;
                    // likewise a name typed inside a definition
                    expect([...defsAfter].sort()).toEqual([...defsTyped].sort());
                    return;
                }
                if (defsTyped.has(name.toLowerCase())) {
                    // the name already works: the second press navigates or refuses, no duplicate
                    expect([...defsAfter].sort()).toEqual([...defsTyped].sort());
                    return;
                }
                // A typed name can make one of the two references dead text:
                // "$" typed into "[^]$[^]5" pairs with the dollar between the
                // two placeholders into inline math, which takes the second
                // reference in (Obsidian's parser reads the "$" first; the
                // note reading follows it since step 2 of the runtime swap,
                // 2026-10-03). The second press then refuses, as for any
                // reference that would be born dead, and edits nothing.
                const liveTyped = readNote(typedLines).references.filter(
                    (reference) => reference.live && reference.name.toLowerCase() === name.toLowerCase(),
                ).length;
                if (liveTyped < 2) {
                    expect(doc2.lines).toEqual(typedLines);
                    return;
                }
                // Where the definition would land is born dead to Obsidian (a
                // "$$" last line under a paragraph opens a math block once a
                // line follows it, rule M2), the press rightly refuses and
                // edits nothing (the runtime swap, 2026-10-03)
                const plugin2 = sharedFakePlugin(
                    { ...settings, footnoteSectionHeading: "# Footnotes", enablePopupEditor: false, enableFootnotePrefix: false, lintOnFootnoteCreation: false },
                    fakeMultiEditor(typedLines),
                );
                const plan = planDefinitionAppend({ lines: typedLines, edits: [], footnoteId: name, plugin: plugin2 });
                if (!judgeEdit(typedLines, plan.final, { created: [{ kind: "footnote", name, references: [], definition: { line: plan.labelLine, lines: 1 } }] }).pass) {
                    expect(doc2.lines).toEqual(typedLines);
                    return;
                }
                // fresh valid name: ONE shared definition exists, both typed
                // references survived, nothing nested
                expect(defsAfter.has(name.toLowerCase())).toBe(true);
                const text = doc2.lines.join("\n");
                expect(text).not.toContain("[^[^");
                const occurrences = text.split(`[^${name}]`).length - 1;
                expect(occurrences).toBeGreaterThanOrEqual(2);
            }),
        );
    });

    // The names nesting inside a QUOTED definition ("> [^q]: body" plus
    // its continuation): a live reference to a defined footnote sitting in
    // the definition's body. The generator plants one deliberately
    // ("> [^110]: quoted body\n> continuation[^110] here"), so the contract
    // is that a press never ADDS to the set - hand-typed nesting survives,
    // created nesting is ADR-0001's refusal.
    const nestedQuotedNames = (lines: string[]): Set<string> => {
        const masked = [...readNote(lines).maskedLines()];
        const starts = readNote(lines).labelLines;
        const defined = new Set<string>();
        for (let i = 0; i < lines.length; i++) {
            if (!starts[i]) continue;
            const hit = definitionLabelWithName(lines[i], masked[i]);
            if (hit) defined.add(hit.name.toLowerCase());
        }
        const nested = new Set<string>();
        for (let i = 0; i < lines.length; i++) {
            if (!starts[i]) continue;
            const hit = definitionLabelWithName(lines[i], masked[i]);
            if (!hit?.label.quoted) continue;
            const end = hit.label.afterCloser ? i : (readNote(lines).labelOn(i)?.end ?? i);
            for (let j = i; j <= end; j++) {
                for (const o of readNote(lines).referencesOn(j)) {
                    if (defined.has(o.name.toLowerCase())) nested.add(o.name.toLowerCase());
                }
            }
        }
        return nested;
    };
    // Kimi hunt cycle 3 (2026-09-16): the claim's definition-interior
    // guard used to know column-0 blocks only, so a caret inside a quoted
    // definition's body got an insertion; the guard now asks
    // quotedDefinitionLabelAbove as well
    const quotedInteriorPressArb = fc
        .tuple(
            docArb,
            fc.nat(1000),
            fc.nat(1000),
            fc.nat(1000),
            settingsArb,
        )
        .map(([doc, innerPick, linePick, chPick, settings]) => {
            const lines = normalizeEol(doc).text.split("\n");
            const masked = [...readNote(lines).maskedLines()];
            const starts = readNote(lines).labelLines;
            const interiors: number[] = [];
            for (let i = 0; i < lines.length; i++) {
                if (!starts[i]) continue;
                const hit = definitionLabelWithName(lines[i], masked[i]);
                if (!hit?.label.quoted) continue;
                const end = hit.label.afterCloser ? i : (readNote(lines).labelOn(i)?.end ?? i);
                for (let j = i; j <= end; j++) interiors.push(j);
            }
            if (interiors.length === 0) return null;
            const innerLine = interiors[innerPick % interiors.length];
            const otherLine = linePick % lines.length;
            return {
                lines,
                carets: [
                    { line: innerLine, ch: chPick % (lines[innerLine].length + 1) },
                    { line: otherLine, ch: (chPick * 7) % (lines[otherLine].length + 1) },
                ],
                settings,
            };
        })
        .filter((press): press is NonNullable<typeof press> => press !== null);
    soakIt("a two-caret press never adds a nested footnote inside a quoted definition", async () => {
        await fc.assert(
            fc.asyncProperty(quotedInteriorPressArb, async (press) => {
                const { lines, carets, settings } = press;
                const before = nestedQuotedNames(lines);
                const doc = fakeMultiEditor(lines, {
                    carets,
                    edits: true,
                    wholeDoc: true,
                    words: true,
                });
                await insertAutonumFootnote(fakePlugin(doc, settings));
                expect(nestedQuotedNames(doc.lines)).toEqual(before);
            }),
        );
    });

    soakIt("a two-caret press never throws, edits atomically, and stays in the shape envelope", async () => {
        await fc.assert(
            fc.asyncProperty(multiPressArb, async ({ lines, carets, command, settings }) => {
                const shapesBefore = rawShapeCount(lines);
                // a caret strictly inside an existing raw shape (an escaped
                // "\[^80]" is lifeless text no guard owns) lets the
                // insertion SPLIT that shape - one extra -1 per such caret,
                // mirroring the single-caret property
                let splits = 0;
                for (const caret of carets) {
                    for (const match of lines[caret.line].matchAll(RawReferenceShape)) {
                        const start = match.index;
                        if (caret.ch > start && caret.ch < start + match[0].length) {
                            splits++;
                        }
                    }
                }
                const doc = fakeMultiEditor(lines, {
                    carets,
                    edits: true,
                    wholeDoc: true,
                    words: true,
                });
                const plugin = sharedFakePlugin(
                    {
                        ...settings,
                        footnoteSectionHeading: "# Footnotes",
                        enablePopupEditor: false,
                        enableFootnotePrefix: false,
                        lintOnFootnoteCreation: false,
                    },
                    doc,
                );
                await COMMANDS[command](plugin);
                // atomicity: at most one transaction carrying changes
                expect(doc.transactions).toBeLessThanOrEqual(1);
                const delta = rawShapeCount(doc.lines) - shapesBefore;
                const allowed: number[] = [];
                for (const base of ALLOWED_MULTI_DELTAS[command]) {
                    for (let s = 0; s <= splits; s++) allowed.push(base - s);
                }
                expect(allowed, `${command} produced raw-shape delta ${delta}`).toContain(delta);
                // and no transaction it made ever nests a reference
                expect(doc.lines.join("\n")).not.toContain("[^[^");
            }),
        );
    });
});

// ---------- rename + selection word model (added 2026-09-16, hunt cycle 5) ----------

const renameArb = fc
    .tuple(
        docArb,
        fc.nat(1000),
        fc.constantFrom("fresh", "Fresh-Name", "note", "NOTE", "9", "x.y", "$start", "bad name", "tick`name", "#tag"),
    )
    .map(([doc, namePick, newName]) => ({
        lines: normalizeEol(doc).text.split("\n"),
        namePick,
        newName,
    }));

describe("rename invariants over random documents", () => {
    soakIt("planFootnoteRename never throws, and a 'renamed' plan conserves protected lines and the footnote census", () => {
        fc.assert(
            fc.property(renameArb, ({ lines, namePick, newName }) => {
                const doc = fakeMultiEditor(lines, { wholeDoc: true });
                const ctx = docContext(doc);
                // every name in the note, references and labels alike
                const names: string[] = [];
                for (let i = 0; i < lines.length; i++) {
                    for (const o of ctx.reading().referencesOn(i)) names.push(o.name);
                    for (const label of ctx.reading().labelsOn(i)) names.push(label.name);
                }
                if (names.length === 0) return;
                const oldName = names[namePick % names.length];
                const plan = planFootnoteRename(doc, oldName, newName, ctx);
                if (plan.kind !== "renamed") return;
                const protectedBefore = readNote(lines).protectedLines;
                const after = simulateChanges(lines, plan.changes);
                // protected text is never renamed into or out of: it survives
                // as a multiset of whole lines
                const counts = new Map<string, number>();
                for (const line of after) counts.set(line, (counts.get(line) ?? 0) + 1);
                for (let i = 0; i < lines.length; i++) {
                    if (!protectedBefore[i]) continue;
                    const left = counts.get(lines[i]) ?? 0;
                    expect(left, `protected line lost: ${JSON.stringify(lines[i])}`).toBeGreaterThan(0);
                    counts.set(lines[i], left - 1);
                }
                // a rename swaps one name for another; it never merges two
                // footnotes or loses one (a collision is refused as "collision",
                // never applied)
                expect(definitionNamesFolded(after).size).toBe(definitionNamesFolded(lines).size);
            }),
        );
    });
});

// The selection expansion's word model: the start walk and the end walk
// must agree on where one word begins and ends. Pinned here over plain
// words; the intra-word apostrophe/dot case ("don't", "U.S.") is the
// cycle-5 bug pinned in test/hunt/bug-selection-start-splits-word.test.ts.
const plainWordArb = fc
    .tuple(
        fc.constantFrom("alpha", "bravo", "charlie", "中文", "word", "注釈"),
        fc.nat(20),
    )
    .map(([word, pick]) => ({ word, at: 1 + (pick % Math.max(1, word.length - 1)) }));

describe("the selection word model over plain words", () => {
    soakIt("startOfWordOffset and endOfWordForSelection agree on one word's span", () => {
        fc.assert(
            fc.property(plainWordArb, ({ word, at }) => {
                // an offset strictly inside the word: the start walk reaches
                // the word's first character, the end walk its last
                expect(startOfWordOffset(word, at)).toBe(0);
                expect(endOfWordForSelection(word, at)).toBe(word.length);
            }),
        );
    });
});

// ---------- press invariants around interrupted definitions (added 2026-09-16, hunt cycle 6) ----------
// The press-side half of the interrupted-definition finding
// (test/hunt/bug-interrupting-block-keeps-definition-open.test.ts): a
// note holding an HTML comment, <div> block, or $$ math block directly
// under a definition, with an indented code chunk under the block. Two
// invariants hold there TODAY and must keep holding when the scan fix
// lands: a press never edits protected text above the caret, and the
// definition a press appends starts a real definition in the after-scan
// (never born dead under the misread chunk).

const interruptedPressArb = fc
    .tuple(
        fc.constantFrom(
            ["use[^1] here", "", "[^1]: body", "<!-- c -->", "    chunk[^73]"],
            ["read[^1] first", "", "[^1]: body", "<!-- c", "-->", "    chunk[^73]"],
            ["note[^1].", "", "[^1]: body", "$$", "x", "$$", "    chunk[^73]"],
            ["cite[^1] here", "", "[^1]: body", "<div>", "inside", "", "    chunk[^73]"],
        ),
        fc.constantFrom("autonum", "named", "inline", "paste"),
    )
    .map(([lines, command]) => ({
        lines: [...lines] as string[],
        cursor: { line: 0, ch: lines[0].length },
        command,
        settings: {
            insertAtEndOfWord: false,
            enableFootnoteSectionHeading: false,
            enableRemoveBlankLastLines: false,
        } satisfies PressSettings,
    }));

describe("press invariants around interrupted definitions", () => {
    soakIt("a press never edits a protected line above the caret", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                // a definition appended above the caret shifts the lines
                // under it, so the protected lines are compared as a
                // multiset of their text, not by index (GLM's original
                // compared by index and tripped on that shift)
                const protectedBefore = readNote(lines).protectedLines;
                const doc = await press(lines, cursor, command, settings);
                const counts = new Map<string, number>();
                for (const line of doc.lines) counts.set(line, (counts.get(line) ?? 0) + 1);
                for (let i = 0; i < cursor.line; i++) {
                    if (!protectedBefore[i]) continue;
                    const left = counts.get(lines[i]) ?? 0;
                    expect(left, `protected line ${i} edited: ${JSON.stringify(lines[i])} is gone`).toBeGreaterThan(0);
                    counts.set(lines[i], left - 1);
                }
            }),
        );
    });

    soakIt("the definition a press appends starts a real definition in the after-scan", async () => {
        await fc.assert(
            fc.asyncProperty(interruptedPressArb, async ({ lines, cursor, command, settings }) => {
                const doc = await press(lines, cursor, command, settings);
                const before = new Set<string>(lines);
                const appended: number[] = [];
                for (let i = 0; i < doc.lines.length; i++) {
                    // the press's own empty definition: "[^N]: " with the
                    // trailing space, not present in the before-document
                    if (/^\[\^\d+\]: $/.test(doc.lines[i]) && !before.has(doc.lines[i])) {
                        appended.push(i);
                    }
                }
                if (appended.length === 0) return; // the press refused or navigated
                const scan = readNote(doc.lines);
                const starts = readNote(doc.lines).labelLines;
                for (const i of appended) {
                    expect(
                        starts[i],
                        `appended definition ${JSON.stringify(doc.lines[i])} is not a definition start`,
                    ).toBe(true);
                    expect(scan.protectedLines[i]).toBe(false);
                }
            }),
        );
    });
});

// ---------- quoted-definition press invariants (hunt cycle 8) ----------
// The pinned refusals (the multi-caret and selection claims, the
// definition-interior guard) keep every creation press out of a quoted
// definition: its label line and its continuation lines are the
// footnote's own text, and a reference planted there nests inside the
// definition (Jason's ruling 2026-08-13). This property sweeps the four
// commands over quoted-definition documents at every caret position
// inside the quoted extent, label line included, and holds the whole
// document byte-still: a guard may spend the press, navigation may move
// the caret, but no edit may land.
//
// The shapes here use SPACE-indented continuations on purpose; the
// tab-indented twin is pinned separately in
// test/hunt/bug-quoted-definition-tab-continuation.test.ts and would turn
// this property red until that fix lands.

const QUOTED_DEF_DOCS = [
    "> [^1]: quoted body\n> continuation text here",
    "> [^1]: quoted body\n>\n>     chunk text",
    "> [^1]: quoted body\n> cont\n>\n>     chunk text",
    "> prose\n\n> > [^1]: depth two body\n> >     chunk text",
    "> [!note] title\n> [^1]: callout label\n> body text",
];

const quotedPressArb = fc
    .tuple(
        fc.constantFrom(...QUOTED_DEF_DOCS),
        fc.nat(1000),
        fc.constantFrom<CommandName>("autonum", "named", "inline", "paste"),
        settingsArb,
    )
    .map(([doc, pick, command, settings]) => {
        const lines = doc.split("\n");
        const masked = [...readNote(lines).maskedLines()];
        const starts = readNote(lines).labelLines;
        const inside: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (!starts[i]) continue;
            const hit = definitionLabelWithName(lines[i], masked[i]);
            if (!hit || !hit.label.quoted) continue;
            const end = (readNote(lines).labelOn(i)?.end ?? i);
            for (let j = i; j <= end; j++) inside.push(j);
        }
        const line = inside[pick % inside.length];
        const ch = pick % (lines[line].length + 1);
        return { lines, cursor: { line, ch }, command, settings };
    });

describe("quoted-definition press invariants over random documents", () => {
    soakIt("no creation press edits inside a quoted definition", async () => {
        await fc.assert(
            fc.asyncProperty(quotedPressArb, async ({ lines, cursor, command, settings }) => {
                const doc = await press(lines, cursor, command, settings);
                expect(doc.lines.join("\n")).toBe(lines.join("\n"));
            }),
        );
    });
});

// ---------- press definition-census invariants (added 2026-09-16, GLM hunt cycle 13) ----------
// A press may add exactly ONE definition (its own) and may never DELETE
// one. Reclassification is a text editor's reality, exactly like typing:
// a wrapper planted on the blank line above a definition (or before a
// quote marker, or on a setext underline line) makes that definition read
// lazy or plain, the same way the user's own keystrokes would. So a
// "dropped" name is legitimate only when its label line still exists with
// the same text and merely reads non-definition; a press that cut the line
// itself fails here.

describe("press definition-census invariants over random documents", () => {
    soakIt("a press adds at most one definition name, and a dropped one is reclassified, never deleted", async () => {
        await fc.assert(
            fc.asyncProperty(pressArb, async ({ lines, cursor, command, settings }) => {
                const before = definitionNamesFolded(lines);
                const doc = await press(lines, cursor, command, settings);
                const after = definitionNamesFolded(doc.lines);
                // a name whose shape was already in the note and now reads
                // as a definition was promoted by the press's edit (a lazy
                // label under a filled-in blank line), exactly like typing
                // would do it; only a name new to the note counts as added
                const promotable = promotableLabelNamesFolded(lines);
                const added = [...after].filter((name) => !before.has(name) && !promotable.has(name));
                expect(
                    added.length,
                    `press added more than one definition: before ${[...before].sort().join()} after ${[...after].sort().join()}`,
                ).toBeLessThanOrEqual(1);
                // a dropped name must survive as its own label-shaped line,
                // read as non-definition text (lazy, heading, plain prose).
                // Matched by line TEXT, not index: the press's own
                // definition append can shift the lines under the caret.
                // Names fold case, so the label lines are collected through
                // the label reader, not string equality.
                const afterMasked = [...readNote(doc.lines).maskedLines()];
                const afterStarts = readNote(doc.lines).labelLines;
                for (const name of before) {
                    if (after.has(name)) continue;
                    const beforeMasked = [...readNote(lines).maskedLines()];
                    const originalLabels = new Set(
                        lines.filter(
                            (line, i) =>
                                line.includes("[^") &&
                                definitionLabelWithName(line, beforeMasked[i])?.name.toLowerCase() ===
                                    name.toLowerCase(),
                        ),
                    );
                    // An in-item definition has no label shape of its own on
                    // its line ("    [^x]: ..." under "- item"). A press on
                    // the blank line between the item's first line and the
                    // definition ends the item there, so the definition's
                    // line reads as indented code: still there, word for
                    // word, only reclassified, as typing on that line would
                    // do it (Jason's ruling 1, option a, 2026-10-03, made
                    // such definitions count here). A press in front of the
                    // item's marker, which would un-list the item, refuses
                    // instead (Jason's block-syntax ruling, 2026-10-03;
                    // test/press-guards-quote-and-underline.test.ts pins it).
                    const inItemLabels = new Set(
                        readNote(lines)
                            .definitions.filter((d) => d.name.toLowerCase() === name.toLowerCase())
                            .map((d) => lines[d.start]),
                    );
                    let survives = false;
                    for (let j = 0; j < doc.lines.length; j++) {
                        if (inItemLabels.has(doc.lines[j]) && !afterStarts[j]) {
                            survives = true;
                            break;
                        }
                        if (!originalLabels.has(doc.lines[j])) continue;
                        const hit = definitionLabelWithName(doc.lines[j], afterMasked[j]);
                        if (hit && hit.name.toLowerCase() === name.toLowerCase() && !afterStarts[j]) {
                            survives = true;
                            break;
                        }
                    }
                    expect(
                        survives,
                        `press deleted the definition line of ${name} outright`,
                    ).toBe(true);
                }
            }),
        );
    });
});
