import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { planCarriedPaste } from "../../src/commands/carry-footnotes";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import type { FootnotePluginSettings } from "../../src/settings";

// spec question: should the paste's renames know about the note's footnote
// prefix (the "footnote-prefix" frontmatter property that numbers a note's
// footnotes as 2.1, 2.2, and so on)?
//
// What it does now: the rename treats a prefixed number such as [^2.1] as
// a name, not a number, so a colliding [^2.1] becomes [^2.1-2]. A footnote
// pasted from a "2." note into a "3." note keeps [^2.1]; with lint on
// creation and Apply the note's footnote prefix on, the linter then puts
// the note's prefix in front of it and the definition lands as
// "[^3.2.1]: theirs".
// What a user might expect: a colliding [^2.1] takes the next free number
// in the same prefix, [^2.3]. A footnote that arrives in a "3." note and
// is given the note's prefix is numbered within it, [^3.2].
// Why it is a question and not a bug: the README's rename rule speaks of
// "a number" and "a name", and a prefixed number is both. Which one the
// rule meant for prefixed footnotes, and whether a paste should adopt the
// destination's prefix, is a product decision for Jason.
//
// Hunt 2026-10-02, round 1, lenses carry-int and carry-plan. Cluster C22.
//
// Source of truth: the README's Paste paragraph, "a name the destination
// already uses for something else is renamed, a number to the next free
// number, a name to name-2", and the README's prefix section, where the
// linter "renumbers [^2-x] footnotes within their own namespace".

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

type Pos = { line: number; ch: number };

// A fake editor holding `lines`, with the selection running from `from`
// to `to`.
const editor = (lines: string[], from: Pos, to: Pos = from) =>
    fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });

const on: Partial<FootnotePluginSettings> = { carryFootnotesOnCopy: true };

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: the paste's renames and the note's footnote prefix", () => {
    it.fails("a colliding prefixed number takes the next free prefixed number, not name-2", () => {
        const destination = "---\nfootnote-prefix: 2.\n---\nx[^2.1] y[^2.2]\n\n[^2.1]: a\n[^2.2]: b";
        const plan = planCarriedPaste(destination, "z[^2.1]", [one("2.1", "[^2.1]: incoming")]);
        expect(plan.body).toBe("z[^2.3]");
    });

    it.fails("paste from a 2. note into a 3. note with lint on creation and apply-prefix on: 2.1 becomes 3.2, not 3.2.1", () => {
        const dest = editor(["---", "footnote-prefix: 3.", "---", "x[^3.1]", "", "[^3.1]: mine"], { line: 3, ch: 7 });
        const settings: Partial<FootnotePluginSettings> = {
            ...on,
            enableFootnotePrefix: true,
            lintApplyPrefix: true,
            lintOnFootnoteCreation: true,
            lintReindex: true,
            lintMoveToBottom: true,
            footnoteNaming: "keep",
        };
        handlePaste(fakePlugin(settings, dest), clipboardEvent("a[^2.1]\n\n[^2.1]: theirs") as never, dest);
        // A footnote that comes into a "3." note and is given the note's
        // prefix should be numbered in it (3.2), not 3.2.1.
        expect(dest.lines).toContain("[^3.2]: theirs");
    });
});
