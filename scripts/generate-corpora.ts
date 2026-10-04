// Renders the property generators into vault notes for human review:
//
//   1. a DOCUMENT corpus - raw samples of docArb, the generator every
//      transform and press property fuzzes over, written unfenced so
//      Obsidian renders the footnotes for realism review;
//   2. an ENTRY corpus - generated creation-command scenarios (press,
//      typed name/body, clipboard, selection) executed against the same
//      transaction-applying fake editor the press properties use, with
//      the document shown before and after and the caret marked "‸".
//
// Run via esbuild with the obsidian mock aliased in (the commands import
// "obsidian"; the mock's Notice self-records, which is how the scenario
// notes list their toasts):
//
//   npx esbuild scripts/generate-corpora.ts --bundle --platform=node \
//     --alias:obsidian=./test/mocks/obsidian.ts --outfile=<tmp>/gen.cjs
//   node <tmp>/gen.cjs "<vault root>" <seed>

import * as fs from "fs";
import * as path from "path";
import fc from "fast-check";

import { noticeCalls } from "../test/mocks/obsidian";
import { docArb } from "../test/arbitraries";
import type FootnotePlugin from "../src/main";
import type { Editor, EditorChange, EditorPosition } from "obsidian";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { simulateChanges } from "../src/editor/insertion-liveness";
import { normalizeEol } from "../src/parsing/line-edits";

const [, , vaultRoot, seedArg] = process.argv;
if (!vaultRoot) throw new Error("usage: gen.cjs <vault root> <seed>");
const seed = Number(seedArg ?? 20260812);

// ---------- the same fake editor the press properties drive ----------

interface PressDoc extends Editor {
    lines: string[];
    cursor: EditorPosition;
}

function pressEditor(
    lines: string[],
    cursor: EditorPosition,
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
    return {
        app: {
            workspace: { getActiveViewOfType: () => ({ editor: doc }) },
            vault: {},
        },
        settings: {
            ...settings,
            footnoteSectionHeading: "# Footnotes",
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            lintOnFootnoteCreation: false,
        },
    } as unknown as FootnotePlugin;
}

function typeText(doc: PressDoc, text: string) {
    const { line, ch } = doc.cursor;
    const current = doc.lines[line];
    doc.lines[line] = current.slice(0, ch) + text + current.slice(ch);
    doc.cursor = { line, ch: ch + text.length };
}

function plantedPlaceholder(doc: PressDoc, placeholder: string): boolean {
    const line = doc.lines[doc.cursor.line] ?? "";
    return line.slice(doc.cursor.ch - 2, doc.cursor.ch + 1) === placeholder;
}

// ---------- the generated entry scenario ----------

const settingsArb: fc.Arbitrary<PressSettings> = fc.record({
    insertAtEndOfWord: fc.boolean(),
    enableFootnoteSectionHeading: fc.boolean(),
    enableRemoveBlankLastLines: fc.boolean(),
});

