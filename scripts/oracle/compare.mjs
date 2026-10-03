// Turns one note's two readings (Obsidian's parse from inapp-parse.js, the
// plugin's from plugin-facts.ts) into a list of disagreements in plain
// terms. Lines are 0-based, as both sides report them.

// Section types that are not blocks of the note: Obsidian adds them for the
// rendered footnotes list at the end.
const IGNORED_SECTIONS = new Set(["text", "element"]);

const fold = (name) => name.toLowerCase();

// An inline footnote "^[text]" shows up in Obsidian's footnotes list with
// a made-up id such as "[inline0" (with no closing bracket, as Obsidian
// 1.14.4 writes it); it is not a definition the scanner reads.
export const isInlineId = (id) => /^\[inline\d+\]?$/.test(id);

/** The parse with inline footnotes left out of its definitions and references. */
function withoutInline(parse) {
    return { ...parse, footnotes: parse.footnotes.filter((f) => !isInlineId(f[0])), refs: parse.refs.filter((r) => !isInlineId(r[0])) };
}

/** The last line a position really covers: an end at column 0 of a later line stops on the line before. */
function lastLine(startLine, endLine, endCol) {
    return endCol === 0 && endLine > startLine ? endLine - 1 : endLine;
}

/**
 * The plugin's block end without trailing blank lines. Inside an unclosed
 * fence or comment the block runs to the note's last line, which is often
 * the empty line after the final newline, while Obsidian's extent stops at
 * the last line holding text.
 */
export function trimmedEnd(note, start, end) {
    const lines = note.split("\n");
    let e = end;
    while (e > start && (lines[e] ?? "").trim() === "") e--;
    return e;
}

function sectionsKey(parse, from, to, shift) {
    return JSON.stringify(
        parse.sections
            .filter((s) => !IGNORED_SECTIONS.has(s[0]) && s[1] >= from && s[1] < to)
            .map((s) => [s[0], s[1] - shift, s[2] - shift]),
    );
}

function footnotesKey(parse, from, to, shift) {
    return JSON.stringify(parse.footnotes.filter((f) => f[1] >= from && f[1] < to).map((f) => [fold(f[0]), f[1] - shift, f[2], f[3] - shift]));
}

/**
 * Obsidian's live references, the defined and the undefined alike, with a
 * flag saying whether the undefined names could be read at all. See
 * inapp-parse.js for the appendix and prefix parses.
 */
function obsidianReferences(note, raw) {
    const entry = {
        ...raw,
        first: withoutInline(raw.first),
        ...(raw.second ? { second: withoutInline(raw.second) } : {}),
        ...(raw.third ? { third: withoutInline(raw.third) } : {}),
    };
    const lineCount = note.split("\n").length - (note.endsWith("\n") ? 1 : 0);
    const first = entry.first;
    const refs = first.refs.map((r) => ({ name: r[0], line: r[1], column: r[2] }));
    if (!entry.appendix) return { refs, unknownNames: [] };
    const wanted = entry.appendix.names.map(fold);
    const firstKey = sectionsKey(first, 0, lineCount, 0) + footnotesKey(first, 0, lineCount, 0);
    // the appendix reading counts when the note above it parsed the same and
    // every appended definition was read as a definition
    const second = entry.second;
    const appendedOk =
        wanted.every((n) => second.footnotes.some((f) => fold(f[0]) === n && f[1] >= entry.appendix.firstLine)) &&
        sectionsKey(second, 0, lineCount, 0) + footnotesKey(second, 0, lineCount, 0) === firstKey;
    if (appendedOk) {
        return {
            refs: second.refs.filter((r) => r[1] < lineCount).map((r) => ({ name: r[0], line: r[1], column: r[2] })),
            unknownNames: [],
            via: "appendix",
        };
    }
    if (entry.third) {
        const shift = entry.prefix.shift;
        const third = entry.third;
        const prefixOk =
            wanted.every((n) => third.footnotes.some((f) => fold(f[0]) === n && f[1] < shift)) &&
            sectionsKey(third, shift, shift + lineCount, shift) + footnotesKey(third, shift, shift + lineCount, shift) === firstKey;
        if (prefixOk) {
            return {
                refs: third.refs.filter((r) => r[1] >= shift).map((r) => ({ name: r[0], line: r[1] - shift, column: r[2] })),
                unknownNames: [],
                via: "prefix",
            };
        }
    }
    return { refs, unknownNames: wanted };
}

