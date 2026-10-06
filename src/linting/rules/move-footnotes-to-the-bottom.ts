import { findLineRunEnd, normalizeEol, removeLineRanges } from "../../parsing/line-edits";
import { Definition, readNote } from "../../parsing/note-reading";
import { linesReadDifferently } from "./remove-orphaned-definitions";
import { DocumentView, movedDefinitions, rewriteDocument } from "../rewrite-document";
import { FootnoteRule } from "../rule";

// The obsidian-linter plugin's "move footnotes to the bottom" rule,
// rewritten here as a pure function and joined up with this plugin's
// section-heading setting. What it should and should not do is pinned by
// test/move-footnotes-to-bottom.test.ts.
//
// The layout it produces deliberately matches the one buildDefinitionAppend
// produces when the plugin inserts a definition. That means a note the
// plugin built is already in its final shape: running this rule over it
// changes nothing.

/**
 * Guard against a note's first line turning into frontmatter.
 *
 * A note whose FIRST line is "---" with no matching "---" later on reads as
 * a horizontal rule. But add a "---" or "..." at the left margin further
 * down, and Obsidian re-reads the whole top of the note as a YAML
 * frontmatter block. Everything caught in it, prose and references alike,
 * quietly stops being part of the note's body. (Verified against
 * metadataCache's section types, 2026-08-10.)
 *
 * This was found by the differential test that compares the plugin against
 * the remark parser: gathering definitions under a "---\n## Footnotes"
 * heading closed that phantom block, and reindex then handed the name of a
 * swallowed reference to an orphaned definition.
 *
 * So when rebuilding the note would flip that reading, one blank line goes
 * in front. It renders exactly the same, and frontmatter can only open on
 * the very first line, so line 0 stays ordinary content for good.
 */
function preserveLeadingThematicBreak(
    firstLineWasProtected: boolean,
    rebuilt: string,
): string {
    if (firstLineWasProtected || !rebuilt.startsWith("---")) return rebuilt;
    if (!readNote(rebuilt.split("\n")).protectedLines[0]) return rebuilt;
    return "\n" + rebuilt;
}

/**
 * Gather every footnote definition block into the note's footnote section,
 * leaving the blocks in the order they were already in. Putting them in a
 * different order is reindexFootnotes' job, not this one.
 *
 * Where they gather depends on the section heading. `sectionHeading` is the
 * setting's value exactly as the user typed it. When it is set and the note
 * contains an exact copy of it outside protected text, the FIRST such copy
 * fixes the spot: the definitions gather directly under it, WHEREVER in the
 * note it happens to be. The lint has to respect where the user put their
 * footnote section instead of hauling it down to the bottom (issue #55
 * follow-up, reported 2026-08-05).
 *
 * With no such heading to aim at, the definitions move to the end of the
 * note, and the heading, if one is configured, is put in above them. Blank
 * lines always separate them from the text around them.
 *
 * A note that ends inside an unclosed code fence or comment comes back
 * untouched: anything added at the end would land inside that region and
 * stop being a definition at all.
 */
export function moveFootnoteDefinitionsToBottom(
    markdown: string,
    sectionHeading = "",
): string {
    return rewriteDocument(markdown, (text, view) => {
        const moved = gathered(text, view, sectionHeading);
        // A move must leave every definition a definition, as Obsidian reads
        // the note. Where the end of the note sits inside something only
        // Obsidian's reading knows about (a "$$" line under a paragraph
        // opens a math block to the end of the note, recorded fact 1c658e2),
        // the gathered definitions would land inside it and stop being
        // footnotes, so the note comes back untouched (the runtime swap,
        // 2026-10-03; found by the adjacency property).
        if (moved !== text && readNote(moved.split("\n")).definitions.length !== view.definitions.length) return text;
        return moved;
    });
}

