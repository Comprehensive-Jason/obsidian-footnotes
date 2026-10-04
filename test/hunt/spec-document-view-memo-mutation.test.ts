import { describe, expect, it } from "vitest";

import { rewriteDocument, DocumentView } from "../../src/linting/rewrite-document";

// spec question: what does the view a lint rule is handed promise about the
// arrays inside it - that they are the rule's own to scribble on, or that
// they are shared and must be left alone?
//
// While one outer lint is running, rewriteDocument keeps the pieces it
// worked out for a document (the scan, the masked twin, the definition
// starts, the definition blocks) in a one-entry memo, so the next rule that
// receives the identical text starts from them instead of scanning again.
// The memo is copied shallowly, which means the arrays themselves are the
// same objects, not copies. It also publishes pieces that were derived from
// the `lines` array a rule was given. So a rule that changes any of those
// arrays in place changes what the NEXT rule sees for the same text.
//
// Reading one, write the contract down: the view is shared, read-only, and a
// rule that needs to change a line makes its own copy. Cheap, and it is what
// every rule already does.
//
// Reading two, make it true: freeze the arrays (or hand out copies) so a
// rule that scribbles on one cannot poison the next view, and the memo is an
// optimisation nobody has to know about.
//
// What the user would see: nothing today. This is latent - no rule in the
// pipeline changes any of these arrays in place, all eight were checked - so
// it is a trap for a rule written later, not a report of something breaking.
// If a rule ever did, the next rule would work from a description of a
// document that does not exist, which is how definitions get moved to
// nowhere or dropped.
//
// Hunt: 2026-09-13. Lens: the rule catalogue (the shared document view).
//
// Source of truth: DocumentView's own declaration, where every array is
// `readonly lines: string[]` and the one allowed change to `lines` is
// spelled out as trimTrailingBlankLines ("This is the ONE change to `lines`
// that is allowed"); and the memo's comment, "The memo is keyed on the exact
// text, so a rule that changed anything gets a fresh scan as before. The
// rules themselves are untouched."

const outerDoc = ["Prose[^1] here.", "", "[^1]: the definition", ""].join("\n");

// run one rule over `text` and hand back the view it was given, so a later
// view of the same text can be compared against it
function capture(text: string, rule?: (v: DocumentView) => string) {
    const seen: DocumentView[] = [];
    const out = rewriteDocument(text, (inner, v) => {
        const r = rule ? rule(v) : inner;
        seen.push(v);
        return r;
    });
    if (seen.length === 0) throw new Error("rule never ran");
    return { out, view: seen[0] };
}

describe("spec question: a rule that changes the arrays in the view it was given", () => {
    it("adding a line to view.lines does not reach the next view of the same text", () => {
        rewriteDocument(outerDoc, (text) => {
            // a rule that scribbles on view.lines BEFORE reading anything,
            // then hands the original text back unchanged
            capture(text, (v) => {
                v.lines.push("[^99]: smuggled in");
                // reading now derives from the scribbled-on array
                expect(v.blocks.map((b) => b.name)).toEqual(["1", "99"]);
                return text;
            });
            const next = capture(text);
            expect(next.view.lines).toEqual(text.split("\n"));
            expect(next.view.blocks.map((b) => b.name)).toEqual(["1"]);
            return text;
        });
    });

    // Settled by the runtime swap, step 2 (2026-10-03): the view keeps no
    // memo of its own any more; every piece comes from the note reading of
    // the lines the view holds, remembered by their exact text, so a view
    // whose lines were cut reads the cut lines and the next view reads its
    // own.
    it("removing a line does not leave the next view a masked twin of the wrong length", () => {
        rewriteDocument(outerDoc, (text) => {
            capture(text, (v) => {
                v.lines.pop();
                void v.maskedLines;
                return text;
            });
            const next = capture(text);
            expect(next.view.maskedLines).toHaveLength(text.split("\n").length);
            return text;
        });
    });

    // Settled the same way (2026-10-03): view.maskedLines is the reading's
    // masked twin, typed read-only and frozen, so a write forced past the
    // type fails at once instead of poisoning the next view.
    it("writing into view.maskedLines does not poison the next view", () => {
        rewriteDocument(outerDoc, (text) => {
            capture(text, (v) => {
                expect(() => {
                    (v.maskedLines as string[])[0] = "SCRIBBLED";
                }).toThrow();
                return text;
            });
            const next = capture(text);
            expect(next.view.maskedLines[0]).toBe("Prose[^1] here.");
            return text;
        });
    });

    // Settled by the runtime swap (2026-10-03), reading two: view.blocks
    // comes from the note reading, typed read-only and frozen, so a rule
    // that forces a push past the type fails at once instead of poisoning
    // the next view.
    it("adding to view.blocks does not poison the next view", () => {
        rewriteDocument(outerDoc, (text) => {
            capture(text, (v) => {
                expect(() => (v.blocks as unknown as { name: string; start: number; end: number }[]).push({ name: "fake", start: 0, end: 0 })).toThrow();
                return text;
            });
            const next = capture(text);
            expect(next.view.blocks.map((b) => b.name)).toEqual(["1"]);
            return text;
        });
    });

    it("control: a rule that only READS leaves the next view correct", () => {
        // this is what all eight rules do today, which is why none of the
        // above can happen yet
        rewriteDocument(outerDoc, (text) => {
            const first = capture(text, (v) => {
                void v.blocks;
                void v.maskedLines;
                return text;
            });
            expect(first.view.blocks.map((b) => b.name)).toEqual(["1"]);
            const next = capture(text);
            expect(next.view.lines).toEqual(text.split("\n"));
            expect(next.view.blocks.map((b) => b.name)).toEqual(["1"]);
            expect(next.view.maskedLines[0]).toBe("Prose[^1] here.");
            return text;
        });
    });
});
