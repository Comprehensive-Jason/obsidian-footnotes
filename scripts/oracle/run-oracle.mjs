// The oracle: Obsidian's own Markdown parser as the referee for the
// plugin's scanner. It needs the live app with the sandbox vault open; it is
// dev tooling, not part of the commit bar. TESTING.md describes the layer.
//
//   npm run oracle -- check <notes.json> [--render] [--out <results.json>]
//       Reads each note (a JSON array of strings, or of {id, text}) with
//       Obsidian's metadata parser and with the plugin's readers, and lists
//       where they disagree. --render also renders every note in Reading
//       view, rules on each disagreement, and compares Reading view with
//       the metadata cache.
//   npm run oracle -- fuzz [--seed <n>] [--count <n>] [--render] [--out <results.json>]
//       Generates container-heavy notes (generate.mjs), compares them,
//       shrinks each disagreement to a short reproducer by deleting lines,
//       clusters the reproducers by shape, and with --render adjudicates one
//       representative per cluster in Reading view.

import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { appFacts, runInApp } from "./obsidian-bridge.mjs";
import { judgeWithMetadata, judgeWithReadingView, pluginReading } from "./claims.mjs";
import { compareNote, isInlineId } from "./compare.mjs";
import { generateNotes } from "./generate.mjs";
import { judge, metadataVsReadingView, readRendering, renderText } from "./reading-view.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "..", "..");
const BATCH = 300;
const RENDER_BATCH = 5;

/** The plugin's readers, bundled for Node with the obsidian stub aliased in, as the unit tests run them. */
async function loadPluginFacts() {
    const outfile = join(tmpdir(), `footnote-oracle-plugin-facts-${process.pid}.mjs`);
    await build({
        entryPoints: [join(HERE, "plugin-facts.ts")],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile,
        alias: { obsidian: join(PLUGIN_DIR, "test", "mocks", "obsidian.ts") },
        logLevel: "error",
    });
    const mod = await import(pathToFileURL(outfile).href);
    rmSync(outfile, { force: true });
    return mod.pluginFacts;
}

/** Obsidian's parse of every note, in batches small enough for one job file each. */
async function parseAll(notes) {
    const results = [];
    for (let i = 0; i < notes.length; i += BATCH) {
        const r = await runInApp("inapp-parse.js", { notes: notes.slice(i, i + BATCH) });
        results.push(...r.results);
    }
    return results;
}

const fold = (name) => name.toLowerCase();

/** The metadata cache's definitions with their last lines, and its live references (appendix-resolved), for the Reading-view rulings. */
function metadataReading(note, entry, comparison) {
    const metaDefs = entry.first.footnotes.filter((f) => !isInlineId(f[0])).map((f) => ({ name: f[0], line: f[1], end: f[4] === 0 && f[3] > f[1] ? f[3] - 1 : f[3] }));
    return { metaDefs, metaRefs: comparison.obsidianRefs, unknown: comparison.unknown, sections: entry.first.sections };
}

async function renderAll(items) {
    // items: {note, entry, comparison}
    const layouts = items.map(({ note, entry }) => renderText(note, new Set(entry.first.footnotes.map((f) => fold(f[0])))));
    const out = [];
    // small batches with a generous wait: the app can stall for minutes
    // (seen 2026-10-03 with the window hidden, about four minutes a note
    // for a while), and a batch that outlives its wait is lost
    for (let i = 0; i < layouts.length; i += RENDER_BATCH) {
        const r = await runInApp("inapp-render.js", { notes: layouts.slice(i, i + RENDER_BATCH).map((l) => l.text) }, { timeoutMs: 1800000 });
        out.push(...r.results);
    }
    return items.map((item, k) => readRendering(layouts[k], out[k]));
}

/** Compares notes; returns per-note records. */
async function checkNotes(notes, pluginFacts) {
    const parsed = await parseAll(notes.map((n) => n.text));
    return notes.map((n, i) => {
        const plugin = pluginFacts(n.text);
        const comparison = compareNote(n.text, parsed[i], plugin);
        return { ...n, entry: parsed[i], plugin, comparison };
    });
}

async function adjudicate(records) {
    const rvs = await renderAll(records.map((r) => ({ note: r.text, entry: r.entry })));
    records.forEach((rec, k) => {
        const rv = rvs[k];
        const { metaDefs, metaRefs, unknown } = metadataReading(rec.text, rec.entry, rec.comparison);
        rec.rv = rv;
        rec.readingView = { defs: rv.defs.map((d) => ({ name: d.name, line: d.line, text: d.text.slice(0, 120) })), unknownNames: rv.unknownNames };
        rec.metadataVsReadingView = metadataVsReadingView(metaDefs, metaRefs, rv, unknown);
        rec.rulings = rec.comparison.disagreements.map((d) => ({ ...d, ...judge(d, rec.text, metaDefs, metaRefs, rec.plugin, rv) }));
    });
}

