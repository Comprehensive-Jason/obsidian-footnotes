// The Node half of the Reading-view adjudicator (inapp-render.js is the
// in-app half): what text to render, how to read the rendering back in the
// note's own line numbers, and how to rule on a disagreement.
//
// Reading view renders a definition only when something references it, and
// renders a reference only when its name has a definition (an undefined
// "[^x]" shows as plain "x"). So the scratch note is the note with two
// additions: a paragraph at the top referencing every name in the note,
// followed by a blank line (after the frontmatter, when there is some), and
// a definition at the end for every name the note itself does not define.
// The top paragraph shifts the note down two lines; the readings below undo
// that shift.

import { hiddenReferences, visibleWords } from "./claims.mjs";
import { trimmedEnd } from "./compare.mts";

const fold = (name) => name.toLowerCase();

// an inline footnote "^[text]" renders in the same list, under a made-up name
const isInline = (name) => name === null || /^\[inline\d+\]?$/.test(name);

/** Every reference-shaped name in the note, first spelling of each, the way inapp-parse.js collects them. */
function namesIn(note) {
    const names = [];
    const seen = new Set();
    // as in inapp-parse.js: the usual names, then names holding a "[", never whitespace
    for (const m of [...note.matchAll(/\[\^([^[\]\s]+)\]/g), ...note.matchAll(/\[\^([^\]\s]*\[[^\]\s]*)\]/g)]) {
        if (seen.has(fold(m[1]))) continue;
        seen.add(fold(m[1]));
        names.push(m[1]);
    }
    return names;
}

/**
 * The scratch note's text for `note`, and where the note's own lines land
 * in it. `definedFolded` holds the names the metadata cache already found
 * definitions for; the rest get an appended definition.
 */
export function renderText(note, definedFolded) {
    const names = namesIn(note);
    // a byte order mark stays the scratch note's first character, where
    // Obsidian skips it; the top paragraph goes in after it
    const bom = note.startsWith("\uFEFF") ? "\uFEFF" : "";
    const lines = note.slice(bom.length).split("\n");
    // The frontmatter has to stay on the first line. It opens with a line
    // that is exactly "---" and closes at the first later line that starts
    // with "---" (rule D2, the overnight oracle run of 2026-10-03), and the
    // top paragraph goes in after that line. When the closing line holds
    // more than the dashes, the rest is ordinary Markdown that the next line
    // may continue, so nothing can go in between: the paragraph goes at the
    // end of the note instead, behind a blank line.
    const noteLines = lines.length - (note.endsWith("\n") ? 1 : 0);
    let insertAt = 0;
    let atEnd = false;
    if (/^---\r?$/.test(lines[0])) {
        const close = lines.findIndex((l, i) => i > 0 && l.startsWith("---"));
        if (close > 0) {
            atEnd = lines[close].slice(3).trim() !== "";
            insertAt = atEnd ? noteLines : close + 1;
        }
    }
    const top = names.length > 0 ? [...(atEnd ? [""] : []), names.map((n) => `[^${n}]`).join(" "), ""] : [];
    const body = bom + [...lines.slice(0, insertAt), ...top, ...lines.slice(insertAt)].join("\n");
    const undefinedNames = names.filter((n) => !definedFolded.has(fold(n)));
    const base = body.endsWith("\n") ? body : `${body}\n`;
    const text = undefinedNames.length > 0 ? `${base}\n${undefinedNames.map((n) => `[^${n}]: oracle appendix\n\n`).join("")}` : body;
    const noteLineCount = lines.length - (note.endsWith("\n") ? 1 : 0);
    return { text, insertAt, shift: top.length, noteLineCount, undefinedNames, topLines: top.length };
}

/**
 * The rendering read back in the note's own line numbers: definitions
 * {name, line, text}, references in the note's sections {name, start, end},
 * references inside a rendered definition {name, defLine}. Lines of the
 * added top paragraph and the appendix are dropped. `unknownNames` lists
 * the undefined names whose appended definition did not render (an unclosed
 * block swallowed the appendix), so their references cannot be judged.
 */
