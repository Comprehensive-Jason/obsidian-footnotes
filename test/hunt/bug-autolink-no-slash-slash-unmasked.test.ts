// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// PARTLY REFUTED 2026-09-16 (probed in Reading view): Obsidian is not laxer than CommonMark here but different. "scheme://" and any angle-bracketed run holding an "@" are links (dead inside); "<ftp:x>", "<tel:+1>", and "<mailto:x>" without an "@" are literal text with the reference live. The masker now follows Reading view; the ftp and tel tests are kept as refuted controls.
import { describe, expect, it } from "vitest";

import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";

import { readNote } from "../../src/parsing/note-reading";

// The masker's autolink branch only recognizes a scheme followed by "://":
// /^<[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]*>/. CommonMark §6.7 asks for a
// scheme (2-32 chars) followed by a COLON and then anything up to ">" -
// so "<ftp:x/y>", "<mailto:a@b.c>", and "<tel:+123>" are autolinks too,
// and a "[^1]" inside one is part of the URI, dead text (verified against
// the micromark oracle in node_modules: fromMarkdown("see <ftp:x/y[^1]>
// here") parses a link node whose url is "ftp:x/y[^1]" with no
// footnoteReference anywhere). The one-letter-scheme probe of 2026-09-16
// (spec-unverified-reading-view-shapes, RESOLVED) found Reading view
// killing the reference inside "<a://b[^1]>" - Obsidian is LAXER than
// CommonMark on autolinks, never stricter, so these valid CommonMark
// autolinks are dead text there as well. Yet the plugin counts a "[^1]"
// inside them as a live reference.
//
// What the user sees: with no definition for "1", the orphan alert nags
// about a footnote that does not exist; with `Delete orphaned references`
// ON, lint cuts the "[^1]" out of the URI ("see <ftp:x/y> here") - user
// text destroyed inside a link. Reindex renumbers it and silently rewrites
// the URI.
//
// Source of truth: CommonMark 0.31 §6.7 (autolinks) via the micromark
// oracle; the plugin's own stated rule (maskLineRegions, Kimi hunt cycle
// 1: "text inside ... an autolink ... is dead and masked") of which this
// is an under-wide grammar; Reading view's one-letter-scheme probe
// (Obsidian never stricter than CommonMark here).
//
// Settings involved: `Delete orphaned references` (the destructive half);
// every other rule inherits the scan.

describe("a reference inside a no-// autolink (<ftp:x>, <mailto:x>) is dead text", () => {
    it("REFUTED: an ftp: scheme without \"//\" is not an autolink to Obsidian, so its reference is live", () => {
        // Reading view renders "<ftp:x/y[^1]>" as typed with the footnote
        // live (probed 2026-09-16): Obsidian links "scheme://" and email
        // addresses only, and the plugin follows Reading view
        expect(readNote(["see <ftp:x/y[^1]> here"]).referencesOn(0).map((o) => o.name)).toEqual(["1"]);
    });
    it("an email autolink's interior is masked (anything in angle brackets with an \"@\")", () => {
        // "<foo@bar.com[^1]>" and even "<xmpp:a@b[^1]>" render as links
        // with the reference swallowed (probed 2026-09-16)
        for (const line of ["see <foo@bar.com[^1]> here", "see <xmpp:a@b[^1]> here", "see <MAILTO:a@b.c[^1]> here"]) {
            expect(readNote([line]).referencesOn(0)).toEqual([]);
        }
    });
    it("control: a mailto: without an \"@\" is literal text, reference live (probed 2026-09-16)", () => {
        const line = "see <mailto:x[^1]> here";
        expect(readNote([line]).referencesOn(0).map((o) => o.name)).toEqual(["1"]);
    });

    it("a mailto: email autolink's interior is masked", () => {
        expect(readNote(["see <mailto:foo@bar.com[^1]> here"]).referencesOn(0)).toEqual([]);
    });

    it("REFUTED: a tel: scheme is not an autolink to Obsidian either, so its reference is live", () => {
        expect(readNote(["see <tel:+12345[^1]> here"]).referencesOn(0).map((o) => o.name)).toEqual(["1"]);
    });

    it("orphaned-reference listing does not name a reference inside <mailto:a@b.c[^9]>", () => {
        expect(orphanedFootnoteReferenceNames("see <mailto:a@b.c[^9]> here")).toEqual([]);
    });

    it("control: the http: autolink is masked (the existing behavior)", () => {
        expect(readNote(["see <http://x[^1]> here"]).referencesOn(0)).toEqual([]);
    });

    it("control: a plain reference outside any autolink stays live", () => {
        expect(readNote(["see <ftp:x/y> and [^1] here"]).referencesOn(0).map((o) => o.name)).toEqual(["1"]);
    });
});