/** Deletes lines one at a time while the note still shows a disagreement of the same kind, for all records at once (one parse batch per round). */
async function shrinkAll(items, pluginFacts) {
    let active = items.filter((it) => it.text.split("\n").length > 1);
    for (let round = 0; round < 40 && active.length > 0; round++) {
        const candidates = [];
        for (const it of active) {
            const lines = it.text.split("\n");
            const trailing = it.text.endsWith("\n");
            const count = lines.length - (trailing ? 1 : 0);
            it.candidates = [];
            for (let j = 0; j < count; j++) {
                const kept = lines.filter((_, k) => k !== j);
                const text = kept.join("\n");
                if (text.trim() === "") continue;
                it.candidates.push(candidates.length);
                candidates.push(text);
            }
        }
        const parsed = await parseAll(candidates);
        const next = [];
        for (const it of active) {
            const hit = it.candidates.find((c) => {
                const result = compareNote(candidates[c], parsed[c], pluginFacts(candidates[c]));
                return result.disagreements.some((d) => d.kind === it.kind);
            });
            if (hit !== undefined) {
                it.text = candidates[hit];
                next.push(it);
            }
        }
        active = next;
    }
    return items;
}

/**
 * A coarse shape of one line: its container prefix (">" quote marker, "b"
 * bullet, "o" ordered marker, "S" one to three spaces, "I" four or more,
 * "T" a tab) and what kind of content follows.
 */
