import { Editor } from "obsidian";

import type FootnotePlugin from "../main";
import { isValidFootnoteName } from "./footnote-grammar";

import { invalidPrefix, Opener, refusal, showNotice } from "../editor/notice";
// Everything about the note's `footnote-prefix` frontmatter property: how
// it is read, what counts as valid, and the settings-aware resolver the
// insert commands share. The reading is a small hand-written parser that
// covers only the slice of YAML Obsidian itself shows as a property.
//
// It imports only footnote-grammar (plus the FootnotePlugin type, which
// disappears when the code is compiled, so it costs nothing at runtime).
// Split out of the all-in-one commands file 2026-08-11.

// Drop a trailing "\r" from a line. Notes saved on Windows end every line
// with "\r\n", and the leftover "\r" would stop a line from matching either
// the exact "---" fence or the property pattern, which is anchored to the
// end of the line. This is the one copy both readers below share
// (2026-08-11 review, for cleanliness).
const stripCrLine = (line: string): string =>
    line.endsWith("\r") ? line.slice(0, -1) : line;

/**
 * Reads the value out of one "footnote-prefix:" property line. The value is
 * the text after the colon, with the quotes taken off. Obsidian adds those
 * quotes around a value that YAML would otherwise read as something else.
 *
 * A "#" does NOT start a comment here. An earlier fix (2026-08-10, from a
 * bug hunt) stripped YAML comments; Jason's ruling of 2026-09-05 reversed
 * it. Nobody writes such comments, the Properties editor cannot produce
 * one, and the stripping code guarded a case that never happened. So the
 * line "2. # a comment" yields the whole value "2. # a comment", and the
 * validity rules below refuse it with the ordinary invalid-prefix toast
 * instead of quietly reading it as "2.".
 */
