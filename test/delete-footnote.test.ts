import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { docArb } from "./arbitraries";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import {
    deleteFootnote,
    deleteFootnoteEverywhere,
    DeleteTargetNotice,
} from "../src/commands/delete-footnote";
import { definitionLabelWithName } from "../src/parsing/label-shapes";
import { normalizeEol } from "../src/parsing/line-edits";
import { readNote } from "../src/parsing/note-reading";

// Deleting a footnote everywhere (T4, Jason's rulings 2026-09-19 to 21):
// the definition and EVERY reference to it go in one step, whichever end
// the caret was on. Obsidian's own right-click "Delete footnote and
// reference" removes only the one reference clicked, so a footnote cited
// twice keeps a dangling reference (Jason's report 2026-09-19). The
// transform probed here is pure markdown-to-markdown; the command is thin
// wiring over it.

function del(lines: string[], name: string) {
    return deleteFootnoteEverywhere(lines.join("\n"), name);
}

describe("deleteFootnoteEverywhere", () => {
    it("removes the reference and the definition and closes the gap", () => {
        expect(del(["prose[^1] more", "", "[^1]: one"], "1")).toEqual({
            kind: "deleted",
            markdown: "prose more",
            references: 1,
            definitions: 1,
        });
    });

    it("deletes EVERY reference of a footnote cited twice (core's delete leaves the second one dangling)", () => {
        expect(del(["a[^n] b[^n] c", "", "[^n]: n"], "n")).toEqual({
            kind: "deleted",
            markdown: "a b c",
            references: 2,
            definitions: 1,
        });
    });

    it("matches the name without regard to case, as Obsidian does", () => {
        expect(del(["see [^Note] here", "", "[^note]: n"], "NOTE")).toMatchObject({
            kind: "deleted",
            markdown: "see here",
        });
    });

    it("leaves copies inside a code fence and a code span alone: they are plain text", () => {
        expect(del(["real[^x] and `[^x]` inline", "```", "fake [^x]", "```", "", "[^x]: x"], "x")).toEqual({
            kind: "deleted",
            markdown: "real and `[^x]` inline\n```\nfake [^x]\n```",
            references: 1,
            definitions: 1,
        });
    });

    it("reports nothing to delete for a name the note does not use", () => {
        expect(del(["prose[^1]", "", "[^1]: one"], "2")).toEqual({ kind: "nothing" });
    });

    it("cuts a reference that sits inside ANOTHER definition's body", () => {
        expect(del(["a[^a]", "", "[^a]: see[^b]", "[^b]: b"], "b")).toEqual({
            kind: "deleted",
            markdown: "a[^a]\n\n[^a]: see",
            references: 1,
            definitions: 1,
        });
    });

    it("takes a definition's whole body, continuation lines and blank gaps included, and does not count references inside it", () => {
        expect(del(["t[^m]", "", "[^m]: first[^m]", "    second", "", "    third[^m]", "", "after"], "m")).toEqual({
            kind: "deleted",
            markdown: "t\n\nafter",
            references: 1,
            definitions: 1,
        });
    });

    it("keeps Windows line endings", () => {
        expect(deleteFootnoteEverywhere("p[^1] q\r\nkeep\r\n\r\n[^1]: one", "1")).toMatchObject({
            kind: "deleted",
            markdown: "p q\r\nkeep",
        });
    });

    it("removes a definition written inside a blockquote together with its quoted continuation", () => {
        expect(del(["p[^q]", "", "> [^q]: quoted", "> more of it", "", "tail"], "q")).toEqual({
            kind: "deleted",
            markdown: "p\n\ntail",
            references: 1,
            definitions: 1,
        });
    });

    it("refuses a definition whose line closes a %% comment, since cutting the line would leave the comment open", () => {
        const plan = del(["p[^c] q", "", "%%", "hidden", "%% [^c]: after the closer"], "c");
        expect(plan.kind).toBe("refused");
        if (plan.kind !== "refused") throw new Error("unreachable");
        expect(plan.reason).toContain('"[^c]:"');
        expect(plan.reason).toContain("%%");
    });

    it("deletes a lazy label (a label directly under prose) as the definition the user meant", () => {
        expect(del(["prose[^l] here", "[^l]: one blank line short", "", "after"], "l")).toEqual({
            kind: "deleted",
            markdown: "prose here\n\nafter",
            references: 1,
            definitions: 1,
        });
    });

    it("deletes an underlined label together with the setext underline that made it a heading", () => {
        expect(del(["p[^u]", "", "[^u]: text", "===", "", "after"], "u")).toEqual({
            kind: "deleted",
            markdown: "p\n\nafter",
            references: 1,
            definitions: 1,
        });
    });

    // Jason, 2026-09-22: Obsidian's own delete removes a definition inside a
    // list item, so this command does too where it can tell the extent: a
    // single line, on the item's marker line or indented under the item.
    // Jason, 2026-09-24 (the feature-round sheet): Obsidian's delete leaves the bullet in
    // front of the definition standing, so this one does too; only the
    // definition text goes, and the item is left empty.
    it("deletes a single-line definition inside a list item, on the marker line or indented under the item", () => {
        expect(del(["- item[^i]", "- [^i]: in the item"], "i")).toEqual({
            kind: "deleted",
            markdown: "- item\n- ",
            references: 1,
            definitions: 1,
        });
        expect(del(["1. item[^i]", "2. [^i]: in the item", "3. next"], "i")).toEqual({
            kind: "deleted",
            markdown: "1. item\n2. \n3. next",
            references: 1,
            definitions: 1,
        });
        expect(del(["- item[^i]", "", "  [^i]: under the item", "- next"], "i")).toMatchObject({
            kind: "deleted",
            markdown: "- item\n\n- next",
            definitions: 1,
        });
    });

    // Jason's ruling 1, option a (2026-10-03): the note reading knows where
    // an in-item definition ends, so one that runs on to another line is
    // deleted whole instead of refused; the bullet stays, as above.
    it("deletes an in-item definition that runs on to another line, its continuation included", () => {
        expect(del(["- item[^i]", "- [^i]: first line", "  continued"], "i")).toEqual({
            kind: "deleted",
            markdown: "- item\n- ",
            references: 1,
            definitions: 1,
        });
    });

    it("refuses a cut that would change how Obsidian reads the line (a leftover marker turning prose into a bullet)", () => {
        const plan = del(["-[^9] tail", "", "[^9]: nine"], "9");
        expect(plan.kind).toBe("refused");
        if (plan.kind !== "refused") throw new Error("unreachable");
        expect(plan.reason).toContain('"[^9]"');
    });
});