const typedNameArb = fc.oneof(
    fc.constantFrom("note", "Note", "9", "a$1", "ch-2", "x"),
    fc.constantFrom("fresh", "Fresh-Name", "注釈", "x.y", "$start"),
    fc.constantFrom("bad name", "tick`name"),
    fc
        .string({ minLength: 1, maxLength: 12 })
        .map((s) => s.replace(/[[\]\s`\\^$\n\r]/g, ""))
        .filter((s) => s.length > 0),
);

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

const KINDS = [
    "autonum press",
    "named flow",
    "inline flow",
    "paste",
    "selection to autonum",
    "selection to inline",
] as const;
type Kind = (typeof KINDS)[number];

interface Scenario {
    lines: string[];
    cursor: EditorPosition;
    selection?: { anchor: EditorPosition; head: EditorPosition };
    settings: PressSettings;
    name: string;
    body: string;
    clip: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
    .tuple(
        docArb,
        fc.nat(1000),
        fc.nat(1000),
        fc.nat(30),
        fc.boolean(),
        settingsArb,
        typedNameArb,
        typedBodyArb,
        fc.string({ maxLength: 40 }),
    )
    .map(([doc, linePick, chPick, lenPick, reversed, settings, name, body, clip]) => {
        const lines = normalizeEol(doc).text.split("\n");
        const line = linePick % lines.length;
        const a = chPick % (lines[line].length + 1);
        const b = Math.min(a + (lenPick % 25), lines[line].length);
        const [anchorCh, headCh] = reversed ? [b, a] : [a, b];
        return {
            lines,
            cursor: { line, ch: a },
            selection: {
                anchor: { line, ch: anchorCh },
                head: { line, ch: headCh },
            },
            settings,
            name,
            body,
            clip,
        };
    });

let clipboardText = "";
Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { readText: async () => clipboardText } },
    configurable: true,
});

interface Rendered {
    before: string;
    after: string;
    steps: string[];
    notices: string[];
}

function withCaret(lines: string[], cursor: EditorPosition): string {
    const marked = lines.slice();
    const text = marked[cursor.line] ?? "";
    marked[cursor.line] = text.slice(0, cursor.ch) + "‸" + text.slice(cursor.ch);
    return marked.join("\n");
}

async function runScenario(kind: Kind, s: Scenario): Promise<Rendered> {
    noticeCalls.length = 0;
    const selection =
        kind === "selection to autonum" || kind === "selection to inline"
            ? s.selection
            : undefined;
    const doc = pressEditor(s.lines, s.cursor, selection);
    const plugin = fakePlugin(doc, s.settings);
    const before = withCaret(s.lines, s.cursor);
    const steps: string[] = [];

    switch (kind) {
        case "autonum press":
        case "selection to autonum":
            await insertAutonumFootnote(plugin);
            steps.push("pressed the numbered hotkey");
            break;
        case "selection to inline":
            await insertInlineFootnote(plugin);
            steps.push("pressed the inline hotkey");
            break;
        case "named flow": {
            await insertNamedFootnote(plugin);
            steps.push("pressed the named hotkey");
            if (plantedPlaceholder(doc, "[^]")) {
                typeText(doc, s.name);
                steps.push(`typed the name "${s.name}"`);
                const caretAfterName = { ...doc.cursor };
                await insertNamedFootnote(plugin);
                steps.push("pressed the named hotkey again");
                if (doc.cursor.line !== caretAfterName.line) {
                    typeText(doc, s.body);
                    steps.push(`typed the body "${s.body}"`);
                }
            }
            break;
        }
        case "inline flow": {
            await insertInlineFootnote(plugin);
            steps.push("pressed the inline hotkey");
            if (plantedPlaceholder(doc, "^[]")) {
                typeText(doc, s.body);
                steps.push(`typed the body "${s.body}"`);
                await insertInlineFootnote(plugin);
                steps.push("pressed the inline hotkey again");
            }
            break;
        }
        case "paste":
            clipboardText = s.clip;
            await pasteInlineFootnote(plugin);
            steps.push(`pressed the paste hotkey (clipboard: ${JSON.stringify(s.clip)})`);
            break;
    }

    return {
        before,
        after: withCaret(doc.lines, doc.cursor),
        steps,
        notices: noticeCalls.map((args) => String(args[0])),
    };
}

// ---------- rendering ----------

const FENCE = "``````";

function scenarioNote(kind: Kind, index: number, s: Scenario, r: Rendered): string {
    const sel =
        kind.startsWith("selection") && s.selection
            ? `- selection: line ${s.selection.anchor.line}, ch ${s.selection.anchor.ch} to ch ${s.selection.head.ch}\n`
            : "";
    const settings = `insertAtEndOfWord ${s.settings.insertAtEndOfWord ? "on" : "off"}, sectionHeading ${s.settings.enableFootnoteSectionHeading ? "on" : "off"}, removeBlankLastLines ${s.settings.enableRemoveBlankLastLines ? "on" : "off"}`;
    const notices = r.notices.length
        ? r.notices.map((n) => `- ${n}`).join("\n")
        : "- (none)";
    return `# ${kind} ${String(index).padStart(2, "0")}

- caret: line ${s.cursor.line}, ch ${s.cursor.ch} (marked ‸ below)
${sel}- settings: ${settings}
- steps: ${r.steps.join("; ")}

## Toasts

${notices}

## Before

${FENCE}
${r.before}
${FENCE}

## After

${FENCE}
${r.after}
${FENCE}
`;
}

async function main() {
    // ----- corpus 1: raw documents -----
    const docsDir = path.join(vaultRoot, "Property Corpus 2026-08-12 v2");
    fs.rmSync(docsDir, { recursive: true, force: true });
    fs.mkdirSync(docsDir, { recursive: true });
    const docs = fc.sample(docArb, { seed, numRuns: 100 });
    docs.forEach((doc, i) => {
        fs.writeFileSync(
            path.join(docsDir, `Sample ${String(i + 1).padStart(3, "0")}.md`),
            doc,
        );
    });
    fs.writeFileSync(
        path.join(docsDir, "00 - Corpus Index.md"),
        `# Property corpus v2 (seed ${seed})

100 raw samples of the CURRENT document generator (test/arbitraries.ts docArb) - the same one the transform and press properties fuzz over. Supersedes the "Property Corpus 2026-08-12" folder.

Review prompts:
- Does the prose/footnote ratio feel like a real note?
- Any structures that could never occur in practice (and waste fuzzing effort)?
- Any real-note structures MISSING (so the properties never see them)?
`,
    );
    console.log(`wrote ${docs.length} docs to ${docsDir}`);

    // ----- corpus 2: entry scenarios -----
    const entryDir = path.join(vaultRoot, "Entry Corpus 2026-08-12");
    fs.rmSync(entryDir, { recursive: true, force: true });
    fs.mkdirSync(entryDir, { recursive: true });
    let written = 0;
    for (const [k, kind] of KINDS.entries()) {
        const scenarios = fc.sample(scenarioArb, {
            seed: seed + k + 1,
            numRuns: 10,
        });
        for (const [i, s] of scenarios.entries()) {
            const rendered = await runScenario(kind, s);
            fs.writeFileSync(
                path.join(
                    entryDir,
                    `${kind} ${String(i + 1).padStart(2, "0")}.md`,
                ),
                scenarioNote(kind, i + 1, s, rendered),
            );
            written++;
        }
    }
    fs.writeFileSync(
        path.join(entryDir, "00 - Entry Corpus Index.md"),
        `# Entry corpus (seed ${seed})

${written} generated CREATION scenarios, executed for real against the press properties' fake editor: the four commands at generated carets and settings, the full named flow (plant, type a generated name, re-press, type the body), the inline flow, paste with a generated clipboard, and single-line selection conversions (issue #35). Documents are shown raw inside 6-backtick fences with the caret marked ‸; every toast the press raised is listed.

Out of scope by construction (matches the property suite): the popup editor, table cell sub-editors, Reading view, and the footnote-prefix feature (all covered by pins and the smoke suite instead).

Review prompts:
- Are the generated caret/selection positions the kind a human would ever press from?
- Do the typed names/bodies cover what you'd actually type (and the mistakes you'd make)?
- Any entry flow you use that is NOT represented here?
`,
    );
    console.log(`wrote ${written} entry scenarios to ${entryDir}`);
}

void main();
