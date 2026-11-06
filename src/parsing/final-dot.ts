// Under Before placement, a footnote reference goes in front of a sentence's
// full stop. But a dot can also belong to the word in front of it, as in
// "U.S." or "Dr.", and then the reference goes after the dot. This file holds
// the one question that tells the two apart. The press, a selection turned into
// a footnote, and the lint all ask it, so they can never disagree (Jason's
// ruling, 2026-11-06).
//
// The rule asks what a word looks like, not which language it is in. It won a
// hillclimb on 2026-11-06, scored on text it had never seen: 4.18 against 10.48
// for the word lists it replaced, and 6.32 against 63.31 where sentences start
// in lower case, with lower better; 796 bytes against 2,254. This copy adds the
// exact "et al" check back, which cost 0.07 on the hillclimb's own text. It is
// one rule for every language and adds no setting (the ruling of 2026-09-20). In
// five sentences:
//
// 1. A mark right after the dot, the word straight after "(", or a word of four
//    letters or fewer before a number: the word's.
// 2. A lone capital, "No", "Fig", or "Art" is otherwise in doubt, except a
//    capital in a spaced pair such as "z. B.", which is the word's.
// 3. A word that could not stand alone is the word's: dotted pieces, a listed
//    spelling, one letter, or no vowel.
// 4. Except that a lower-case word with no vowel is the sentence's stop when no
//    lower-case word follows and either a number stands in front ("5 km.") or
//    it has three letters or more and the line ends ("open the pdf."). "Hmm"
//    and "Mhm" do not count as having no vowel.
// 5. Any other word of four letters or fewer is in doubt before a short dotted
//    word, or before a lower-case word unless the line shows lower-case
//    sentence starts. Everything else is the sentence's stop.
//
// Under doubt the reference stays where the caret put it, and the lint leaves it
// alone. These are narrow exceptions to Jason's ruling of 2026-11-05 that a press
// after a word's punctuation hops back in front of it: "No.|", "Fig.|", and
// "plan B.|" do not hop. Nothing here applies under After or Don't move.

/** Who a word-final dot belongs to: the word, the sentence, or nobody can tell. */
export type DotOwner = "word" | "sentence" | "doubt";

/**
 * The footnotes on a line, so the question can read the line as if they were
 * not there: "U.S[^1]." and "U.S.[^1]" must get the same answer, or a lint would
 * move what the last lint placed. It looks a footnote up by either end, so
 * stepping over one takes the same time however many the line holds.
 */