function parsePrefixValue(captured: string | undefined): string | null {
    const value = (captured ?? "").trim();
    const quoted = value.match(/^(["'])(.*)\1$/);
    // A closing quote that YAML itself escapes ("2.\"" with an odd run
    // of backslashes before it, '2.'' with a doubled quote at the end)
    // never closes the value: Obsidian's Properties panel shows "Invalid
    // properties" for the note (probed 2026-09-16, GLM hunt cycle 6), so
    // there is no prefix the user can see, and none to honor.
    if (quoted && quoted[1] === '"' && /(?<!\\)(?:\\\\)*\\$/.test(quoted[2])) return null;
    if (quoted && quoted[1] === "'" && quoted[2].endsWith("'") && !/^(?:''|[^'])*$/.test(quoted[2])) return null;
    if (quoted) {
        // Inside the quotes, YAML's own escapes are resolved the way
        // Obsidian resolves them before it shows the value: a doubled
        // single quote is one quote, and a backslash escapes a quote, a
        // slash, or another backslash in a double-quoted value (Kimi
        // sweep 2026-09-13). Without this the plugin namespaced the note
        // as [^a\"b1] while the Properties panel said the prefix was a"b.
        return quoted[1] === "'"
            ? quoted[2].replace(/''/g, "'")
            : quoted[2].replace(/\\(["\\/])/g, "$1");
    }
    // A quote that opens and never closes makes the whole frontmatter
    // block unreadable to YAML, so Obsidian shows no properties at all,
    // and there is no prefix to honor (Kimi sweep 2026-09-13; the same
    // reasoning as an unclosed block, below). A quote that closes with
    // more text after it ("2." # chapter) is a different case: the value
    // is read whole and refused as invalid, per the "#" ruling above.
    if (/^(["'])(?:(?!\1).)*$/.test(value)) return null;
    return value;
}

/**
 * The note's `footnote-prefix` frontmatter value, or "" when it has none.
 *
 * Why a prefix exists: when one document is assembled from chapter notes,
 * each chapter sets a prefix (say "2.") so the numbered command creates
 * "[^2.1]", "[^2.2]", and so on. The names then stay unique once the
 * chapters are merged into a single export (issue #31).
 *
 * It walks the head of the note one line at a time rather than splitting
 * the whole document into lines. Lint calls this several times on the full
 * note text, so splitting would be wasteful (2026-08-11 review, a
 * performance item).
 */
export function footnotePrefix(markdownText: string): string {
    let lineStart = 0;
    let first = true;
    // If the property is written twice, the FIRST line wins. Its value only
    // becomes real once the frontmatter block CLOSES: Obsidian shows no
    // properties at all out of an unclosed "---" block (2026-08-11 review,
    // bug #11, ground-truthed against Obsidian's own metadataCache).
    // Honoring an unclosed block would namespace the note's footnotes from
    // a setting the user cannot see.
    let value: string | null = null;
    for (;;) {
        let lineEnd = markdownText.indexOf("\n", lineStart);
        if (lineEnd === -1) lineEnd = markdownText.length;
        const line = stripCrLine(markdownText.slice(lineStart, lineEnd));
        if (first) {
            // a byte order mark in front of the opener is Obsidian's own
            // frontmatter still; YAML's "..." end marker is no closer to
            // Obsidian (both probed 2026-09-21)
            if (line.replace(/^\ufeff/, "") !== "---") return "";
            first = false;
        } else if (/^---\s*$/.test(line)) {
            return value ?? "";
        } else if (value === null) {
            // YAML wants a space after the colon. Written without one,
            // "footnote-prefix:2." is just a line of text to YAML, not a
            // property, and Obsidian does not show it as one, so the
            // pattern insists on the space (bug-prefix-yaml-comment).
            // Spaces or tabs between the key and the colon are fine to
            // YAML, and Obsidian shows such a property (Kimi sweep
            // 2026-09-13), so they are fine here.
            const match = line.match(/^footnote-prefix[ \t]*:(?:\s+(.*))?$/);
            // The "(?:\s+(.*))?" part of the pattern is optional on
            // purpose. match[1] is undefined when the property is written
            // with no value after it at all.
            if (match) {
                const parsed = parsePrefixValue(match[1]);
                if (parsed === null) return ""; // the block is unreadable as YAML
                value = parsed;
            }
        }
        if (lineEnd === markdownText.length) return ""; // ran off the end, so the block never closed
        lineStart = lineEnd + 1;
    }
}

/**
 * The same answer as footnotePrefix, but read through the editor's
 * line-by-line API so that only the note's frontmatter block is touched.
 *
 * The guards that run on every press used to call doc.getValue(), which
 * builds a string of the entire document each time, on every press, while
 * the prefix feature is on (performance, 2026-08-07). This version stops at
 * the closing fence. The parsing itself is handed to footnotePrefix, so the
 * two readers cannot drift apart.
 */
export function footnotePrefixFromEditor(doc: Editor): string {
    if (stripCrLine(doc.getLine(0)).replace(/^\ufeff/, "") !== "---") return "";
    const lines = ["---"];
    for (let i = 1; i < doc.lineCount(); i++) {
        const line = stripCrLine(doc.getLine(i));
        lines.push(line);
        if (/^---\s*$/.test(line)) break;
    }
    return footnotePrefix(lines.join("\n"));
}

/**
 * Says why `prefix` can't be used as a footnote prefix, or returns null
 * when it can. The Set-footnote-prefix modal, the insert path, and the lint
 * guard all ask this one function.
 *
 * A prefix ending in a digit is the dangerous case. With the prefix "10",
 * the first footnote is named [^101], which is indistinguishable from a
 * plain numbered footnote. Reindex then renumbers it, and the separate
 * namespace the prefix exists to preserve collapses.
 */
export function footnotePrefixProblem(prefix: string): string | null {
    if (!prefix) return null;
    // "#" is refused on top of the ordinary name rules, for two reasons.
    // A "#" at the start is a YAML comment to Obsidian, so the property
    // shows as empty and the prefix would come from a value the user can't
    // see. And a "#" ANYWHERE in a name is one the popup can never bind to,
    // because the link it builds uses "#" as its own delimiter. (Jason's
    // report, 2026-09-05: a "#chapter-" prefix minted the name
    // "[^#chapter-1]", the popup never came up, and the waiting notice sat
    // there until it hit the cap.)
    if (!isValidFootnoteName(prefix) || /[[\]#]/.test(prefix)) {
        return `The footnote prefix can't contain spaces, backticks, brackets, or "#".`;
    }
    if (/\d$/.test(prefix)) {
        return "The footnote prefix can't end in a number. Its footnotes would be indistinguishable from plain numbered ones.";
    }
    return null;
}

// The prefix an insert should actually use. It is "" when the feature is
// switched off in settings or the note has no prefix, the prefix itself
// when the prefix works, and null when it can't. Null BLOCKS the insert and
// shows an explanation; falling back to an unprefixed footnote was worse,
// because it just left the user something to delete (reported 2026-08-07).
//
// The prefix arrives already extracted, so each caller can pick the cheaper
// way to read it: footnotePrefixFromEditor on a press, footnotePrefix when
// the full note text is already in hand (review item F1 - never build a
// string of the whole document on a keypress).
//
// `opener` is how the refusal starts: "footnotes" for a press with several
// cursors, "convert" for a conversion.
export function activeFootnotePrefix(
    plugin: FootnotePlugin,
    prefix: string,
    opener: Opener = "footnote",
): string | null {
    if (!plugin.settings.enableFootnotePrefix) return "";
    if (!prefix) return "";
    const problem = footnotePrefixProblem(prefix);
    if (problem) {
        showNotice(
            refusal(opener, invalidPrefix(prefix, problem)),
            8000,
        );
        return null;
    }
    return prefix;
}
