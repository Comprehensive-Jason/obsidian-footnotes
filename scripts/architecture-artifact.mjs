// Derives the "Footnote Shortcut Anatomy" artifact source from
// docs/architecture.html, the single source of truth for that page
// (Jason's ruling, 2026-09-09).
//
// The docs copy carries a full document wrapper (doctype, html, head, body)
// so it opens in a browser. The artifact host adds a wrapper of its own, so
// the artifact wants the same page WITHOUT ours: the title, the font link,
// the style block, and the page div. This script strips the wrapper and
// writes the result where you point it. Run from the repo root:
//
//   node scripts/architecture-artifact.mjs <output.html>
//
// Then publish the output to the existing artifact URL.
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
    console.error("usage: node scripts/architecture-artifact.mjs <output.html>");
    process.exit(2);
}
let page = readFileSync("docs/architecture.html", "utf8");
page = page.replace(/^<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, "");
page = page.replace(/<meta [^>]*>\s*/g, "");
page = page.replace(/<!-- Claude: drafted[^>]*-->\s*/, "");
page = page.replace(/\n<\/head>\n<body>/, "");
page = page.replace(/\s*<\/body>\s*<\/html>\s*$/, "\n");
if (!page.startsWith("<title>") || /<html|<\/body>/.test(page)) {
    console.error("the wrapper did not strip cleanly; check docs/architecture.html's head and tail");
    process.exit(1);
}
writeFileSync(out, page);
console.log(`artifact source written to ${out} (${page.length} bytes)`);
