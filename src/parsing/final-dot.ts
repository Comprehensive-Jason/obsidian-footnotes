// Under Before placement, a footnote reference goes in front of a sentence's
// full stop. But a dot can also belong to the word in front of it, as in
// "U.S." or "Dr.", and then the reference goes after the dot. This file holds
// the one question that tells the two apart, and the word lists it uses. The
// press, a selection turned into a footnote, and the lint all ask it, so they
// can never disagree (Jason's ruling, 2026-11-06, option E of "Abbreviation
// placement research 2026-11-06" in his project folder).
//
// Nothing here applies under After or Don't move, and the lists are not
// editable in settings. The ruling of 2026-09-20, one global setting and no
// per-language table, does not forbid these lists, on Jason's reading: they
// add no setting and do not change placement by language.

/** Who a word-final dot belongs to: the word, the sentence, or nobody can tell. */
export type DotOwner = "word" | "sentence" | "doubt";

/**
 * Abbreviations whose dot is always the word's, even at a sentence's end. The
 * lists are case-sensitive, and they leave out anything that is also an
 * ordinary word in these languages, which is why "esp" (a real gap) and "Sen"
 * (a surname) are not here. A rule about the word's shape already covers
 * dotted forms such as "e.g", "z. B", and "т. д", so none of those are listed.
 */
const AbbreviationWords: ReadonlySet<string> = new Set([
    // English, and Latin as English writes it
    "Dr", "Mr", "Mrs", "Ms", "Prof", "Jr", "Sr", "St", "Mt",
    "Inc", "Ltd", "Corp", "Co", "Bros",
    "etc", "vs", "cf", "ibid", "Ibid", "viz", "approx", "pp",
    // German
    "usw", "bzw", "Nr", "Aufl", "Hrsg", "vgl", "ggf", "evtl", "ca", "Bd", "Abb", "inkl",
    // French
    "Mme", "Mlle", "éd", "réf", "coll", "chap",
    // Spanish and Portuguese
    "Sra", "Srta", "Dra", "Ud", "Uds", "pág", "págs", "núm", "ej",
    // Italian
    "Sig", "Dott", "Avv", "Ing", "ecc", "pag",
    // Polish
    "itd", "itp", "np", "tzw", "tzn", "tj", "dr", "prof", "mgr", "inż", "św",
    // Dutch
    "bijv", "enz", "dhr", "mevr", "blz",
    // Russian
    "др", "пр", "см", "стр", "рис", "г", "гг",
]);

/**
 * Abbreviations of more than one piece whose last piece alone means nothing
 * or means something else: "al", "ex", and "in" are ordinary words, so they
 * count only as part of the whole phrase. Written with an ordinary space; a
 * no-break space in the note counts as one.
 */
const AbbreviationPhrases: readonly string[] = [
    "et al", "et seq", "op. cit", "loc. cit", // Latin
    "v. Chr", "n. Chr", // German
    "p. ex", "J.-C", // French
    "EE. UU", // Spanish
    "Sig.ra", "Dott.ssa", // Italian
    "m.in", "i in", // Polish
];

/**
 * Words that are sometimes an abbreviation and sometimes an ordinary word or a
 * name: "No." may answer a question, and "fig." may be the fruit. Text alone
 * cannot tell, so a number after one settles it ("No. 5", "fig. 3") and
 * anything else leaves it in doubt.
 */
const SometimesAbbreviations: ReadonlySet<string> = new Set([
    "No", "no", "Nos", "Fig", "fig", "Vol", "vol", "Art", "art",
    "Ed", "ed", "Eds", "eds", "Ch", "ch", "p", "Sec", "sec",
    "Rev", "Gen", "Gov", "Rep", "Sen", "Col", "Hon", "es", "ex",
]);

