// The refusal texts the tests expect, written out in full. The plugin
// builds every refusal from shared pieces (refusal() in
// src/editor/notice.ts); these are what the pieces must add up to,
// spelled out by hand so a test compares against the words a user reads
// and not against the builder that made them (Jason's shared vocabulary,
// 2026-10-22, run toast-consolidate). The names are the ones the plugin's
// own constants had before the builder replaced them.

/** A press in code, math, a comment, or the frontmatter. */
export const ProtectedCreationNotice = "No footnote was created: footnotes can't go inside code, math, or other protected text.";
/** A press whose new footnote would sit inside another footnote. */
export const NestedFootnoteNotice = "No footnote was created: footnotes can't be nested inside other footnotes.";
/** A press whose new reference Obsidian would read as part of a link. */
export const InsideLinkNotice = "No footnote was created: Obsidian would read it as part of a link.";
/** A press in a line's block syntax, or one that would change a line's shape. */
export const BlockSyntaxNotice = "No footnote was created: it would break the line's formatting. Move the cursor into the text.";
/** A press whose new footnote Obsidian would not read as one. */
export const DeadFootnoteNotice = "No footnote was created: Obsidian wouldn't read it as a footnote here.";

/** A press with several cursors, one inside a footnote and the others on plain text. */
export const MultiCaretNestedNotice = "No footnotes were created: footnotes can't be nested inside other footnotes.";
/** A press with several cursors, all inside footnotes that cannot carry on together. */
export const MultiCaretInFootnotesNotice = "No footnotes were created: the cursors are inside existing footnotes. Move them into the text.";

/** A cut the result gate refused. */
export const NothingCutNotice = "Nothing was cut: it would change how Obsidian reads the text around it.";
/** A carried paste whose footnotes would land inside another footnote. */
export const PasteNestedNotice = "Nothing was pasted: footnotes can't be nested inside other footnotes.";
/** A carried paste refused for the general reason. */
export const PasteReadsDifferentlyNotice = "Nothing was pasted: it would change how Obsidian reads the text around it.";
/** A press with several cursors, one of them in code, math, a comment, or the frontmatter. */
export const MultiCaretProtectedNotice = "No footnotes were created: footnotes can't go inside code, math, or other protected text.";
/** A press with several cursors whose new references Obsidian would read as part of a link. */
export const MultiCaretLinkNotice = "No footnotes were created: Obsidian would read it as part of a link.";
