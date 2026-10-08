// The shared plugin double, owning the one `as unknown as` cast the
// per-file copies each repeated. Settings stay PARTIAL on purpose: the
// code under test reads specific keys and a missing key reads as
// undefined = feature off, exactly like the old hand-rolled fakes - do
// NOT spread DEFAULT_SETTINGS here, or every fake would silently turn
// on insert-at-end-of-word (default true) and start calling wordAt()
// on editors built without it.
import type { Editor } from "obsidian";
import type FootnotePlugin from "../../src/main";
import type { FootnotePluginSettings } from "../../src/settings";

/**
 * Pass `editor` when the spec drives a COMMAND entry point
 * (insertAutonumFootnote and friends resolve their editor through
 * app.workspace.getActiveViewOfType); leave it off for specs that hand
 * the editor to the function under test directly; its workspace then has
 * no open view. Specs needing a
 * richer view (Reading-view getMode, files, etc.) keep their own local
 * double.
 */
export function fakePlugin(
    settings: Partial<FootnotePluginSettings> = {},
    editor?: Editor,
): FootnotePlugin {
    return {
        settings,
        app: editor
            ? {
                  workspace: { getActiveViewOfType: () => ({ editor }) },
                  vault: {},
              }
            : { workspace: { getActiveViewOfType: () => null }, vault: {} },
    } as unknown as FootnotePlugin;
}
