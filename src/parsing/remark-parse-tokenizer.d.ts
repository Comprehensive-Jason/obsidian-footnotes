// The type of the vendored tokenizer loop in remark-parse-tokenizer.js, a
// plain JavaScript file kept as close to remark-parse's own as possible.
import type { MarkdownNode } from "./obsidian-markdown";

/** Builds the loop that reads blocks ("block") or the text inside them ("inline"); the parser calls it with itself as `this`. */
declare function factory(type: "block" | "inline"): (value: string, location: { line: number; column: number }) => MarkdownNode[];
export default factory;
