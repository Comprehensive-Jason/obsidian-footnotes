# Contributing

Thanks for your interest in improving Footnote Shortcut! Bug reports, feature
ideas, and pull requests are all welcome.

## Reporting bugs

Open an issue at
[github.com/Comprehensive-Jason/obsidian-footnotes/issues](https://github.com/Comprehensive-Jason/obsidian-footnotes/issues)
with:

- what you did (the command/hotkey and where your cursor was)
- what you expected, and what happened instead
- a minimal snippet of Markdown that reproduces it, if you can

A note on how fixes land here: **every reported bug gets pinned by a failing
test before the fix** (see [TESTING.md](TESTING.md)). A crisp reproduction in
the issue makes that test, and therefore the fix, much faster to write.

## Development setup

```bash
git clone https://github.com/Comprehensive-Jason/obsidian-footnotes.git
cd obsidian-footnotes
npm install
npm run dev    # esbuild watch mode, rebuilds main.js on save
```

To try your build in Obsidian, copy (or symlink/clone) the plugin folder into
a **test vault** at `<vault>/.obsidian/plugins/obsidian-footnotes/` and enable
it in Settings → Community plugins. The
[hot-reload](https://github.com/pjeby/hot-reload) plugin picks up rebuilds
automatically. Please don't develop against a vault you care about.

## Checks

| Command | What it runs |
| --- | --- |
| `npm run build` | TypeScript type-check + production bundle |
| `npm run lint` | ESLint (including `eslint-plugin-obsidianmd`) |
| `npm test` | Vitest unit tests |
| `npm run test:smoke` | Integration tests against a live Obsidian instance |

CI runs lint, the unit tests, and the build on every push and PR (and the
release workflow gates on the same three), so run them locally before
opening a PR. Smoke tests need a running Obsidian with a
sandbox vault — see [TESTING.md](TESTING.md) for the setup; if you can't run
them, say so in the PR and they'll be run for you.

## Pull requests

- Keep each PR to one logical change.
- Add or update tests for behavior changes — unit tests for pure logic,
  smoke tests for anything that touches the live editor or undocumented
  Obsidian internals (see the standing rules in [TESTING.md](TESTING.md)).
- Match the surrounding code style; `npm run lint` is the arbiter.
- Don't bump the version in `manifest.json`/`versions.json` — that happens
  as part of the release process.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers the project.
