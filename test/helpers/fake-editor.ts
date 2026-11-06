// The shared fake-editor family for unit tests. Every spec used to
// hand-roll its own `fakeEditor` (39 copies at the 2026-08-25 count),
// each with its own `as unknown as Editor` cast; this module owns that
// cast in ONE place and keeps the fakes honest by funneling every edit
// through `simulateChanges` - the exact CodeMirror change-application
// order the commands' born-dead simulation relies on.
//
// Capabilities are OPT-IN because a capability's absence is itself a
// contract: a fake built without `wholeDoc` proves the code under test
// reads individual lines and never the whole document (the
// footnote-prefix perf rule, 2026-08-11), one built without `edits`
// proves a navigation press never writes, one built without `words`
// proves the end-of-word adjustment stayed off. A disabled method
// THROWS naming its option instead of being undefined - the same test
// failure as the old missing-method TypeError, but the message says
// which contract fired.
//
// Purpose-built doubles stay local to their specs: the replaceMinimal
// fake in mutation-hardening-linter.test.ts applies edits by OFFSET
// SPLICING on a value string precisely so it cannot share
// simulateChanges' semantics with the code it checks.
import type { Editor, EditorChange, EditorPosition } from "obsidian";
import { simulateChanges } from "../../src/editor/insertion-liveness";

export interface FakeEditorOptions {
    /** enables getCursor (setCursor is always available and moves this) */
    cursor?: EditorPosition;
    /**
     * multi-caret press: listSelections reports these carets (frozen, the
     * way Alt-click carets are fixed at press time); getCursor starts at
     * carets[0] unless `cursor` is also given
     */
    carets?: EditorPosition[];
    /** single-range selection: listSelections reports exactly this range */
    selection?: { anchor: EditorPosition; head: EditorPosition };
    /**
     * enables transaction(): changes apply via simulateChanges,
     * spec.selection lands the cursor, spec.selections is recorded on
     * `selections` for multi-caret landing assertions
     */
    edits?: boolean;
    /** enables getValue() */
    wholeDoc?: boolean;
    /** enables wordAt() (\w runs, the shape the end-of-word tests need) */
    words?: boolean;
}

/** the fake, typed as the real Editor plus its inspectable state */
export type FakeEditor = Editor & {
    /** live line array - reflects every applied transaction */
    lines: string[];
    /** live caret - setCursor and transaction selections move it */
    cursor: EditorPosition;
    /** number of transaction() calls (atomicity assertions) */
    transactions: number;
    /**
     * every EditorChange handed to transaction(), in order - the raw
     * specs, for pins that assert exactly what a press asked the editor
     * to do. (The old appliedChanges-family fakes recorded these WITHOUT
     * applying them; this helper records and applies, which is strictly
     * more realistic and keeps those assertions valid.)
     */
    appliedChanges: EditorChange[];
    /** what the last transaction's `selections` requested, if any */
    selections: { from: EditorPosition }[] | null;
    /** every setCursor call in order (jump-target assertions) */
    moves: EditorPosition[];
};

export function fakeEditor(
    lines: string[],
    options: FakeEditorOptions = {},
): FakeEditor {
    const hasCaret = !!(options.cursor ?? options.carets);
    const disabled = (method: string, option: string) => () => {
        throw new Error(
            `fake editor: ${method}() is disabled - this spec's editor was built without \`${option}\`, so the code under test is not allowed to call it`,
        );
    };
    // state first, methods closing over it - merging the two at the end
    // keeps the object self-reference out of TypeScript's inference
    const state = {
        lines: lines.slice(),
        cursor: options.cursor ?? options.carets?.[0] ?? { line: 0, ch: 0 },
        transactions: 0,
        selections: null as { from: EditorPosition }[] | null,
        moves: [] as EditorPosition[],
        appliedChanges: [] as EditorChange[],
    };
    const methods = {
        getLine: (n: number) => state.lines[n],
        lineCount: () => state.lines.length,
        lastLine: () => state.lines.length - 1,
        setCursor(pos: EditorPosition) {
            state.cursor = pos;
            state.moves.push(pos);
        },
        // a selection set after the edits, as the write-back sets one: the
        // caret goes to the first range's head
        setSelections(ranges: { anchor: EditorPosition; head?: EditorPosition }[]) {
            state.cursor = ranges[0].head ?? ranges[0].anchor;
        },
        scrollIntoView() {},
        posToOffset(pos: EditorPosition): number {
            let offset = 0;
            for (let line = 0; line < pos.line; line++) {
                offset += state.lines[line].length + 1;
            }
            return offset + pos.ch;
        },
        offsetToPos(offset: number): EditorPosition {
            let remaining = offset;
            for (let line = 0; line < state.lines.length; line++) {
                if (remaining <= state.lines[line].length)
                    return { line, ch: remaining };
                remaining -= state.lines[line].length + 1;
            }
            return {
                line: state.lines.length - 1,
                ch: state.lines.at(-1)?.length ?? 0,
            };
        },

        getCursor: hasCaret
            ? () => state.cursor
            : disabled("getCursor", "cursor/carets"),
        listSelections: options.carets
            ? () =>
                  options.carets?.map((pos) => ({ anchor: pos, head: pos })) ??
                  []
            : options.selection
              ? () => [options.selection]
              : hasCaret
                ? () => [{ anchor: state.cursor, head: state.cursor }]
                : disabled("listSelections", "cursor/carets/selection"),
        getValue: options.wholeDoc
            ? () => state.lines.join("\n")
            : disabled("getValue", "wholeDoc"),
        transaction: options.edits
            ? (spec: {
                  changes?: EditorChange[];
                  selection?: { from: EditorPosition };
                  selections?: { from: EditorPosition }[];
              }) => {
                  state.transactions++;
                  if (spec.changes) {
                      state.appliedChanges.push(...spec.changes);
                      state.lines = simulateChanges(state.lines, spec.changes);
                  }
                  if (spec.selection) state.cursor = spec.selection.from;
                  if (spec.selections) state.selections = spec.selections;
              }
            : disabled("transaction", "edits"),
        wordAt: options.words
            ? (pos: EditorPosition) => {
                  const line = state.lines[pos.line] ?? "";
                  // unicode-aware like CodeMirror's wordAt: ASCII \w hid
                  // the whole main-editor end-of-word branch from CJK text
                  // (review D2, 2026-09-09)
                  const isWord = (c: string | undefined) =>
                      !!c && /[\p{L}\p{N}\p{M}_]/u.test(c);
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
              }
            : disabled("wordAt", "words"),
    };
    return Object.assign(state, methods) as unknown as FakeEditor;
}
