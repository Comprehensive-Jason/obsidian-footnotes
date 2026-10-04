import { EditorPosition } from "obsidian";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { docArb } from "./arbitraries";
import { noticeCalls } from "./mocks/obsidian";
import { resetNotices } from "./helpers/notices";
import {
    planFootnoteRename,
    renameFootnote,
    RenameTargetNotice,
    renameTargetAtCursor,
} from "../src/commands/rename-footnote";
import { simulateChanges } from "../src/editor/insertion-liveness";
import { referenceOccurrences } from "../src/parsing/footnote-grammar";
import { readNote } from "../src/parsing/note-reading";
import {
    definitionLabelWithName,
    definitionStartLines,
    findDefinitionBlocks,
    maskedLineAt,
    normalizeEol,
    scanDocument,
} from "../src/parsing/markdown-scan";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

// Renaming a footnote (Jason's calls 2026-08-12): every
// masked-live occurrence - references and definition labels - renames
// case-insensitively in one planned transaction; a taken name refuses
// (collision), invalid names refuse with the reason, and a name the
// simulation can't keep alive refuses whole ("dead"). The modal and the
// command entry are thin wiring over the two pure functions probed here.

function fakeEditor(lines: string[]): FakeEditor {
    return sharedFakeEditor(lines, { wholeDoc: true });
}

function targetAt(lines: string[], cursor: EditorPosition): string | null {
    return renameTargetAtCursor(fakeEditor(lines), cursor);
}

/** Plan and apply, asserting the plan succeeded. */
function rename(lines: string[], oldName: string, newName: string): string[] {
    const plan = planFootnoteRename(fakeEditor(lines), oldName, newName);
    expect(plan.kind).toBe("renamed");
    if (plan.kind !== "renamed") throw new Error("unreachable");
    return simulateChanges(lines, plan.changes);
}

describe("renameTargetAtCursor", () => {
    const lines = [
        "prose with [^note] inside",
        "",
        "[^note]: the definition body has [^other] in it",
        "```",
        "fake [^code] here",
        "```",
    ];

    it("finds the reference under the caret, casing preserved", () => {
        expect(targetAt(["see [^Note] here"], { line: 0, ch: 7 })).toBe("Note");
    });

    it("finds the definition's name from inside its label", () => {
        expect(targetAt(lines, { line: 2, ch: 3 })).toBe("note");
    });

    it("finds a reference inside a definition BODY", () => {
        expect(targetAt(lines, { line: 2, ch: 36 })).toBe("other");
    });

    it("sees nothing in a definition body's plain text", () => {
        expect(targetAt(lines, { line: 2, ch: 12 })).toBeNull();
    });

    it("sees nothing in a code-fenced reference shape", () => {
        expect(targetAt(lines, { line: 4, ch: 8 })).toBeNull();
    });

    it("sees nothing in plain prose", () => {
        expect(targetAt(lines, { line: 0, ch: 2 })).toBeNull();
    });
});

