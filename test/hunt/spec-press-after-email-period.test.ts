import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { readNote } from "../../src/parsing/note-reading";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { DEFAULT_SETTINGS } from "../../src/settings";

// spec question: under After placement, a press at the end of a sentence
// that ends in an email address is refused. Should it land in front of
// the period instead?
//
// What it does now: "Write to me@example.com.", the caret at the end of
// the line after the period, default settings (After). The press is
// refused with "No footnote was created: Obsidian would read it as part of
// a link." The refusal is right about the spot it would write:
// "me@example.com.[^1]" makes Obsidian link "me@example.com." with the
// period inside the link (live answer c6:z17-email-ref). The same happens
// with the caret on the address itself, where After carries the
// reference past the period.
// What a user might expect: footnote 1 created, since a spot that works
// is right there: "Write to me@example.com[^1]." shows footnote 1 and
// links the address as it was (live answer c6:z17-email-before). Under
// Before placement, a press on the address already lands there.
//
// The options, recommended first:
// (a) Land in front of the period: "Write to me@example.com[^1].", which is
// live and keeps the link as it is. Recommended: the user gets a footnote,
// and the link does not change.
// (b) Keep refusing.
// (c) Refuse with a notice that says why: the period would join the email
// address's link.
// The tests below assert (a).
//
// Why it is a question and not a bug: the refusal stops a real change to
// the link (rule D8), so the plugin does nothing wrong. Whether After
// should give way to Before in this one shape, rather than refuse, is a
// product decision for Jason.
//
// Hunt 2026-10-08, cycle 6. Cluster Z17, triage question Q30. The hunter
// expected "Write to me@example.com.[^1]"; the live answers refuted that.
//
// Origin: the refusal comes from 6dc4c29 (links compared by their shape),
// which is right here, and the result gate kept it.
//
// Source of truth: live answers c6:z17-email-ref, c6:z17-email-plain
// ("Write to me@example.com." links the address without the period), and
// c6:z17-email-before, Obsidian 1.14.4 on sprout, 2026-10-08;
// docs/obsidian-reading-rules.md D8 (an email address takes a period that
// text follows).

const line = "Write to me@example.com.";

/** Presses the numbered key with the caret at `ch` of the line under the given placement, and returns the editor. */
async function press(ch: number, footnotePlacement: FootnotePlacement = DEFAULT_SETTINGS.footnotePlacement) {
    const doc = fakeEditor([line, "", "More text."], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false, footnotePlacement }, doc));
    return doc;
}

beforeEach(resetNotices);

describe("a press at the end of a sentence ending in an email address", () => {
    it("control: the default placement is After", () => {
        expect(DEFAULT_SETTINGS.footnotePlacement).toBe("after");
    });

    it("control: the plugin's reader reads the spot in front of the period as live", () => {
        expect(readNote(["Write to me@example.com[^1].", "", "[^1]: one"]).referencesOn(0).map((r) => r.name)).toEqual(["1"]);
    });

    it("control: under Before, a press on the address lands in front of the period", async () => {
        const doc = await press("Write to me@example.com".length, "before");
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["Write to me@example.com[^1].", "", "More text.", "", "[^1]: "]);
    });

    // Now: refused with the link notice, and the note is unchanged.
    it.fails.each([
        ["after the period", line.length],
        ["on the address", "Write to me@example.com".length],
    ])("spec (a): under After, a press with the caret %s lands in front of the period", async (_where, ch) => {
        const doc = await press(ch);
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(["Write to me@example.com[^1].", "", "More text.", "", "[^1]: "]);
    });
});