function lineShape(line) {
    let i = 0;
    let prefix = "";
    for (;;) {
        const rest = line.slice(i);
        let m;
        if ((m = rest.match(/^ +/))) prefix += m[0].length >= 4 ? "I" : "S";
        else if ((m = rest.match(/^\t/))) prefix += "T";
        else if ((m = rest.match(/^>/))) prefix += ">";
        else if ((m = rest.match(/^[-+*](?=[ \t]|$)/))) prefix += "b";
        else if ((m = rest.match(/^\d{1,9}[.)](?=[ \t]|$)/))) prefix += "o";
        else break;
        i += m[0].length;
    }
    const rest = line.slice(i);
    let kind;
    if (rest === "") kind = "BLANK";
    else if (/^\[\^[^\]]+\]:/.test(rest)) kind = /\[\^[^\]]+\][^:]/.test(rest.replace(/^\[\^[^\]]+\]:/, "")) ? "LABEL+ref" : "LABEL";
    else if (/^(`{3,}|~{3,})/.test(rest)) kind = "FENCE";
    else if (/^\$\$/.test(rest)) kind = "MATH";
    else if (/^%%/.test(rest)) kind = "PCT";
    else if (/^#{1,6}( |$)/.test(rest)) kind = "HEAD";
    else if (/^(=+|-+) *$/.test(rest)) kind = "UNDER";
    else if (/^([*_-] *){3,}$/.test(rest)) kind = "RULE";
    else if (/^\|/.test(rest)) kind = "TABLE";
    else if (/^\[!/.test(rest)) kind = "CALLOUT";
    else if (/^</.test(rest)) kind = "HTML";
    else {
        const marks = [];
        if (/`[^`]*\[\^/.test(rest)) marks.push("code");
        if (/\$[^$]*\[\^/.test(rest)) marks.push("math");
        if (/%%/.test(rest)) marks.push("pct");
        if (/<!--/.test(rest)) marks.push("htmlc");
        if (/\^\[/.test(rest)) marks.push("inline");
        if (/\\\[\^/.test(rest)) marks.push("esc");
        if (/\[\^/.test(rest)) marks.push("ref");
        kind = `TEXT${marks.length ? `(${marks.join(",")})` : ""}`;
    }
    return prefix + kind;
}

/**
 * A coarse shape of a reproducer, so notes that differ only in wording or
 * names cluster together. The line the disagreement is about keeps what
 * its text holds (a code span, math, a comment around a reference); the
 * other lines keep only their container prefix and block kind.
 */
function shapeOf(text, focusLine) {
    return text
        .replace(/\n$/, "")
        .split("\n")
        .map((line, i) => {
            const shape = lineShape(line);
            return i === focusLine ? `*${shape}` : shape.replace(/TEXT\(.*\)$/, "TEXT").replace("LABEL+ref", "LABEL");
        })
        .join(" / ");
}

function argValue(args, flag, fallback) {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const facts = appFacts();
    console.log(`Obsidian ${facts.version}, vault ${facts.vault}, isMobile ${facts.isMobile}`);
    const pluginFacts = await loadPluginFacts();
    const outPath = argValue(args, "--out", null);
    const render = args.includes("--render");
    let report;
    if (command === "check") {
        const raw = JSON.parse(readFileSync(args[0], "utf8"));
        const notes = raw.map((n, i) => (typeof n === "string" ? { id: String(i), text: n } : n));
        const records = await checkNotes(notes, pluginFacts);
        if (render) await adjudicate(records);
        for (const r of records) {
            if (!r.claims) continue;
            const meta = metadataReading(r.text, r.entry, r.comparison);
            r.claimResults = r.claims.map((c) => ({
                ...c,
                plugin: pluginReading(c, r.plugin, r.text),
                metadata: judgeWithMetadata(c, r.text, meta),
                ...(r.rv ? { readingView: judgeWithReadingView(c, r.text, meta, r.rv) } : {}),
            }));
        }
        for (const r of records) {
            const lines = r.rulings ?? r.comparison.disagreements;
            console.log(`${r.id}: ${lines.length === 0 ? "agree" : `${lines.length} disagreement(s)`}${r.comparison.unknown.length ? ` (liveness unknown for ${r.comparison.unknown.join(", ")})` : ""}`);
            for (const d of lines) console.log(`  ${d.kind}: ${d.detail}${d.verdict ? ` -> Reading view: ${d.verdict} (${d.reason})` : ""}`);
            for (const m of r.metadataVsReadingView ?? []) console.log(`  metadata vs Reading view: ${m}`);
            for (const c of r.claimResults ?? []) {
                const what = c.type === "definition" ? `line ${c.line + 1} ${c.is ? "is" : "is not"} a definition of [^${c.name}]` : c.type === "definitionEnd" ? `[^${c.name}] on line ${c.line + 1} ends on line ${c.end + 1}` : c.type === "reference" ? `[^${c.name}] on line ${c.line + 1} is ${c.live ? "live" : "dead"}` : `line ${c.line + 1} is ${c.is ? "" : "not "}protected`;
                console.log(`  claim: ${what}; plugin: ${c.plugin}; metadata cache ${c.metadata.verdict} (${c.metadata.reason})${c.readingView ? `; Reading view ${c.readingView.verdict} (${c.readingView.reason})` : ""}`);
            }
        }
        report = { app: facts, command, records: records.map(({ entry, rv, ...rest }) => ({ ...rest, obsidian: entry.first })) };
    } else if (command === "fuzz") {
        const seed = Number(argValue(args, "--seed", "20261003"));
        const count = Number(argValue(args, "--count", "2000"));
        const notes = generateNotes(seed, count).map((text, i) => ({ id: `${seed}-${i}`, text }));
        const records = await checkNotes(notes, pluginFacts);
        const disagreeing = records.filter((r) => r.comparison.disagreements.length > 0);
        const unknownCount = records.filter((r) => r.comparison.unknown.length > 0).length;
        console.log(`${count} notes, ${disagreeing.length} with disagreements, ${unknownCount} with some reference liveness unknown`);
        // one shrink job per (note, kind)
        const items = [];
        for (const r of disagreeing) {
            for (const kind of new Set(r.comparison.disagreements.map((d) => d.kind))) items.push({ id: r.id, kind, original: r.text, text: r.text });
        }
        await shrinkAll(items, pluginFacts);
        // the line each reproducer's disagreement is about
        const final = await parseAll(items.map((it) => it.text));
        items.forEach((it, i) => {
            const d = compareNote(it.text, final[i], pluginFacts(it.text)).disagreements.find((x) => x.kind === it.kind);
            it.focus = d ? d.line : -1;
        });
        const clusters = new Map();
        for (const it of items) {
            const shape = shapeOf(it.text, it.focus);
            const key = `${it.kind}\n${shape}`;
            if (!clusters.has(key)) clusters.set(key, { kind: it.kind, shape, count: 0, reproducer: it.text, from: it.id, members: [] });
            const c = clusters.get(key);
            c.count++;
            if (c.members.length < 5) c.members.push(it.id);
            // the shortest reproducer represents the cluster
            if (it.text.length < c.reproducer.length) {
                c.reproducer = it.text;
                c.from = it.id;
            }
        }
        const list = [...clusters.values()].sort((a, b) => b.count - a.count);
        if (render) {
            const reps = await checkNotes(list.map((c, i) => ({ id: `cluster-${i}`, text: c.reproducer })), pluginFacts);
            await adjudicate(reps);
            list.forEach((c, i) => {
                c.detail = reps[i].comparison.disagreements.filter((d) => d.kind === c.kind).map((d) => d.detail);
                c.rulings = (reps[i].rulings ?? []).filter((d) => d.kind === c.kind).map((d) => ({ verdict: d.verdict, reason: d.reason, detail: d.detail }));
                c.metadataVsReadingView = reps[i].metadataVsReadingView;
            });
        } else {
            for (const c of list) c.detail = compareNote(c.reproducer, (await parseAll([c.reproducer]))[0], pluginFacts(c.reproducer)).disagreements.filter((d) => d.kind === c.kind).map((d) => d.detail);
        }
        for (const c of list) {
            console.log(`\n[${c.count}] ${c.kind}: ${JSON.stringify(c.reproducer)}`);
            for (const d of c.detail ?? []) console.log(`  ${d}`);
            for (const r of c.rulings ?? []) console.log(`  -> Reading view: ${r.verdict} (${r.reason})`);
        }
        report = {
            app: facts,
            command,
            seed,
            count,
            disagreeingNotes: disagreeing.length,
            unknownLivenessNotes: unknownCount,
            kinds: Object.fromEntries([...new Set(items.map((i) => i.kind))].map((k) => [k, items.filter((i) => i.kind === k).length])),
            clusters: list,
        };
    } else {
        throw new Error("usage: run-oracle.mjs check <notes.json> [--render] [--out f] | fuzz [--seed n] [--count n] [--render] [--out f]");
    }
    if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1), "utf8");
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