describe("planFootnoteRename", () => {
    it("renames every live occurrence case-insensitively, label included", () => {
        expect(
            rename(["a[^x] b[^X]", "", "[^x]: def"], "x", "y"),
        ).toEqual(["a[^y] b[^y]", "", "[^y]: def"]);
    });

    it("counts the occurrences it rewrote", () => {
        const plan = planFootnoteRename(
            fakeEditor(["a[^x] b[^X]", "", "[^x]: def"]),
            "x",
            "y",
        );
        expect(plan).toMatchObject({ kind: "renamed", count: 3 });
    });

    it("renames a mid-line label-shaped reference too", () => {
        // "[^x]:" mid-line is a live reference followed by a literal colon
        expect(rename(["see [^x]: not a label", "", "[^x]: d"], "x", "y")).toEqual([
            "see [^y]: not a label",
            "",
            "[^y]: d",
        ]);
    });

    it("leaves code-fenced copies untouched", () => {
        expect(
            rename(
                ["live [^x]", "```", "dead [^x]", "```", "[^x]: d"],
                "x",
                "y",
            ),
        ).toEqual(["live [^y]", "```", "dead [^x]", "```", "[^y]: d"]);
    });

    it("refuses a name another footnote already uses (any casing)", () => {
        expect(
            planFootnoteRename(
                fakeEditor(["a[^x] b[^Z]", "", "[^x]: d", "[^z]: e"]),
                "x",
                "z",
            ),
        ).toEqual({ kind: "collision" });
    });

    it("allows a case-only rename of the SAME footnote", () => {
        expect(rename(["a[^x]", "", "[^X]: d"], "x", "X")).toEqual([
            "a[^X]",
            "",
            "[^X]: d",
        ]);
    });

    it("refuses invalid names with the reason", () => {
        const doc = fakeEditor(["a[^x]", "", "[^x]: d"]);
        expect(planFootnoteRename(doc, "x", "bad name")).toMatchObject({
            kind: "invalid",
        });
        expect(planFootnoteRename(doc, "x", "tick`y")).toMatchObject({
            kind: "invalid",
        });
        expect(planFootnoteRename(doc, "x", "a[b")).toMatchObject({
            kind: "invalid",
        });
    });

    it("treats the unchanged or empty name as a no-op", () => {
        const doc = fakeEditor(["a[^x]", "", "[^x]: d"]);
        expect(planFootnoteRename(doc, "x", "x")).toEqual({ kind: "noop" });
        expect(planFootnoteRename(doc, "x", "")).toEqual({ kind: "noop" });
    });

    it("no-ops on a name with no live occurrences", () => {
        expect(
            planFootnoteRename(fakeEditor(["plain prose"]), "ghost", "y"),
        ).toEqual({ kind: "noop" });
    });

    it("a new name containing a comment opener renames cleanly (since 2026-09-15)", () => {
        // "[^a<!--]" used to be the example of a name that kills its own
        // occurrence: the masker read the "<!--" as a comment opener that
        // swallowed the closing bracket, and the simulation refused the
        // rename as "dead". Obsidian reads a "<!--" inside a reference as
        // part of the name (Kimi sweep 2026-09-13, verified in Reading
        // view), so the masker now does too, and the rename goes through.
        // The "dead" verdict stays as a safety net for shapes not yet
        // known; no valid name reaches it today.
        const plan = planFootnoteRename(
            fakeEditor(["see [^a]", "", "[^a]: d"]),
            "a",
            "a<!--",
        );
        expect(plan.kind).toBe("renamed");
    });
});

