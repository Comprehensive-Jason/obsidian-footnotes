import { beforeEach, describe, expect, it } from "vitest";
import { Editor, EditorChange, EditorPosition } from "obsidian";

import { noticeCalls } from "./mocks/obsidian";
import { messages, resetNotices } from "./helpers/notices";

import FootnotePlugin from "../src/main";
import {
    lintAfterFootnoteCreation,
    lintBlockedByPrefix,
    lintFootnotes,
    lintOptionsFromSettings,
    lintRulesAllDisabled,
    LintOptions,
} from "../src/linting/linter";

// Mutation hardening for the linter's unit-reachable surface (Stryker
// re-baseline 2026-08-12: linter.ts scored 58%). The pure pipeline, the
// settings→options mappings, and - through a transaction-APPLYING fake
// editor - the whole lint-on-footnote-creation path: its guards, its
// minimal-diff writer, its notices, and the empty-definition relanding.
// The live-Obsidian-only survivors (popup busy state, the save wrapper, the
// vim adapter) are deliberately not chased here.

// ---------- fakes ----------

interface FakeDoc extends Editor {
    appliedChanges: EditorChange[];
    cursor: EditorPosition;
    value: string;
}

/**
 * An editor that actually APPLIES the transactions it is handed, so a test
 * can assert both the resulting document AND the exact change span that
 * produced it (replaceMinimal's whole job is that span). getLine throws
 * out of range like the real one does - CM6's doc.line() raises rather than
 * handing back an empty string, and a lint that walks one line too far must
 * not look correct here.
 */
function fakeEditor(
    value: string,
    cursor: EditorPosition = { line: 0, ch: 0 },
    cm?: unknown,
): FakeDoc {
    const lines = () => doc.value.split("\n");
    const doc = {
        value,
        cm,
        appliedChanges: [] as EditorChange[],
        cursor,
        getCursor: () => doc.cursor,
        getLine(n: number) {
            const all = lines();
            if (n < 0 || n >= all.length) throw new RangeError(`no line ${n}`);
            return all[n];
        },
        getValue: () => doc.value,
        lineCount: () => lines().length,
        lastLine: () => lines().length - 1,
        wordAt: () => null,
        offsetToPos(offset: number): EditorPosition {
            const all = lines();
            let remaining = offset;
            for (let line = 0; line < all.length; line++) {
                if (remaining <= all[line].length) return { line, ch: remaining };
                remaining -= all[line].length + 1;
            }
            return { line: all.length - 1, ch: all.at(-1)?.length ?? 0 };
        },
        posToOffset(pos: EditorPosition): number {
            const all = lines();
            let offset = 0;
            for (let line = 0; line < pos.line; line++) {
                offset += all[line].length + 1;
            }
            return offset + pos.ch;
        },
        setCursor(pos: EditorPosition) {
            doc.cursor = pos;
        },
        scrollIntoView() {},
        transaction(spec: {
            changes?: EditorChange[];
            selection?: { from: EditorPosition };
        }) {
            for (const change of spec.changes ?? []) {
                doc.appliedChanges.push(change);
                const from = doc.posToOffset(change.from);
                const to = change.to ? doc.posToOffset(change.to) : from;
                doc.value =
                    doc.value.slice(0, from) +
                    change.text +
                    doc.value.slice(to);
            }
            if (spec.selection) doc.cursor = spec.selection.from;
        },
    };
    return doc as unknown as FakeDoc;
}

const SETTINGS = {
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    footnoteNaming: "keep",
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
    lintFixPunctuation: true,
    lintMoveToBottom: true,
    lintReindex: true,
    lintApplyPrefix: true,
    lintOnSave: false,
    lintOnFootnoteCreation: true,
};

type Settings = Partial<typeof SETTINGS>;

function pluginFor(view: unknown, overrides: Settings = {}): FootnotePlugin {
    return {
        app: { workspace: { getActiveViewOfType: () => view }, vault: {} },
        settings: { ...SETTINGS, ...overrides },
    } as unknown as FootnotePlugin;
}

const viewFor = (doc: FakeDoc | null, path: string | null = "note.md") => ({
    editor: doc ?? undefined,
    file: path === null ? null : { path },
    getMode: () => "source",
});

/** Drive lint-on-footnote-creation over `value` and hand back the fake editor. */
function creationLint(
    value: string,
    overrides: Settings = {},
    relandCursor = false,
): FakeDoc {
    const doc = fakeEditor(value, { line: 0, ch: 0 });
    lintAfterFootnoteCreation(pluginFor(viewFor(doc), overrides), doc, relandCursor);
    return doc;
}

