import { Editor } from "obsidian";
import { describe, expect, it } from "vitest";

import { createMatchingFootnoteDefinition } from "../src/commands/create-footnote";
import {
    footnoteNameProblem,
    InvalidNameCharacters,
    isValidFootnoteName,
} from "../src/parsing/footnote-grammar";
import type FootnotePlugin from "../src/main";

// Regression (reported 2026-07-14): footnote names containing spaces are a
// common authoring mistake that Obsidian won't render. Instead of silently
// creating a broken definition for them, the plugin warns the user.

describe("isValidFootnoteName", () => {
    it("accepts alphanumeric names", () => {
        expect(isValidFootnoteName("note")).toBe(true);
        expect(isValidFootnoteName("12")).toBe(true);
    });

    it("accepts dashes and underscores", () => {
        expect(isValidFootnoteName("my-note")).toBe(true);
        expect(isValidFootnoteName("my_note")).toBe(true);
    });

    it("rejects names containing spaces", () => {
        expect(isValidFootnoteName("my note")).toBe(false);
    });

    it("rejects other whitespace too", () => {
        expect(isValidFootnoteName("a\tb")).toBe(false);
    });

    it("rejects names containing backticks (disallowed, Jason 2026-08-10)", () => {
        // backticked names don't render properly in Obsidian
        expect(isValidFootnoteName("x`c`y")).toBe(false);
        expect(isValidFootnoteName("`1`")).toBe(false);
    });

    it("rejects an empty name", () => {
        expect(isValidFootnoteName("")).toBe(false);
    });

    it('still accepts "#" - such footnotes RENDER, so the scanner and the linter keep treating them as footnotes', () => {
        expect(isValidFootnoteName("#x")).toBe(true);
        expect(isValidFootnoteName("a#b")).toBe(true);
    });
});

describe("footnoteNameProblem (the creation and rename rule, 2026-09-05)", () => {
    it("spaces, backticks, brackets, and \"#\" all share the one invalid-character message", () => {
        expect(footnoteNameProblem("a[b")).toBe(InvalidNameCharacters);
        expect(footnoteNameProblem("a b")).toBe(InvalidNameCharacters);
        expect(footnoteNameProblem("a`b")).toBe(InvalidNameCharacters);
        expect(footnoteNameProblem("#x")).toBe(InvalidNameCharacters);
        expect(footnoteNameProblem("a#b")).toBe(InvalidNameCharacters);
    });

    it('the message names all four (Jason: one rule, one toast, 2026-09-05)', () => {
        expect(InvalidNameCharacters).toBe('Footnote names can\'t contain spaces, backticks, brackets, or "#".');
    });

    it("an ordinary name has no problem", () => {
        expect(footnoteNameProblem("note")).toBeNull();
        expect(footnoteNameProblem("arXiv:1234.5678")).toBeNull();
        expect(footnoteNameProblem("2.7")).toBeNull();
    });
});

describe("createMatchingFootnoteDefinition with an invalid name", () => {
    it("warns and stops instead of creating a definition", () => {
        const line = "alpha[^my note] bravo";
        const doc = {
            getLine: () => line,
            lineCount: () => 1,
        } as unknown as Editor;

        // returning true consumes the hotkey press; the fake editor has no
        // transaction method, so reaching the creation path would throw
        const handled = createMatchingFootnoteDefinition(
            line,
            { line: 0, ch: 7 }, // cursor inside [^my note]
            {} as unknown as FootnotePlugin,
            doc,
        );
        expect(handled).toBe(true);
    });

    it("warns and stops on a backticked name too", () => {
        const line = "alpha[^`c`] bravo";
        const doc = {
            getLine: () => line,
            lineCount: () => 1,
        } as unknown as Editor;

        const handled = createMatchingFootnoteDefinition(
            line,
            { line: 0, ch: 8 }, // cursor inside [^`c`]
            {} as unknown as FootnotePlugin,
            doc,
        );
        expect(handled).toBe(true);
    });
});

// REVERSED same day: Jason verified live that dollar signs inside
// footnote references render correctly as footnotes, so they are VALID
// (the scanner keeps in-reference dollars out of math pairing)
describe("dollar signs in footnote names", () => {
    it("accepts names containing a dollar sign", () => {
        expect(isValidFootnoteName("a$1")).toBe(true);
        expect(isValidFootnoteName("cost$")).toBe(true);
    });
});
