import { describe, expect, it } from "vitest";

import { buildDefinitionAppend } from "../src/commands/definition-append";
import { docContext } from "../src/editor/doc-context";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

// The optional heading inserted above the first footnote definition. A blank
// line ALWAYS separates the heading from the content above it (markdown
// block convention, requested 2026-07-20) - which also keeps a heading
// starting with a divider (---/***/___) from turning the last text line
// into a setext heading. The live insertion is covered by the smoke suite.
// Asserted through buildDefinitionAppend, the one production consumer -
// the helper itself went unexported (2026-08-11 review cleanliness).

function fakePlugin(enabled: boolean, heading: string) {
    return sharedFakePlugin({
        enableFootnoteSectionHeading: enabled,
        footnoteSectionHeading: heading,
        enableRemoveBlankLastLines: false,
    });
}

function firstFootnoteText(enabled: boolean, heading: string): string {
    // a one-line note, so the whole heading policy shows up in the change text
    const { change } = buildDefinitionAppend(
        docContext(fakeEditor(["Alpha"])),
        "1",
        true,
        fakePlugin(enabled, heading),
    );
    return change.text;
}

describe("the first footnote's section heading", () => {
    it("adds no heading when the setting is disabled", () => {
        expect(firstFootnoteText(false, "# Footnotes")).toBe("\n\n[^1]: ");
    });

    it("keeps a blank line above a plain heading", () => {
        expect(firstFootnoteText(true, "# Footnotes")).toBe(
            "\n\n# Footnotes\n\n[^1]: ",
        );
    });

    it("keeps a blank line above a leading --- divider", () => {
        // doubly important here: a divider directly below a text line
        // would turn that line into a setext heading
        expect(firstFootnoteText(true, "---\n## Footnotes")).toBe(
            "\n\n---\n## Footnotes\n\n[^1]: ",
        );
    });

    it("treats *** the same", () => {
        expect(firstFootnoteText(true, "***")).toBe("\n\n***\n\n[^1]: ");
    });

    it("treats ___ the same", () => {
        expect(firstFootnoteText(true, "___")).toBe("\n\n___\n\n[^1]: ");
    });

    it("passes multi-line headings through untouched", () => {
        expect(firstFootnoteText(true, "## Footnotes\n> sources below")).toBe(
            "\n\n## Footnotes\n> sources below\n\n[^1]: ",
        );
    });
});