/** Every live mention of a name in `markdown`, lower-cased: references on unprotected lines (a lazy label's head counts, as it renders) and the labels that start definitions. */
function liveNames(markdown: string): string[] {
    const lines = normalizeEol(markdown).text.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    const names: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (reading.protectedLines[i]) continue;
        for (const { name } of readNote(lines).referencesOn(i)) {
            names.push(name.toLowerCase());
        }
        if (starts[i]) {
            const hit = definitionLabelWithName(lines[i], masked[i]);
            if (hit) names.push(hit.name.toLowerCase());
        }
    }
    return names;
}

describe("delete property", () => {
    fc.configureGlobal({ numRuns: Number(process.env.FC_NUM_RUNS ?? 200) });

    it("is total, and after a deletion no live reference or definition of the name remains, and deleting again finds nothing", () => {
        fc.assert(
            fc.property(docArb, fc.nat(1000), (raw, pick) => {
                const names = [...new Set(liveNames(raw))];
                if (names.length === 0) {
                    expect(deleteFootnoteEverywhere(raw, "zz-absent")).toEqual({ kind: "nothing" });
                    return;
                }
                const name = names[pick % names.length];
                const plan = deleteFootnoteEverywhere(raw, name);
                if (plan.kind === "nothing") {
                    // every live name found above is a reference or a
                    // definition, so there is always something to delete
                    throw new Error(`nothing to delete for a live name ${name}`);
                }
                if (plan.kind === "refused") return;
                expect(liveNames(plan.markdown)).not.toContain(name);
                expect(deleteFootnoteEverywhere(plan.markdown, name)).toEqual({ kind: "nothing" });
                expect(plan.references + plan.definitions).toBeGreaterThan(0);
            }),
        );
        // each deletion reads the note before and after, which under a full
        // parallel suite can take longer than vitest's default five seconds
    }, Math.max(30_000, Number(process.env.FC_NUM_RUNS ?? 200) * 60));
});

describe("the command entry", () => {
    it("deletes the footnote under the caret in ONE transaction and says what went", async () => {
        resetNotices();
        const doc = fakeEditor(["a[^n] b[^n] c", "", "[^n]: n"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 3 },
            selection: { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
        });
        await deleteFootnote(fakePlugin({}, doc));
        expect(doc.lines).toEqual(["a b c"]);
        expect(doc.transactions).toBe(1);
        expect(messages()).toContain('Deleted "[^n]" everywhere: 2 references and 1 definition.');
    });

    // a zero count is left out of the toast, as the paste toast leaves
    // its zeros out (Jason, 2026-09-25)
    it("says only the non-zero count when a footnote had no definition, or no reference", async () => {
        resetNotices();
        const orphanReference = fakeEditor(["a[^n] b"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 3 },
            selection: { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
        });
        await deleteFootnote(fakePlugin({}, orphanReference));
        expect(messages()).toContain('Deleted "[^n]" everywhere: 1 reference.');
        resetNotices();
        const orphanDefinition = fakeEditor(["p", "", "[^n]: n"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 2, ch: 3 },
            selection: { anchor: { line: 2, ch: 3 }, head: { line: 2, ch: 3 } },
        });
        await deleteFootnote(fakePlugin({}, orphanDefinition));
        expect(messages()).toContain('Deleted "[^n]" everywhere: 1 definition.');
    });

    it("explains itself when the caret is on nothing deletable", async () => {
        resetNotices();
        const doc = fakeEditor(["plain prose here"], {
            wholeDoc: true,
            cursor: { line: 0, ch: 3 },
            selection: { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
        });
        await deleteFootnote(fakePlugin({}, doc));
        expect(messages()).toContain(DeleteTargetNotice);
    });
});
