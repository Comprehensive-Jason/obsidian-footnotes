// A seeded generator of small, container-heavy notes for the oracle: the
// shapes where the plugin's scanner has to model Obsidian's block reading
// by hand. Each note is 5 to 15 lines built from blocks (prose with
// references, definition labels with continuation lines, fences, math,
// comments, HTML, headings, rules, tables) placed inside containers
// (blockquotes, callouts, bullet and ordered lists, nested, with spaces or
// tabs). The same seed always gives the same notes, so a run can be
// repeated and a disagreement reproduced.

/** A small fast seeded random source (mulberry32); returns floats in [0, 1). */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Names in several alphabets and case variants; "Note" and "note" are the
// same footnote, as are "Ä" and "ä".
const NAMES = ["1", "2", "3", "a", "b", "Note", "note", "ä", "Ä", "Ω", "名", "x-y", "ch2*"];

function generator(seed) {
    const r = rng(seed);
    const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const chance = (p) => r() < p;
    const name = () => pick(NAMES);
    const ref = () => `[^${name()}]`;

    // inline text, sometimes holding references in protected or odd spots
    const inline = () => {
        const parts = [pick(["Text", "Some words", "Prose here", "More", "It"])];
        const n = int(0, 2);
        for (let i = 0; i < n; i++) {
            parts.push(
                pick([
                    ref(),
                    ref(),
                    ref(),
                    `\`${ref()}\``,
                    `$${ref()}$`,
                    `%% ${ref()} %%`,
                    `<!-- ${ref()} -->`,
                    `\\${ref()}`,
                    `^[inline ${ref()}]`,
                    "words",
                    "end.",
                ]),
            );
        }
        return parts.join(chance(0.5) ? " " : "");
    };
    const label = () => `[^${name()}]: ${pick(["def", "body text", "Definition", inline()])}`;
    const indent = () => pick(["", "", " ", "  ", "   ", "    ", "\t", "  \t"]);
    const continuationIndent = () => pick(["    ", "    ", "  ", "\t", "", "     "]);
    const fenceChar = () => pick(["```", "```", "~~~", "````"]);

    // a block is a list of lines without container prefixes
    const blocks = {
        prose: () => [inline(), ...(chance(0.3) ? [inline()] : [])],
        label: () => {
            const out = [indent().slice(0, chance(0.7) ? 0 : 3) + label()];
            const n = int(0, 2);
            for (let i = 0; i < n; i++) {
                if (chance(0.3)) out.push("");
                out.push(continuationIndent() + pick([inline(), "continued", "$$", "```", "%%", "- item", "> quoted", "# heading"]));
            }
            return out;
        },
        labelAfterProse: () => [inline(), label()],
        fence: () => {
            const f = fenceChar();
            const ind = pick(["", "", "  ", "    "]);
            const body = [inline(), ...(chance(0.4) ? [""] : []), label()];
            return chance(0.2) ? [ind + f, ...body] : [ind + f, ...body, ind + f];
        },
        math: () => (chance(0.2) ? ["$$", inline(), label()] : ["$$", inline(), ...(chance(0.3) ? [""] : []), "$$"]),
        percent: () => (chance(0.2) ? ["%%", label()] : ["%%", inline(), ...(chance(0.3) ? [""] : []), label(), "%%"]),
        percentInline: () => [`${inline()} %% hidden ${ref()} %% ${ref()}`],
        html: () => pick([["<div>", inline(), "</div>"], ["<!--", label(), "-->"], [`<span>${ref()}</span>`], ["<!--", inline()]]),
        setext: () => [inline(), pick(["===", "---", "-", "=="])],
        heading: () => [`${pick(["#", "##", "###"])} ${inline()}`],
        rule: () => [pick(["***", "---", "___", "- - -"])],
        table: () => [`| ${inline()} | b |`, "| --- | --- |", `| ${ref()} | c |`],
        indentedCode: () => [`    ${inline()}`, `    ${label()}`],
        blank: () => [""],
    };
    const blockKinds = Object.keys(blocks);
    const weights = { prose: 4, label: 6, labelAfterProse: 2, fence: 2, math: 1, percent: 1, percentInline: 1, html: 1, setext: 1, heading: 1, rule: 1, table: 1, indentedCode: 1, blank: 2 };
    const weighted = blockKinds.flatMap((k) => Array(weights[k]).fill(k));

    // containers wrap a block's lines
    const quote = (lines) => {
        const depth = chance(0.75) ? 1 : 2;
        const marker = pick(["> ", ">", ">\t", "> "]);
        const prefix = marker.repeat(depth);
        return lines.map((l, i) => (i > 0 && chance(0.15) ? l : l === "" ? prefix.trimEnd() : prefix + l));
    };
    const callout = (lines) => [`> [!${pick(["note", "tip", "info"])}]${chance(0.3) ? " Title" : ""}`, ...lines.map((l) => (l === "" ? ">" : `> ${l}`))];
    const listItem = (lines, nested) => {
        const marker = pick(["-", "*", "+", "1.", "2)", "10."]);
        const gap = pick([" ", " ", "  ", "\t", "    ", "     "]);
        const lead = nested ? pick(["  ", "   ", "    ", "\t"]) : "";
        const contentCol = lead + " ".repeat(marker.length + (gap === "\t" ? 1 : gap.length));
        return lines.map((l, i) => {
            if (i === 0) return lead + marker + gap + l;
            if (l === "") return "";
            // continuation lines: aligned, lazy (unindented), or tab-indented
            return pick([contentCol, contentCol, "", "\t", lead + "  "]) + l;
        });
    };
    const wrap = (lines) => {
        const roll = r();
        if (roll < 0.35) return lines;
        if (roll < 0.55) return quote(lines);
        if (roll < 0.65) return callout(lines);
        if (roll < 0.85) return listItem(lines, false);
        // a nested list item under a parent item
        return [`${pick(["-", "*", "1."])} parent ${inline()}`, ...(chance(0.3) ? [""] : []), ...listItem(lines, true)];
    };

    return () => {
        const target = int(5, 15);
        const out = [];
        while (out.length < target) {
            out.push(...wrap(blocks[pick(weighted)]()));
            const gap = pick([0, 1, 1, 1, 2]);
            for (let i = 0; i < gap; i++) out.push("");
        }
        // keep at least one reference to a defined name more often than not
        if (chance(0.5)) out.unshift(`Opening ${ref()} and ${ref()}`, "");
        return out.slice(0, 15).join("\n") + (chance(0.8) ? "\n" : "");
    };
}

