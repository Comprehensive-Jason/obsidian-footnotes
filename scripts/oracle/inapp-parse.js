// In-app half of the metadata-cache oracle. obsidian-bridge.mjs copies this
// file into the sandbox vault's .footnote-oracle folder and evals a loader
// that reads it and calls the function below with a job id. It touches no
// note and no setting: it only feeds strings to Obsidian's own parser.
//
// app.metadataCache.computeMetadataAsync(arrayBuffer) is undocumented. It
// runs the parser that also builds Reading view and the metadata cache (a
// fork of remark-parse 8, research 2026-10-03) on any string and returns
// sections, footnotes (definitions), and footnoteRefs (references).
//
// footnoteRefs lists only references whose name HAS a definition (probed
// 2026-10-03: "Only [^nodef] here" gives no footnoteRefs at all). To learn
// which of the other reference-shaped strings Obsidian would read as live,
// each note is parsed again with a definition for every undefined name,
// once appended after a blank line and once put at the top. The Node side
// (compare.mts) takes the first probe that left the note's own parse
// unchanged and had every probe definition read as one (an unclosed fence
// or "%%" block at the end swallows the appendix); when neither does, the
// liveness of the undefined names is reported as unknown rather than guessed.
(async (id) => {
    const dir = ".footnote-oracle";
    const out = { id, isMobile: app.isMobile };
    try {
        const job = JSON.parse(await app.vault.adapter.read(`${dir}/job-${id}.json`));
        const parse = async (text) => {
            const r = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(text).buffer);
            const pos = (p) => [p.start.line, p.start.col, p.end.line, p.end.col];
            return {
                sections: (r.sections || []).map((s) => [s.type, s.position.start.line, s.position.end.line]),
                footnotes: (r.footnotes || []).map((f) => [f.id, ...pos(f.position)]),
                refs: (r.footnoteRefs || []).map((f) => [f.id, ...pos(f.position)]),
            };
        };
        out.results = [];
        for (const text of job.notes) {
            const first = await parse(text);
            const defined = new Set(first.footnotes.map((f) => f[0].toLowerCase()));
            const names = [];
            const seen = new Set();
            for (const m of text.matchAll(/\[\^([^[\]\n]+)\]/g)) {
                const folded = m[1].toLowerCase();
                if (defined.has(folded) || seen.has(folded)) continue;
                seen.add(folded);
                names.push(m[1]);
            }
            const entry = { first };
            if (names.length > 0) {
                const base = text.endsWith("\n") ? text : `${text}\n`;
                const baseLines = base.split("\n").length - 1;
                const appendix = names.map((n) => `[^${n}]: oracle appendix\n\n`).join("");
                // the appended definitions sit on lines baseLines + 1, + 3, ...
                entry.appendix = { names, firstLine: baseLines + 1, step: 2 };
                entry.second = await parse(`${base}\n${appendix}`);
                // An unclosed fence, "$$", "%%", or HTML block at the end of
                // the note swallows the appendix. For that case the same
                // definitions are also tried at the top of the note, then a
                // one-line paragraph that ends the last definition (so an
                // indented first line of the note is not read as its
                // continuation), then a blank line: the note moves down two
                // lines per name plus two. The Node side uses whichever probe
                // leaves the note's own parse unchanged. Not done for a note
                // with frontmatter, which must stay on the first line.
                if (!/^---\r?\n/.test(text)) {
                    entry.prefix = { names, shift: names.length * 2 + 2 };
                    entry.third = await parse(`${appendix}oracle separator\n\n${text}`);
                }
            }
            out.results.push(entry);
        }
    } catch (e) {
        out.error = String((e && e.stack) || e);
    }
    await app.vault.adapter.write(`${dir}/result-${id}.json`, JSON.stringify(out));
})
