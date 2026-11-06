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
//
// Every refusal is built the same way: an opener that says what did not
// happen, one reason from the list below, and sometimes a piece of advice
// (Jason's choice, 2026-10-22, run toast-consolidate). refusal() puts them
// together, so no refusal is written out in full anywhere else.

/** The opening words of every refusal, one per kind of action. A press with
 * several cursors always gets the plural one, "footnotes". */
const Openers = {
    footnote: "No footnote was created",
    footnotes: "No footnotes were created",
    paste: "Nothing was pasted",
    cut: "Nothing was cut",
    delete: "Nothing was deleted",
    convert: "Nothing was converted",
    lint: "Linting canceled",
} as const;
export type Opener = keyof typeof Openers;

/** The shared reasons, each worded once. All but the last are also the
 * reasons the result gate gives (GateReason in result-gate.ts), so a refusal
 * the gate makes picks its sentence by the gate's reason. */
export const Reason = {
    protected: "footnotes can't go inside code, math, or other protected text.",
    nested: "footnotes can't be nested inside other footnotes.",
    link: "Obsidian would read it as part of a link.",
    formatting: "it would break the line's formatting.",
    dead: "Obsidian wouldn't read it as a footnote here.",
    other: "it would change how Obsidian reads the text around it.",
    cutsProtected: "the selection cuts through code, math, or other protected text.",
} as const;

/** The advice that ends some refusals. Each is attached to the reason it
 * helps with at the place that shows it. */
export const Advice = {
    cursorIntoText: "Move the cursor into the text.",
    cursorsIntoText: "Move the cursors into the text.",
    intoCell: "Put it inside a cell.",
    allOrNone: "Select all of it or none of it.",
    wholeLine: "Select the whole line, or only its text.",
    oneItem: "Select one item's text, or the whole list.",
    oneQuoteLine: "Select one line's text, or the whole quote.",
    deleteByHand: "Delete it by hand.",
    convertByHand: "Convert it by hand.",
} as const;

/** A refusal: the opener, a colon, the reason, and the advice when there is
 * any. `reason` is one of Reason's sentences, invalidPrefix's, or a
 * sentence only one place uses. */
export function refusal(opener: Opener, reason: string, advice?: string): string {
    return `${Openers[opener]}: ${reason}${advice === undefined ? "" : ` ${advice}`}`;
}

/** The reason for a note whose footnote-prefix property cannot be used,
 * worded the same way whether a press refuses, a conversion refuses, or the
 * lint cancels. `problem` is the sentence footnotePrefixProblem gives. */
export function invalidPrefix(prefix: string, problem: string): string {
    return `this note's footnote-prefix ("${prefix}") is invalid. ${problem}`;
}

/** The advice for a press whose caret sits in a line's block syntax: move
 * the cursor, or the cursors when there were several. */
export function cursorAdvice(opener: Opener): string {
    return opener === "footnotes" ? Advice.cursorsIntoText : Advice.cursorIntoText;
}

/** "a", "a and b", or "a, b, and c": a list inside a sentence, with the
 * Oxford comma. */
export function andList(items: readonly string[]): string {
    if (items.length <= 2) return items.join(" and ");
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The advice for a definition nothing references. The navigation press and
 * the lint alert give the same advice. `byHand` is for a definition the lint
 * tried to delete and could not, so the user knows the next lint won't do it. */
export function addReferenceOrDeleteDefinition(name: string, byHand = false): string {
    return `Add a ${quotedReference(name)} reference in the text, or delete the definition${byHand ? " by hand" : ""}.`;
}

/** The same advice for several definitions nothing references. */
export function addReferencesOrDeleteDefinitions(byHand = false): string {
    return `Add their references in the text, or delete the definitions${byHand ? " by hand" : ""}.`;
}

/** The advice for a reference or inline footnote nested in a definition. `what` is the quoted footnote, or "them". */
export function moveIntoText(what: string): string {
    return `Move ${what} into the text.`;
}

/** The advice for a definition written inside another definition: into the
 * text would be the wrong place for it, since a definition belongs outside
 * the definition that holds it (Jason's choice, 2026-11-05). `what` is the
 * quoted label, or "them", and `holders` are the quoted definitions holding it. */
export function moveOutOfDefinition(what: string, holders: readonly string[]): string {
    return `Move ${what} out of the ${holders.length === 1 ? "definition" : "definitions"} of ${andList(holders)}.`;
}

/** The sentence for something the lint could have changed and did not. `what`
 * is what it left, `one` says whether that is one thing or several, and
 * `doing` is the change it held back: "changing", "deleting", or "merging".
 * It names no cause, so a new reason for leaving something never makes the
 * text wrong (Jason, 2026-10-05). */
export function lintLeft(what: string, one: boolean, doing: string): string {
    return one
        ? `The lint left ${what} as it is, because ${doing} it would change how Obsidian reads the text around it.`
        : `The lint left ${what} as they are, because ${doing} them would change how Obsidian reads the text around them.`;
}

/** The alert for a section heading the lint could not add. It has its own
 * sentence, because the heading was never in the note to be "left as it is"
 * (Jason's choice, 2026-11-05). */
export const SectionHeadingNotAdded = `The lint did not add the footnote section heading, because ${Reason.other}`;

/** A name another footnote already carries. The named-selection modal and
 * the Rename modal say the same thing. */
export function nameAlreadyUsed(name: string): string {
    return `${quotedReference(name)} is already used by another footnote.`;
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
