import { Notice } from "obsidian";

import { quotedReference } from "../parsing/footnote-grammar";

// Every toast the plugin shows goes through showNotice.
//
// The problem it solves: Obsidian's notice uses `overflow-wrap: anywhere`,
// which lets a full line break between ANY two characters. So a quoted
// footnote name could come out as `Add a"` at the end of one line and
// `[^bob]" reference` at the start of the next (Jason's report 2026-09-04,
// right after every toast gained the quotes for consistency).
//
// A quoted reference should read as one thing, so it is wrapped in a
// no-wrap span: the quotes, the brackets and the name always land on the
// same line. A message with none of them stays a plain string.

// ---- Shared toast text ------------------------------------------------
// One string per rule, assembled from shared pieces (Jason, 2026-09-05).
// A refusal that means the same thing says the same thing wherever it
// fires, which leaves fewer separate strings to keep in step and, later,
// to translate.

/** The opening words every "nothing was created" refusal starts with. */
export const NoFootnoteCreated = "No footnote was created: ";
/** The same opener in the plural, for a multi-caret press. */
const NoFootnotesCreated = "No footnotes were created: ";
/** The opener lint uses when a note cannot be linted at all. */
export const LintingCanceled = "Linting canceled: ";

/** The one nesting rule, worded once. It covers a caret inside a definition
 * body, a selection that already holds a footnote, and a caret inside a
 * footnote among otherwise plain-text carets. */
const NestingRule = "footnotes can't be nested inside other footnotes.";
export const NestedFootnoteNotice = NoFootnoteCreated + NestingRule;
export const MultiCaretNestedNotice = NoFootnotesCreated + NestingRule;

/** A press with the caret in a line's block syntax: a quote or list marker, a
 * task box, a heading's "#" marks, a thematic break, a setext underline
 * (Jason's wording, 2026-10-03). Code, math, and comments keep the
 * protected-text notice. */
export const BlockSyntaxNotice = NoFootnoteCreated + "a footnote here would break the line's formatting. Move the caret into the text.";

/** A press whose new reference Obsidian would read as part of a link, a
 * reference link, an image, or a wikilink: the caret on the last word of
 * "[sic]" writes "[sic][^1]", a reference link with no footnote in it
 * (Jason's wording, 2026-10-04). Code, math, and comments keep the
 * protected-text notice. */
export const InsideLinkNotice = NoFootnoteCreated + "Obsidian would read it as part of a link.";

/** A press whose new footnote Obsidian would not read as one, for no
 * reason a more particular notice names: not protected text, not a link
 * (the result gate's reason "dead"). It borrowed the protected-text
 * notice, which named code or math that was not there (Jason's wording,
 * ruling 7 of the cycle 6 rulings, 2026-10-08; hunt 2026-10-08 cycle 6,
 * cluster Z8). */
export const DeadFootnoteNotice = NoFootnoteCreated + "Obsidian wouldn't read it as a footnote here.";

/** The end of every refusal for an edit that would change how Obsidian
 * reads the note somewhere it was not asked to: the result gate's general
 * reason, when no more particular one fits (Jason's wording, 2026-10-08).
 * Each action opens it with its own outcome. */
const ReadsDifferently = "it would change how Obsidian reads the text around it.";
export const ReadsDifferentlyNotice = NoFootnoteCreated + ReadsDifferently;

/** A cut the result gate refused: nothing is cut or copied (Jason, 2026-10-08). */
export const NothingCutNotice = "Nothing was cut: " + ReadsDifferently;

/** A carried paste the result gate refused: nothing is pasted, and the
 * notice says why, by the gate's reason (Jason, 2026-10-08). */
export const PasteNestedNotice = "Nothing was pasted: the pasted footnotes would land inside another footnote.";
export const PasteProtectedNotice = "Nothing was pasted: footnotes can't go inside code, math, or other protected text.";
export const PasteReadsDifferentlyNotice = "Nothing was pasted: " + ReadsDifferently;

/** The advice for a definition nothing references. The navigation press and
 * the lint alert give the same advice. */
export function addReferenceOrDeleteDefinition(name: string): string {
    return `Add a ${quotedReference(name)} reference in the text, or delete the definition.`;
}

/** A name another footnote already carries. The named-selection modal and
 * the Rename modal say the same thing. */
export function nameAlreadyUsed(name: string): string {
    return `${quotedReference(name)} is already used by another footnote.`;
}

/** An invalid footnote-prefix property, worded the same way whether the
 * insert refuses or the lint cancels. */
export function invalidPrefixMessage(opener: string, prefix: string, problem: string): string {
    return `${opener}this note's footnote-prefix ("${prefix}") is invalid. ${problem}`;
}

/** A quoted footnote reference, exactly as the toasts spell it:
 * `"[^name]"`, including the empty `"[^]"` and bare-prefix `"[^2.]"`
 * placeholders, and the quoted label `"[^name]:"` that the lazy-definition
 * alert uses. */
// A name may contain a double quote (only whitespace, backticks, brackets
// and "#" are refused), so the run inside the brackets stops at "]" alone;
// stopping at a quote too left such a name to wrap (Claude sweep
// 2026-09-13).
const QuotedReference = /"\[\^[^\]]*\]:?"/g;

/** The message cut into runs. A run marked `nowrap` is a quoted reference,
 * which must not be broken across two lines. */
export function noticeSegments(message: string): { text: string; nowrap: boolean }[] {
    const segments: { text: string; nowrap: boolean }[] = [];
    let last = 0;
    for (const match of message.matchAll(QuotedReference)) {
        if (match.index > last) {
            segments.push({ text: message.slice(last, match.index), nowrap: false });
        }
        segments.push({ text: match[0], nowrap: true });
        last = match.index + match[0].length;
    }
    if (last < message.length) {
        segments.push({ text: message.slice(last), nowrap: false });
    }
    return segments;
}

/**
 * Show a toast. Every quoted footnote reference in `message` is kept on one
 * line, each in its own no-wrap span. A message with none of them, or a
 * host that has no Obsidian DOM helpers (unit tests), is handed to
 * Obsidian's Notice as the plain string.
 */
export function showNotice(message: string, duration?: number): Notice {
    const segments = noticeSegments(message);
    if (typeof createFragment !== "function" || !segments.some((segment) => segment.nowrap)) {
        return new Notice(message, duration);
    }
    const fragment = createFragment();
    for (const segment of segments) {
        if (segment.nowrap) {
            fragment.createSpan({ cls: "footnote-shortcut-nowrap", text: segment.text });
        } else {
            fragment.appendText(segment.text);
        }
    }
    return new Notice(fragment, duration);
}