/** `count` notes from `seed`, deterministic. */
export function generateNotes(seed, count) {
    const next = generator(seed);
    const notes = [];
    for (let i = 0; i < count; i++) notes.push(next());
    return notes;
}

// The broad generator (Jason, 2026-10-03: the overnight 20,000-note run).
// It keeps the container-heavy shapes above and adds what real notes hold:
// prose with hard-wrapped lines and references after punctuation,
// definitions at the bottom under a heading, frontmatter (valid and near
// misses), nested callouts and callouts in lists, wikilinks and embeds next
// to references, tables of every pipe style, inline footnotes (nested,
// spanning lines, holding brackets), "%%" in every container, math, HTML,
// ATX and setext headings, definitions longer than 1,024 characters
// (remark-footnotes stops looking for what ends a definition after its
// first 1,024 characters), and text and names in other scripts (Chinese,
// Japanese, Korean, Arabic, Persian with its joiners, Devanagari, emoji).
// Notes are 5 to 30 lines.

// Invisible characters are built from their code points so the source stays readable.
const ZWNJ = String.fromCodePoint(0x200c); // zero-width non-joiner, used inside Persian words
const ZWJ = String.fromCodePoint(0x200d); // zero-width joiner, used inside emoji sequences
const VS16 = String.fromCodePoint(0xfe0f); // asks for the emoji form of the character before it

const SCRIPTS = {
    latin: {
        words: ["lorem", "ipsum", "dolor", "sit", "amet", "velit", "magna", "aliqua", "nostrud", "tempor", "culpa", "officia", "anim", "est", "laborum", "ex", "commodo"],
        stops: [".", ".", ".", "!", "?", ";", ":", ","],
        space: " ",
    },
    cjk: {
        words: ["这是", "一个", "测试", "句子", "脚注", "日本語", "の", "テキスト", "です", "한국어", "문장", "입니다", "中文"],
        stops: ["。", "，", "！", "？", "、", "：", "」"],
        space: "",
    },
    arabic: {
        words: ["هذا", "نص", "تجريبي", "مع", "حاشية", "في", "الكتاب", "ملاحظة"],
        stops: ["،", "؟", ".", "؛"],
        space: " ",
    },
    persian: {
        words: ["این", "یک", "متن", `می${ZWNJ}خواهم`, `کتاب${ZWNJ}ها`, "آزمایشی", `نوشته${ZWNJ}ای`, "است"],
        stops: ["،", "؟", ".", "؛"],
        space: " ",
    },
    devanagari: {
        words: ["यह", "एक", "परीक्षण", "वाक्य", "है", "टिप्पणी", "हिंदी", "पाठ"],
        stops: ["।", "॥", ",", "?"],
        space: " ",
    },
    emoji: {
        words: ["🎉", `👩${ZWJ}💻`, "🇺🇸", "✅", `❤${VS16}`, "party", "done", `👨${ZWJ}👩${ZWJ}👧`, "🙂"],
        stops: ["!", ".", "?"],
        space: " ",
    },
};
const SCRIPT_NAMES = Object.keys(SCRIPTS);