// Character classes, in the Unicode terms the rest of the plugin uses: a word
// character is a letter, a number, or a mark (such as a combining accent),
// plus the two invisible joiners and the underscore, as in cursor-motion.ts.
const WordCharacter = /^[\p{L}\p{N}\p{M}\p{Join_C}_]/u;
/** The word and its inner dots at the end of a stretch of text. */
const TrailingWord = /[\p{L}\p{N}\p{M}\p{Join_C}_.]*$/u;
/** Han, kana, and Hangul in front of a word: those scripts write no spaces, so "美国U.S" holds the word "U.S". */
const LeadingNoSpaceScript = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/u;
/** One piece of a dotted word: one letter, or a capital and one letter, as in "U", "e", "Ph", "EE", and "т". */
const ShortPiece = /^(?:\p{L}\p{M}*|\p{Lu}\p{M}*\p{L}\p{M}*)$/u;
const SingleLetter = /^\p{L}\p{M}*$/u;
const LoneCapital = /^\p{Lu}\p{M}*$/u;
/** What right after a dot shows the dot is the word's, since nobody writes "word.,". A "!" in front of a "[" may open an image, so it does not count. */
const MarkRightAfter = /^(?:[,;:?]|!(?!\[))/;
/** A single letter, its dot, and one space, at the end of the text in front of a word: the "z. " of "z. B". */
const SingleLetterAndSpace = /(?:^|[^\p{L}\p{N}\p{M}\p{Join_C}_.])\p{L}\p{M}*\. $/u;
/** A space inside an abbreviation, including the no-break spaces typographers put in "z. B." and "et al.". */
const NoBreakSpaces = /[\u00a0\u202f]/g;

/**
 * How far either way the question looks, in characters. No abbreviation is
 * longer, and a fixed limit keeps a very long line cheap, since the lint may
 * ask once for every reference on it.
 */
const LookBehind = 40;
const LookAhead = 16;

/**
 * The footnotes on a line, so the question can read the line as if they were
 * not there: "U.S[^1]." and "U.S.[^1]" must get the same answer, or a lint
 * would move what the last lint placed. It looks a footnote up by either end,
 * so stepping over one takes the same time however many the line holds.
 */
export interface LineFootnotes {
    /** Where a footnote starting at this column ends. */
    endOf: ReadonlyMap<number, number>;
    /** Where a footnote ending at this column starts. */
    startOf: ReadonlyMap<number, number>;
}

/** The footnotes at `spans`, each from its first column to just past its last. */
export function lineFootnotes(spans: readonly { start: number; end: number }[]): LineFootnotes {
    return {
        endOf: new Map(spans.map((span) => [span.start, span.end])),
        startOf: new Map(spans.map((span) => [span.end, span.start])),
    };
}

/** A line with no footnotes known: what a walk uses when it is handed none. */
export const NoFootnotes: LineFootnotes = lineFootnotes([]);

/** The text in front of column `at`, up to LookBehind characters of it, with footnotes left out. */
function textBehind(text: string, at: number, footnotes: LineFootnotes): string {
    let out = "";
    let i = at;
    while (i > 0 && out.length < LookBehind) {
        const start = footnotes.startOf.get(i);
        if (start !== undefined) {
            i = start;
            continue;
        }
        i--;
        out = text[i] + out;
    }
    return out;
}

/** The text from column `at` on, up to LookAhead characters of it, with footnotes left out. */
function textAhead(text: string, at: number, footnotes: LineFootnotes): string {
    let out = "";
    let i = at;
    while (i < text.length && out.length < LookAhead) {
        const end = footnotes.endOf.get(i);
        if (end !== undefined) {
            i = end;
            continue;
        }
        out += text[i];
        i++;
    }
    return out;
}

/** Whether the word itself shows that its final dot is its own: "U.S", "e.g", "Ph.D", "EE.UU", or a spaced pair such as "z. B". */
function hasAbbreviationShape(word: string, written: string, behind: string): boolean {
    const pieces = word.split(".");
    if (pieces.length > 1) return pieces.every((piece) => ShortPiece.test(piece));
    // The spaced pair needs the whole word to be a single letter, with no
    // other script glued to its front.
    return word === written && SingleLetter.test(word) && SingleLetterAndSpace.test(behind.slice(0, behind.length - word.length));
}

/** Whether `behind` ends in one of the listed phrases, with the phrase starting at a word's edge. */
function endsInPhrase(behind: string): boolean {
    return AbbreviationPhrases.some((phrase) => {
        if (!behind.endsWith(phrase)) return false;
        const edge = behind.length - phrase.length;
        return edge === 0 || !(behind[edge - 1] === "." || WordCharacter.test(behind.slice(edge - 1)));
    });
}

/**
 * Who the "." at column `dot` of `text` belongs to, asked in this order
 * (Jason's ruling, 2026-11-06):
 *
 * 1. Is it a dot at the end of a word at all? The second dot of "U.S.." is the
 *    sentence's, and so is the first of exactly three, which is an ellipsis.
 * 2. The word's shape: "U.S", "e.g", and "z. B" own their dot.
 * 3. What follows: "," ";" ":" "?" or "!" right after the dot means the word
 *    owns it, since nobody writes "word.,". A "!" in front of a "[" may open an
 *    image, so it does not count.
 * 4. The lists: a listed abbreviation owns its dot. A word that is only
 *    sometimes an abbreviation, or a lone capital ("plan B", "J"), owns it when
 *    a number follows ("No. 5", "S. 5"), and is otherwise in doubt.
 * 5. A lower-case word after the dot ("the foo. bar") is doubt too.
 *
 * Everything else is the sentence's, as "A word." and "open main.js." are.
 *
 * Under doubt the reference stays where the caret put it, and the lint leaves
 * it alone. These are narrow exceptions to Jason's ruling of 2026-11-05 that a
 * press after a word's punctuation hops back in front of it: "No.|", "Fig.|",
 * and "plan B.|" no longer hop.
 *
 * The line is read with its `footnotes` left out, so a reference on either side
 * of the dot does not change the answer. Only ever asked under Before.
 */
export function finalDotOwner(text: string, dot: number, footnotes: LineFootnotes = NoFootnotes): DotOwner {
    const behind = textBehind(text, dot, footnotes).replace(NoBreakSpaces, " ");
    const ahead = textAhead(text, dot + 1, footnotes);
    const written = TrailingWord.exec(behind)?.[0] ?? "";
    // No word touches the dot, or the dot is the second of a run: "**the U.S**.", "U.S..".
    if (written === "" || written.endsWith(".")) return "sentence";
    // A word character glued to the far side makes it an inner dot, which the word walk handles. Three dots are an ellipsis.
    if (WordCharacter.test(ahead) || (ahead.startsWith("..") && ahead[2] !== ".")) return "sentence";
    const word = written.replace(/^\.+/, "").replace(LeadingNoSpaceScript, "");
    if (hasAbbreviationShape(word, written, behind)) return "word";
    if (MarkRightAfter.test(ahead)) return "word";
    if (AbbreviationWords.has(word) || endsInPhrase(behind)) return "word";
    const next = ahead.trimStart();
    if (SometimesAbbreviations.has(word) || LoneCapital.test(word)) return /^\p{Nd}/u.test(next) ? "word" : "doubt";
    return /^\p{Ll}/u.test(next) ? "doubt" : "sentence";
}
