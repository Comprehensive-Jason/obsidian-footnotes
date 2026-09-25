# Agent instructions

## Working rules

Jason's standing rulings for this repo. Each one was made after the thing went wrong once; the date is when he ruled. The commit history is the style guide for commit messages.

- **Vocabulary lives in `CONTEXT.md`.** A `[^1]` in the text is a reference; the `[^1]: …` line is a definition, in code identifiers, tests, UI strings, commits, and manual sheets alike (2026-08-10). Where "references" would collide with the verb, write "nothing references this footnote". "Marker" stays only for list, blockquote, and callout markers.
- **Comments are written for Jason as a non-programmer** (2026-09-09). Plain sentences, one idea each: what the code does, then why, then the provenance in parentheses (a ruling date, an issue number, a test name, an ADR). Define a term of art on its first use in a file. Prove a comment-only edit by stripping comments with TypeScript's `transpileModule` (`removeComments: true`) on both versions and diffing; esbuild keeps comments inside expressions and before class members, so it reports them as code. Stryker directive comments keep their exact prefix.
- **Punctuation** (2026-08-29). Comments use " - " where an em dash would go. Settings text, notices, and alerts get a real rewrite with commas, colons, semicolons, or a sentence break.
- **Every bug Jason reports is pinned by a failing test before the fix** (2026-07-14): a unit test when the logic is pure, a smoke test when it needs the live editor. AI writes the tests and Jason reviews them, so flag characterization tests (behaviour pinned as it is) so his review means something.
- **Sweeps and hunts report the whole findings list before fixing anything** (2026-08-28). Deliver a triage: passed, failed with the observed behaviour, needs his eyes. For each failure say whether it is a plugin bug, a sheet defect, or a design question, and offer options with a recommendation. Bugs he reported himself skip the queue. For UI text, offer drafts to pick from.
- **Prefix tests vary the separator** (2026-08-08): `2-`, `2~`, `3=`, `4_`, regex-special ones like `ch2*` and `a$`, plus one dot baseline. `test/prefix-separators.test.ts` is the parameterized suite; extend its `PREFIXES` list rather than duplicating cases.
- **A new feature asks about its settings toggle** (2026-07-16): toggle or always-on, and the default. One question with a recommendation, at planning or the first green milestone. Jason owns the UX surface.
- **Manual sheets mirror into the sandbox vault.** After any edit under `manual-tests/` or `compat-tests/`, copy the folder into `Footnote Tests/` or `Footnote Compat Tests/` at the vault root (two levels above this folder) and confirm with `diff -rq`, after checking that the mirror carries no ticked boxes or local edits. `Footnote Tests USED/` is Jason's working copy: read it to learn what he actually tested, and leave it alone. Sheets are self-contained: fixtures, preexisting footnotes, and frontmatter prefixes all inside the sheet (2026-08-27). A check goes on a sheet only when it needs a human: rendering, feel, Obsidian's own widgets, undo grouping, phone behaviour, wording (2026-09-20). Anything the fake editor or a smoke scenario can observe goes in that theme's `test/manual-<theme>.test.ts` instead; `manual-tests/0 - How to use.md` maps the retired sheet numbers.
- **Commit at every green checkpoint, without asking** (2026-07-16): one completed thought per commit, a fix with its test, a feature milestone, a refactor with the suite green. If describing the working tree needs the word "and", a commit is overdue. Stage deliberately and check `git status` for Jason's own uncommitted files first. Push only when Jason asks.
- **Work on this checkout, branch master** (2026-07-13), with absolute paths and `git -C` even when a session anchors in a worktree: his vault hot-reloads from here, so he can work alongside.
- **Commits carry no AI attribution** (2026-07-13): the plugin is public. The global Claude settings strip the trailer; add none by hand.
- **`docs/architecture.html` is the source of the "Footnote Shortcut Anatomy" artifact** (2026-09-09). Edit the repo file, derive the artifact with `npm run architecture -- <output.html>` (scripts/architecture-artifact.mjs strips the document wrapper), republish to the same URL, and refresh the counts on the page from the filesystem.
- **Writes into Jason's personal vault** (the "Second Brain" vault, used for sweep verification notes) follow that vault's own `AGENTS.md` at its root.

## Verification

`TESTING.md` lists the layers and their commands. The bar for a commit is the one every commit message here states: tests, tsc, eslint, knip, and build green. `npm run test:smoke` deploys `main.js` without building it, so build first.

## Dev environment

`docs/agents/dev-setup.md` holds what the environment cannot tell you: the sandbox vault and hot-reload, how to drive the live app through the Obsidian CLI without touching Jason's open notes, the table-cell and mobile-emulation gotchas, and the release and beta flow. Read it before any live-app work or release step.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`MichaBrugger/obsidian-footnotes`), driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Stock GitHub labels reused where they carry the meaning (`question`, `help wanted`, `wontfix`); `needs-triage` is the only added label, and the AFK-agent role is unused. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`, both created lazily by `/domain-modeling` when terms or decisions actually get resolved. See `docs/agents/domain.md`.