beforeEach(() => {
    resetNotices();
});

// ---------- the settings → options mappings ----------

describe("lintOptionsFromSettings", () => {
    // L36-42 BlockStatement/ObjectLiteral (reindexOptionsFromSettings gutted)
    // and the whole options literal: the nested reindex policy must be
    // present and carry the setting's value, not undefined.
    it("maps a default settings object option for option", () => {
        expect(lintOptionsFromSettings(pluginFor(null), "H", "body")).toEqual({
            sectionHeading: "H",
            fixPunctuation: true,
            moveDefinitionsToBottom: true,
            reindex: true,
            reindexOptions: { renumberNamedFootnotes: false, nameNumberedFootnotes: false },
            removeOrphanedReferences: false,
            removeOrphanedDefinitions: false,
            mergeDuplicateDefinitions: false,
            orphanSafePrefix: "",
            applyNotePrefix: false,
        });
    });

    it("maps an everything-on settings object, prefix and all", () => {
        const options = lintOptionsFromSettings(
            pluginFor(null, {
                enableFootnotePrefix: true,
                lintDeleteOrphanedReferences: true,
                lintDeleteOrphanedDefinitions: true,
                lintMergeDuplicateDefinitions: true,
                footnoteNaming: "numbered",
            }),
            "H",
            '---\nfootnote-prefix: "3."\n---\nbody',
        );
        expect(options).toEqual({
            sectionHeading: "H",
            fixPunctuation: true,
            moveDefinitionsToBottom: true,
            reindex: true,
            reindexOptions: { renumberNamedFootnotes: true, nameNumberedFootnotes: false },
            removeOrphanedReferences: true,
            removeOrphanedDefinitions: true,
            mergeDuplicateDefinitions: true,
            orphanSafePrefix: "3.",
            applyNotePrefix: true,
        });
    });

    const ALL_OFF: Settings = {
        lintFixPunctuation: false,
        lintMoveToBottom: false,
        lintReindex: false,
        lintDeleteOrphanedReferences: false,
        lintDeleteOrphanedDefinitions: false,
        lintMergeDuplicateDefinitions: false,
        lintApplyPrefix: false,
        enableFootnotePrefix: false,
    };

    const pairs: [keyof typeof SETTINGS, keyof LintOptions][] = [
        ["lintFixPunctuation", "fixPunctuation"],
        ["lintMoveToBottom", "moveDefinitionsToBottom"],
        ["lintReindex", "reindex"],
        ["lintDeleteOrphanedReferences", "removeOrphanedReferences"],
        ["lintDeleteOrphanedDefinitions", "removeOrphanedDefinitions"],
        ["lintMergeDuplicateDefinitions", "mergeDuplicateDefinitions"],
    ];

    for (const [flag, option] of pairs) {
        it(`${flag} flips ${option} and nothing else`, () => {
            const off = lintOptionsFromSettings(pluginFor(null, ALL_OFF), "", "");
            const on = lintOptionsFromSettings(
                pluginFor(null, { ...ALL_OFF, [flag]: true }),
                "",
                "",
            );
            expect(off[option]).toBe(false);
            expect(on[option]).toBe(true);
            expect({ ...on, [option]: false }).toEqual(off);
        });
    }

    it("applyNotePrefix needs BOTH the feature and the lint toggle", () => {
        const only = (overrides: Settings) =>
            lintOptionsFromSettings(pluginFor(null, { ...ALL_OFF, ...overrides }), "", "")
                .applyNotePrefix;
        expect(only({})).toBe(false);
        expect(only({ enableFootnotePrefix: true })).toBe(false);
        expect(only({ lintApplyPrefix: true })).toBe(false);
        expect(only({ enableFootnotePrefix: true, lintApplyPrefix: true })).toBe(true);
    });
});

// ---------- the pipeline ----------