/** The note with its movable definitions gathered under the section heading or at the end, before the check above. */
function gathered(text: string, view: DocumentView, sectionHeading: string): string {
    const lines = view.lines;

    // Remember how many blank lines the note ended with; they go back on
    // at the end. The trim goes through the view's own method, which
    // refuses to run once anything has been worked out from the lines,
    // so the reading can never end up describing the untrimmed note.
    const trailingNewlines = view.trimTrailingBlankLines();

    const { reading, blocks } = view;
    const isProtected = reading.protectedLines;
    if (blocks.length === 0) return text;

    // A line added at the end of the note would be inside protected
    // text, because an unclosed code fence or comment runs on to the end
    // of the file. Moving definitions in there would cut them off from
    // their references.
    if (reading.openRegionFrom !== -1) return text;

    // Packed label to label, except after a block whose last line is
    // a lazy continuation (a plain column-0 line): the next label
    // directly under such a line would read as more lazy text and
    // stop rendering, so a blank line keeps it a definition (Kimi hunt
    // cycle 3, 2026-09-16: the move demoted the second footnote and
    // fix-lazy fought it back every lint).
    const packed: string[] = [];
    blocks.forEach((block, index) => {
        packed.push(lines.slice(block.start, block.end + 1).join("\n"));
        const last = lines[block.end];
        const lazyTail =
            block.end > block.start && !isProtected[block.end] && !/^(?: {4}|\t)/.test(last) && last.trim() !== "";
        if (lazyTail && index < blocks.length - 1) packed.push("");
    });
    const definitions = packed.join("\n");

    // Taking the definitions out must leave every other line reading as it
    // did, the promise the orphan rules make for their cuts: a definition
    // can be all that keeps "   thin prose" under a list item from
    // becoming that item's second paragraph, and the indented code under
    // it from waking up as live text (found by the conservation property,
    // the runtime swap step 2, 2026-10-03). Such a note is left as it is,
    // and the move alert names the definitions that held it back
    // (definitionsHoldingTheMoveBack).
    const body = bodyWithout(lines, blocks);
    if (linesReadDifferently(lines, { lines, ranges: blocks }, body)) return text;

    // The section-heading setting is markdown that may run over
    // SEVERAL lines, such as "---\n## Footnotes". So the search
    // compares runs of lines, not single ones. Comparing line by line
    // meant a multi-line heading was never recognised and a fresh copy
    // was added on every lint (bug reported 2026-07-17).
    //
    // findLineRunEnd is the ONE piece of code that finds the heading,
    // shared with the heading slot in buildDefinitionAppend. That is
    // what guarantees a note the plugin built comes back unchanged.
    //
    // The reading here is of the body with the definitions already cut
    // out. That is safe: removing whole definition blocks cannot change
    // which code fences pair with which, so the protected regions come
    // out the same.
    let anchorEnd = -1;
    const bodyReading = readNote(body);
    if (sectionHeading) {
        anchorEnd = findLineRunEnd(
            body,
            bodyReading.protectedLines,
            sectionHeading.split("\n"),
            bodyReading.commentLines,
        );
    }

    if (anchorEnd !== -1) {
        const out: string[] = [];
        const headingStart = anchorEnd - sectionHeading.split("\n").length + 1;
        for (let i = 0; i <= anchorEnd; i++) {
            // Make sure there is a blank line above where the heading
            // starts, the same way every other block of markdown here
            // is separated
            if (
                i === headingStart &&
                out.length > 0 &&
                out[out.length - 1] !== ""
            ) {
                out.push("");
            }
            out.push(body[i]);
        }
        const rest = body.slice(anchorEnd + 1);
        while (rest.length > 0 && rest[0] === "") rest.shift();
        // An indented code chunk right under the heading stays where it
        // is, and the definitions go BELOW it. Parked above it, the
        // last definition would swallow the chunk: an indented line
        // after a definition's blank line continues the definition, so
        // the code stopped being code and a reference-shaped string
        // inside it woke up as a live reference (found by the
        // conservation property 2026-09-11; Jason's ruling 2026-09-16,
        // below the chunk, as for any block). The chunk runs while its
        // lines are indented code, blank lines between them included.
        let chunkEnd = 0;
        // rest[k] is body[offset + k], which is how its scan facts are read
        const offset = body.length - rest.length;
        const indentedCode = (k: number) =>
            k < rest.length && bodyReading.protectedLines[offset + k] && /^(\t| {4})/.test(rest[k]);
        if (indentedCode(0)) {
            while (chunkEnd < rest.length) {
                const line = rest[chunkEnd];
                if (line === "") {
                    let next = chunkEnd + 1;
                    while (next < rest.length && rest[next] === "") next++;
                    if (indentedCode(next)) {
                        chunkEnd = next;
                        continue;
                    }
                    break;
                }
                if (indentedCode(chunkEnd)) {
                    chunkEnd++;
                    continue;
                }
                break;
            }
        }
        if (chunkEnd > 0) out.push("", ...rest.slice(0, chunkEnd));
        out.push("", ...definitions.split("\n"));
        // The rest of the note goes below the gathered definitions,
        // with a blank line between. Without it, the first line of that
        // text would be read as more of the last definition
        // (buildDefinitionAppend follows the same rule).
        const remainder = rest.slice(chunkEnd);
        while (remainder.length > 0 && remainder[0] === "") remainder.shift();
        if (remainder.length > 0) out.push("", ...remainder);
        const anchored = preserveLeadingThematicBreak(
            isProtected[0],
            out.join("\n") + "\n".repeat(trailingNewlines),
        );
        return anchored;
    }

    const base = body.join("\n");
    let headingPart = "";
    if (sectionHeading !== "" && base !== "") {
        // The same layout rule addFootnoteSectionHeader uses: a blank
        // line always separates the heading from the text above it.
        // That is how markdown blocks are kept apart, and it also stops
        // a heading that starts with a "---" divider from turning the
        // last line of the note's text into a heading, the way a line
        // of dashes underneath text does in markdown.
        headingPart = "\n\n" + sectionHeading;
    }

    const result =
        base === ""
            ? (sectionHeading !== "" ? sectionHeading + "\n\n" : "") +
              definitions
            : base + headingPart + "\n\n" + definitions;
    const rebuilt = preserveLeadingThematicBreak(
        isProtected[0],
        result + "\n".repeat(trailingNewlines),
    );
    return rebuilt;
}