export function readRendering(layout, result) {
    const toNote = (line) => (line < layout.insertAt ? line : line - layout.shift);
    const inTop = (line) => line >= layout.insertAt && line < layout.insertAt + layout.topLines;
    const inNote = (line) => !inTop(line) && toNote(line) < layout.noteLineCount;
    const defs = result.defs.filter((d) => !isInline(d.name) && inNote(d.line)).map((d) => ({ ...d, line: toNote(d.line) }));
    const appended = new Set(result.defs.filter((d) => !inTop(d.line) && toNote(d.line) >= layout.noteLineCount && d.name).map((d) => fold(d.name)));
    const unknownNames = layout.undefinedNames.map(fold).filter((n) => !appended.has(n));
    const refs = [];
    const defRefs = [];
    for (const r of result.refs) {
        if (isInline(r.name)) continue;
        if (r.defLine !== undefined) {
            if (inNote(r.defLine)) defRefs.push({ name: r.name, defLine: toNote(r.defLine) });
        } else if (!inTop(r.start) && inNote(r.start)) {
            refs.push({ name: r.name, start: toNote(r.start), end: toNote(r.end) });
        }
    }
    const sections = (result.sections ?? []).filter(([start]) => !inTop(start) && inNote(start)).map(([start, end]) => [toNote(start), toNote(end)]);
    return { defs, refs, defRefs, sections, unknownNames };
}

/**
 * Which rendered container holds note line `line`: the definition (by the
 * metadata cache's extent) whose rendered item would hold a reference there,
 * else the Reading-view section. Returns a counter for references named
 * `name` in that container, applied to any list of {line, name}.
 */
function containerOf(line, metaDefs, rv) {
    const def = metaDefs.find((d) => d.line <= line && line <= d.end);
    if (def) {
        const shown = rv.defs.find((d) => d.line === def.line);
        if (!shown) return { shadowed: true, def };
        return { def, rvCount: (name) => rv.defRefs.filter((r) => r.defLine === def.line && fold(r.name) === fold(name)).length, has: (l) => def.line <= l && l <= def.end };
    }
    // the innermost (shortest) rendered section holding the line
    const section = rv.sections.filter(([s, e]) => s <= line && line <= e).sort((a, b) => a[1] - a[0] - (b[1] - b[0]))[0];
    const start = section ? section[0] : line;
    const end = section ? section[1] : line;
    return {
        rvCount: (name) => rv.refs.filter((r) => r.start === start && fold(r.name) === fold(name)).length,
        has: (l) => start <= l && l <= end && !metaDefs.some((d) => d.line <= l && l <= d.end),
    };
}

/**
 * Reading view's verdict on one disagreement: "obsidian" when Reading view
 * sides with the metadata cache, "plugin" when it sides with the plugin,
 * "no opinion" when it cannot tell, each with a reason.
 */
export function judge(dis, note, metaDefs, metaRefs, plugin, rv) {
    const noteLines = note.split("\n");
    if (dis.kind === "def-only-obsidian" || dis.kind === "def-only-plugin") {
        const shown = rv.defs.find((d) => d.line === dis.line);
        if (shown) return { verdict: dis.kind === "def-only-obsidian" ? "obsidian" : "plugin", reason: `Reading view renders a definition from line ${dis.line + 1}: "${shown.text.slice(0, 60)}"` };
        const later = rv.defs.find((d) => d.name && fold(d.name) === fold(dis.name) && d.line > dis.line);
        if (later) return { verdict: "no opinion", reason: `a later definition of [^${dis.name}] on line ${later.line + 1} is the one Reading view renders` };
        return { verdict: dis.kind === "def-only-obsidian" ? "plugin" : "obsidian", reason: `Reading view renders no definition from line ${dis.line + 1}` };
    }
    if (dis.kind === "def-end") {
        const shown = rv.defs.find((d) => d.line === dis.line);
        if (!shown) return { verdict: "no opinion", reason: "the definition does not render (shadowed by a later one)" };
        const meta = metaDefs.find((d) => d.line === dis.line);
        const mine = plugin.definitions.find((d) => d.line === dis.line);
        const mineEnd = trimmedEnd(note, mine.line, mine.end);
        const lo = Math.min(meta.end, mineEnd);
        const hi = Math.max(meta.end, mineEnd);
        const probe = [];
        const shownWords = visibleWords(noteLines);
        for (let l = lo + 1; l <= hi; l++) probe.push(...shownWords[l]);
        if (probe.length === 0) return { verdict: "no opinion", reason: `lines ${lo + 2}-${hi + 1} hold no words to look for in the rendered footnote` };
        const found = probe.filter((w) => shown.text.includes(w)).length;
        const longer = meta.end > mineEnd ? "obsidian" : "plugin";
        const shorter = longer === "obsidian" ? "plugin" : "obsidian";
        if (found === probe.length) return { verdict: longer, reason: `the rendered footnote holds the words of lines ${lo + 2}-${hi + 1}: "${shown.text.slice(0, 80)}"` };
        if (found === 0) return { verdict: shorter, reason: `the rendered footnote lacks the words of lines ${lo + 2}-${hi + 1}: "${shown.text.slice(0, 80)}"` };
        return { verdict: "no opinion", reason: `the rendered footnote holds some of lines ${lo + 2}-${hi + 1}: "${shown.text.slice(0, 80)}"` };
    }
    if (dis.kind === "ref-only-obsidian" || dis.kind === "ref-only-plugin") {
        if (rv.unknownNames.includes(fold(dis.name))) return { verdict: "no opinion", reason: "the appended definition did not render, so the reference cannot be judged" };
        const c = containerOf(dis.line, metaDefs, rv);
        if (c.shadowed) return { verdict: "no opinion", reason: `the reference sits in the definition on line ${c.def.line + 1}, which a later duplicate shadows` };
        const rvCount = c.rvCount(dis.name);
        const metaCount = metaRefs.filter((r) => c.has(r.line) && fold(r.name) === fold(dis.name)).length;
        const pluginCount = plugin.references.filter((r) => c.has(r.line) && fold(r.name) === fold(dis.name)).length;
        // references inside a "%%" comment render nothing but still count,
        // one back-arrow each on the footnote
        const hidden = hiddenReferences(rv, dis.name);
        if (hidden > 0 && rvCount !== metaCount && rvCount + hidden === metaCount && metaCount !== pluginCount) return { verdict: "obsidian", reason: `Reading view shows ${rvCount} reference(s) to [^${dis.name}] there and counts ${hidden} hidden one(s) by back-arrow; the metadata cache counts ${metaCount}, the plugin ${pluginCount}` };
        if (rvCount === metaCount && rvCount !== pluginCount) return { verdict: "obsidian", reason: `Reading view renders ${rvCount} reference(s) to [^${dis.name}] there; the metadata cache counts ${metaCount}, the plugin ${pluginCount}` };
        if (rvCount === pluginCount && rvCount !== metaCount) return { verdict: "plugin", reason: `Reading view renders ${rvCount} reference(s) to [^${dis.name}] there; the plugin counts ${pluginCount}, the metadata cache ${metaCount}` };
        return { verdict: "no opinion", reason: `Reading view renders ${rvCount} reference(s) to [^${dis.name}] there; the metadata cache counts ${metaCount}, the plugin ${pluginCount}` };
    }
    return { verdict: "no opinion", reason: "Reading view is not asked about protected lines" };
}

