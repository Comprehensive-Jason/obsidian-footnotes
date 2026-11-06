import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnote, deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// SPEC (wrong output): Delete footnote everywhere on a footnote whose label sits
// in a "%%" comment.
//
// What the user would see: the label's "[^k]" was cut as a reference, which left
// ": hidden" in the comment with the name gone, the same leftover Jason called
// wrong for the orphan rule. Now the label line goes whole, as a lazy label's
// does, since it is a definition the user wrote and asked to delete.
//
// Hunt 2026-11-06, cycle 9, finding H25. Severity: wrong output. Origin:
// pre-existing. Source of truth: the triage's choice, for Jason's objection, by
// analogy with his ruling of 2026-11-05 (74c3472).

const deleted = (note: string, name: string) => {
    const plan = deleteFootnoteEverywhere(note, name);
    return plan.kind === "deleted" ? { markdown: plan.markdown, references: plan.references, definitions: plan.definitions } : plan.kind;
};

beforeEach(resetNotices);

describe("a label in a %% comment", () => {
    it("goes whole, and counts as a definition", () => {
        expect(deleted("text[^k] here\n\n%%\n[^k]: hidden\n%%", "k")).toEqual({ markdown: "text here\n\n%%\n%%", references: 1, definitions: 1 });
    });

    it("goes whole beside a real definition, and both count", () => {
        expect(deleted("text[^k] here\n\n%%\n[^k]: hidden\n%%\n\n[^k]: real", "k")).toEqual({ markdown: "text here\n\n%%\n%%", references: 1, definitions: 2 });
    });

    it("the other text in the comment stays", () => {
        expect(deleted("text[^k] here\n\n%%\nkept\n[^k]: hidden\nalso kept\n%%", "k")).toEqual({ markdown: "text here\n\n%%\nkept\nalso kept\n%%", references: 1, definitions: 1 });
    });

    it("a label of another name stays", () => {
        expect(deleted("text[^k] here[^j]\n\n%%\n[^j]: other\n[^k]: hidden\n%%\n\n[^j]: real", "k")).toEqual({
            markdown: "text here[^j]\n\n%%\n[^j]: other\n%%\n\n[^j]: real",
            references: 1,
            definitions: 1,
        });
    });

    it("the toast counts it as a definition", async () => {
        const doc = fakeEditor(["text[^k] here", "", "%%", "[^k]: hidden", "%%"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 6 }, selection: { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 6 } } });
        await deleteFootnote(fakePlugin({}, doc));
        expect(doc.lines).toEqual(["text here", "", "%%", "%%"]);
        expect(messages()[0]).toBe('Deleted "[^k]" everywhere: 1 reference and 1 definition.');
    });

    it("a label on the comment's closing line, which holds the closer, is refused rather than losing the closer", () => {
        expect(deleted("text[^k] here\n\n%%\n[^k]: hidden %%", "k")).toBe("refused");
    });

    it("control: a one-line comment is refused by the gate", () => {
        expect(deleted("text[^k] here\n\n%% [^k]: hidden %%", "k")).toBe("refused");
    });

    it("control: a label in an HTML comment is plain text and stays, as the README says", () => {
        expect(deleted("text[^k] here\n\n<!--\n[^k]: hidden\n-->\n\n[^k]: real", "k")).toEqual({ markdown: "text here\n\n<!--\n[^k]: hidden\n-->", references: 1, definitions: 1 });
    });

    it("control: a plain reference in a comment is cut as a reference (rule F)", () => {
        expect(deleted("%%a[^1]%% b[^1]\n\n[^1]: one", "1")).toEqual({ markdown: "%%a%% b", references: 2, definitions: 1 });
    });
});