/**
 * Everything that is staying put once `blocks` are taken out, still in
 * order, without blank lines at the end. removeLineRanges also closes the
 * gap: when cutting a block leaves two blank lines next to each other,
 * they become one.
 */
function bodyWithout(lines: string[], blocks: readonly Definition[]): string[] {
    const body = removeLineRanges(lines, blocks);
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    return body;
}

/**
 * The names of the definitions that hold the whole move back, each once, in
 * the order they appear: the ones whose own move would change how Obsidian
 * reads the lines around them, such as a definition between two lists,
 * whose move would join the lists. The rule then leaves every definition
 * where it is, so the lint alert names these, and once the user has moved
 * them by hand the next lint gathers the rest (hunt 2026-10-05 round 2,
 * cluster L8; Jason's triage decision Q5, 2026-10-05; ADR 0002: the lint is
 * never silent about what it leaves). When no single definition does it
 * but the whole set does, every movable definition is named. Empty when
 * the move is not held back this way.
 */
export function definitionsHoldingTheMoveBack(markdown: string): string[] {
    if (!markdown.includes("[^")) return [];
    // the note as the rule sees it: plain line endings, no blank lines at
    // the end
    const lines = normalizeEol(markdown).text.split("\n");
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const reading = readNote(lines);
    const blocks = movedDefinitions(reading.definitions);
    if (blocks.length === 0 || reading.openRegionFrom !== -1) return [];
    // definitions that already close the note, with nothing but blank
    // lines among them, have nowhere to go, so nothing was held back
    const inBlock = (i: number): boolean => blocks.some((block) => block.start <= i && i <= block.end);
    let alreadyGathered = true;
    for (let i = blocks[0].start; i < lines.length && alreadyGathered; i++) alreadyGathered = inBlock(i) || lines[i].trim() === "";
    if (alreadyGathered) return [];
    const holdsBack = (cut: readonly Definition[]): boolean => linesReadDifferently(lines, { lines, ranges: cut }, bodyWithout(lines, cut));
    if (!holdsBack(blocks)) return [];
    const holding = blocks.filter((block) => holdsBack([block]));
    const names: string[] = [];
    for (const block of holding.length > 0 ? holding : blocks) {
        if (!names.some((name) => name.toLowerCase() === block.name.toLowerCase())) names.push(block.name);
    }
    return names;
}

/**
 * This rule's catalogue entry. The id matches obsidian-linter's file name.
 * The option is the section-heading setting exactly as the user typed it;
 * empty means no heading.
 */
export const moveFootnotesToTheBottomRule: FootnoteRule<string> = {
    id: "move-footnotes-to-the-bottom",
    name: "Move footnotes to the bottom",
    description:
        "Gather every footnote definition block under the note's existing section heading, or at the end of the note when there is none, keeping the blocks' relative order.",
    examples: [
        {
            description: "A mid-document definition moves to the bottom",
            before: "para one[^1].\n\n[^1]: def\n\npara two",
            after: "para one[^1].\n\npara two\n\n[^1]: def",
            options: "",
        },
        {
            description: "Definitions keep their relative order",
            before: "a[^2].\n\n[^2]: two\n\nb[^1].\n\n[^1]: one",
            after: "a[^2].\n\nb[^1].\n\n[^2]: two\n[^1]: one",
            options: "",
        },
    ],
    apply: (text, sectionHeading) =>
        moveFootnoteDefinitionsToBottom(text, sectionHeading),
};