describe("lintFootnotes composition", () => {
    // L118-123 (options.reindex ?? true): with `reindex` unset, reindex's own
    // orphaned-definition deletion still has to be HOISTED above the move.
    // The mutants ("reindex && true", "reindex ?? false") make the hoist
    // conditional on an explicit flag, so the move gathers the doomed
    // definition first and reindex's later deletion strands the section
    // heading it caused to be written.
    it("hoists reindex's own orphan deletion above the move", () => {
        expect(
            lintFootnotes("body text\n\n[^9]: orphan", {
                sectionHeading: "# Footnotes",
                reindexOptions: { keepOrphanedDefinitions: false },
            }),
        ).toBe("body text");
    });

    // L155 LogicalOperator/BooleanLiteral on `options.moveDefinitionsToBottom
    // ?? true`: deleting the reference blanks its line, and only the
    // re-settle collapses that blank run - without it the pass is not its own
    // fixed point.
    it("re-settles the layout after a reference deletion", () => {
        expect(
            lintFootnotes("para[^1].\n\n[^9]\n\n[^1]: one", {
                removeOrphanedReferences: true,
            }),
        ).toBe("para.[^1]\n\n[^1]: one");
    });

    // L155 ConditionalExpression (-> true) and LogicalOperator (&& -> ||):
    // both let the re-settle run while moving is switched OFF, which would
    // haul the mid-document definition to the bottom behind the user's back.
    it("never re-settles while moving definitions is off", () => {
        expect(
            lintFootnotes("a[^7] b[^3] end\n\n[^3]: three\n\ntail", {
                removeOrphanedReferences: true,
                moveDefinitionsToBottom: false,
            }),
        ).toBe("a b[^1] end\n\n[^1]: three\n\ntail");
    });

    // L190 ConditionalExpression (`result === text` -> false): a lint that
    // changed nothing must hand back the ORIGINAL bytes. Restoring EOL onto
    // this mixed-ending note would rewrite its lone LF into CRLF and report a
    // phantom lint.
    it("returns a byte-identical no-op, mixed line endings and all", () => {
        expect(lintFootnotes("plain\r\nmixed\nline")).toBe("plain\r\nmixed\nline");
    });
});

// ---------- lintRulesAllDisabled ----------

describe("lintRulesAllDisabled", () => {
    const ALL_OFF: Settings = {
        lintFixPunctuation: false,
        lintMoveToBottom: false,
        lintReindex: false,
        lintApplyPrefix: false,
        enableFootnotePrefix: false,
        lintDeleteOrphanedReferences: false,
        lintDeleteOrphanedDefinitions: false,
        lintMergeDuplicateDefinitions: false,
    };

    it("is true only when every rule is off", () => {
        expect(lintRulesAllDisabled(pluginFor(null, ALL_OFF))).toBe(true);
    });

    // L228's ConditionalExpression (-> true) and LogicalOperator (&& -> ||)
    // both blind the check to the leading conjuncts; each single-rule case
    // below has to come back false.
    const singles: Settings[] = [
        { lintFixPunctuation: true },
        { lintMoveToBottom: true },
        { lintReindex: true },
        { enableFootnotePrefix: true, lintApplyPrefix: true },
        { lintDeleteOrphanedReferences: true },
        { lintDeleteOrphanedDefinitions: true },
        { lintMergeDuplicateDefinitions: true },
    ];

    for (const single of singles) {
        it(`is false with only ${Object.keys(single).join(" + ")} on`, () => {
            expect(
                lintRulesAllDisabled(pluginFor(null, { ...ALL_OFF, ...single })),
            ).toBe(false);
        });
    }

    it("stays true when the prefix feature is on but the lint rule is off", () => {
        expect(
            lintRulesAllDisabled(
                pluginFor(null, { ...ALL_OFF, enableFootnotePrefix: true }),
            ),
        ).toBe(true);
    });
});

// ---------- lintBlockedByPrefix ----------

describe("lintBlockedByPrefix", () => {
    it("explains a digit-ending prefix, verbatim", () => {
        expect(
            lintBlockedByPrefix('---\nfootnote-prefix: "3"\n---\nbody'),
        ).toBe(
            'Linting canceled: this note\'s footnote-prefix ("3") is invalid. The footnote prefix can\'t end in a number. Its footnotes would be indistinguishable from plain numbered ones.',
        );
    });

    it("explains a prefix with spaces, verbatim", () => {
        expect(
            lintBlockedByPrefix('---\nfootnote-prefix: "two words-"\n---\nbody'),
        ).toBe(
            'Linting canceled: this note\'s footnote-prefix ("two words-") is invalid. The footnote prefix can\'t contain spaces, backticks, brackets, or "#".',
        );
    });

    it("blocks nothing for a valid prefix or no prefix at all", () => {
        expect(lintBlockedByPrefix('---\nfootnote-prefix: "3."\n---\nbody')).toBeNull();
        expect(lintBlockedByPrefix("plain note")).toBeNull();
    });
});

