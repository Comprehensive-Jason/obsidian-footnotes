// The plugin's own reading of a note, in the same shape the oracle reads
// Obsidian's: which labels are definitions and where each block ends, which
// reference-shaped strings are live, and which lines the scanner protects.
//
// It calls the readers exactly as the commands and the lint do: the note
// reading for definitions (src/parsing/note-reading.ts), the scanner for
// protection and live references (src/parsing/markdown-scan.ts), so a
// disagreement found here is a disagreement in the shipped plugin.
// run-oracle.mjs bundles this file with esbuild for Node, the way
// scripts/generate-corpora.ts is run.

import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { maskProtectedLines, normalizeEol, scanDocument } from "../../src/parsing/markdown-scan";
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
    /** Per line: the scanner's kind for a protected or special line, or "" for ordinary text. */
    lineKinds: string[];
}

export function pluginFacts(text: string): PluginFacts {
    const lines = normalizeEol(text).text.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const reading = readNote(lines);
    const starts = reading.labelLines;

    const definitions: PluginDefinition[] = reading.definitions.map((definition) => ({
        name: definition.name,
        kind: definition.container.listItems > 0 ? "in-item" : definition.container.quotes > 0 ? "quoted" : "block",
        line: definition.start,
        end: definition.end,
    }));

    const references: PluginReference[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of referenceOccurrences(lines[i], masked[i], starts[i])) {
            references.push({ name: occurrence.name, line: i, column: occurrence.start });
        }
    }

    const lineKinds = lines.map((_, i) => {
        if (scan.indentedCode[i]) return "indented-code";
        if (scan.startsInFence[i]) return "fence";
        if (scan.startsInMath[i]) return "math";
        if (scan.startsInComment[i]) return "html-comment";
        if (scan.inCommentBlock[i]) return "percent-comment";
        if (scan.isProtected[i]) return "protected";
        return "";
    });
    return { definitions, references, lineKinds };
}
