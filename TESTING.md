# Testing

Five layers, four commands and one by hand:

| Layer | Command | What it covers | Needs Obsidian running? |
| --- | --- | --- | --- |
| Unit + property (vitest) | `npm test` | Pure logic: pinned behavior + random-document invariants | No |
| Static analysis | `npm run lint`, `npm run knip` | Type-aware lint rules; dead exports/files/dependencies | No |
| Mutation (Stryker) | `npm run mutation` | Whether the suite actually notices logic changes | No |
| Smoke (integration) | `npm run test:smoke` | The real plugin inside the real app | Yes |
| Manual (by hand) | `manual-tests/0 - How to use.md` | The theme sheets in `manual-tests/`, run as live notes for what only a human can judge: rendering, popups, feel, the phone; `compat-tests/` for other plugins | Yes |

## Unit tests — `npm test`

Vitest, watching `test/**/*.test.ts`. The `obsidian` npm package is type
definitions only, so `vitest.config.mts` aliases it to the runtime stub in
`test/mocks/obsidian.ts` — extend the stub (empty classes / no-ops) if a
new import breaks test startup.

Specs build editor state with the shared fakes in `test/helpers/`
(`fakeEditor`, `fakePlugin`) instead of hand-rolling doubles. Editor
capabilities are opt-in (`cursor`, `carets`, `selection`, `edits`,
`wholeDoc`, `words`) and a disabled method throws naming its option, so
leaving a capability off is an assertion that the code under test never
uses it. `test/fake-editor-helper.test.ts` pins the helper's own
contract. Purpose-built doubles (the offset-splicing linter fake, richer
view shapes) stay local to their specs.

The suite has five kinds of files:

- **Feature specs** (`test/*.test.ts`) — one file per unit under test:
  autonumbering, reference regexes, the insert cascade guards, table-cell
  editing, the linter and each of its rules, prefixes, the popup guards.
  `test/rule-examples.test.ts` executes every lint rule's worked examples
  from the rule registry, so the examples can never drift from the code.
- **Bug pins** (`test/hunt/bug-*.test.ts`) — every bug ever found gets a
  failing test before its fix and keeps it as a regression pin. Spec
  rulings live next to them as `test/hunt/spec-*.test.ts`.
- **The offline referee** (`test/obsidian-referee.test.ts`): the
  remark-parse 8 reader (`src/parsing/obsidian-markdown.ts`, Obsidian's
  own parser rebuilt from remark-parse 8 and Obsidian's rules as observed
  with the oracle) against Obsidian's answers saved from the live oracle
  below, about 6,000 notes in `test/obsidian-answers/`. It uses the
  oracle's own comparison (`scripts/oracle/compare.mts`) and fails on any
  disagreement except a short list of known ones, each with its reason.
  `test/footnote-facts.test.ts` pins the positions the reader derives
  (label columns, reference ends, protected spans).
- **Properties** (`test/properties.test.ts`) — fast-check invariants over
  randomly generated documents and option combos: lint idempotence, no
  mask (NUL) leakage, protected-region preservation, reference/definition
  conservation, plus a **differential oracle**
  that parses each document with micromark (GFM footnotes + math) before
  and after linting and requires identical footnote structure. Failures
  shrink to a minimal counterexample automatically. The document generator
  lives in `test/arbitraries.ts`, shared with the sample-corpus script.