/**
 * The disagreements between the two readings of `note`. Each is
 * { kind, name, line, detail }, kinds:
 *   def-only-obsidian   Obsidian reads a definition here, the plugin does not
 *   def-only-plugin     the plugin reads a definition here, Obsidian does not
 *   def-end             both read the definition, its last line differs
 *   ref-only-obsidian   a live reference to Obsidian, dead or absent to the plugin
 *   ref-only-plugin     a live reference to the plugin, dead text to Obsidian
 *   code-unprotected    a line of a top-level Obsidian code block the plugin leaves unprotected
 * plus `unknown`, the reference names whose liveness Obsidian could not be asked about,
 * and `obsidianRefs`, Obsidian's live references as {name, line, column}.
 */
export function compareNote(note, entry, plugin) {
    const out = [];
    const obsDefs = withoutInline(entry.first).footnotes.map((f) => ({ name: f[0], line: f[1], column: f[2], end: lastLine(f[1], f[3], f[4]) }));
    const pluginDefs = plugin.definitions.slice();
    const usedPlugin = new Set();
    for (const d of obsDefs) {
        const i = pluginDefs.findIndex((p, k) => !usedPlugin.has(k) && p.line === d.line && fold(p.name) === fold(d.name));
        if (i === -1) {
            out.push({ kind: "def-only-obsidian", name: d.name, line: d.line, detail: `Obsidian reads a definition of [^${d.name}] on line ${d.line + 1} (lines ${d.line + 1}-${d.end + 1}); the plugin does not` });
            continue;
        }
        usedPlugin.add(i);
        const p = pluginDefs[i];
        if (p.end !== null && trimmedEnd(note, p.line, p.end) !== d.end) {
            out.push({ kind: "def-end", name: d.name, line: d.line, detail: `[^${d.name}] on line ${d.line + 1} ends on line ${d.end + 1} to Obsidian, line ${trimmedEnd(note, p.line, p.end) + 1} to the plugin (${p.kind})` });
        }
    }
    pluginDefs.forEach((p, k) => {
        if (!usedPlugin.has(k)) out.push({ kind: "def-only-plugin", name: p.name, line: p.line, detail: `the plugin reads ${p.kind === "in-item" ? "an" : "a"} ${p.kind} definition of [^${p.name}] on line ${p.line + 1}; Obsidian does not` });
    });

    const { refs, unknownNames } = obsidianReferences(note, entry);
    const unknown = new Set(unknownNames);
    const key = (r) => `${r.line}:${r.column}`;
    const obsKeys = new Map(refs.map((r) => [key(r), r]));
    const pluginKeys = new Map(plugin.references.map((r) => [key(r), r]));
    for (const [k, r] of obsKeys) {
        if (!pluginKeys.has(k)) out.push({ kind: "ref-only-obsidian", name: r.name, line: r.line, detail: `Obsidian reads a live reference [^${r.name}] at line ${r.line + 1}, column ${r.column + 1}; the plugin does not` });
    }
    for (const [k, r] of pluginKeys) {
        if (obsKeys.has(k) || unknown.has(fold(r.name))) continue;
        out.push({ kind: "ref-only-plugin", name: r.name, line: r.line, detail: `the plugin reads a live reference [^${r.name}] at line ${r.line + 1}, column ${r.column + 1}; to Obsidian it is dead text` });
    }

    for (const s of entry.first.sections) {
        if (s[0] !== "code") continue;
        for (let line = s[1]; line <= s[2]; line++) {
            if (plugin.lineKinds[line] === "") {
                out.push({ kind: "code-unprotected", name: "", line, detail: `line ${line + 1} is in a code block to Obsidian; the plugin leaves it unprotected` });
            }
        }
    }
    return { disagreements: out, unknown: unknownNames, obsidianRefs: refs };
}