export interface LineFootnotes {
    /** Where a footnote starting at this column ends. */
    endOf: ReadonlyMap<number, number>;
    /** Where a footnote ending at this column starts. */
    startOf: ReadonlyMap<number, number>;
    /** The lower-case sentence starts of the line last asked about, kept because the lint may ask once for every reference on it. */
    lastRead?: { text: string; stretches: readonly Stretch[] };
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

/**
 * How far either way the question looks for the words around the dot, in
 * characters. A fixed limit keeps a very long line cheap. Spaces straight after
 * the dot do not count towards LookAhead, so they cannot hide the next word.
 */
const LookBehind = 64;
const LookAhead = 16;

// A stretch is the part of a line the question reads. It ends at a table's "|",
// since a cell's editor holds one cell and the lint holds the whole row, and they
// must answer alike. It ends at a line break too, which a cell's editor holds as
// a real break and the row holds as "<br>". An escaped "\|" counts as a "|", as
// the cell's editor may hold it without the backslash.
const StretchEdge = /\\?\||\n|<br>/y;

/** The length of the stretch's edge starting at column `at`, or 0 when there is none. */
function edgeLengthAt(text: string, at: number): number {
    StretchEdge.lastIndex = at;
    return StretchEdge.exec(text)?.[0].length ?? 0;
}

/** The text in front of column `at`, back to the stretch's edge and up to LookBehind characters of it, with footnotes left out. */
function textBehind(text: string, at: number, footnotes: LineFootnotes): string {
    let out = "";
    let i = at;
    while (i > 0 && out.length < LookBehind) {
        const start = footnotes.startOf.get(i);
        if (start !== undefined) {
            i = start;
            continue;
        }
        if (text[i - 1] === "|" || text[i - 1] === "\n" || text.startsWith("<br>", i - 4)) break;
        i--;
        out = text[i] + out;
    }
    return out;
}

/** The text from column `at` on, up to the stretch's edge and LookAhead characters past any spaces, with footnotes left out. */
function textAhead(text: string, at: number, footnotes: LineFootnotes): string {
    let out = "";
    let counted = 0;
    let i = at;
    while (i < text.length && counted < LookAhead) {
        const end = footnotes.endOf.get(i);
        if (end !== undefined) {
            i = end;
            continue;
        }
        if (edgeLengthAt(text, i) > 0) break;
        if (counted > 0 || !/\s/.test(text[i])) counted++;
        out += text[i];
        i++;
    }
    return out;
}

/** One stretch of a line: the column just past it, and whether it shows lower-case sentence starts. */
interface Stretch {
    end: number;
    lowerCaseStarts: boolean;
}

/**
 * Five lower-case letters, a dot, a space, and a lower-case letter: a writer who
 * does not capitalise. On such a line a lower-case word after a dot says nothing
 * about the dot. It takes five letters so that an abbreviation such as "esp."
 * does not count as a sentence's end.
 */
const LowerCaseSentenceStart = /\p{Ll}{5}\.\s+\p{Ll}/u;

/** Reads the whole line once, with footnotes left out, and answers for each stretch of it. */
function readStretches(text: string, footnotes: LineFootnotes): Stretch[] {
    const stretches: Stretch[] = [];
    let plain = "";
    let i = 0;
    while (i <= text.length) {
        const end = footnotes.endOf.get(i);
        if (end !== undefined) {
            i = end;
            continue;
        }
        const edge = edgeLengthAt(text, i);
        if (edge > 0 || i === text.length) {
            stretches.push({ end: i, lowerCaseStarts: LowerCaseSentenceStart.test(plain) });
            plain = "";
            i += Math.max(edge, 1);
            continue;
        }
        plain += text[i];
        i++;
    }
    return stretches;
}

/** Whether the stretch holding column `at` shows lower-case sentence starts. The answers are kept with `footnotes`, so a line is read once however many references it holds. */
function showsLowerCaseStarts(text: string, at: number, footnotes: LineFootnotes): boolean {
    if (footnotes.lastRead?.text !== text) footnotes.lastRead = { text, stretches: readStretches(text, footnotes) };
    return footnotes.lastRead.stretches.find((stretch) => at <= stretch.end)?.lowerCaseStarts ?? false;
}

// Character classes, in the Unicode terms the rest of the plugin uses: a word
// character is a letter, a number, or a mark (such as a combining accent), plus
// the two invisible joiners and the underscore, as in cursor-motion.ts.
const WordCharacter = /^[\p{L}\p{N}\p{M}\p{Join_C}_]/u;
/** The word and its inner dots at the end of a stretch of text. */
const TrailingWord = /[\p{L}\p{N}\p{M}\p{Join_C}_.]*$/u;
/** Everything back to the last space. */
const TextSinceLastSpace = /\S*$/u;
/** The opening quotes, brackets, and emphasis markers in front of a word. */
const OpeningMarks = /^[("'“‘«»„‚[{<¿¡*_~`‹›—–-]+/u;
/** Han, kana, and Hangul in front of a word: those scripts write no spaces, so "美国U.S" holds the word "U.S", and "있다" holds no word at all. */
const LeadingNoSpaceScript = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/u;

/** What right after a dot shows the dot is the word's, since nobody writes "word.,". A "!" in front of a "[" may open an image, so it does not count. */
const MarkRightAfter = /^(?:[,;:?]|!(?!\[))/;
/** One letter, then only lower-case letters: "Dr", "pp", "г", and "S", but not "USA", "1998", "GmbH", or "5th". */
const OneLetterThenLowerCase = /^\p{L}\p{Ll}*$/u;
/** Sometimes an abbreviation and sometimes a word or a name: "No." may answer a question, "fig." may be the fruit, and "plan B." ends a sentence (Jason's rulings). */
const SometimesAbbreviation = /^(?:\p{Lu}|[Nn]o|[Ff]ig|[Aa]rt)$/u;
/** A single letter, its dot, and a space in front of the last word: the "z. " of "z. B". */
const SpacedPairInFront = /(?:^|\s)\p{L}\.\s\S+$/u;
/** Dotted pieces of one character, or of a capital and one character: "U.S", "e.g", "Ph.D", and "EE.UU", but not "main.js". */
const DottedPieces = /^(?:\p{Lu}?\S\.)+\p{Lu}?\p{L}$/u;
/**
 * The few abbreviations that have a vowel, so nothing else about them shows what
 * they are, and "uu" for "EE. UU.". Any case counts, so "Etc." is here too. All
 * of them but "aufl" and "eds" are on the open lists of Unicode CLDR, pySBD, or
 * spaCy. Those two are from the hand-written list this rule replaced.
 */
const ListedAbbreviation = /^(?:etc|ibid|cit|ed|eds|trans|inc|prof|usw|itd|itp|ecc|aufl|uu|ul|proc|mevr|pct|тыс)$/i;
/** "al" alone is an ordinary word in several languages, so only the whole phrase counts: "et al", and not "wet al". A no-break space counts as a space. */
const EtAl = /\bet\sal$/;
/** The vowels of the Latin and Cyrillic alphabets, with the accented forms the hillclimb's languages use. */
const Vowel = /[aeiouyà-ÿąęěůаеёиоуыэюя]/i;
/** A letter other than h and m, so that "Hmm", "Mhm", and "Mm" count as words of a sentence and not as abbreviations. */
const OtherThanHAndM = /[^hm]/i;
/** A number and one space in front of the last word, as in "5 km". */
const NumberInFront = /\d\s\S+$/;
/** The next word is short and has a dot of its own: "Prof. Dr.", "Kon. Ned.". */
const ShortDottedWordNext = /^\S{1,4}\./;

/**
 * Who the "." at column `dot` of `text` belongs to. The steps are the five
 * sentences at the top of this file, after two checks that it is a dot at the
 * end of a word at all.
 *
 * The line is read with its `footnotes` left out, so a reference on either side
 * of the dot does not change the answer. Only ever asked under Before.
 */
export function finalDotOwner(text: string, dot: number, footnotes: LineFootnotes = NoFootnotes): DotOwner {
    const behind = textBehind(text, dot, footnotes);
    const ahead = textAhead(text, dot + 1, footnotes);
    const written = TrailingWord.exec(behind)?.[0] ?? "";
    // No word touches the dot, or the dot is the second of a run: "**the U.S**.", "U.S..".
    if (written === "" || written.endsWith(".")) return "sentence";
    // A word character glued to the far side makes it an inner dot, which the word walk handles. Three dots are an ellipsis.
    if (WordCharacter.test(ahead) || (ahead.startsWith("..") && ahead[2] !== ".")) return "sentence";

    const word = written.replace(LeadingNoSpaceScript, "");
    const next = ahead.trimStart();
    const textWord = (TextSinceLastSpace.exec(behind)?.[0] ?? "").replace(OpeningMarks, "");
    // "can't" and "km/h" hold more than the letters that touch the dot, so "t" and "h" are no word of their own.
    const standsAlone = textWord === written;
    const isShort = word.length <= 4;
    const isCased = OneLetterThenLowerCase.test(word);
    const nextIsLowerCase = /^\p{Ll}/u.test(next);

    // Sentence 1. A sentence does not end straight after "(", and "Art. 5", "pp. 12", and "S. 5" are the word's.
    if (MarkRightAfter.test(ahead) || behind.endsWith(`(${textWord}`) || (isShort && isCased && /^\d/.test(next))) return "word";

    // Sentence 2.
    if (SometimesAbbreviation.test(word)) return SpacedPairInFront.test(behind) ? "word" : "doubt";

    // Sentence 3, the shape and the list. One letter is an initial, or the end of a pair such as "u. a.".
    if (DottedPieces.test(word) || ListedAbbreviation.test(word) || EtAl.test(behind) || (standsAlone && isCased && word.length === 1)) return "word";

    // Sentences 3 and 4, no vowel. "Dr", "bzw", and "г" are the word's. A lower-case one may be a unit or a file type, and then the dot is the sentence's.
    if (standsAlone && isCased && !Vowel.test(word) && OtherThanHAndM.test(word)) {
        const unitOrFileType = /^\p{Ll}/u.test(word) && !nextIsLowerCase && (NumberInFront.test(behind) || (word.length >= 3 && next === ""));
        return unitOrFileType ? "sentence" : "word";
    }

    // Sentence 5.
    if (isShort && (ShortDottedWordNext.test(next) || (nextIsLowerCase && !showsLowerCaseStarts(text, dot, footnotes)))) return "doubt";
    return "sentence";
}
