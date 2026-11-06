import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";
import { insertInTableCell } from "../src/commands/create-footnote";
import { insertAutonumFootnote, insertInlineFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { selectionPressHandled } from "../src/commands/selection-footnote";
import type { TableCellEditor } from "../src/editor/table-cursor";
import { footnoteAfterPunctuation } from "../src/linting/rules/footnote-after-punctuation";
import { finalDotOwner, lineFootnotes } from "../src/parsing/final-dot";
import type { FootnotePlacement } from "../src/parsing/landing";

// Jason's ruling of 2026-11-06 (option E of "Abbreviation placement research
// 2026-11-06" in his project folder). Under Before placement, a final dot that
// belongs to the word keeps the reference behind it: "in the U.S.|" gives "in
// the U.S.[^1]". A dot in doubt lets the caret decide, and the lint leaves it
// alone. Every other dot is the sentence's, and the reference goes in front of
// it as before. After and Don't move do not change at all.
//
// The tables come from that research. Each row states the note with the caret
// at "|", then the expected text under Before, After, and Don't move.
//
// CHARACTERIZATION, for Jason's review:
// - The After and Don't move columns were recorded from master at ff047df, just
//   before the rule went in, so they pin behaviour as it was. They are what
//   proves those two settings did not move.
// - A row marked Wrong is one the rule gets wrong on purpose: the research lists
//   them as what text alone cannot decide. They are pinned as they behave, not
//   as a careful writer would want them.
//
// The rule behind the tables changed on 2026-11-06, to the winner of the
// abbreviation hillclimb (src/parsing/final-dot.ts). The tables did not: every
// row answers as it did under option E. The one statement that changed is that
// "Etc.[^1]" now stays, since the short list takes any case.

/** The note with the caret at "|", then Before, After, and Don't move, and whether Before is wrong on purpose. */
type PressRow = readonly [marked: string, before: string, after: string, none: string, wrong?: "wrong"];
const Wrong = "wrong";

const PressRows: Record<string, readonly PressRow[]> = {
    "Dotted initialisms": [
        ["in the U.S.|", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S.[^1]"],
        ["in the U.S|.", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S[^1]."],
        ["in the U|.S.", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S[^1]."],
        ["in the U.S.A.|", "in the U.S.A.[^1]", "in the U.S.A.[^1]", "in the U.S.A.[^1]"],
        ["in the U.K.|", "in the U.K.[^1]", "in the U.K.[^1]", "in the U.K.[^1]"],
        ["in the E.U.|", "in the E.U.[^1]", "in the E.U.[^1]", "in the E.U.[^1]"],
        ["e.g.|", "e.g.[^1]", "e.g.[^1]", "e.g.[^1]"],
        ["i.e.|", "i.e.[^1]", "i.e.[^1]", "i.e.[^1]"],
        ["at 5 a.m.|", "at 5 a.m.[^1]", "at 5 a.m.[^1]", "at 5 a.m.[^1]"],
        ["at 5 p.m.|", "at 5 p.m.[^1]", "at 5 p.m.[^1]", "at 5 p.m.[^1]"],
        ["a Ph.D.|", "a Ph.D.[^1]", "a Ph.D.[^1]", "a Ph.D.[^1]"],
        ["an M.D.|", "an M.D.[^1]", "an M.D.[^1]", "an M.D.[^1]"],
        ["N.B.|", "N.B.[^1]", "N.B.[^1]", "N.B.[^1]"],
        ["P.S.|", "P.S.[^1]", "P.S.[^1]", "P.S.[^1]"],
        ["a.k.a.|", "a.k.a.[^1]", "a.k.a.[^1]", "a.k.a.[^1]"],
        ["the US.|", "the US[^1].", "the US.[^1]", "the US.[^1]"],
    ],
    "One-word abbreviations, no inner dot": [
        ["Dr.| Smith", "Dr.[^1] Smith", "Dr.[^1] Smith", "Dr.[^1] Smith"],
        ["Mr.| Smith", "Mr.[^1] Smith", "Mr.[^1] Smith", "Mr.[^1] Smith"],
        ["Mrs.| Smith", "Mrs.[^1] Smith", "Mrs.[^1] Smith", "Mrs.[^1] Smith"],
        ["Prof.| Smith", "Prof.[^1] Smith", "Prof.[^1] Smith", "Prof.[^1] Smith"],
        ["St.| Louis", "St.[^1] Louis", "St.[^1] Louis", "St.[^1] Louis"],
        ["A vs.| B", "A vs.[^1] B", "A vs.[^1] B", "A vs.[^1] B"],
        ["apples, etc.|", "apples, etc.[^1]", "apples, etc.[^1]", "apples, etc.[^1]"],
        ["Smith et al.|", "Smith et al.[^1]", "Smith et al.[^1]", "Smith et al.[^1]"],
        ["Smith et al.| argue", "Smith et al.[^1] argue", "Smith et al.[^1] argue", "Smith et al.[^1] argue"],
        ["cf.| Marx", "cf.[^1] Marx", "cf.[^1] Marx", "cf.[^1] Marx"],
        ["ibid.|", "ibid.[^1]", "ibid.[^1]", "ibid.[^1]"],
        ["op. cit.|", "op. cit.[^1]", "op. cit.[^1]", "op. cit.[^1]"],
        ["see fig.| 3", "see fig.[^1] 3", "see fig.[^1] 3", "see fig.[^1] 3"],
        ["see no.| 5", "see no.[^1] 5", "see no.[^1] 5", "see no.[^1] 5"],
        ["pp.| 3-5", "pp.[^1] 3-5", "pp.[^1] 3-5", "pp.[^1] 3-5"],
        ["vol.| 2", "vol.[^1] 2", "vol.[^1] 2", "vol.[^1] 2"],
        ["ed.| Marx", "ed.[^1] Marx", "ed.[^1] Marx", "ed.[^1] Marx"],
        ["Acme Inc.|", "Acme Inc.[^1]", "Acme Inc.[^1]", "Acme Inc.[^1]"],
        ["Acme Ltd.|", "Acme Ltd.[^1]", "Acme Ltd.[^1]", "Acme Ltd.[^1]"],
        ["John Jr.|", "John Jr.[^1]", "John Jr.[^1]", "John Jr.[^1]"],
        ["John Sr.|", "John Sr.[^1]", "John Sr.[^1]", "John Sr.[^1]"],
    ],
    "Non-English": [
        ["z.B.| das", "z.B.[^1] das", "z.B.[^1] das", "z.B.[^1] das"],
        ["z. B.| das", "z. B.[^1] das", "z. B.[^1] das", "z. B.[^1] das"],
        ["d.h.| das", "d.h.[^1] das", "d.h.[^1] das", "d.h.[^1] das"],
        ["d. h.| das", "d. h.[^1] das", "d. h.[^1] das", "d. h.[^1] das"],
        ["u. a.|", "u. a.[^1]", "u. a.[^1]", "u. a.[^1]"],
        ["und so weiter usw.|", "und so weiter usw.[^1]", "und so weiter usw.[^1]", "und so weiter usw.[^1]"],
        ["bzw.| das", "bzw.[^1] das", "bzw.[^1] das", "bzw.[^1] das"],
        ["Nr.| 5", "Nr.[^1] 5", "Nr.[^1] 5", "Nr.[^1] 5"],
        ["3. Aufl.|", "3. Aufl.[^1]", "3. Aufl.[^1]", "3. Aufl.[^1]"],
        ["S.| 5", "S.[^1] 5", "S.[^1] 5", "S.[^1] 5"],
        ["M.| Dupont", "M.[^1] Dupont", "M.[^1] Dupont", "M.[^1] Dupont"],
        ["etc.|", "etc.[^1]", "etc.[^1]", "etc.[^1]"],
        ["p. ex.| ceci", "p. ex.[^1] ceci", "p. ex.[^1] ceci", "p. ex.[^1] ceci"],
        ["Sr.| Pérez", "Sr.[^1] Pérez", "Sr.[^1] Pérez", "Sr.[^1] Pérez"],
        ["los EE.UU.|", "los EE.UU.[^1]", "los EE.UU.[^1]", "los EE.UU.[^1]"],
        ["los EE. UU.|", "los EE. UU.[^1]", "los EE. UU.[^1]", "los EE. UU.[^1]"],
        ["np.| to", "np.[^1] to", "np.[^1] to", "np.[^1] to"],
        ["itd.|", "itd.[^1]", "itd.[^1]", "itd.[^1]"],
        ["и т. д.|", "и т. д.[^1]", "и т. д.[^1]", "и т. д.[^1]"],
        ["т.е.| это", "т.е.[^1] это", "т.е.[^1] это", "т.е.[^1] это"],
        ["这是句子。|", "这是句子[^1]。", "这是句子。[^1]", "这是句子。[^1]"],
        ["这是句子|。", "这是句子[^1]。", "这是句子。[^1]", "这是句子[^1]。"],
        ["文章等。|", "文章等[^1]。", "文章等。[^1]", "文章等。[^1]"],
        ["美国U.S.。|", "美国U.S.[^1]。", "美国U.S.。[^1]", "美国U.S.。[^1]"],
        ["「句子。|」然后", "「句子。」[^1]然后", "「句子。[^1]」然后", "「句子。[^1]」然后"],
    ],
    "Initials in names": [
        ["J.R.R.| Tolkien", "J.R.R.[^1] Tolkien", "J.R.R.[^1] Tolkien", "J.R.R.[^1] Tolkien"],
        ["J.R.R|. Tolkien", "J.R.R.[^1] Tolkien", "J.R.R.[^1] Tolkien", "J.R.R[^1]. Tolkien"],
        ["J.| Smith", "J.[^1] Smith", "J.[^1] Smith", "J.[^1] Smith"],
        ["by J. Smith.|", "by J. Smith[^1].", "by J. Smith.[^1]", "by J. Smith.[^1]"],
        ["by J.R.R. Tolkien.|", "by J.R.R. Tolkien[^1].", "by J.R.R. Tolkien.[^1]", "by J.R.R. Tolkien.[^1]"],
    ],
    "Doubled period and marks after an abbreviation": [
        ["Opening in the U.S..|", "Opening in the U.S.[^1].", "Opening in the U.S..[^1]", "Opening in the U.S..[^1]"],
        ["Opening in the U.S.|.", "Opening in the U.S.[^1].", "Opening in the U.S.[^1].", "Opening in the U.S.[^1]."],
        ["Opening in the U.S|..", "Opening in the U.S.[^1].", "Opening in the U.S..[^1]", "Opening in the U.S[^1].."],
        ["the U.S.,| and", "the U.S.[^1], and", "the U.S.,[^1] and", "the U.S.,[^1] and"],
        ["the U.S.|, and", "the U.S.[^1], and", "the U.S.[^1], and", "the U.S.[^1], and"],
        ["the U.S.;| and", "the U.S.[^1]; and", "the U.S.;[^1] and", "the U.S.;[^1] and"],
        ["(the U.S.)|", "(the U.S.)[^1]", "(the U.S.)[^1]", "(the U.S.)[^1]"],
        ["(the U.S.|)", "(the U.S.)[^1]", "(the U.S.[^1])", "(the U.S.[^1])"],
        ["\"the U.S.\"|", "\"the U.S.\"[^1]", "\"the U.S.\"[^1]", "\"the U.S.\"[^1]"],
        ["\"the U.S.|\"", "\"the U.S.\"[^1]", "\"the U.S.[^1]\"", "\"the U.S.[^1]\""],
        ["in the U.S.?|", "in the U.S.[^1]?", "in the U.S.?[^1]", "in the U.S.?[^1]"],
        ["in the U.S.!|", "in the U.S.[^1]!", "in the U.S.![^1]", "in the U.S.![^1]"],
        ["the U.S...|", "the U.S[^1]...", "the U.S...[^1]", "the U.S...[^1]"],
        ["the U.S.…|", "the U.S.[^1]…", "the U.S.…[^1]", "the U.S.…[^1]"],
        ["the U.S…|", "the U.S[^1]…", "the U.S…[^1]", "the U.S…[^1]"],
        ["e.g.,| this", "e.g.[^1], this", "e.g.,[^1] this", "e.g.,[^1] this"],
        ["etc.),| and", "etc.)[^1], and", "etc.),[^1] and", "etc.),[^1] and"],
    ],
    "Mid-sentence, sentence end, and where the line sits": [
        ["the U.S.| law", "the U.S.[^1] law", "the U.S.[^1] law", "the U.S.[^1] law"],
        ["the U.S.| Senate", "the U.S.[^1] Senate", "the U.S.[^1] Senate", "the U.S.[^1] Senate"],
        ["in the U.S.| Then we left.", "in the U.S.[^1] Then we left.", "in the U.S.[^1] Then we left.", "in the U.S.[^1] Then we left."],
        ["in the U.S.|\nNext line.", "in the U.S.[^1]\nNext line.", "in the U.S.[^1]\nNext line.", "in the U.S.[^1]\nNext line."],
        ["- in the U.S.|", "- in the U.S.[^1]", "- in the U.S.[^1]", "- in the U.S.[^1]"],
        ["- [ ] in the U.S.|", "- [ ] in the U.S.[^1]", "- [ ] in the U.S.[^1]", "- [ ] in the U.S.[^1]"],
        ["> in the U.S.|", "> in the U.S.[^1]", "> in the U.S.[^1]", "> in the U.S.[^1]"],
        ["# in the U.S.|", "# in the U.S.[^1]", "# in the U.S.[^1]", "# in the U.S.[^1]"],
        ["**the U.S.**|", "**the U.S.**[^1]", "**the U.S.**[^1]", "**the U.S.**[^1]"],
        ["**the U.S**.|", "**the U.S**[^1].", "**the U.S**.[^1]", "**the U.S**.[^1]"],
        ["[U.S.](http://a.b/c).|", "[U.S.](http://a.b/c)[^1].", "[U.S.](http://a.b/c).[^1]", "[U.S.](http://a.b/c).[^1]"],
        ["[[U.S.]].|", "[[U.S.]][^1].", "[[U.S.]].[^1]", "[[U.S.]].[^1]"],
        ["`U.S.`.|", "`U.S.`[^1].", "`U.S.`.[^1]", "`U.S.`.[^1]"],
    ],
    "Numbers and things with dots": [
        ["Step 1.|", "Step 1[^1].", "Step 1.[^1]", "Step 1.[^1]"],
        ["No. 5.|", "No. 5[^1].", "No. 5.[^1]", "No. 5.[^1]"],
        ["pi is 3.14.|", "pi is 3.14[^1].", "pi is 3.14.[^1]", "pi is 3.14.[^1]"],
        ["use v2.0.|", "use v2.0[^1].", "use v2.0.[^1]", "use v2.0.[^1]"],
        ["open main.js.|", "open main.js[^1].", "open main.js.[^1]", "open main.js.[^1]"],
        ["open fs.js.|", "open fs.js[^1].", "open fs.js.[^1]", "open fs.js.[^1]"],
        ["see gov.uk.|", "see gov.uk[^1].", "see gov.uk.[^1]", "see gov.uk.[^1]"],
        ["use ASP.NET.|", "use ASP.NET[^1].", "use ASP.NET.[^1]", "use ASP.NET.[^1]"],
        ["see example.com.|", "see example.com[^1].", "see example.com.[^1]", "see example.com.[^1]"],
        ["Write to me@example.com.|", "Write to me@example.com[^1].", "Write to me@example.com[^1].", "Write to me@example.com."],
    ],
    "Other marks against a word": [
        ["the dogs'.|", "the dogs'[^1].", "the dogs'.[^1]", "the dogs'.[^1]"],
        ["the dogs|'.", "the dogs'[^1].", "the dogs'.[^1]", "the dogs[^1]'."],
        ["Marx's.|", "Marx's[^1].", "Marx's.[^1]", "Marx's.[^1]"],
        ["\"word\".|", "\"word\"[^1].", "\"word\".[^1]", "\"word\".[^1]"],
        ["\"word.\"|", "\"word.\"[^1]", "\"word.\"[^1]", "\"word.\"[^1]"],
        ["(word).|", "(word)[^1].", "(word).[^1]", "(word).[^1]"],
        ["(word.)|", "(word.)[^1]", "(word.)[^1]", "(word.)[^1]"],
        ["**bold**.|", "**bold**[^1].", "**bold**.[^1]", "**bold**.[^1]"],
    ],
    "Where text alone cannot decide": [
        ["Yes.|", "Yes[^1].", "Yes.[^1]", "Yes.[^1]"],
        ["A word.|", "A word[^1].", "A word.[^1]", "A word.[^1]"],
        ["Tell me.|", "Tell me[^1].", "Tell me.[^1]", "Tell me.[^1]"],
        ["No.|", "No.[^1]", "No.[^1]", "No.[^1]"],
        ["No.| Then", "No.[^1] Then", "No.[^1] Then", "No.[^1] Then"],
        ["Fig.|", "Fig.[^1]", "Fig.[^1]", "Fig.[^1]"],
        ["I ate a fig.|", "I ate a fig.[^1]", "I ate a fig.[^1]", "I ate a fig.[^1]", Wrong],
        ["plan B.|", "plan B.[^1]", "plan B.[^1]", "plan B.[^1]", Wrong],
        ["vitamin C.|", "vitamin C.[^1]", "vitamin C.[^1]", "vitamin C.[^1]", Wrong],
        ["Henry V.|", "Henry V.[^1]", "Henry V.[^1]", "Henry V.[^1]", Wrong],
        ["at 5 PM.|", "at 5 PM[^1].", "at 5 PM.[^1]", "at 5 PM.[^1]"],
        ["the USA.|", "the USA[^1].", "the USA.[^1]", "the USA.[^1]"],
        ["We left.| iPhone sales rose.", "We left.[^1] iPhone sales rose.", "We left.[^1] iPhone sales rose.", "We left.[^1] iPhone sales rose.", Wrong],
        ["i went home.| then i slept.", "i went home.[^1] then i slept.", "i went home.[^1] then i slept.", "i went home.[^1] then i slept.", Wrong],
        ["esp.| when", "esp.[^1] when", "esp.[^1] when", "esp.[^1] when"],
        ["esp.|", "esp[^1].", "esp.[^1]", "esp.[^1]", Wrong],
        ["I met Dr. Li.|", "I met Dr. Li[^1].", "I met Dr. Li.[^1]", "I met Dr. Li.[^1]"],
    ],
};

// The same presses in a table cell's own editor, which has its own route.
const CellRows: readonly PressRow[] = [
    ["in the U.S.|", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S.[^1]"],
    ["in the U.S|.", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S[^1]."],
    ["e.g.|", "e.g.[^1]", "e.g.[^1]", "e.g.[^1]"],
    ["Dr.|", "Dr.[^1]", "Dr.[^1]", "Dr.[^1]"],
    ["etc.|", "etc.[^1]", "etc.[^1]", "etc.[^1]"],
    ["Opening in the U.S..|", "Opening in the U.S.[^1].", "Opening in the U.S..[^1]", "Opening in the U.S..[^1]"],
    ["Opening in the U.S.|.", "Opening in the U.S.[^1].", "Opening in the U.S.[^1].", "Opening in the U.S.[^1]."],
    ["A word.|", "A word[^1].", "A word.[^1]", "A word.[^1]"],
    ["the U.S.,|", "the U.S.[^1],", "the U.S.,[^1]", "the U.S.,[^1]"],
    ["(U.S.)|", "(U.S.)[^1]", "(U.S.)[^1]", "(U.S.)[^1]"],
];

// What the lint does to a reference already in the note. The first column is
// the note as written, with no caret.
const LintRows: readonly PressRow[] = [
    ["the U.S.[^1] law", "the U.S.[^1] law", "the U.S.[^1] law", "the U.S.[^1] law"],
    ["the U.S[^1]. law", "the U.S.[^1] law", "the U.S.[^1] law", "the U.S[^1]. law"],
    ["in the U.S.[^1]", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S.[^1]"],
    ["in the U.S[^1].", "in the U.S.[^1]", "in the U.S.[^1]", "in the U.S[^1]."],
    ["in the U.S.[^1].", "in the U.S.[^1].", "in the U.S.[^1].", "in the U.S.[^1]."],
    ["in the U.S[^1]..", "in the U.S.[^1].", "in the U.S..[^1]", "in the U.S[^1].."],
    ["Dr.[^1] Smith", "Dr.[^1] Smith", "Dr.[^1] Smith", "Dr.[^1] Smith"],
    ["Dr[^1]. Smith", "Dr.[^1] Smith", "Dr.[^1] Smith", "Dr[^1]. Smith"],
    ["etc.[^1].", "etc.[^1].", "etc.[^1].", "etc.[^1]."],
    ["etc[^1]..", "etc.[^1].", "etc..[^1]", "etc[^1].."],
    ["etc.[^1]", "etc.[^1]", "etc.[^1]", "etc.[^1]"],
    ["etc[^1].", "etc.[^1]", "etc.[^1]", "etc[^1]."],
    ["e.g.[^1], this", "e.g.[^1], this", "e.g.[^1], this", "e.g.[^1], this"],
    ["e.g[^1]., this", "e.g.[^1], this", "e.g.,[^1] this", "e.g[^1]., this"],
    ["the U.S.[^1], and", "the U.S.[^1], and", "the U.S.[^1], and", "the U.S.[^1], and"],
    ["the U.S[^1]., and", "the U.S.[^1], and", "the U.S.,[^1] and", "the U.S[^1]., and"],
    ["in the U.S.[^1]?", "in the U.S.[^1]?", "in the U.S.[^1]?", "in the U.S.[^1]?"],
    ["in the U.S[^1].?", "in the U.S.[^1]?", "in the U.S.?[^1]", "in the U.S[^1].?"],
    ["J.[^1] Smith", "J.[^1] Smith", "J.[^1] Smith", "J.[^1] Smith"],
    ["J[^1]. Smith", "J[^1]. Smith", "J.[^1] Smith", "J[^1]. Smith"],
    ["A word.[^1]", "A word[^1].", "A word.[^1]", "A word.[^1]"],
    ["A word[^1].", "A word[^1].", "A word.[^1]", "A word[^1]."],
    ["Yes.[^1]", "Yes[^1].", "Yes.[^1]", "Yes.[^1]"],
    ["Yes[^1].", "Yes[^1].", "Yes.[^1]", "Yes[^1]."],
    ["the U.S.[^1]..", "the U.S[^1]...", "the U.S.[^1]..", "the U.S.[^1].."],
    ["the U.S[^1]...", "the U.S[^1]...", "the U.S...[^1]", "the U.S[^1]..."],
    ["z.B.[^1] das", "z.B.[^1] das", "z.B.[^1] das", "z.B.[^1] das"],
    ["z.B[^1]. das", "z.B.[^1] das", "z.B.[^1] das", "z.B[^1]. das"],
    ["z. B.[^1] das", "z. B.[^1] das", "z. B.[^1] das", "z. B.[^1] das"],
    ["usw.[^1]", "usw.[^1]", "usw.[^1]", "usw.[^1]"],
    ["usw[^1].", "usw.[^1]", "usw.[^1]", "usw[^1]."],
    ["(U.S.[^1])", "(U.S.)[^1]", "(U.S.[^1])", "(U.S.[^1])"],
    ["(U.S[^1].)", "(U.S.)[^1]", "(U.S.)[^1]", "(U.S[^1].)"],
    ["(U.S.)[^1]", "(U.S.)[^1]", "(U.S.)[^1]", "(U.S.)[^1]"],
    ["\"U.S.[^1]\"", "\"U.S.\"[^1]", "\"U.S.[^1]\"", "\"U.S.[^1]\""],
    ["\"U.S.\"[^1]", "\"U.S.\"[^1]", "\"U.S.\"[^1]", "\"U.S.\"[^1]"],
    ["see example.com.[^1]", "see example.com[^1].", "see example.com.[^1]", "see example.com.[^1]"],
    ["see example.com[^1].", "see example.com[^1].", "see example.com.[^1]", "see example.com[^1]."],
    ["main.js.[^1]", "main.js[^1].", "main.js.[^1]", "main.js.[^1]"],
    ["main.js[^1].", "main.js[^1].", "main.js.[^1]", "main.js[^1]."],
    ["me@example.com.[^1]", "me@example.com.[^1]", "me@example.com.[^1]", "me@example.com.[^1]"],
    ["me@example.com[^1].", "me@example.com[^1].", "me@example.com[^1].", "me@example.com[^1]."],
];

const Placements = ["before", "after", "none"] as const;
const column = (row: PressRow, placement: FootnotePlacement) => row[Placements.indexOf(placement) + 1];

beforeEach(resetNotices);

/** Everything in the note above its definitions: the text the reference was written into. */
function withoutDefinitions(written: string): string {
    const at = written.indexOf("\n\n[^");
    return at === -1 ? written : written.slice(0, at);
}

/** Where line and column the "|" of `marked` stands, and the note without it. */
function caretOf(marked: string) {
    const at = marked.indexOf("|");
    const lines = marked.replace("|", "").split("\n");
    const before = marked.slice(0, at).split("\n");
    return { lines, cursor: { line: before.length - 1, ch: before[before.length - 1].length } };
}

const Settings = { insertAtEndOfWord: true, enablePopupEditor: false, enableFootnotePrefix: false, enableFootnoteSectionHeading: false };

/** Presses the numbered-footnote key at the "|" of `marked`. */
async function press(marked: string, footnotePlacement: FootnotePlacement): Promise<string> {
    const { lines, cursor } = caretOf(marked);
    const doc = fakeEditor(lines, { cursor, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...Settings, footnotePlacement }, doc));
    return withoutDefinitions(doc.lines.join("\n"));
}

/** Presses the numbered key in a table cell's own editor holding `marked`. */
function cellPress(marked: string, footnotePlacement: FootnotePlacement): string {
    const head = marked.indexOf("|");
    const text = marked.replace("|", "");
    let written = text;
    const cell: TableCellEditor = {
        state: { doc: { toString: () => text }, selection: { main: { head, anchor: head } } },
        dispatch: (spec) => {
            const { from, to, insert } = (spec as { changes: { from: number; to: number; insert: string } }).changes;
            written = text.slice(0, from) + insert + text.slice(to);
        },
    };
    insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true, footnotePlacement }), "[^1]", 4);
    return written;
}

/** The lint's punctuation rule on `note`, which gets the definitions its references need, and without them again afterwards. */
function lint(note: string, placement: FootnotePlacement = "before"): string {
    return withoutDefinitions(footnoteAfterPunctuation(`${note}\n\n[^1]: one\n[^2]: two`, placement));
}

describe("the research's table", () => {
    describe.each(Object.keys(PressRows))("%s", (section) => {
        it.each(PressRows[section].map((row) => [row[0], row] as const))("press at %s", async (_marked, row) => {
            for (const placement of Placements) expect(await press(row[0], placement), placement).toBe(column(row, placement));
        });

        it.each(PressRows[section].map((row) => [row[0], row] as const))("the lint leaves what a press placed at %s, and a second lint changes nothing", async (_marked, row) => {
            const placed = await press(row[0], "before");
            expect(lint(placed)).toBe(placed);
        });
    });

    it("counts 132 rows, 7 of them wrong on purpose", () => {
        const rows = Object.values(PressRows).flat();
        expect(rows).toHaveLength(132);
        expect(rows.filter((row) => row[4] === Wrong)).toHaveLength(7);
    });

    it("press in a table cell beside a reference reads past it", () => {
        expect(cellPress("in the U.S.[^2]|", "before")).toBe("in the U.S.[^2][^1]");
        expect(cellPress("the U.S|.[^2] law", "before")).toBe("the U.S.[^1][^2] law");
        expect(cellPress("the foo|.[^2] bar", "before")).toBe("the foo[^1].[^2] bar");
    });

    it.each(CellRows.map((row) => [row[0], row] as const))("press in a table cell at %s", (_marked, row) => {
        for (const placement of Placements) expect(cellPress(row[0], placement), placement).toBe(column(row, placement));
    });

    it.each(LintRows.map((row) => [row[0], row] as const))("lint of %s, and a second lint changes nothing", (note, row) => {
        for (const placement of Placements) {
            const once = lint(note, placement);
            expect(once, placement).toBe(column(row, placement));
            expect(lint(once, placement), `${placement}, second lint`).toBe(once);
        }
    });
});

describe("Jason's rulings, stated directly", () => {
    it.each([
        // a reference goes after an abbreviation's own dot, even at a sentence's end
        ["in the U.S.|", "in the U.S.[^1]"],
        // a doubled period keeps both dots
        ["in the U.S..|", "in the U.S.[^1]."],
        ["in the U.S.|.", "in the U.S.[^1]."],
        // still in front of a sentence's stop
        ["A word.|", "A word[^1]."],
        ["open main.js.|", "open main.js[^1]."],
        ["这是句子。|", "这是句子[^1]。"],
    ])("press at %s gives %s", async (marked, expected) => {
        expect(await press(marked, "before")).toBe(expected);
    });

    // Under doubt the caret decides, in both directions.
    it.each([
        ["No.|", "No.[^1]"],
        ["No|.", "No[^1]."],
        ["N|o.", "No[^1]."],
        ["Fig.|", "Fig.[^1]"],
        ["Fig|.", "Fig[^1]."],
        ["plan B.|", "plan B.[^1]"],
        ["plan B|.", "plan B[^1]."],
        ["J.| Smith", "J.[^1] Smith"],
        ["J|. Smith", "J[^1]. Smith"],
        ["the foo.| bar", "the foo.[^1] bar"],
        ["the foo|. bar", "the foo[^1]. bar"],
    ])("doubt: press at %s gives %s", async (marked, expected) => {
        expect(await press(marked, "before")).toBe(expected);
    });

    // The lint leaves a reference in doubt where it finds it, on either side.
    it.each(["No.[^1]", "No[^1].", "Fig.[^1]", "Fig[^1].", "plan B.[^1]", "plan B[^1].", "J.[^1] Smith", "J[^1]. Smith", "the foo.[^1] bar", "the foo[^1]. bar"])("doubt: the lint leaves %s alone", (note) => {
        expect(lint(note)).toBe(note);
    });

    it("the lint keeps the Quebec French form etc.[^1]. as written (OQLF: the note follows the abbreviation's dot, and a final period follows the note)", () => {
        expect(lint("etc.[^1].")).toBe("etc.[^1].");
    });

    it("a number settles a word that is only sometimes an abbreviation, and a lone capital", () => {
        expect(lint("see No[^1]. 5")).toBe("see No.[^1] 5");
        expect(lint("see fig[^1]. 3")).toBe("see fig.[^1] 3");
        expect(lint("S[^1]. 5")).toBe("S.[^1] 5");
    });

    it("the list takes any case, and capitals alone do not make an abbreviation", () => {
        // "Etc." keeps its reference after the dot (Jason's brief, 2026-11-06).
        expect(lint("Etc.[^1]")).toBe("Etc.[^1]");
        expect(lint("Etc[^1].")).toBe("Etc.[^1]");
        expect(lint("DR.[^1]")).toBe("DR[^1].");
        expect(lint("Dr.[^1]")).toBe("Dr.[^1]");
    });

    it("the punctuation that follows counts only right after the dot", () => {
        expect(lint("the foo[^1]., and")).toBe("the foo.[^1], and");
        expect(lint("the foo[^1]. , and")).toBe("the foo[^1]. , and");
    });

    it("the plugin never adds or deletes punctuation", async () => {
        for (const rows of Object.values(PressRows)) {
            for (const row of rows) {
                const placed = await press(row[0], "before");
                expect(lint(placed).replace(/\[\^\d+\]/g, "")).toBe(row[0].replace("|", ""));
            }
        }
    });
});

describe("references and inline footnotes next to the dot do not change the answer", () => {
    it.each([
        ["U.S[^1][^2].", "U.S.[^1][^2]"],
        ["U.S.[^1][^2]", "U.S.[^1][^2]"],
        ["U.S[^1].[^2]", "U.S.[^1][^2]"],
        ["Dr[^1]. Smith[^2]", "Dr.[^1] Smith[^2]"],
        ["etc^[note].", "etc.^[note]"],
        ["etc.^[note]", "etc.^[note]"],
        ["word.^[note]", "word^[note]."],
        ["etc[^1]^[note].", "etc.[^1]^[note]"],
        ["No^[note].", "No^[note]."],
        ["No.^[note]", "No.^[note]"],
        // a shape that only looks like a reference is the text of the word: the dot here does not touch "U.S"
        ["U.S\\[^1].", "U.S\\[^1]."],
    ])("the lint gives %s as %s", (note, expected) => {
        expect(lint(note)).toBe(expected);
        expect(lint(expected)).toBe(expected);
    });

    it("the question itself gets one answer on either side of a footnote", () => {
        const ask = (text: string, dot: number, spans: { start: number; end: number }[]) => finalDotOwner(text, dot, lineFootnotes(spans));
        expect(ask("U.S[^1].", 7, [{ start: 3, end: 7 }])).toBe("word");
        expect(ask("U.S.[^1]", 3, [{ start: 4, end: 8 }])).toBe("word");
        expect(ask("word[^1].", 8, [{ start: 4, end: 8 }])).toBe("sentence");
        expect(ask("word.[^1] next", 4, [{ start: 5, end: 9 }])).toBe("doubt");
    });

    it("a second press keeps both references behind the dot, and the lint leaves them", async () => {
        const doc = fakeEditor(["in the U.S.[^2]", "", "[^2]: two"], { cursor: { line: 0, ch: 15 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin({ ...Settings, footnotePlacement: "before" }, doc));
        expect(doc.lines[0]).toBe("in the U.S.[^2][^3]");
        expect(withoutDefinitions(footnoteAfterPunctuation(doc.lines.join("\n"), "before"))).toBe("in the U.S.[^2][^3]");
    });

    it("the inline key follows the rule too", async () => {
        const place = async (marked: string) => {
            const { lines, cursor } = caretOf(marked);
            const doc = fakeEditor(lines, { cursor, edits: true, wholeDoc: true, words: true });
            await insertInlineFootnote(fakePlugin({ ...Settings, footnotePlacement: "before" }, doc));
            return doc.lines[0];
        };
        expect(await place("in the U.S.|")).toBe("in the U.S.^[]");
        expect(await place("in the U.S|.")).toBe("in the U.S.^[]");
        expect(await place("Dr.| Smith")).toBe("Dr.^[] Smith");
        expect(await place("A word.|")).toBe("A word^[].");
        expect(await place("No.|")).toBe("No.^[]");
    });
});

describe("a selection turned into a footnote", () => {
    /** Converts the text between the two "|" of `marked` with the numbered key: the note's lines afterwards. The space in front of a selection goes with it (Jason's attach ruling of 2026-09-08). */
    function convert(marked: string, footnotePlacement: FootnotePlacement, inline = false) {
        const anchor = marked.indexOf("|");
        const head = marked.indexOf("|", anchor + 1) - 1;
        const text = marked.replaceAll("|", "");
        const doc = fakeEditor([text], { selection: { anchor: { line: 0, ch: anchor }, head: { line: 0, ch: head } }, edits: true, wholeDoc: true, words: true });
        const plugin = fakePlugin({ ...Settings, footnotePlacement, expandSelectionToWholeWords: true }, doc);
        selectionPressHandled(plugin, doc, null, inline ? "inline" : "autonum");
        return doc.lines;
    }

    it.each([
        // the word's dot goes along with the word
        ["in the |U.S|.", ["in the[^1]", "", "[^1]: U.S."]],
        ["in the |U|.S.", ["in the[^1]", "", "[^1]: U.S."]],
        ["see |Dr| Smith", ["see[^1] Smith", "", "[^1]: Dr"]],
        ["see |Dr|. Smith", ["see[^1] Smith", "", "[^1]: Dr."]],
        ["apples, |etc|.", ["apples,[^1]", "", "[^1]: etc."]],
        ["the |U.S|., and", ["the[^1], and", "", "[^1]: U.S."]],
        // the doubled period's second dot stays with the sentence
        ["in the |U.S|..", ["in the[^1].", "", "[^1]: U.S."]],
        // a sentence's stop stays out, as it did
        ["|A word|.", ["[^1].", "", "[^1]: A word"]],
        ["open |main.js|.", ["open[^1].", "", "[^1]: main.js"]],
        ["|这是句子|。", ["[^1]。", "", "[^1]: 这是句子"]],
        // a dot in doubt stays out unless the selection takes it
        ["|No|.", ["[^1].", "", "[^1]: No"]],
        ["|No.|", ["[^1]", "", "[^1]: No."]],
        ["plan |B|.", ["plan[^1].", "", "[^1]: B"]],
        ["plan |B.|", ["plan[^1]", "", "[^1]: B."]],
    ])("under Before, %s", (marked, expected) => {
        expect(convert(marked, "before")).toEqual(expected);
    });

    it("the inline key takes the same stretch", () => {
        expect(convert("in the |U.S|.", "before", true)).toEqual(["in the^[U.S.]"]);
        expect(convert("|A word|.", "before", true)).toEqual(["^[A word]."]);
    });

    // CHARACTERIZATION: After takes one trailing mark, and Don't move takes none, as they did on master.
    it.each([
        ["in the |U.S|.", "after", ["in the[^1]", "", "[^1]: U.S."]],
        ["|A word|.", "after", ["[^1]", "", "[^1]: A word."]],
        ["in the |U.S|.", "none", ["in the[^1].", "", "[^1]: U.S"]],
        ["see |Dr|. Smith", "none", ["see[^1]. Smith", "", "[^1]: Dr"]],
        ["|A word|.", "none", ["[^1].", "", "[^1]: A word"]],
    ] as const)("controls: %s under %s", (marked, placement, expected) => {
        expect(convert(marked, placement)).toEqual(expected);
    });

    /** Converts the text between the two "|" of `marked` in a table cell's own editor: the edit the cell receives, which takes in the space in front of the selection. */
    function convertInCell(marked: string, footnotePlacement: FootnotePlacement) {
        const anchor = marked.indexOf("|");
        const head = marked.indexOf("|", anchor + 1) - 1;
        const text = marked.replaceAll("|", "");
        const dispatched: unknown[] = [];
        const cell: TableCellEditor = {
            state: { doc: { toString: () => text }, selection: { main: { head, anchor } } },
            dispatch: (spec) => {
                dispatched.push(spec);
            },
        };
        const doc = fakeEditor([`| ${text} |`, "| --- |", "| x |"], { cursor: { line: 0, ch: 2 }, edits: true, wholeDoc: true, words: true });
        selectionPressHandled(fakePlugin({ ...Settings, footnotePlacement, expandSelectionToWholeWords: true }, doc), doc, cell, "inline");
        return (dispatched[0] as { changes: { from: number; to: number; insert: string } }).changes;
    }

    it("in a table cell, the same stretch", () => {
        expect(convertInCell("in the |U.S|.", "before")).toEqual({ from: 6, to: 11, insert: "^[U.S.]" });
        expect(convertInCell("see |Dr|. Smith", "before")).toEqual({ from: 3, to: 7, insert: "^[Dr.]" });
        expect(convertInCell("|A word|.", "before")).toEqual({ from: 0, to: 6, insert: "^[A word]" });
        expect(convertInCell("|No|.", "before")).toEqual({ from: 0, to: 2, insert: "^[No]" });
        expect(convertInCell("in the |U.S|.", "none")).toEqual({ from: 6, to: 10, insert: "^[U.S]" });
    });

    it("in a table cell, a reference beside the dot does not change the stretch", () => {
        expect(convertInCell("in the |U.S|.[^1]", "before")).toEqual({ from: 6, to: 11, insert: "^[U.S.]" });
    });

    it("in the main editor, a reference beside the dot does not change the stretch", () => {
        expect(convert("|Dr|.[^2] Smith", "before", true)).toEqual(["^[Dr.][^2] Smith"]);
    });

    it("what a selection leaves, the lint leaves", () => {
        for (const marked of ["in the |U.S|.", "see |Dr|. Smith", "in the |U.S|..", "|A word|.", "|No|.", "plan |B.|"]) {
            const written = convert(marked, "before").join("\n");
            expect(footnoteAfterPunctuation(written, "before")).toBe(written);
        }
    });
});

describe("the question itself", () => {
    it.each([
        // the word's own shape
        ["U.S.", "word"],
        ["e.g.", "word"],
        ["Ph.D.", "word"],
        ["z. B.", "word"],
        ["z.\u00a0B.", "word"],
        ["l'U.E.", "word"],
        ["美国U.S.", "word"],
        // shapes that are not an abbreviation's
        ["main.js.", "sentence"],
        ["fs.js.", "sentence"],
        ["gov.uk.", "sentence"],
        ["ASP.NET.", "sentence"],
        ["3.14.", "sentence"],
        ["v2.0.", "sentence"],
        // the list, a phrase, and the words around them
        ["Dr.", "word"],
        ["et al.", "word"],
        ["Smith et\u00a0al.", "word"],
        ["al.", "sentence"],
        ["wet al.", "sentence"],
        ["op. cit.", "word"],
        // doubt
        ["No.", "doubt"],
        ["fig.", "doubt"],
        ["plan B.", "doubt"],
        ["Yes.", "sentence"],
        ["这是句子.", "sentence"],
    ] as const)("%s", (text, owner) => {
        expect(finalDotOwner(text, text.length - 1)).toBe(owner);
    });

    it("follows the text after the dot", () => {
        expect(finalDotOwner("foo. bar", 3)).toBe("doubt");
        expect(finalDotOwner("foo. Bar", 3)).toBe("sentence");
        expect(finalDotOwner("foo.bar", 3)).toBe("sentence");
        expect(finalDotOwner("foo.,", 3)).toBe("word");
        expect(finalDotOwner("foo.!", 3)).toBe("word");
        // that "!" may open an image, so it says nothing about the dot
        expect(finalDotOwner("foo.![x](y)", 3)).toBe("sentence");
        // exactly three dots are an ellipsis; four are a dot and an ellipsis
        expect(finalDotOwner("U.S...", 3)).toBe("sentence");
        expect(finalDotOwner("U.S....", 3)).toBe("word");
        // the second dot of a run is always the sentence's
        expect(finalDotOwner("U.S..", 4)).toBe("sentence");
    });

    it("stays fast on a long line", () => {
        const line = `${"a".repeat(200000)}.`;
        const started = performance.now();
        expect(finalDotOwner(line, line.length - 1)).toBe("sentence");
        expect(performance.now() - started).toBeLessThan(100);
    });

    it("reads a long line once, however many references on it ask", () => {
        const unit = "aa[^1]. bb ";
        const line = unit.repeat(20000);
        const footnotes = lineFootnotes(Array.from({ length: 20000 }, (_, i) => ({ start: i * unit.length + 2, end: i * unit.length + 6 })));
        const started = performance.now();
        for (let i = 0; i < 20000; i++) expect(finalDotOwner(line, i * unit.length + 6, footnotes)).toBe("doubt");
        expect(performance.now() - started).toBeLessThan(2000);
    });
});

// Lines made by combining the parts below, so the checks reach many more shapes
// than the tables above can state one by one.
const GeneratedFronts = ["", "- ", "> ", "see ", "(", "5 ", "i went there. then ", "z. "];
const GeneratedWords = [
    "U.S", "e.g", "Ph.D", "z.B", "EE.UU", "main.js", "3.14", "5th", "2026",
    "Dr", "dr", "Mrs", "St", "bzw", "pp", "vs", "km", "pdf", "md", "г", "др",
    "etc", "Etc", "ETC", "et al", "al", "wet al", "ibid", "ed", "Inc", "prof", "usw", "EE. UU",
    "No", "no", "Fig", "fig", "Art", "J", "plan B", "x", "S",
    "Hmm", "Mhm", "esp", "foo", "word", "thing", "Yes", "USA", "can't", "km/h",
    "这是句子", "美国U.S", "있다", "λόγος",
];
const GeneratedTails = ["", " Then we left.", " then we left.", " 12", ", and", "? And", "..", " e.g. this", " second thing. third"];
const GeneratedLines = GeneratedFronts.flatMap((front) => GeneratedWords.flatMap((word) => GeneratedTails.map((tail) => ({ front, word, tail, line: `${front}${word}.${tail}` }))));

/** Selects the word in `front + word + "." + tail` and turns it into a footnote with the numbered key. */
function convertWord({ front, word, tail }: (typeof GeneratedLines)[number], footnotePlacement: FootnotePlacement): string {
    const doc = fakeEditor([`${front}${word}.${tail}`], {
        selection: { anchor: { line: 0, ch: front.length }, head: { line: 0, ch: front.length + word.length } },
        edits: true,
        wholeDoc: true,
        words: true,
    });
    selectionPressHandled(fakePlugin({ ...Settings, footnotePlacement, expandSelectionToWholeWords: true }, doc), doc, null, "autonum");
    return doc.lines.join("\n");
}

describe("what the hillclimb's rule adds", () => {
    it.each([
        // no list: the shape says it, in any language
        ["Dr.|", "Dr.[^1]"],
        ["dr.|", "dr.[^1]"],
        ["bzw.| das", "bzw.[^1] das"],
        ["г.|", "г.[^1]"],
        ["Dr|.", "Dr.[^1]"],
        ["bzw|. das", "bzw.[^1] das"],
        ["г|.", "г.[^1]"],
        // a short word before a number
        ["pp.| 12", "pp.[^1] 12"],
        ["pp|. 12", "pp.[^1] 12"],
        ["Art.| 5", "Art.[^1] 5"],
        // a lower-case word with no vowel may be a unit or a file type
        ["open the pdf.|", "open the pdf[^1]."],
        ["open the pdf|.", "open the pdf[^1]."],
        ["5 km.|", "5 km[^1]."],
        ["5 km.| Then it fell.", "5 km[^1]. Then it fell."],
        ["bzw.| 5 km. Then", "bzw.[^1] 5 km. Then"],
        // "Hmm" and "Mhm" have no vowel, and they are still words of a sentence
        ["Hmm.|", "Hmm[^1]."],
        ["Mhm.| Then", "Mhm[^1]. Then"],
        // the list takes any case
        ["Etc.|", "Etc.[^1]"],
        ["Etc|.", "Etc.[^1]"],
        // a line that shows lower-case sentence starts
        ["first thing.| second thing.", "first thing[^1]. second thing."],
        ["first thing. second thing.|", "first thing. second thing[^1]."],
        ["i went there. then home.| next", "i went there. then home[^1]. next"],
        // the same short word, with no such evidence on the line
        ["then home.| next", "then home.[^1] next"],
        // a short word before a short dotted word
        ["Kon.| Ned. Bank", "Kon.[^1] Ned. Bank"],
        // straight after "("
        ["(see.| More", "(see.[^1] More"],
    ])("press at %s gives %s, and the lint leaves it", async (marked, expected) => {
        const placed = await press(marked, "before");
        expect(placed).toBe(expected);
        expect(lint(placed)).toBe(placed);
    });

    // CHARACTERIZATION, for Jason's review: each of these answers is wrong on
    // purpose, or at least untested. They are what the rule gives, pinned so a
    // change shows, not what a careful writer would want.
    it.each([
        // "bzw." with nothing after it reads as a file type, like "pdf." The next
        // lint moves the reference once text follows, as the hillclimb's notes say.
        ["bzw.", "sentence"],
        // the hillclimb's notes list these as still wrong
        ["in md.", "word"],
        ["the pdf. Then", "word"],
        ["3 m.", "word"],
        ["Shh.", "word"],
        ["Brr.", "word"],
        ["viz.", "sentence"],
        ["Smith, J.", "doubt"],
        // a real word with no vowel, which the rule cannot tell from an abbreviation
        ["trg. Zatim", "word"],
    ] as const)("wrong on purpose: %s answers %s", (text, owner) => {
        expect(finalDotOwner(text, text.indexOf("."))).toBe(owner);
    });

    // Only a word wholly in Latin or Cyrillic script can count as having no
    // vowel, and accents are set aside first. These all ended a sentence, and
    // the vowel test took each for an abbreviation.
    it.each([
        ["să. Apoi"],
        ["tűz. Aztán"],
        ["Він. Потім"],
        ["λόγος. Μετά"],
        ["kız. Sonra"],
        ["bērns. Tad"],
        ["để. Rồi"],
        ["sø. Så"],
        ["cœur. Puis"],
    ])("the sentence's stop: %s", (text) => {
        expect(finalDotOwner(text, text.indexOf("."))).toBe("sentence");
    });

    it.each([
        ["să.| Apoi", "să[^1]. Apoi"],
        ["Він.| Потім", "Він[^1]. Потім"],
        ["λόγος.| Μετά", "λόγος[^1]. Μετά"],
        ["để.| Rồi", "để[^1]. Rồi"],
    ])("press at %s gives %s, and the lint leaves it", async (marked, expected) => {
        const placed = await press(marked, "before");
        expect(placed).toBe(expected);
        expect(lint(placed)).toBe(placed);
    });

    it.each([
        ["Dr. Smith"],
        ["bzw. das"],
        ["г. Москва"],
        ["trg. Zatim"],
    ])("still the word's: %s", (text) => {
        expect(finalDotOwner(text, text.indexOf("."))).toBe("word");
    });

    it("only the whole phrase et al counts", () => {
        expect(finalDotOwner("et al.", 5)).toBe("word");
        expect(finalDotOwner("(et al.", 6)).toBe("word");
        expect(finalDotOwner("al.", 2)).toBe("sentence");
        expect(finalDotOwner("wet al.", 6)).toBe("sentence");
    });

    it("a selection follows the same rule", () => {
        const convert = (front: string, word: string, tail: string) => convertWord({ front, word, tail, line: `${front}${word}.${tail}` }, "before");
        expect(convert("", "bzw", " das")).toBe("[^1] das\n\n[^1]: bzw.");
        expect(convert("", "Etc", "")).toBe("[^1]\n\n[^1]: Etc.");
        expect(convert("open the ", "pdf", "")).toBe("open the[^1].\n\n[^1]: pdf");
        expect(convert("", "Hmm", "")).toBe("[^1].\n\n[^1]: Hmm");
    });

    describe("a table row and its cell read the same stretch", () => {
        /** Asks about the dot written as "•" in `marked`. */
        const owner = (marked: string) => finalDotOwner(marked.replace("•", "."), marked.indexOf("•"));

        // Each pair is what a row holds and what the cell's own editor holds.
        it.each([
            // the other cell's lower-case sentence starts say nothing about this one
            ["first thing. second thing. | go home• next", "go home• next", "doubt"],
            ["go home• next | first thing. second thing.", "go home• next", "doubt"],
            // the next cell is not the next word
            ["open the pdf• | next", "open the pdf•", "sentence"],
            ["see foo• | next", "see foo•", "sentence"],
            ["see | No•", "No•", "doubt"],
            // an escaped "|" ends the stretch too, and the editor may hold it without the backslash
            ["open the pdf• \\| next", "open the pdf• | next", "sentence"],
            ["open the pdf• \\| next", "open the pdf• \\| next", "sentence"],
            // a line break in a cell is "<br>" in the row
            ["go home•<br>next", "go home•\nnext", "sentence"],
            ["open the pdf•<br>Next", "open the pdf•\nNext", "sentence"],
        ] as const)("%s and %s", (row, cell, expected) => {
            expect(owner(row)).toBe(expected);
            expect(owner(cell)).toBe(expected);
        });

        it("a footnote holding a \"|\" does not end the stretch", () => {
            const text = "first thing^[a|b]. go home. next";
            const start = text.indexOf("^[");
            const end = text.indexOf("]") + 1;
            expect(finalDotOwner(text, text.indexOf("home") + 4, lineFootnotes([{ start, end }]))).toBe("sentence");
        });

        it("a press in a cell by a line break, and the lint of its row, agree", () => {
            const placed = cellPress("go home.|\nnext", "before");
            expect(placed).toBe("go home[^1].\nnext");
            const row = `| ${placed.replace("\n", "<br>")} |`;
            expect(lint(`${row}\n| --- |`).split("\n")[0]).toBe(row);
        });
    });

    it("spaces after the dot cannot hide the next word", () => {
        const spaces = " ".repeat(40);
        expect(finalDotOwner(`foo.${spaces}bar`, 3)).toBe("doubt");
        expect(finalDotOwner(`open the pdf.${spaces}`, 12)).toBe("sentence");
        expect(finalDotOwner(`open the pdf.${spaces}Next`, 12)).toBe("word");
    });
});

describe("generated lines", () => {
    // CHARACTERIZATION, for Jason's review: this pins After and Don't move as
    // they behave, not as anyone chose them. The digest below is a fingerprint of
    // every result, recorded on master at 59b2743, just before the rule from the
    // hillclimb of 2026-11-06 went in. A change under either setting changes it,
    // and the failure says which setting moved but not which line.
    it.each([
        ["after", "eb22abf7321d03acea6d4e2a6dfd77d5df57291621a38621f8716846ca1ac2ff"],
        ["none", "16e87d121f688710f469550aad7ae0447832d4e95b9224949f92c42f7f6500ae"],
    ] as const)("under %s, presses, lints, and selections stay as recorded from master", async (placement, digest) => {
        const results = createHash("sha256");
        let count = 0;
        const record = (result: string) => {
            results.update(`${result}\0`);
            count++;
        };
        for (const generated of GeneratedLines) {
            const { line, front, word } = generated;
            const dot = front.length + word.length;
            record(await press(`${line.slice(0, dot)}|${line.slice(dot)}`, placement));
            record(await press(`${line.slice(0, dot + 1)}|${line.slice(dot + 1)}`, placement));
            record(lint(`${line.slice(0, dot)}[^1]${line.slice(dot)}`, placement));
            record(lint(`${line.slice(0, dot + 1)}[^1]${line.slice(dot + 1)}`, placement));
            record(cellPress(`${line.slice(0, dot)}|${line.slice(dot)}`, placement));
            record(cellPress(`${line.slice(0, dot + 1)}|${line.slice(dot + 1)}`, placement));
            record(convertWord(generated, placement));
            resetNotices();
        }
        expect(count).toBe(7 * GeneratedLines.length);
        expect(results.digest("hex")).toBe(digest);
    }, 120_000);

    it("a reference on either side of the dot does not change the answer", () => {
        for (const { line, front, word } of GeneratedLines) {
            const dot = front.length + word.length;
            const plain = finalDotOwner(line, dot);
            const left = `${line.slice(0, dot)}[^1]${line.slice(dot)}`;
            const right = `${line.slice(0, dot + 1)}[^1]${line.slice(dot + 1)}`;
            expect(finalDotOwner(left, dot + 4, lineFootnotes([{ start: dot, end: dot + 4 }])), left).toBe(plain);
            expect(finalDotOwner(right, dot, lineFootnotes([{ start: dot + 1, end: dot + 5 }])), right).toBe(plain);
        }
    });

    it("a lint run twice changes nothing, with the reference on either side of the dot", () => {
        for (const { line, front, word } of GeneratedLines) {
            const dot = front.length + word.length;
            for (const written of [`${line.slice(0, dot)}[^1]${line.slice(dot)}`, `${line.slice(0, dot + 1)}[^1]${line.slice(dot + 1)}`]) {
                const once = lint(written);
                expect(lint(once), written).toBe(once);
            }
        }
    }, 120_000);

    it("the lint leaves what a press placed, with the caret on either side of the dot", async () => {
        for (const { line, front, word } of GeneratedLines) {
            const dot = front.length + word.length;
            for (const caret of [dot, dot + 1]) {
                const placed = await press(`${line.slice(0, caret)}|${line.slice(caret)}`, "before");
                expect(lint(placed), `${line} at ${caret}`).toBe(placed);
            }
            resetNotices();
        }
    }, 120_000);

    it("the lint leaves what a selection placed, and a second lint changes nothing", () => {
        for (const generated of GeneratedLines) {
            const written = convertWord(generated, "before");
            const once = footnoteAfterPunctuation(written, "before");
            expect(footnoteAfterPunctuation(once, "before"), generated.line).toBe(once);
            // CHARACTERIZATION, for Jason's review: a selection takes its word
            // out of the line, so another word now stands in front of the dot,
            // and that word can answer differently. "see main.js. 12" becomes
            // "see[^1]. 12", and the lint moves it to "see.[^1] 12", since "see."
            // is now a short word before a number. Punctuation does not change.
            if ((generated.front === "see " || generated.front === "i went there. then ") && generated.tail === " 12") continue;
            expect(once, generated.line).toBe(written);
            resetNotices();
        }
    }, 120_000);

    it("the lint of a table row leaves what a press in its cell placed, whatever the row's other cell holds", () => {
        for (const { line, front, word } of GeneratedLines) {
            if (front === "- " || front === "> ") continue;
            const dot = front.length + word.length;
            for (const caret of [dot, dot + 1]) {
                const placed = cellPress(`${line.slice(0, caret)}|${line.slice(caret)}`, "before");
                for (const row of [`| ${placed} |`, `| first thing. second thing. | ${placed} |`, `| ${placed} | first thing. second thing. |`]) {
                    expect(lint(`${row}\n| --- | --- |`).split("\n")[0], `${line} at ${caret}`).toBe(row);
                }
            }
        }
    }, 120_000);
});
