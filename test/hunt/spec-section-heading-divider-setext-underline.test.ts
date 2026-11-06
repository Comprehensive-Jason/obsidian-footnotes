import { describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { findSectionHeadingEnd } from "../../src/linting/section-heading";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A section heading of "---" in a note whose title is underlined with "---": the
// underline is the same text, but Obsidian reads it as part of the title, not as
// a divider.
//
// What the user saw: the underline counted as the section heading already in the
// note. The move would then split the title from its underline, the result gate
// refused it, and the note stayed as it was on every lint: no divider and no alert
// with the definition at the end, and "The lint left "[^1]:" as it is ... Fix it by
// hand" with it mid-note, advice that does not help.
//
// Hunt 2026-11-06, cycle 9, finding H15. Severity: annoyance. Origin: pre-existing.
//
// Source of truth: the triage of cycle 9 (add the divider at the end as if no
// heading exists); the README (the setting adds a heading above the definitions and
// reuses one already in the note); the note reading's blocks for a setext heading.

const Divider = { ...DEFAULT_SETTINGS, enableFootnoteSectionHeading: true, footnoteSectionHeading: "---" };

/** The lint of `note` under a section heading of `heading`. */
function lint(note: string, heading = "---"): string {
    const plugin = fakePlugin({ ...Divider, footnoteSectionHeading: heading });
    return lintFootnotes(note, lintOptionsFromSettings(plugin, heading, note));
}

/** Where the heading is found in `note`. */
function found(note: string, heading: string): number {
    const lines = note.split("\n");
    return findSectionHeadingEnd(lines, readNote(lines), heading);
}

describe("a divider section heading and a title underlined with ---", () => {
    it("a definition at the end gets a divider of its own, and no alert", () => {
        const after = lint("Title\n---\n\nbody[^1]\n\n[^1]: one");
        expect(after).toBe("Title\n---\n\nbody[^1]\n\n---\n\n[^1]: one");
        resetNotices();
        noticeLintAlerts(fakePlugin(Divider), after);
        expect(messages()).toEqual([]);
    });

    it("a definition mid-note moves below the body, under a divider of its own", () => {
        expect(lint("Title\n---\n\n[^1]: one\n\nbody[^1]")).toBe("Title\n---\n\nbody[^1]\n\n---\n\n[^1]: one");
    });

    it("a second lint changes nothing", () => {
        const once = lint("Title\n---\n\nbody[^1]\n\n[^1]: one");
        expect(lint(once)).toBe(once);
    });

    it("an underline further up does not hide a real divider below it", () => {
        const note = "Title\n---\n\nbody[^1]\n\n---\n\n[^1]: one";
        expect(found(note, "---")).toBe(5);
        expect(lint(note)).toBe(note);
    });

    it("a heading of a divider and a title is not found on a title's underline", () => {
        expect(found("Title\n---\n## Footnotes\n\nbody", "---\n## Footnotes")).toBe(-1);
    });

    it("control: a real divider on its own is reused", () => {
        const note = "body[^1]\n\n---\n\n[^1]: one";
        expect(lint(note)).toBe(note);
    });

    it("control: a heading setting that is itself underlined is found, underline and all", () => {
        expect(found("body\n\nFootnotes\n---\n\n[^1]: one", "Footnotes\n---")).toBe(3);
    });

    it("control: a heading of a divider and a title is found where it reads as those", () => {
        expect(found("body\n\n---\n## Footnotes\n\n[^1]: one", "---\n## Footnotes")).toBe(3);
    });

    it("control: spaces at the end of the line still do not count", () => {
        expect(found("body\n\n--- \n\n[^1]: one", "---")).toBe(2);
    });

    it("control: a heading setting shaped like frontmatter is read as what it is mid-note", () => {
        expect(found("body\n\n---\nfoo\n---\n\n[^1]: one", "---\nfoo\n---")).toBe(4);
    });
});