describe("the command entry", () => {
    it("explains itself when the caret is on nothing renameable", async () => {
        resetNotices();
        const doc = sharedFakeEditor(["plain prose here"], {
            wholeDoc: true,
            cursor: { line: 0, ch: 3 },
            selection: { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
        });
        const plugin = sharedFakePlugin({}, doc);
        await renameFootnote(plugin);
        expect(noticeCalls.some((args) => args[0] === RenameTargetNotice)).toBe(
            true,
        );
    });
});

describe("rename property", () => {
    fc.configureGlobal({ numRuns: Number(process.env.FC_NUM_RUNS ?? 200) });

    const newNameArb = fc.oneof(
        fc.constantFrom("fresh", "Fresh-Name", "注釈", "x.y", "a$1", "9"),
        fc
            .string({ minLength: 1, maxLength: 10 })
            .map((s) => s.replace(/[[\]\s`\\^$\n\r]/g, ""))
            .filter((s) => s.length > 0),
    );

    it(
        "renameTargetAtCursor is total and truthful at ANY caret (the menu gate)",
        () => {
            // the right-click menu shows "Rename footnote" exactly when this
            // resolver returns a name - so at any caret in any document it
            // must never throw, never fire inside protected text, only name
            // footnotes the document really has, and always hand
            // planFootnoteRename something it can answer
            fc.assert(
                fc.property(
                    docArb,
                    fc.nat(1000),
                    fc.nat(1000),
                    newNameArb,
                    (raw, linePick, chPick, newName) => {
                        const lines = normalizeEol(raw).text.split("\n");
                        const line = linePick % lines.length;
                        const ch = chPick % (lines[line].length + 1);
                        const doc = fakeEditor(lines);
                        const target = renameTargetAtCursor(doc, { line, ch });
                        if (target === null) return;
                        const scan = scanDocument(lines);
                        expect(
                            scan.isProtected[line],
                            `offered a rename inside protected text at ${line}:${ch}`,
                        ).toBe(false);
                        const folded = target.toLowerCase();
                        const names = new Set<string>();
                        // the same label rule the resolver applies: only a
                        // label that starts a definition is a label; a LAZY
                        // label's own "[^x]" and a label's inside a %% block
                        // comment are live references (ruling A1,
                        // 2026-09-15). The oracle used to treat every label
                        // as a label, which only passed because every other
                        // lazy shape carries a real reference somewhere else
                        // (found by a 4000-run soak, 2026-09-12)
                        const starts = definitionStartLines(lines, scan, (i) =>
                            maskedLineAt(lines, i),
                        );
                        for (let i = 0; i < lines.length; i++) {
                            if (!lines[i].includes("[^")) continue;
                            for (const occurrence of referenceOccurrences(
                                lines[i],
                                maskedLineAt(lines, i),
                                starts[i],
                            )) {
                                names.add(occurrence.name.toLowerCase());
                            }
                        }
                        // every definition START carries a name: the
                        // column-0 blocks, AND the labels findDefinitionBlocks
                        // never collects: quoted ones and labels after a %%
                        // closer (both live definitions). The resolver's own
                        // label rule (starts + definitionLabelWithName) is
                        // what planFootnoteRename renames, so the oracle must
                        // count them too (found by a soak flake, 2026-09-16:
                        // an afterCloser label with no reference anywhere
                        // else)
                        for (let i = 0; i < lines.length; i++) {
                            if (!starts[i]) continue;
                            const hit = definitionLabelWithName(
                                lines[i],
                                maskedLineAt(lines, i),
                            );
                            if (hit) names.add(hit.name.toLowerCase());
                        }
                        // and every definition wherever it sits, one in a list
                        // item included (Jason's ruling 1, option a,
                        // 2026-10-03: rename renames those too)
                        for (const definition of readNote(lines).definitions) {
                            names.add(definition.name.toLowerCase());
                        }
                        expect(
                            names.has(folded),
                            `offered "${target}", which no live occurrence or label carries`,
                        ).toBe(true);
                        const plan = planFootnoteRename(doc, target, newName);
                        expect([
                            "renamed",
                            "noop",
                            "invalid",
                            "collision",
                            "dead",
                        ]).toContain(plan.kind);
                    },
                ),
            );
        },
        Math.max(30_000, Number(process.env.FC_NUM_RUNS ?? 200) * 60),
    );

    it(
        "a successful rename maps the name everywhere and touches nothing else",
        () => {
            fc.assert(
                fc.property(
                    docArb,
                    fc.nat(1000),
                    newNameArb,
                    (raw, pick, newName) => {
                        const lines = normalizeEol(raw).text.split("\n");
                        // collect the live names to pick a real target
                        const names: string[] = [];
                        for (let i = 0; i < lines.length; i++) {
                            if (!lines[i].includes("[^")) continue;
                            for (const occurrence of referenceOccurrences(
                                lines[i],
                                maskedLineAt(lines, i),
                            )) {
                                names.push(occurrence.name);
                            }
                        }
                        if (names.length === 0) return;
                        const oldName = names[pick % names.length];
                        const plan = planFootnoteRename(
                            fakeEditor(lines),
                            oldName,
                            newName,
                        );
                        if (plan.kind !== "renamed") return;
                        const after = simulateChanges(lines, plan.changes);
                        expect(after.length).toBe(lines.length);
                        // edited lines are exactly the plan's lines;
                        // everything else is byte-identical
                        const editedLines = new Set(
                            plan.changes.map((change) => change.from.line),
                        );
                        for (let i = 0; i < lines.length; i++) {
                            if (!editedLines.has(i)) {
                                expect(after[i]).toBe(lines[i]);
                            }
                        }
                        // the old name is gone from live text (folds differ
                        // by collision refusal unless case-only)
                        const oldFolded = oldName.toLowerCase();
                        const newFolded = newName.toLowerCase();
                        if (oldFolded === newFolded) return;
                        const scan = scanDocument(after);
                        for (let i = 0; i < after.length; i++) {
                            if (!after[i].includes("[^")) continue;
                            for (const occurrence of referenceOccurrences(
                                after[i],
                                maskedLineAt(after, i),
                            )) {
                                expect(
                                    occurrence.name.toLowerCase(),
                                ).not.toBe(oldFolded);
                            }
                        }
                        for (const block of findDefinitionBlocks(after, scan)) {
                            expect(block.name.toLowerCase()).not.toBe(oldFolded);
                        }
                        // and renaming BACK is possible: the old name is free
                        const reverse = planFootnoteRename(
                            fakeEditor(after),
                            newName,
                            oldName,
                        );
                        expect(reverse.kind).toBe("renamed");
                    },
                ),
            );
        },
        Math.max(30_000, Number(process.env.FC_NUM_RUNS ?? 200) * 60),
    );
});
