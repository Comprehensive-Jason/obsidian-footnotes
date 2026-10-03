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
