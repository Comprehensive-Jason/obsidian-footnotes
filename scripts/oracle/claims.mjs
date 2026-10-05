// Checks recorded claims about how Obsidian reads a note (a pin's premise,
// a fact a commit message recorded) against the metadata cache, Reading
// view, and the plugin. A fixture in a `check` notes file may carry
// "claims", each one of (lines 0-based):
//   {"type":"definition","name":"a","line":2,"is":true}
//   {"type":"definitionEnd","name":"a","line":2,"end":5}
//   {"type":"reference","name":"a","line":0,"live":true}     (optional "column")
//   {"type":"protected","line":3,"is":true}                  (inside code or math)
// Each judge answers "agrees", "disagrees", or "no opinion", with a reason.

import { trimmedEnd } from "./compare.mts";

const fold = (name) => name.toLowerCase();

// top-level section types that are ordinary markdown, and the ones that
// protect their lines; containers (lists, quotes, definitions) hide what
// is nested in them, so the metadata cache has no opinion there
// (a paragraph or table is not here: an inline code span or "$" math inside
// one can span lines, and the metadata cache does not break those down)
const PLAIN_SECTIONS = new Set(["heading", "thematicBreak"]);
const PROTECTING_SECTIONS = new Set(["code", "math", "yaml"]);

const verdict = (holds, reason) => ({ verdict: holds ? "agrees" : "disagrees", reason });
const noOpinion = (reason) => ({ verdict: "no opinion", reason });

/**
 * Per line of the note, the words Reading view would show from it, for
 * looking up in a rendered footnote's text: words of three or more letters,
 * or failing those the shorter ones. Container markers, labels, HTML tags,
 * inline footnotes, and comment text ("%%" and "<!-- -->", followed across lines) are left
 * out, since none of them shows in the rendering.
 */
export function visibleWords(noteLines) {
    let open = null;
    return noteLines.map((line) => {
        let shown = "";
        let rest = line;
        while (rest.length > 0) {
            if (open) {
                const close = rest.indexOf(open);
                if (close === -1) break;
                rest = rest.slice(close + open.length);
                open = null;
                continue;
            }
            const m = rest.match(/%%|<!--/);
            if (!m) {
                shown += rest;
                break;
            }
            shown += rest.slice(0, m.index);
            open = m[0] === "%%" ? "%%" : "-->";
            rest = rest.slice(m.index + m[0].length);
        }
        const t = shown
            .replace(/^[\s>]*(?:[-+*]|\d{1,9}[.)])?\s*/, "")
            .replace(/<\/?[A-Za-z][^>]*>/g, " ")
            // an inline footnote renders as a numbered superscript, its text elsewhere
            .replace(/\^\[[^\]]*\]/g, " ")
            .replace(/\[\^[^\]]*\]:?/g, " ");
        const long = t.match(/[\p{L}\p{N}]{3,}/gu);
        return long ?? t.match(/[\p{L}\p{N}]+/gu) ?? [];
    });
}

/** Only the words of three or more letters, the ones safe to take as evidence that a line's text IS in a rendered footnote. */
const longWords = (words) => words.filter((w) => w.length >= 3);

/**
 * How many references to `name` Reading view counts but does not show: the
 * rendered footnote carries one back-arrow per reference, a reference
 * inside a "%%" comment included, while the comment itself renders nothing.
 * The scratch note's top paragraph adds one reference of its own.
 */
export function hiddenReferences(rv, name) {
    const def = rv.defs.find((d) => d.name && fold(d.name) === fold(name));
    if (!def || def.backrefs === undefined) return 0;
    const visible = [...rv.refs, ...rv.defRefs].filter((r) => fold(r.name) === fold(name)).length;
    return def.backrefs - visible - 1;
}

function refsOnLine(list, claim) {
    return list.filter((r) => r.line === claim.line && fold(r.name) === fold(claim.name) && (claim.column === undefined || r.column === claim.column));
}

export function judgeWithMetadata(claim, note, meta) {
    const { metaDefs, metaRefs, unknown, sections } = meta;
    if (claim.type === "definition") {
        const has = metaDefs.some((d) => d.line === claim.line && fold(d.name) === fold(claim.name));
        return verdict(has === claim.is, has ? `the metadata cache reads a definition of [^${claim.name}] on line ${claim.line + 1}` : `the metadata cache reads no definition of [^${claim.name}] on line ${claim.line + 1}`);
    }
    if (claim.type === "definitionEnd") {
        const d = metaDefs.find((x) => x.line === claim.line && fold(x.name) === fold(claim.name));
        if (!d) return noOpinion(`the metadata cache reads no definition there`);
        return verdict(d.end === claim.end, `the metadata cache ends it on line ${d.end + 1}`);
    }
    if (claim.type === "reference") {
        if (unknown.includes(fold(claim.name))) return noOpinion("an unclosed block at the end of the note swallowed the probe definition");
        const live = refsOnLine(metaRefs, claim).length > 0;
        return verdict(live === claim.live, live ? "the metadata cache lists it as a reference" : "the metadata cache lists no such reference on that line");
    }
    if (claim.type === "protected") {
        const s = sections.find((x) => x[1] <= claim.line && claim.line <= x[2] && x[0] !== "text" && x[0] !== "element");
        if (!s) return noOpinion("the line is in no section (a blank line)");
        if (PROTECTING_SECTIONS.has(s[0])) return verdict(claim.is, `the line is in a top-level ${s[0]} section`);
        if (PLAIN_SECTIONS.has(s[0])) return verdict(!claim.is, `the line is in a top-level ${s[0]} section`);
        return noOpinion(`the line is inside a top-level ${s[0]} section, whose contents the metadata cache does not break down`);
    }
    return noOpinion(`unknown claim type ${claim.type}`);
}

