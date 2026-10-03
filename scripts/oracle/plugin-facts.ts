// The plugin's own reading of a note, in the same shape the oracle reads
// Obsidian's: which labels are definitions and where each block ends, which
// reference-shaped strings are live, and which lines the scanner protects.
//
// It calls the scanner's readers exactly as the commands and the lint do
// (src/parsing/markdown-scan.ts and list-item-definitions.ts), so a
// disagreement found here is a disagreement in the shipped plugin.
// run-oracle.mjs bundles this file with esbuild for Node, the way
// scripts/generate-corpora.ts is run.

import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { inItemDefinitionLabels } from "../../src/parsing/list-item-definitions";
import {
    allDefinitionBlocks,
    definitionLabelWithName,
    definitionStartLines,
    maskProtectedLines,
    normalizeEol,
    scanDocument,
} from "../../src/parsing/markdown-scan";

/** One definition as the plugin reads it. `end` is null where the plugin does not model the extent (a definition inside a list item). */
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
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);

    const definitions: PluginDefinition[] = [];
    for (const block of allDefinitionBlocks(lines, scan, masked, starts)) {
        const quoted = definitionLabelWithName(lines[block.start], masked[block.start])?.label.quoted === true;
        definitions.push({ name: block.name, kind: quoted ? "quoted" : "block", line: block.start, end: block.end });
    }
    // An in-item label ("- [^a]: text") is a definition to the plugin's
    // orphan and navigation readers (Jason's ruling 1, 2026-09-20), so its
    // "[^a]" is not a reference; remember where each one starts.
    const inItemLabelAt = new Map<number, number>();
    for (const hit of inItemDefinitionLabels(lines, scan, masked, starts)) {
        definitions.push({ name: hit.name, kind: "in-item", line: hit.line, end: null });
        inItemLabelAt.set(hit.line, lines[hit.line].lastIndexOf(`[^${hit.name}]:`, hit.labelEnd));
    }
    definitions.sort((a, b) => a.line - b.line);

    const references: PluginReference[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of referenceOccurrences(lines[i], masked[i], starts[i])) {
            if (inItemLabelAt.get(i) === occurrence.start) continue;
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
