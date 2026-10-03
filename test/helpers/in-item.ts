import { readNote } from "../../src/parsing/note-reading";

// The definitions the note reading puts inside a list item, in the shape
// the old in-item reader (src/parsing/list-item-definitions.ts, deleted in
// the runtime swap of 2026-10-03) gave them: the label's line, its name as
// written, and the column just past its ":". The tests that pinned that
// reader now ask the note reading the same questions through this.

/** Every definition inside a list item, in document order. */
export function inItemDefinitionLabels(lines: string[]): { line: number; name: string; labelEnd: number }[] {
    return readNote(lines)
        .definitions.filter((definition) => definition.container.listItems > 0)
        .map((definition) => ({ line: definition.start, name: definition.name, labelEnd: definition.labelEnd }));
}

/** The names of every definition inside a list item, lower-cased. */
export function inItemDefinitionNamesFolded(lines: string[]): Set<string> {
    return new Set(inItemDefinitionLabels(lines).map((label) => label.name.toLowerCase()));
}