/**
 * Where the metadata cache and Reading view disagree on one note: the
 * definitions each renders (the last of each name, which is the one Reading
 * view shows), and per container the count of references to each name.
 */
export function metadataVsReadingView(metaDefs, metaRefs, rv, unknownMetaNames) {
    const out = [];
    const lastOf = new Map();
    for (const d of metaDefs) lastOf.set(fold(d.name), d);
    const metaShown = new Map([...lastOf].map(([n, d]) => [n, d.line]));
    const rvShown = new Map(rv.defs.filter((d) => d.name).map((d) => [fold(d.name), d.line]));
    for (const [n, line] of metaShown) {
        if (rvShown.get(n) !== line) out.push(`definition [^${n}]: metadata cache line ${line + 1}, Reading view ${rvShown.has(n) ? `line ${rvShown.get(n) + 1}` : "none"}`);
    }
    for (const [n, line] of rvShown) {
        if (!metaShown.has(n)) out.push(`definition [^${n}]: Reading view line ${line + 1}, metadata cache none`);
    }
    const shadowed = metaDefs.filter((d) => lastOf.get(fold(d.name)) !== d);
    const counted = metaRefs.filter((r) => !shadowed.some((d) => d.line <= r.line && r.line <= d.end));
    const tally = (list) => {
        const m = new Map();
        for (const r of list) m.set(fold(r.name), (m.get(fold(r.name)) ?? 0) + 1);
        return m;
    };
    const unknown = new Set([...unknownMetaNames, ...rv.unknownNames]);
    const metaTally = tally(counted);
    const rvTally = tally([...rv.refs, ...rv.defRefs]);
    // a reference inside a "%%" comment renders nothing, but its back-arrow counts it
    for (const d of rv.defs) {
        const hidden = d.name ? hiddenReferences(rv, d.name) : 0;
        if (hidden > 0) rvTally.set(fold(d.name), (rvTally.get(fold(d.name)) ?? 0) + hidden);
    }
    for (const n of new Set([...metaTally.keys(), ...rvTally.keys()])) {
        if (unknown.has(n)) continue;
        if ((metaTally.get(n) ?? 0) !== (rvTally.get(n) ?? 0)) out.push(`references to [^${n}]: metadata cache ${metaTally.get(n) ?? 0}, Reading view ${rvTally.get(n) ?? 0}`);
    }
    return out;
}