export function judgeWithReadingView(claim, note, meta, rv) {
    const noteLines = note.split("\n");
    if (claim.type === "definition") {
        const shown = rv.defs.find((d) => d.line === claim.line && d.name && fold(d.name) === fold(claim.name));
        if (shown) return verdict(claim.is, `Reading view renders it: "${shown.text.slice(0, 60)}"`);
        const later = rv.defs.find((d) => d.name && fold(d.name) === fold(claim.name) && d.line > claim.line);
        if (later) return noOpinion(`Reading view renders the later definition of [^${claim.name}] on line ${later.line + 1} (only the last of a name renders)`);
        return verdict(!claim.is, "Reading view renders no definition from that line");
    }
    if (claim.type === "definitionEnd") {
        const shown = rv.defs.find((d) => d.line === claim.line && d.name && fold(d.name) === fold(claim.name));
        if (!shown) return noOpinion("the definition does not render");
        // every line of the claimed extent shows up in the rendered footnote,
        // and the next non-blank line does not
        const shownWords = visibleWords(noteLines);
        const inside = [];
        for (let l = claim.line + 1; l <= claim.end; l++) inside.push(...shownWords[l].map((w) => [l, w]));
        let next = claim.end + 1;
        while (next < noteLines.length && noteLines[next].trim() === "") next++;
        const nextWords = next < noteLines.length ? longWords(shownWords[next]) : [];
        const missing = inside.find(([, w]) => !shown.text.includes(w));
        if (missing) return verdict(false, `the rendered footnote lacks line ${missing[0] + 1}'s "${missing[1]}": "${shown.text.slice(0, 80)}"`);
        if (nextWords.length > 0 && nextWords.every((w) => shown.text.includes(w))) return verdict(false, `the rendered footnote holds line ${next + 1}'s words: "${shown.text.slice(0, 80)}"`);
        if (inside.length === 0 && nextWords.length === 0) return noOpinion("no words to look for");
        return verdict(true, `the rendered footnote: "${shown.text.slice(0, 80)}"`);
    }
    if (claim.type === "reference") {
        if (rv.unknownNames.includes(fold(claim.name))) return noOpinion("the probe definition did not render");
        const def = meta.metaDefs.find((d) => d.line <= claim.line && claim.line <= d.end);
        let rvCount;
        let inContainer;
        if (def) {
            if (!rv.defs.some((d) => d.line === def.line)) return noOpinion(`the reference sits in the definition on line ${def.line + 1}, which does not render`);
            rvCount = rv.defRefs.filter((r) => r.defLine === def.line && fold(r.name) === fold(claim.name)).length;
            inContainer = (l) => def.line <= l && l <= def.end;
        } else {
            const s = rv.sections.filter(([a, b]) => a <= claim.line && claim.line <= b)[0];
            const [a, b] = s ?? [claim.line, claim.line];
            rvCount = rv.refs.filter((r) => r.start === a && fold(r.name) === fold(claim.name)).length;
            inContainer = (l) => a <= l && l <= b && !meta.metaDefs.some((d) => d.line <= l && l <= d.end);
        }
        // the other live references to the name in the same container, as
        // the metadata cache counts them, and the raw occurrences on this line
        const others = meta.metaRefs.filter((r) => inContainer(r.line) && r.line !== claim.line && fold(r.name) === fold(claim.name)).length;
        const here = [...(noteLines[claim.line] ?? "").matchAll(/\[\^([^[\]\n]+)\]/g)].filter((m) => fold(m[1]) === fold(claim.name)).length;
        const hidden = hiddenReferences(rv, claim.name);
        if (rvCount === others && hidden > 0) {
            const metaLive = refsOnLine(meta.metaRefs, claim).length > 0;
            if (metaLive) return verdict(claim.live, `Reading view shows no reference to [^${claim.name}] there, but its footnote counts ${hidden} hidden reference(s) by back-arrow (a reference inside a "%%" comment), as the metadata cache reads this one`);
            return noOpinion(`Reading view shows none there and counts ${hidden} hidden reference(s) elsewhere`);
        }
        if (rvCount === others) return verdict(!claim.live, `Reading view renders ${rvCount} reference(s) to [^${claim.name}] there, none from this line`);
        if (rvCount === others + here) return verdict(claim.live, `Reading view renders ${rvCount} reference(s) to [^${claim.name}] there, including this line's`);
        return noOpinion(`Reading view renders ${rvCount} reference(s) to [^${claim.name}] there; ${others} expected elsewhere, ${here} on this line`);
    }
    return noOpinion("Reading view is not asked about protected lines");
}

export function pluginReading(claim, plugin, note) {
    if (claim.type === "definition") return plugin.definitions.some((d) => d.line === claim.line && fold(d.name) === fold(claim.name)) ? "definition" : "no definition";
    if (claim.type === "definitionEnd") {
        const d = plugin.definitions.find((x) => x.line === claim.line && fold(x.name) === fold(claim.name));
        if (!d) return "no definition";
        return d.end === null ? `${d.kind} definition, extent not modelled` : `ends on line ${trimmedEnd(note, d.line, d.end) + 1}`;
    }
    if (claim.type === "reference") return refsOnLine(plugin.references, claim).length > 0 ? "live" : "dead";
    if (claim.type === "protected") {
        const kind = plugin.lineKinds[claim.line];
        return kind === "" || kind === "percent-comment" ? "not protected" : `protected (${kind})`;
    }
    return "?";
}
