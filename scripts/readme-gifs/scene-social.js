// Still: the footnote popup, shot for the repo's GitHub social preview card
// (the image GitHub shows when someone links the repo). Made 2026-10-02.
//
// Run it with an --out path, or the driver drops the picture into README/:
//   node scripts/readme-gifs/record.mjs social --out <somewhere>/social-capture.png
//
// The card is 1280x640 but appears at roughly 450 pixels wide in Discord and
// forum previews, so the popup has to be captured larger than life to stay
// sharp once it is cut out and shrunk. This scene zooms Obsidian to 2x for
// the shot, then puts the zoom back.
//
// The cutout is made outside Obsidian. To know where the popup and the
// sentence above it sit in the picture, the scene leaves their positions in
// window.__scene.meta. Read them right after the run with:
//   Obsidian.com vault=Obsidian-Plugin-Sandbox eval "code=JSON.stringify(window.__scene.meta)"
// Positions are in page pixels; multiply by (picture width / meta.innerWidth)
// to get picture pixels.
(async () => {
    const G = window.__gif;
    const S = window.__gifScene;
    // webContents is Electron's handle on the window's page, which is what
    // owns the zoom level
    const wc = require("electron").remote.getCurrentWebContents();
    const ZOOM = 2;
    await S.run({}, async () => {
        const before = wc.getZoomFactor();
        // At 2x zoom the sidebars squeeze the note until the sentence wraps
        // behind the popup, so both are folded away for the shot and put back
        // exactly as they were afterwards.
        const ws = app.workspace;
        const leftWas = ws.leftSplit.collapsed;
        const rightWas = ws.rightSplit.collapsed;
        try {
            ws.leftSplit.collapse();
            ws.rightSplit.collapse();
            wc.setZoomFactor(ZOOM);
            await G.sleep(900);
            // Short enough to stay on one line above the popup at 2x zoom.
            const line = "The reef survey counted 412 colonies, a third more than last season.";
            await G.setNote("# Field notes\n\n" + line, { line: 2, ch: line.indexOf("season") + 3 });
            await G.sleep(700);
            // The command is pressed directly rather than through G.press, so
            // no on-screen key caption ends up in the picture.
            app.commands.executeCommandById(S.NUM);
            if (!(await G.waitFor(G.popupOpen))) throw new Error("popup did not open");
            await G.sleep(500);
            // Long enough to wrap onto a second line, so the popup reads as a
            // small editor rather than a thin strip.
            await G.typePopup("Transect B, surveyed 14 March by the second dive team. Counts exclude the two quadrats lost in the storm surge.", 3);
            await G.sleep(1200);
            const rectOf = (el) => {
                const r = el.getBoundingClientRect();
                return { x: r.left, y: r.top, width: r.width, height: r.height };
            };
            const popup = document.querySelector(".footnote-shortcut-popup");
            const lines = [...G.view().contentEl.querySelectorAll(".cm-line")];
            const refLine = lines.find((l) => l.textContent.includes("season"));
            const editor = G.view().contentEl.querySelector(".cm-scroller");
            const meta = {
                zoom: ZOOM,
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                popup: popup && rectOf(popup),
                refLine: refLine && rectOf(refLine),
                editor: editor && rectOf(editor),
            };
            // No rectangle given, so the whole window is captured; the
            // cutout happens later using the positions above.
            const still = await G.snapshot("social", undefined);
            app.commands.executeCommandById(S.NUM);
            await G.waitFor(G.popupGone);
            await G.diskQuiet(1200);
            return { still, meta };
        } finally {
            wc.setZoomFactor(before);
            if (!leftWas) ws.leftSplit.expand();
            if (!rightWas) ws.rightSplit.expand();
        }
    });
})();