// Footnote names: plain numbers most often, as real notes have, then words,
// case variants, regex-special characters, and names in other scripts.
const BROAD_NAMES = [
    "1", "1", "2", "2", "3", "4", "5", "12", "a", "b", "Note", "note", "ä", "Ä", "Ω", "x-y", "ch2*", "a$", "2~", "3=", "4_",
    "名", "注1", "脚注", "ملاحظة", "یادداشت", `نیم${ZWNJ}فاصله`, "टिप्पणी", "🎉", `👩${ZWJ}💻`, "#tag", "1.5", "src:2",
];

function broadGenerator(seed) {
    const r = rng(seed);
    const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const chance = (p) => r() < p;
    let script = SCRIPTS.latin;
    const name = () => pick(BROAD_NAMES);
    const ref = () => `[^${name()}]`;
    const words = (lo, hi) => {
        const n = int(lo, hi);
        const out = [];
        for (let i = 0; i < n; i++) out.push(pick(script.words));
        return out.join(script.space);
    };

    // Something next to a reference: the things that change how a "[^x]" reads.
    const decorated = () =>
        pick([
            ref(),
            ref(),
            ref(),
            `${ref()}${ref()}`,
            `[[Some note]]${ref()}`,
            `[[Some note|alias]] ${ref()}`,
            `[[Note|alias ${ref()}]]`,
            `[[Note#Heading]]${ref()}`,
            `![[image.png]]${ref()}`,
            `![[image.png|${ref()}]]`,
            `[[unclosed ${ref()}`,
            `[link](https://example.com)${ref()}`,
            `[link ${ref()}](https://example.com)`,
            `[text][${ref()}]`,
            `<https://example.com>${ref()}`,
            `\`code ${ref()}\``,
            `$x^2 ${ref()}$`,
            `$$ m ${ref()} $$`,
            `%% hidden ${ref()} %%`,
            `%% open ${ref()}`,
            `<!-- c ${ref()} -->`,
            `<span>${ref()}</span>`,
            `==mark ${ref()}==`,
            `~~gone ${ref()}~~`,
            `*em ${ref()}*`,
            `**bold**${ref()}`,
            `#tag${ref()}`,
            `^[inline ${ref()}]`,
            `^[outer ^[inner ${ref()}] more]`,
            `^[with [brackets] ${ref()}]`,
            `^[unbalanced [ ${ref()}]`,
            `^[unclosed ${ref()}`,
            `^[]${ref()}`,
            `\\${ref()}`,
            `\\^[x ${ref()}]`,
            `${ref()} ^blockid`,
            `[^${name()} ${name()}]`,
            `[^]`,
        ]);

    // One sentence, with a reference before or after its closing punctuation now and then.
    const sentence = () => {
        let s = words(2, 9);
        if (chance(0.25)) s += script.space + decorated() + script.space + words(1, 4);
        const stop = pick(script.stops);
        const roll = r();
        if (roll < 0.25) return `${s}${stop}${ref()}`;
        if (roll < 0.45) return `${s}${ref()}${stop}`;
        return s + stop;
    };
    // A hard-wrapped paragraph: one to four lines.
    const paragraph = () => {
        const n = int(1, 4);
        const lines = [];
        for (let i = 0; i < n; i++) lines.push(sentence() + (chance(0.3) ? script.space + sentence() : ""));
        return lines;
    };
    // An inline footnote that spans two lines of one paragraph.
    const spanningInline = () => [`${words(2, 5)} ^[starts here`, `${pick(["and ends", `holds ${ref()}`, "[a] b"])}] ${words(1, 3)}${ref()}`];
    // A definition body; sometimes a long one, around the 1,024-character mark.
    const body = () => (chance(0.15) ? sentence() + script.space + decorated() : sentence());
    const longText = (target) => {
        let s = "";
        while (s.length < target) s += (s ? " " : "") + pick(SCRIPTS.latin.words);
        return s.slice(0, target);
    };
    const labelLine = () => `[^${name()}]:${pick([" ", " ", " ", "", "  ", "\t"])}${body()}`;
    const continuation = () => pick(["    ", "    ", "\t", "  ", "", "     ", "        "]) + pick([sentence(), sentence(), `${ref()} more`, "- item", "> quoted", "```", "$$", "%%", "# heading"]);
    // what may come right after a definition: the blocks that would end it, and some that would not
    const interrupter = () =>
        pick(["# Heading", "## Footnotes", "```", "~~~", "$$", "- item", "1. item", "2. item", "> quote", "> [!note]", "***", "---", "<div>", "<!-- c -->", "| a | b |", "[^9]: next", "%%", "    indented", "lazy text", ""]);

    const blocks = {
        paragraph,
        spanningInline,
        label: () => {
            const out = [labelLine()];
            for (let i = int(0, 2); i > 0; i--) {
                if (chance(0.25)) out.push("");
                out.push(continuation());
            }
            return out;
        },
        longLabel: () => {
            // the label line alone, or a shorter label line with continuation lines, around 1,024 characters
            const head = `[^${name()}]: `;
            const target = int(980, 1100);
            const out = chance(0.6) ? [head + longText(target - head.length)] : [head + longText(500), `    ${longText(target - head.length - 505)}`];
            if (chance(0.25)) out.push(""); // a blank line, which ends a definition at any length
            out.push(interrupter());
            if (chance(0.5)) out.push(`after ${ref()}`);
            return out;
        },
        footnoteSection: () => {
            const out = [pick(["## Footnotes", "# Notes", "---", "***", "Footnotes", "### References"])];
            if (chance(0.5)) out.push("");
            for (let i = int(1, 5); i > 0; i--) {
                out.push(labelLine());
                if (chance(0.2)) out.push(continuation());
            }
            return out;
        },
        fence: () => {
            const f = pick(["```", "```", "~~~", "````", "```js", "~~~ md"]);
            const lines = [f, words(1, 4), labelLine()];
            // the closer is the opener's fence characters without the info string; one in five stays open
            return chance(0.2) ? lines : [...lines, f.replace(/[^`~]+$/, "")];
        },
        indentedCode: () => [`    ${words(1, 4)} ${ref()}`, `    ${labelLine()}`],
        math: () => pick([["$$", `x ${ref()}`, "$$"], ["$$", labelLine()], [`$$ a ${ref()} $$`], [`text $$ a`, `b ${ref()} $$ end`], [`$$ open ${ref()}`, labelLine()]]),
        percent: () => pick([["%%", `${words(1, 3)} ${ref()}`, labelLine(), "%%"], ["%%", labelLine()], [`%% ${words(1, 3)} %%`, labelLine()], ["%%%", labelLine(), "%%%"], [`${words(1, 3)} %%`, labelLine(), "%%"]]),
        html: () => pick([["<div>", sentence(), "</div>"], ["<details>", "<summary>More</summary>", "", labelLine(), "", "</details>"], ["<!--", labelLine(), "-->"], [`<span>${ref()}</span> ${words(1, 3)}`], ["<br>", labelLine()], ["<!--", sentence()]]),
        heading: () => [`${pick(["#", "##", "###", "####", "######", "#######", "#"])}${pick([" ", " ", ""])}${words(1, 4)}${chance(0.4) ? ref() : ""}`],
        setext: () => [sentence(), pick(["===", "---", "-", "==", "  ===", "    ---"])],
        rule: () => [pick(["***", "---", "___", "- - -", "* * *"])],
        table: () => {
            const style = pick(["both", "both", "lead", "trail", "none"]);
            const row = (cells) => (style === "both" ? `| ${cells.join(" | ")} |` : style === "lead" ? `| ${cells.join(" | ")}` : style === "trail" ? `${cells.join(" | ")} |` : cells.join(" | "));
            const delimiter = chance(0.15) ? (style === "none" ? "| --- | --- |" : "--- | ---") : row([pick(["---", ":---", "---:", ":-:"]), "---"]);
            const out = [row([words(1, 2), "b"]), delimiter];
            for (let i = int(1, 3); i > 0; i--) out.push(pick([row([ref(), "c"]), row([`a \\| b ${ref()}`, "d"]), `${labelLine()} | x`, row(["e", "f"]), `| ${ref()}`, labelLine()]));
            return out;
        },
        linkDefinition: () => [`[${pick(["foo", "1", "^x"])}]: ${pick(["https://example.com", "/url", `/u${ref()}`])}`],
        task: () => [`- [${pick([" ", "x"])}] ${sentence()}`, `- [ ] ${labelLine()}`],
        blank: () => [""],
    };
    const weights = { paragraph: 8, spanningInline: 1, label: 5, longLabel: 1, footnoteSection: 1, fence: 2, indentedCode: 1, math: 1, percent: 2, html: 1, heading: 2, setext: 1, rule: 1, table: 2, linkDefinition: 1, task: 1, blank: 2 };
    const weighted = Object.keys(blocks).flatMap((k) => Array(weights[k]).fill(k));

    // containers, nested now and then
    const quote = (lines) => {
        const prefix = pick(["> ", ">", ">\t", "> > ", ">> "]);
        return lines.map((l, i) => (i > 0 && chance(0.12) ? l : l === "" ? prefix.trimEnd() : prefix + l));
    };
    const calloutHead = () => `[!${pick(["note", "tip", "info", "warning", "NOTE", "my note", "note|meta"])}]${pick(["", "", "+", "-"])}${pick(["", "", " Title", ` Title ${ref()}`, "\tTabbed title", `\t${ref()}`, ` ${labelLine()}`])}`;
    const callout = (lines) => {
        const out = [`> ${calloutHead()}`, ...lines.map((l) => (l === "" ? ">" : `> ${l}`))];
        // a callout nested in this one
        if (chance(0.25)) out.push(`> > ${calloutHead()}`, `> > ${pick([sentence(), labelLine(), "%%", `- ${labelLine()}`])}`);
        return out;
    };
    const listItem = (lines, lead = "") => {
        const marker = pick(["-", "*", "+", "1.", "2)", "10.", "- [ ]"]);
        const gap = pick([" ", " ", " ", "  ", "\t", "    "]);
        const contentCol = lead + " ".repeat(marker.length + (gap === "\t" ? 1 : gap.length));
        return lines.map((l, i) => (i === 0 ? lead + marker + gap + l : l === "" ? "" : pick([contentCol, contentCol, "", "\t", `${lead}  `]) + l));
    };
    const wrap = (lines) => {
        const roll = r();
        if (roll < 0.45) return lines;
        if (roll < 0.58) return quote(lines);
        if (roll < 0.7) return callout(lines);
        if (roll < 0.82) return listItem(lines);
        if (roll < 0.88) return [`- ${sentence()}`, ...listItem(lines, pick(["  ", "    ", "\t"]))];
        // a callout inside a list item, or a list inside a callout
        if (chance(0.5)) return listItem(callout(lines));
        return callout(listItem(lines));
    };

    const frontmatter = () =>
        pick([
            ["---", "title: A note", `aliases: [one, two]`, "---"],
            ["---", `title: see${ref()} here`, "tags:", "  - test", "---"],
            ["---", `${labelLine()}`, "---"],
            ["---", "---"],
            ["--- ", "title: near miss", "---"],
            ["----", "title: near miss", "----"],
            ["---", "title: unclosed", `${ref()}`],
            ["---", "title: dots", "..."],
            ["", "---", "title: second line", "---"],
        ]);

    return () => {
        script = chance(0.6) ? SCRIPTS.latin : SCRIPTS[pick(SCRIPT_NAMES)];
        const target = int(5, 30);
        const out = [];
        const realistic = chance(0.45);
        const withFrontmatter = chance(realistic ? 0.35 : 0.12);
        if (withFrontmatter) out.push(...frontmatter());
        if (realistic) {
            // a note as people write it: a heading, paragraphs, definitions at the bottom
            if (chance(0.6)) out.push(`# ${words(1, 4)}`, "");
            while (out.length < target - 4) {
                // now and then the note switches script for a block
                if (chance(0.08)) script = SCRIPTS[pick(SCRIPT_NAMES)];
                const kind = chance(0.7) ? "paragraph" : pick(weighted);
                out.push(...(chance(0.2) ? wrap(blocks[kind]()) : blocks[kind]()));
                out.push("");
            }
            out.push(...blocks.footnoteSection());
        } else {
            while (out.length < target) {
                if (chance(0.08)) script = SCRIPTS[pick(SCRIPT_NAMES)];
                out.push(...wrap(blocks[pick(weighted)]()));
                const gap = pick([0, 1, 1, 1, 2]);
                for (let i = 0; i < gap; i++) out.push("");
            }
            if (!withFrontmatter && chance(0.5)) out.unshift(`Opening ${ref()} and ${ref()}`, "");
        }
        return out.slice(0, 30).join("\n") + (chance(0.8) ? "\n" : "");
    };
}

/** `count` notes from `seed` by the broad generator, deterministic. */
export function generateBroadNotes(seed, count) {
    const next = broadGenerator(seed);
    const notes = [];
    for (let i = 0; i < count; i++) notes.push(next());
    return notes;
}
