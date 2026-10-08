# One result gate instead of shape-by-shape checks

By 2026-10-07 the plugin guarded its edits with about twenty separate
checks, each answering some version of "would this edit change how
Obsidian reads the note?" for one command or one shape a bug hunt had
built. They overlapped and disagreed, several edits had none, and the
hunt fixes behind them had grown `src` by about 3,800 lines in three days
while each fix round made new bugs. Jason decided (2026-10-07) that the
plugin spends no code on rare shapes a user builds on purpose, and that
one rule replaces the checks: every edit is worked out, the note after it
is read, and the edit is refused (by the lint: held back and named, ADR
0002) unless the note reads the same as before except for what the
action meant to change. The six things compared: untouched footnotes,
nesting (ADR 0001), protected text, links, the block shape of every
other line and the containers of the edited ones, and that what the
action meant to create is live. A rare shape now needs no new code: the
gate refuses it. The gate does not decide where a footnote lands.

A cut pasted back is the second rule: the plugin remembers the note
before and after its last cut, and a paste of that cut's text into the
unchanged note at the cut's caret restores the note exactly, names
included.

## Consequences

- Guards that judge the caret before an edit stay, for their more
  helpful notices; result checks are not written per command any more.
- A refusal reports a reason (nesting, protected text, a link, a line's
  formatting, or anything else), and each reason has one notice.
- A refused carried paste pastes nothing (Jason, 2026-10-07).
- When the plugin cannot tell what the user meant, it does what the
  editor would do without it.
- Bug hunts report only data loss and plausible actions; a deliberately
  strange note is out of scope unless it loses text.
- The full design and its build stages: "Result gate design 2026-10-07"
  in Jason's project folder.
