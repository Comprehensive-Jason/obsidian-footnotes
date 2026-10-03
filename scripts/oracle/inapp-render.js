// In-app half of the Reading-view adjudicator, the oracle's court of appeal.
// obsidian-bridge.mjs copies this file into the sandbox vault's
// .footnote-oracle folder and evals a loader that calls the function below
// with a job id.
//
// For each note it creates a scratch note in the "Footnote Oracle" folder,
// opens it in a NEW tab in Reading view (never reusing a tab Jason has
// open), renders it, reads which footnotes rendered and where, then closes
// the tab and deletes the scratch note. Reading view is forced to render
// synchronously (renderer.set, parseSync, then each section's render),
// because a hidden or occluded window never runs the animation-frame
// callbacks its normal lazy rendering waits on (dev-setup rule 6).
//
// What it reads back, with lines as the scratch note numbers them:
// - every rendered definition: the footnotes list's items, whose data-line
//   is the definition's line counted from the footnotes section's own line,
//   with the name taken from a reference that links to the item;
// - every rendered reference (a footnote superscript), with the line range
//   of the section it sits in, or the line of the definition whose rendered
//   item holds it.
(async (id) => {
    const dir = ".footnote-oracle";
    const folder = "Footnote Oracle";
    const out = { id, isMobile: app.isMobile, results: [] };
    const before = app.workspace.activeLeaf;
    try {
        const job = JSON.parse(await app.vault.adapter.read(`${dir}/job-${id}.json`));
        if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
        for (let n = 0; n < job.notes.length; n++) {
            const text = job.notes[n];
            const path = `${folder}/oracle-${id}-${n}.md`;
            if (app.vault.getAbstractFileByPath(path)) throw new Error(`scratch note already exists: ${path}`);
            const file = await app.vault.create(path, text);
            const leaf = app.workspace.getLeaf("tab");
            try {
                await leaf.openFile(file, { active: false, state: { mode: "preview" } });
                const view = leaf.view;
                if (!view.file || view.file.path !== path) throw new Error(`the new tab did not open ${path}`);
                // Obsidian drops a leading byte order mark when it reads a
                // note, so the view's text is compared without one
                const bomless = (t) => t.replace(/^﻿/, "");
                if (bomless(view.data) !== bomless(text)) throw new Error(`the new tab holds different text from ${path}`);
                const renderer = view.previewMode.renderer;
                renderer.set(view.data);
                renderer.parseSync();
                for (const s of renderer.sections) if (!s.rendered) s.render();
                const sections = renderer.sections.map((s) => ({ start: s.start.line, end: s.end.line, el: s.el }));
                // every footnote superscript names its footnote and links to its item
                const nameOfItem = {};
                for (const s of sections) {
                    for (const a of s.el.querySelectorAll("sup.footnote-ref a[data-footref]")) {
                        nameOfItem[(a.getAttribute("href") || "").replace(/^#/, "")] = a.getAttribute("data-footref");
                    }
                }
                const defs = [];
                const refs = [];
                for (const s of sections) {
                    if (s.el.matches(".mod-header, .mod-footer")) continue;
                    const list = s.el.querySelector("section.footnotes");
                    if (list) {
                        for (const li of list.querySelectorAll(":scope > ol > li")) {
                            const itemId = li.getAttribute("data-footnote-id");
                            const line = s.start + Number(li.getAttribute("data-line"));
                            // one back-arrow per reference, hidden ones (inside a
                            // "%%" comment) included
                            const backrefs = li.querySelectorAll("a.footnote-backref").length;
                            defs.push({ name: nameOfItem[itemId] ?? null, line, backrefs, text: li.textContent.replace(/↩︎/g, "").trim() });
                            for (const a of li.querySelectorAll("sup.footnote-ref a[data-footref]")) {
                                refs.push({ name: a.getAttribute("data-footref"), defLine: line });
                            }
                        }
                        continue;
                    }
                    for (const a of s.el.querySelectorAll("sup.footnote-ref a[data-footref]")) {
                        refs.push({ name: a.getAttribute("data-footref"), start: s.start, end: s.end });
                    }
                }
                // the note's block sections, without the header and footer
                // Obsidian adds around them and the footnotes list
                const blocks = sections
                    .filter((s) => !s.el.querySelector(".mod-header, .mod-footer, section.footnotes") && !s.el.matches(".mod-header, .mod-footer"))
                    .map((s) => [s.start, s.end]);
                out.results.push({ defs, refs, sections: blocks, bomDropped: view.data !== text });
            } finally {
                leaf.detach();
                await app.vault.delete(file);
            }
        }
    } catch (e) {
        out.error = String((e && e.stack) || e);
    }
    // hand the focus back to the tab that had it, if opening tabs moved it
    if (before && app.workspace.activeLeaf !== before && before.parent) app.workspace.setActiveLeaf(before, { focus: false });
    await app.vault.adapter.write(`${dir}/result-${id}.json`, JSON.stringify(out));
})
