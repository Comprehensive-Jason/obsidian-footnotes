@AGENTS.md

# Claude Code only

Rules about this harness, not about the repo. OpenCode reads `AGENTS.md` and skips these.

- **Subagents doing breadth work run on Opus** (`model: "opus"`), or Sonnet for mechanical high-volume work; hunting, probing, grading, and baseline runs all count. Fable stays in the main loop: a fan-out of Fable subagents hit the monthly spend limit and died mid-task (2026-07-17), and Jason has spare Opus room most weeks (2026-09-18).
- **Patch scripts go to the scratchpad through the Write tool**, then run with one plain command, whenever an anchor holds a backslash escape or a backtick. The Bash tool rewrites backslashes in inline heredocs before the shell sees them, and the script matches nothing (seen five times, 2026-07 to 2026-09). Inline heredocs are fine for short commands without either.
- **TaskStop does not stop a subagent's background shells** (2026-10-06): three stopped fix groups left loops that kept starting test runs and took 95% of the laptop. Briefs tell subagents to run tests in the foreground. After stopping one, run `npm run tests:stop` and end any shell still running its scratchpad scripts. Breadth work that runs for hours goes to sprout (`PC Automation/sprout/bin/footnotes-hunt.sh`), where each job is a cgroup that dies whole.
- **An orchestrator with `isolation: "worktree"` that fans out background children dirties its tree first** by writing a file, or runs without isolation. A clean worktree is auto-removed when its agent goes idle, and the children die with it (2026-07-16).
