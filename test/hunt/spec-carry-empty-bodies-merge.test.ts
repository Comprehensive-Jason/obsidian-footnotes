import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { planCarriedPaste } from "../../src/commands/carry-footnotes";
import { handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// Ruling (Jason, 2026-11-05, entry 6 of the spec sort): an empty definition
// never merges. It is a placeholder waiting for its text, not text.
//
// Before, two empty definitions counted as identical. Moving a paragraph whose
// footnote was still empty merged it into another empty one, so unrelated
// references shared one definition, and typing into it filled both. Convert
// inline footnotes to normal footnotes already made this choice: it leaves an
// empty ^[] alone, so it never merges an empty body.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C26.

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

// A stand-in for the browser's clipboard event: it reads `text` and records
// what the plugin writes back.
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

const settings = { carryFootnotesOnCopy: true, enableFootnoteSectionHeading: false, removeEmptySectionHeading: false };

/** Cuts from..to out of a note holding `lines`; returns the note and the clipboard text. */
function cut(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"] };
}

/** Copies from..to from a note holding `lines`; returns the clipboard text. */
function copy(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    return event.written["text/plain"];
}

/** Pastes `clip` over from..to (nothing selected without `to`) in a note holding `lines`; returns the note. */
function paste(lines: string[], from: { line: number; ch: number }, clip: string, to = from) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    handlePaste(fakePlugin(settings, doc), clipboardEvent(clip) as never, doc);
    return doc.lines.slice();
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("Jason's ruling 2026-11-05: an empty definition never merges", () => {
    it("an empty carried definition lands as its own footnote beside an empty one in the note", () => {
        const plan = planCarriedPaste("a[^x]\n\n[^x]:", "b[^1]", [one("1", "[^1]:")]);
        expect(plan.body).toBe("b[^1]");
        expect(plan.reused).toBe(0);
    });

    it("a label followed only by spaces counts as empty too", () => {
        const plan = planCarriedPaste("a[^x]\n\n[^x]:   ", "b[^1]", [one("1", "[^1]: ")]);
        expect(plan.body).toBe("b[^1]");
    });

    it("a definition citing an empty one does not merge through it", () => {
        const plan = planCarriedPaste("a[^x]\n\n[^x]: see [^y]\n[^y]:", "b[^1]", [one("1", "[^1]: see [^2]"), one("2", "[^2]:")]);
        expect(plan.reused).toBe(0);
        expect(plan.body).toBe("b[^1]");
    });

    it("moving a paragraph keeps its empty footnote apart from the other one", () => {
        const { lines, clip } = cut(["One[^1] here.", "Two[^2] here.", "Three.", "", "[^1]: ", "[^2]: "], { line: 0, ch: 0 }, { line: 0, ch: 13 });
        expect(lines).toEqual(["", "Two[^2] here.", "Three.", "", "[^2]: "]);
        resetNotices();
        expect(paste(lines, { line: 2, ch: 6 }, clip)).toEqual(["", "Two[^2] here.", "Three.One[^1] here.", "", "[^2]: ", "[^1]: "]);
        expect(messages()).toEqual(["Pasted with 1 footnote definition: 1 added."]);
    });

    it("a cut pasted straight back still gives the note back exactly", () => {
        const note = ["One[^1] here.", "", "Two.", "", "[^1]: ", "[^2]: "];
        const { lines, clip } = cut(note, { line: 0, ch: 0 }, { line: 0, ch: 13 });
        expect(paste(lines, { line: 0, ch: 0 }, clip)).toEqual(note);
    });

    it("control: two definitions with the same text still merge", () => {
        const plan = planCarriedPaste("a[^x]\n\n[^x]: same", "b[^1]", [one("1", "[^1]: same")]);
        expect(plan.body).toBe("b[^x]");
        expect(plan.reused).toBe(1);
    });
});

// CHARACTERIZATION: these pin what "never merges" does when the empty definition
// has the very same name, within one note. The ruling names no exception, and
// the paste cannot tell the note's own [^1] from another note's unrelated [^1].
// Nothing is lost in any of them, but Jason has not ruled on them: flip the
// expectations if he does.
describe("characterization: an empty definition and its own copy in the same note", () => {
    const note = ["One[^1] here.", "", "Two.", "", "[^1]: "];
    const first = { line: 0, ch: 0 };
    const firstEnd = { line: 0, ch: 13 };

    it("a copy pasted elsewhere gets an empty footnote of its own", () => {
        expect(paste(note, { line: 2, ch: 4 }, copy(note, first, firstEnd))).toEqual(["One[^1] here.", "", "Two.One[^2] here.", "", "[^1]: ", "[^2]: "]);
    });

    it("a copy pasted over itself gets a new footnote, and the first is left with nothing citing it", () => {
        expect(paste(note, first, copy(note, first, firstEnd), firstEnd)).toEqual(["One[^2] here.", "", "Two.", "", "[^1]: ", "[^2]: "]);
    });

    it("cutting one use of a footnote cited twice and pasting it elsewhere splits the two", () => {
        const shared = ["One[^1] here.", "", "Two[^1].", "", "[^1]: "];
        const { lines, clip } = cut(shared, first, firstEnd);
        expect(paste(lines, { line: 2, ch: 8 }, clip)).toEqual(["", "", "Two[^1].One[^2] here.", "", "[^1]: ", "[^2]: "]);
    });
});