// ---------- the creation-lint guards ----------

describe("lintAfterFootnoteCreation guards", () => {
    const DIRTY = "Alpha[^1], bravo\n\n[^1]: one";

    // L417: the trigger's own setting.
    it("does nothing while the trigger is off", () => {
        const doc = creationLint(DIRTY, { lintOnFootnoteCreation: false });
        expect(doc.value).toBe(DIRTY);
        expect(noticeCalls).toEqual([]);
    });

    // L421 ConditionalExpression (-> false): without the guard the reading
    // of the (absent) view's mode throws.
    it("survives having no active markdown view", () => {
        expect(() =>
            { lintAfterFootnoteCreation(pluginFor(null), fakeEditor(DIRTY), false); },
        ).not.toThrow();
        expect(noticeCalls).toEqual([]);
    });

    // L421 LogicalOperator (|| -> &&): a deferred view HAS a view object but
    // no editor, so only the disjunction catches it.
    it("survives a deferred view that has no editor yet", () => {
        expect(() =>
            { lintAfterFootnoteCreation(
                pluginFor({ file: { path: "note.md" }, getMode: () => "source" }),
                fakeEditor(DIRTY),
                false,
            ); },
        ).not.toThrow();
        expect(noticeCalls).toEqual([]);
    });

    // L430 ConditionalExpression (-> false) and LogicalOperator (|| -> &&):
    // focus inside a nested sub-editor (here one with no td/th ancestor, so
    // activeTableCellEditor is null and only nestedSubEditorOwnsFocus is
    // true) must stop the lint - the && mutant needs BOTH to be true.
    it("stays out while a nested sub-editor owns focus", () => {
        const nested = { closest: () => null };
        const contentDOM = {
            ownerDocument: { activeElement: nested },
            contains: (el: unknown) => el === nested,
        };
        const doc = fakeEditor(DIRTY, { line: 0, ch: 0 }, { contentDOM });
        lintAfterFootnoteCreation(pluginFor(viewFor(doc)), doc, false);
        expect(doc.value).toBe(DIRTY);
        expect(doc.appliedChanges).toEqual([]);
    });

    // A creation written into another editor than the active tab's (a
    // carried paste into a hover popover) leaves the active note alone, and
    // the alerts speak for the edited note instead (hunt 2026-10-02, pin
    // bug-paste-lints-other-note).
    it("leaves the active note alone when another editor was edited, and alerts on that one", () => {
        const active = fakeEditor(DIRTY, { line: 0, ch: 0 });
        const edited = fakeEditor("text[^1]\n\n[^1]: used\n[^9]: stray", { line: 0, ch: 0 });
        expect(lintAfterFootnoteCreation(pluginFor(viewFor(active)), edited, false)).toBeNull();
        expect(active.value).toBe(DIRTY);
        expect(active.appliedChanges).toEqual([]);
        expect(edited.appliedChanges).toEqual([]);
        expect(messages().some((m) => m.includes("nothing references"))).toBe(true);
    });

    // L433 ConditionalExpression (-> false): an invalid footnote-prefix
    // cancels the run, silently (the insert path already explained it).
    it("is silently inert on a note whose prefix is invalid", () => {
        const blocked = '---\nfootnote-prefix: "3"\n---\nAlpha[^1], bravo\n\n[^1]: one';
        // an invalid property blocks the lint only while the prefix
        // feature is on (Jason's ruling 2026-09-20); with it off, the
        // property is ordinary frontmatter and the lint runs
        const doc = creationLint(blocked, { enableFootnotePrefix: true });
        expect(doc.value).toBe(blocked);
        expect(noticeCalls).toEqual([]);
    });

    // L438 ConditionalExpression (-> false) and its BlockStatement: a clean
    // note takes the alerts-only exit - no edit, and above all no toast (the
    // creation trigger is quiet by design).
    it("edits nothing and says nothing on an already-clean note", () => {
        const clean = "Alpha.[^1]\n\n[^1]: one";
        const doc = creationLint(clean);
        expect(doc.value).toBe(clean);
        expect(doc.appliedChanges).toEqual([]);
        expect(noticeCalls).toEqual([]);
    });

    // L443 StringLiteral.
    it("announces an actual cleanup with the exact notice", () => {
        creationLint(DIRTY);
        expect(messages()).toEqual(["Footnotes linted."]);
    });
});

