# Footnote Shortcut

An Obsidian plugin where a small set of hotkeys create, navigate, and
clean up Markdown footnotes. Its vocabulary is enforced: the terms below
appear verbatim in code, tests, commit messages, and the manual-test
sheets (reference/definition ruling: 2026-08-10).

## Language

### Footnote anatomy

**Reference**:
The `[^name]` occurrence in body text that points at a footnote.
_Avoid_: marker, footnote mark

**Definition**:
The `[^name]: …` entry that holds a footnote's text.
_Avoid_: detail, footnote content

**Label**:
The `[^name]:` head of a definition. A label defines; it never counts as
a reference.

**Continuation line**:
An indented line that belongs to the definition above it.

**Definition block**:
A label line plus its continuation lines — the unit that moves, merges,
and is jumped to as one thing.

**Container**:
What holds a definition: the note itself (top level), a quote or callout,
a list item, or another footnote's definition. Every definition counts,
whatever its container (Jason's ruling 1, option a, 2026-10-03); only a
**movable** one, at the top level with nothing but indentation before its
label, is ever moved, and a rule that cannot safely edit one in a
container refuses or alerts.

**Inline footnote**:
The self-contained `^[…]` form, with its text in place instead of in a
definition.

**Name**:
The identifier inside a footnote's brackets. Identity is
case-insensitive: `[^Note]` and `[^note]` are the same footnote.
_Avoid_: id (except in code symbols), key

**Autonumbered footnote**:
A footnote whose name is the next free number, minted by the plugin.

**Named footnote**:
A footnote whose name the user typed.

**Prefix**:
A per-note namespace (like `2.`) prepended to autonumbered names so
chapters merged into one document don't collide.

**Placeholder**:
An empty reference (`[^]`, or bare-prefix `[^2.]`) mid-naming — an
in-progress footnote owned by the user's typing, never deleted out from
under them.

**Orphan**:
A reference with no definition, or a definition with no reference.
Always qualified: orphaned reference, orphaned definition.

**Nested footnote**:
A footnote inside another footnote's body. Prevented plugin-wide
(ruling 2026-08-24); hand-typed nesting is surfaced by lint, never
destroyed.

### The press

**Press**:
One invocation of a footnote command — the atom every behavior rule is
stated in.

**Cascade**:
The ordered decision steps a press falls through (navigate before
create; each step either handles the press or passes it on).

**Claim**:
An early handler consuming the whole press before the cascade proper
(the selection claim, the multi-caret claim). A claimed press is
handled even when it only shows a refusal.

**Guard**:
A check that refuses a press with a toast instead of editing (protected
text, definition interiors, invalid names).

**Jump**:
Moving the caret between a reference and its definition — the
navigation half of the cascade.

**Popup**:
The small at-cursor editor for a definition, replacing the
jump-to-bottom when enabled.

**Landing**:
Where a creation press hands off after its edit: the popup, or a jump
to the new definition.

**Conversion**:
Turning selected text into a footnote — the selection replaced by a
reference, the text moved into the definition (or wrapped inline).

**Multi-caret press**:
A press with several carets that puts the same footnote at every one.
Atomic: one bad caret refuses the lot, one undo reverts the lot.

### Reading the document

**Note reading**:
The one parse of a note the way Obsidian reads it (remark-parse 8 plus
Obsidian's rules), remembered per exact text, from which every definition
with its extent and container is read.
_Avoid_: parse result, AST (except in code about the tree)

**Protected text**:
Regions where footnote syntax is plain text, not footnotes: code,
math, comments, frontmatter.

**Masked twin**:
The document copy with protected spans blotted out
(indices preserved) that every scan judges against; names are then
re-sliced from the raw line.
_Avoid_: sanitized copy, cleaned text

**Raw line**:
The unmasked original line, as the user typed it.

**Live**:
Actually parsing as a footnote construct in context. A reference-shaped
string inside code is not live — it's a fake.

**Born-dead**:
An insertion that would not be live the moment it lands (swallowed,
reclassified, or completing a construct around it). Creation simulates
first and refuses born-dead presses.

**Fake**:
Reference-shaped text that is not a live footnote (usually inside
protected text). Fakes travel freely; they are nobody's footnote.

### Linting

**Lint**:
The whole-document cleanup pass composed of rules; also the one
command that runs it.
_Avoid_: tidy (the pre-0.2 name)

**Rule**:
One toggleable lint transform (reindex, move to bottom, punctuation,
orphan handling, merge duplicates, apply prefix).

**Reindex**:
Renumbering footnotes 1, 2, 3… in occurrence order and reordering their
definitions to match.

**Lint alert**:
A notice about a problem lint won't fix by itself (never-silent
policy: content-destroying fixes are alerted, not applied).

**Trigger**:
An automatic occasion for lint (on save, on footnote creation) as
opposed to the explicit command.

**Section heading**:
The configurable markdown run separating definitions from the rest of
the note.

### Editor terrain

**Cell**:
An actively edited table cell's own sub-editor — a single-caret world
whose text only the cell itself may write (main-editor writes corrupt
it).

**End-of-word adjustment**:
Moving an insertion point to the end of the word (and past trailing
punctuation) under the caret, so mid-word presses don't split words.
