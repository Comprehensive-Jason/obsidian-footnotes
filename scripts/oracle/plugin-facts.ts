// The plugin's own reading of a note, in the same shape the oracle reads
// Obsidian's: which labels are definitions and where each block ends, which
// reference-shaped strings are live, and which lines the plugin protects.
//
// It calls the readers exactly as the commands and the lint do: the note
// reading (src/parsing/note-reading.ts) for definitions, live references
// (NoteReading.referencesOn, since step 3 of the runtime swap,
// 2026-10-03), and protected text, so a disagreement found here is a
// disagreement in the shipped plugin.
// run-oracle.mjs bundles this file with esbuild for Node, the way
// scripts/generate-corpora.ts is run.

import { normalizeEol } from "../../src/parsing/line-edits";
import { readNote } from "../../src/parsing/note-reading";

/** One definition as the plugin reads it, by what holds it: the note itself, a quote, or a list item. `end` is null where the plugin does not model the extent (no longer the case since the runtime swap of 2026-10-03). */
export interface PluginDefinition {
    name: string;
    kind: "block" | "quoted" | "in-item";
    line: number;
    end: number | null;
}

/** One reference the plugin counts as live text: not protected, not a definition's own label. */
export interface PluginReference {
    name: string;
    line: number;
    column: number;
}

export interface PluginFacts {
    definitions: PluginDefinition[];
    references: PluginReference[];
    /** Per line: the kind of protected text covering the line through and through, "percent-comment" on a "%%" block comment's line, or "" for ordinary text. */
    lineKinds: string[];
}

export function pluginFacts(text: string): PluginFacts {
    const lines = normalizeEol(text).text.split("\n");
    const reading = readNote(lines);

    const definitions: PluginDefinition[] = reading.definitions.map((definition) => ({
        name: definition.name,
        kind: definition.container.listItems > 0 ? "in-item" : definition.container.quotes > 0 ? "quoted" : "block",
        line: definition.start,
        end: definition.end,
    }));

    const references: PluginReference[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of reading.referencesOn(i)) {
            references.push({ name: occurrence.name, line: i, column: occurrence.start });
        }
    }

    const lineKinds = lines.map((_, i) => {
        if (reading.commentLines[i]) return "percent-comment";
        if (!reading.protectedLines[i]) return "";
        return reading.lineSpans(i).map((kind) => kind.replace(/^\^/, "")).find((kind) => kind !== "percentComment") ?? "protected";
    });
    return { definitions, references, lineKinds };
}