// ---------- the section heading the creation lint passes down ----------

describe("configuredSectionHeading", () => {
    const MESSY = "Alpha[^1], bravo\n\nTail\n\n[^1]: one";

    // L29 BlockStatement (an emptied body hands the pipeline `undefined`,
    // which `?? ""` swallows into no heading at all).
    it("passes the configured heading through while the setting is on", () => {
        const doc = creationLint(MESSY, { enableFootnoteSectionHeading: true });
        expect(doc.value).toBe("Alpha,[^1] bravo\n\nTail\n\n# Footnotes\n\n[^1]: one");
    });

    // L32 StringLiteral: with the setting off the heading must be EMPTY, not
    // some other string that would be written into the note.
    it("passes no heading at all while the setting is off", () => {
        const doc = creationLint(MESSY, {
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "# Footnotes",
        });
        expect(doc.value).toBe("Alpha,[^1] bravo\n\nTail\n\n[^1]: one");
    });
});

// ---------- replaceMinimal ----------

// The write-back is a set of edits, one per run of changed lines and
// trimmed to the characters that differ (lineDiffChanges, 2026-09-11):
// untouched lines are never rewritten, so folds on them survive, and a
// caret outside the differing characters keeps its place. These assert
// the change spans themselves, since every mutant in the write-back
// leaves the FINAL text reachable by a wider edit.
describe("replaceMinimal writes the smallest possible changes", () => {
    it("a substitution touches only the swapped middle", () => {
        const doc = creationLint("Alpha[^1], bravo\n\n[^1]: one");
        expect(doc.appliedChanges).toEqual([
            { from: { line: 0, ch: 5 }, to: { line: 0, ch: 10 }, text: ",[^1]" },
        ]);
        expect(doc.value).toBe("Alpha,[^1] bravo\n\n[^1]: one");
    });

    it("an insertion is a zero-width change, even against a repeated newline", () => {
        // move-to-bottom only adds the blank line before the definition: the
        // inserted "\n" matches the newline right before the edit point, so
        // the suffix walk has to stop AT `start` instead of chewing past it.
        // (a heading above the label: a label directly under a PROSE line
        // is lazy paragraph text since 2026-09-09, and nothing would move).
        // The new line goes in at the end of the line above, so a caret at
        // the start of the label line stays there (hunt 2026-10-05, pin
        // bug-caret-jumps-to-inserted-line).
        const doc = creationLint("x[^1]\n# H\n[^1]: one", {
            lintFixPunctuation: false,
            lintReindex: false,
        });
        expect(doc.appliedChanges).toEqual([
            { from: { line: 1, ch: 3 }, to: { line: 1, ch: 3 }, text: "\n" },
        ]);
        expect(doc.value).toBe("x[^1]\n# H\n\n[^1]: one");
    });

    it("a deletion whose tail repeats the kept text still cuts exactly once", () => {
        // "[^b]: one" is deleted and "[^a]: one" is kept: the two share a
        // trailing "one", which the suffix walk must not follow past the
        // point where the surviving text ends.
        const doc = creationLint("See [^a]\n\n[^a]: one\n[^b]: one", {
            lintFixPunctuation: false,
            lintMoveToBottom: false,
            lintReindex: false,
            lintDeleteOrphanedDefinitions: true,
        });
        expect(doc.appliedChanges).toEqual([
            { from: { line: 2, ch: 9 }, to: { line: 3, ch: 9 }, text: "" },
        ]);
        expect(doc.value).toBe("See [^a]\n\n[^a]: one");
    });
});

// ---------- uniqueEmptyDefinitionName + the reland ----------