- **Command-press properties** (`test/command-properties.test.ts`) — the
  same generator drives the four real creation commands (autonum, named,
  inline, paste) against a transaction-applying fake editor at random
  caret positions and settings: a press never throws, never edits
  protected text, never loses a protected line, adds only the raw
  reference shapes its contract allows, and never mints a dead reference
  or orphaned definition of its own making. The TYPED flows are fuzzed
  too: the full named cycle (plant `[^]`, type a generated name —
  colliding, fresh, or invalid — re-press for the definition, type its
  body), the inline cycle (plant `^[]`, type a body, re-press hops out or
  warns while empty), and paste with arbitrary `fc.string` clipboard
  content through the whole command. SELECTION conversions (issue #35) are
  fuzzed with random single-line spans (reversed, whitespace-edged, empty):
  a conversion moves EXACTLY the trimmed selected text into the footnote
  and keeps the line's prefix/suffix, named/paste redirect without
  editing, multi-line selections warn and edit nothing, and protected
  lines survive conversion presses untouched. Popup, table cells, and
  Reading view stay smoke-suite territory (the cell conversion writer has
  deterministic pins in `test/selection-to-footnote.test.ts`). RENAME
  (issue #36, `test/rename-footnote.test.ts`) pins its planner and adds a
  property: a successful rename maps the name everywhere, leaves every
  unedited line byte-identical, and is always reversible.

Properties run 200 cases each by default. Before a release, soak them:

```powershell
$env:FC_NUM_RUNS = "5000"; npx vitest run test/properties.test.ts test/command-properties.test.ts
```

Standing rules:

- **Every reported bug gets a failing test before the fix** (unit if the
  logic is pure, smoke if it needs the live editor). When a property or
  the oracle finds one, the shrunk counterexample becomes a deterministic
  pin in `test/hunt/` — properties discover, pins remember.
- New *generic* invariants ("lint never does X to any document") belong in
  `test/properties.test.ts`; new *specific* behavior gets a normal spec.
- Mark a test *characterization* when it pins current behavior that
  hasn't been blessed as intended — flip the expectation to change the
  spec. (The original batch was folded away once its behaviors were
  ruled on; the marker outlives any one test.)
- **Unit tests defend against our changes; smoke tests defend against
  Obsidian's.** Anything that touches undocumented internals (table cell
  sub-editors, embedRegistry) must keep a smoke test — a mocked unit test
  would just encode our assumptions and stay green when Obsidian changes.
- When a classification is contested (is this line code? frontmatter? a
  definition continuation?), get ground truth from the real app with the
  oracle below (`npm run oracle -- check`), which reads the note with
  Obsidian's own parser and, with `--render`, in Reading view.

## Static analysis — `npm run lint` and `npm run knip`

- `npm run lint`: ESLint over `src/` and `test/` with the official
  Obsidian plugin guidelines plus typescript-eslint's
  `strict-type-checked` preset (type-aware). Fix findings with typed
  code, not disable comments. Two rules are off for `test/` only (see
  the comment in `eslint.config.mjs`): `no-extraneous-class` (test
  doubles legitimately mirror external class shapes) and
  `no-global-this` (tests run under node, where the guideline's
  `window` global doesn't exist).
- `npm run knip`: dead exports, unused files, unused/unlisted
  dependencies. The repo is kept at **zero findings** — if knip flags new
  code, either wire it in (see rule-examples.test.ts for the pattern) or
  delete it.

Line coverage (`npm run coverage`) exists for ad-hoc "is this path
reached at all?" questions; the quality signal this project actually
gates on is mutation testing below — high line coverage with weak
assertions still lets mutants live.

## Mutation testing — `npm run mutation`

Stryker mutates the pure-logic modules — all of `src/parsing/` and
`src/linting/`, plus the non-DOM parts of `src/editor/` and
`src/commands/` (the exact list is the `mutate` array in
`stryker.config.json`; plugin bootstrap, settings UI, and the popup are
smoke-test territory) — and reruns the covering tests per mutant
(`coverageAnalysis: perTest`). A surviving mutant is a logic change no
test noticed — either add a test or accept it knowingly.

- **Local only, by design** — it is a pre-release audit, not CI.
- Results cache in `reports/stryker-incremental.json` (gitignored), so
  re-runs after small changes take seconds to minutes; the first full run
  takes much longer.
- The HTML report lands at `reports/mutation.html`.
- The npm script pins `FC_NUM_RUNS=25` so the property suite stays cheap
  per mutant.

## Smoke tests — `npm run test:smoke`

`scripts/smoke-test.mjs` drives the **actual plugin in a running Obsidian
instance** through the Obsidian CLI: it deploys the current build, creates a
scratch note, moves the cursor, executes the plugin's commands, and asserts
on the real editor contents — the same loop used to verify the v0.2 features
(end-of-word insertion, numbering, section headings, blank-line trimming,
popup open/toggle-close, orphan handling, fences/callouts/math protection).

The script is fully repeatable: it backs up your plugin settings to a
sidecar file, forces the note into live preview, restores everything on
every exit path (finish, failure, Ctrl+C), and heals from a leftover
backup if a previous run was killed.

Requirements:

- Obsidian is open with the **Obsidian-Plugin-Sandbox** vault focused
  (the script refuses to run against any vault without "Sandbox" in its name)
- the `obsidian` CLI on PATH (ships with Obsidian; `Obsidian.com` on Windows,
  override with the `OBSIDIAN_CLI` env var if needed)
- the **hot-reload** community plugin enabled, so the deployed build is
  picked up automatically
- the Obsidian window visible (the render loop stalls while hidden or
  minimized; the script nudges the window awake but can't fight a
  deliberate minimize)

Flags: `npm run test:smoke -- --no-deploy` tests whatever build is already
loaded instead of deploying first. `npm run test:smoke -- --filter "popup"`
runs only the tests whose name contains the substring (case-insensitive) —
for iterating on one new test without the full run.

Notes for writing new smoke tests:

- The CLI sometimes swallows eval output. Treat evals as fire-and-forget
  *actions* and verify by *polling* idempotent reads (`pollUntil`).
- Set note content through `editor.setValue`, never by overwriting the file
  on disk — an open editor with unsaved changes merges disastrously.
- Reset plugin settings to the baseline at the start of every test
  (`resetSettings`); never rely on a previous test's cleanup running.
- Settings changes are in-memory only and restored at the end, so the
  vault's `data.json` is untouched.

## The oracle, Obsidian as the referee: `npm run oracle`

`scripts/oracle/` compares the plugin's reading of a note with Obsidian's
own. It needs the live app with the sandbox vault open and is not part of
the commit bar: run it when a reading fact is contested, after work on the
reader, or as a fuzz before a release.

Obsidian's side comes from `app.metadataCache.computeMetadataAsync`
(undocumented), which runs the parser behind Reading view and the metadata
cache on any string: its sections, its definitions (`footnotes`), and its
references (`footnoteRefs`). That list holds only references whose name has
a definition, so each note is parsed a second time with a definition for
every undefined name appended (or, when an unclosed block swallows the
appendix, put at the top); when neither probe leaves the note's own parse
unchanged, those names' liveness is reported as unknown. The plugin's side
(`plugin-facts.ts`) asks the note reading the way the commands do, parts
and all (the hand-written scanner it used to ask is gone since the runtime
swap of 2026-10-03): every definition with its container and last line,
the live references, and the protected lines. `compare.mts` lists the
disagreements: a definition one
side reads and the other does not, a definition whose last line differs, a
reference live to one side only, a line of an Obsidian code block the
plugin leaves unprotected. The offline referee suite uses the same file, so
the two always judge alike. It is TypeScript that Node runs directly, which
needs Node 22.18 or later.

With `--reader`, either command compares Obsidian with one whole-note
parse of the remark-parse 8 reader (`reader-facts.ts`), the reader the
note reading is built on; the two answer alike unless the reading in parts
goes wrong (test/note-reading-parts.test.ts holds them together). The
rules the oracle has
found so far, which the reader's code cites by letter and number, are in
`docs/obsidian-reading-rules.md`. With `--answers
<file>`, `check` also saves Obsidian's answers in the packed form of
`test/obsidian-answers/`: add the file to `AnswerFiles` in
`test/obsidian-referee.test.ts` to make those notes part of the referee.

Reading view is the court of appeal (`--render`): each note becomes a
scratch note in the vault's `Footnote Oracle/` folder, opens in a new tab in
Reading view, is rendered, read back (which definitions render and from
which line, which references render), and the tab is closed and the note
deleted. Reading view renders only referenced definitions and only defined
references, so the scratch note gets a top paragraph referencing every name
and the same appended definitions.

```powershell
npm run oracle -- check notes.json --render --out results.json
npm run oracle -- check notes.json --reader --answers test/obsidian-answers/new-notes.json
npm run oracle -- fuzz --seed 20261003 --count 3000 --render --out fuzz.json
npm run oracle -- fuzz --broad --seed 20261004 --count 20000 --reader --out broad.json
```

`check` takes a JSON array of notes (strings, or `{id, text}`); a note may
carry `claims` (a definition on a line, a definition's last line, a
reference live or dead, a line protected), and each claim gets the plugin's
reading and the metadata cache's and Reading view's verdicts (`claims.mjs`
documents the shapes). `fuzz` generates small container-heavy notes from a
seed (`generate.mjs`); with `--broad` it uses the broad generator instead,
which mixes notes written the way people write them (prose with hard
wraps, definitions at the bottom, frontmatter, wikilinks, tables, nested
callouts, long definitions, text in other scripts) with the
container-heavy shapes, 5 to 30 lines each. It then shrinks each disagreement by deleting lines while it
persists, clusters the reproducers by line shape, and adjudicates one per
cluster in Reading view. The bridge (`obsidian-bridge.mjs`) follows the
live-app rules in `docs/agents/dev-setup.md`: the sandbox vault named on
every CLI call, scripts and notes passed through the vault's
`.footnote-oracle/` dotfolder, and evals that return at once while Node
polls for the result file. Long runs want the sandbox window visible: on
2026-10-03, with it hidden, the app slowed for a while to about four
minutes per rendered note and CLI evals timed out, then recovered by
itself. A metadata-only `fuzz` (no `--render`) of 3000 notes takes about
40 minutes, most of it shrinking.

## When to run what

- While developing pure logic: `npm test` (watch mode).
- Before committing: `npm run lint` — and `npm run knip` if you added or
  removed exports.
- Before committing anything that touches editor behavior: `npm run
  test:smoke`.
- Bumping the version: `npm version 0.2.1-beta.1` writes manifest-beta.json alone (a BRAT beta); `npm version 0.2.1` writes manifest.json, versions.json, and manifest-beta.json together, because older BRAT builds install whatever version manifest-beta.json names on the default branch, so the beta manifest must never lag a stable release (the release workflow refuses a stable tag while it does).
- Before a release: all of the above, a property soak (`FC_NUM_RUNS`),
  `npm run mutation`, and the manual sheets (`manual-tests/0 - How to
  use.md`, mirrored into the sandbox vault's "Footnote Tests" folder).