describe("relanding the cursor on the new empty definition", () => {
    // The whole cluster (L373 regex, L381-395 walk, L445/L447 gates) is
    // observable only through where the caret ends up: the lint runs first
    // and may have renumbered the footnote, so the reland re-finds the note's
    // ONE empty definition by shape.
    it("lands at the end of the note's single empty definition", () => {
        const doc = creationLint("Alpha[^note], bravo\n\n[^note]: ", {}, true);
        expect(doc.value).toBe("Alpha,[^note] bravo\n\n[^note]: ");
        expect(doc.cursor).toEqual({ line: 2, ch: 9 });
    });

    it("lands on an empty definition with no trailing space either", () => {
        // "[ \t]*" -> "[ \t]": a definition the user has not typed a space
        // after is still empty.
        const doc = creationLint("Alpha[^note], bravo\n\n[^note]:", {}, true);
        expect(doc.value).toBe("Alpha,[^note] bravo\n\n[^note]:");
        expect(doc.cursor).toEqual({ line: 2, ch: 8 });
    });

    it("picks the empty definition out from among written ones", () => {
        // the "$" anchor: "[^b]: filled" is a definition too, and without the
        // end anchor it reads as empty - the note would look ambiguous and
        // the caret would never land.
        const doc = creationLint(
            "Alpha[^note], bravo[^b]\n\n[^note]: \n[^b]: filled",
            {},
            true,
        );
        expect(doc.value).toBe("Alpha,[^note] bravo[^b]\n\n[^note]: \n[^b]: filled");
        expect(doc.cursor).toEqual({ line: 2, ch: 9 });
    });

    it("leaves the cursor alone when relanding was not asked for", () => {
        const doc = creationLint("Alpha[^note], bravo\n\n[^note]: ", {}, false);
        expect(doc.cursor).toEqual({ line: 0, ch: 0 });
    });

    it("leaves the cursor alone when several definitions are empty", () => {
        // ambiguous: neither of the two is provably the footnote just
        // created, so nothing moves (and nothing is jumped to with a null
        // name, which would throw).
        const doc = creationLint("A[^one], b[^two]\n\n[^one]: \n[^two]: ", {}, true);
        expect(doc.value).toBe("A,[^one] b[^two]\n\n[^one]: \n[^two]: ");
        expect(doc.cursor).toEqual({ line: 0, ch: 0 });
    });

    it("a blockquoted empty label is not the fresh definition", () => {
        // a blockquoted "> [^x]: " is a definition of its own, but it is not
        // the empty definition this walk hunts for (the plugin never creates
        // quoted definitions) - counting it would make the note look
        // ambiguous and strand the caret.
        const doc = creationLint(
            "Alpha[^note], bravo\n\n> [^x]: \n\n[^note]: ",
            {},
            true,
        );
        expect(doc.value).toBe("Alpha,[^note] bravo\n\n> [^x]: \n\n[^note]: ");
        expect(doc.cursor).toEqual({ line: 4, ch: 9 });
    });

    it("reads the note's real lines, frontmatter masking included", () => {
        // the line array is built from line 0 up: a walk that starts anywhere
        // else shifts the frontmatter out of position, un-masks the
        // definition-shaped property line inside it, and the note looks
        // ambiguous.
        const doc = creationLint(
            "---\n[^x]: \n---\nAlpha[^note], bravo\n\n[^note]: ",
            {},
            true,
        );
        expect(doc.value).toBe("---\n[^x]: \n---\nAlpha,[^note] bravo\n\n[^note]: ");
        expect(doc.cursor).toEqual({ line: 5, ch: 9 });
    });
});

// ---------- the relocated-name return (popup binding, 2026-08-27) ----------

describe("the creation lint returns the relocated definition name", () => {
    // The popup arm lints BEFORE the popup opens and binds the popup to
    // the returned post-lint id (Jason's ask 2026-08-27) - the same
    // relocation the caret reland uses, surfaced as the return value.
    it("returns the renumbered name of the unique empty definition", () => {
        const doc = fakeEditor("alpha[^5] bravo[^9]\n\n[^5]: five\n[^9]: ");
        expect(
            lintAfterFootnoteCreation(pluginFor(viewFor(doc)), doc, false),
        ).toBe("2");
        expect(doc.value).toBe("alpha[^1] bravo[^2]\n\n[^1]: five\n[^2]: ");
    });

    it("returns null when the lint changed nothing", () => {
        const doc = fakeEditor("alpha[^1]\n\n[^1]: ");
        expect(
            lintAfterFootnoteCreation(pluginFor(viewFor(doc)), doc, false),
        ).toBeNull();
    });

    it("returns the seeded definition's renumbered name when a body is given", () => {
        const doc = fakeEditor("alpha[^5] bravo[^9]\n\n[^5]: five\n[^9]: moved text");
        expect(
            lintAfterFootnoteCreation(pluginFor(viewFor(doc)), doc, false, "moved text"),
        ).toBe("2");
    });

    it("returns null when several empty definitions leave the new one ambiguous", () => {
        const doc = fakeEditor("a[^7] b[^9]\n\n[^7]: \n[^9]: ");
        expect(
            lintAfterFootnoteCreation(pluginFor(viewFor(doc)), doc, false),
        ).toBeNull();
    });
});
