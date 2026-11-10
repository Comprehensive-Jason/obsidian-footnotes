# Third-party licences

`main.js` is a bundle. Besides this plugin's own code (see `LICENSE`), it holds the packages below, all under the MIT License. This file carries their notices, so that `main.js` can point here.

## The packages in `main.js`

Each row was checked on 2026-11-10 in the package's own published files, for remark-obsidian 2.2.1. Some packages come from this plugin's own `node_modules`, at the versions its `package-lock.json` pins; the rest are bundled inside remark-obsidian's `dist/index.js`, at the versions remark-obsidian's own `package-lock.json` pins for v2.2.1. A package in both places shows both versions when they differ. `format` has no `license` field in its `package.json`: it uses the older `licenses` list, and it says MIT there, in its readme, and at the top of its source.

| Package | Version | Licence | Copyright |
| --- | --- | --- | --- |
| `@quartz-community/remark-obsidian` | 2.2.1 | MIT | Copyright (c) 2026 Quartz Community |
| `bail` | 2.0.2 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `character-entities` | 2.0.2 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `character-entities-legacy` | 3.0.0 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `decode-named-character-reference` | 1.3.0 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `devlop` | 1.1.0 | MIT | Copyright (c) 2023 Titus Wormer <tituswormer@gmail.com> |
| `escape-string-regexp` | 5.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| `extend` | 3.0.2 | MIT | Copyright (c) 2014 Stefan Thomas |
| `fault` | 2.0.1 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `format` | 0.2.2 | MIT | Copyright 2010 - 2014 Sami Samhuri sami@samhuri.net |
| `is-plain-obj` | 4.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| `longest-streak` | 3.1.0 | MIT | Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com> |
| `mdast-util-frontmatter` | 2.0.1 | MIT | Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com> |
| `mdast-util-math` | 3.0.0 | MIT | Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com> |
| `mdast-util-phrasing` | 4.1.0 | MIT | Copyright (c) 2017 Titus Wormer <tituswormer@gmail.com> |
| `mdast-util-to-markdown` | 2.2.3 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `mdast-util-to-string` | 4.0.0 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `micromark-core-commonmark` | 2.0.4 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-extension-frontmatter` | 2.0.0 | MIT | Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com> |
| `micromark-extension-math` | 3.1.0 | MIT | Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com> |
| `micromark-factory-space` | 2.1.0 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-character` | 2.1.1 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-classify-character` | 2.0.1 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-decode-numeric-character-reference` | 2.0.2 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-decode-string` | 2.0.1 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-html-tag-name` | 2.0.1 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-normalize-identifier` | 2.0.1 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `micromark-util-symbol` | 2.0.1 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |
| `trough` | 2.2.0 | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> |
| `unified` | 11.0.5 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `unist-util-is` | 6.0.1 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `unist-util-stringify-position` | 4.0.0 | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> |
| `unist-util-visit` | 5.1.0 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `unist-util-visit-parents` | 6.0.2 | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> |
| `vfile` | 6.0.3 | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> |
| `vfile-message` | 4.0.3 | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> |

Each is under this text, with its own copyright line above:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `@quartz-community/remark-obsidian` 2.2.1: its `LICENSE`, as published

```

MIT License

Copyright (c) 2026 Quartz Community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `@quartz-community/remark-obsidian` 2.2.1: its `LICENSE-THIRD-PARTY.md`, as published

Everything below this line is that file, word for word.

---

# Third-party licences

## obsidian-footnotes

Two things come from
[`obsidian-footnotes`](https://github.com/Comprehensive-Jason/obsidian-footnotes),
both contributed for this purpose.

`test/parity/corpus-hunt.ts` holds structural markdown fixtures harvested from that
project's `test/hunt/` regression pins. They cover block-structure edges a generated
corpus does not reach.

`test/parity/referee-answers/` is its `test/obsidian-answers/` directory vendored
verbatim — 6,818 documents with the `metadataCache` answers real Obsidian gave for
each. This IS that project's recorded measurement, not just its inputs, and it is
what `referee.mts` and eight sibling instruments compare against. Kept
byte-identical (see `.prettierignore`) so a diff against upstream shows answers
changing and nothing else. The only local change is that `refsTrustworthy` is
populated where upstream leaves it `null`, written by `recorder.mts`.

None of that is published to npm; `package.json` ships `dist` only.

A third thing IS published. `src/rp8/reader.ts`, the `legacy` preset's parser, ports the
Obsidian readers of that project's `src/parsing/obsidian-markdown.ts` -- `%%` comments, callout
titles, table pipe styles, wikilinks, frontmatter, `$$` inline math -- and `src/rp8/list.ts`
follows its `remark-parse-list.js` in changing remark-parse 8's list reader. Both are bundled
into `dist`, under this licence.

```
MIT License

Copyright (c) 2021-2026 Alexis Rondeau, Micha Brugger, Jason Qin, and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## micromark-extension-math

`src/lib/syntax/math-text.ts` is adapted from
[`micromark-extension-math`](https://github.com/micromark/micromark-extension-math).
Its tokenizer and resolver were vendored so Obsidian's inline-math rules could be
implemented directly; see the file header for the specific divergences.

```
(The MIT License)

Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## micromark-extension-gfm-footnote

`src/lib/syntax/footnote.ts` is vendored from
[`micromark-extension-gfm-footnote`](https://github.com/micromark/micromark-extension-gfm-footnote)
2.1.0, the footnote syntax `remark-gfm` registers. `strict` uses it in place of upstream's with
Obsidian's label rule -- a `[` may sit inside a label and a backslash escapes nothing; the file
header has the details.

```
(The MIT License)

Copyright (c) 2021 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## remark-parse 8 and its companions

`src/rp8/vendor/` vendors remark-parse 8.0.3, remark-footnotes 2.0.0, remark-math 3.0.1 and
parse-entities 2.0.0 with the v1 entity tables, converted to ESM; `src/rp8/vendor/helpers.ts`
rewrites the small packages they required (trim, repeat-string, xtend, is-whitespace-character,
is-word-character, is-decimal, is-alphabetical, is-hexadecimal, is-alphanumerical,
trim-trailing-lines, collapse-white-space, ccount, state-toggle, markdown-escapes, vfile-location,
unist-util-remove-position). `src/rp8/list.ts` and `src/rp8/remove-indentation.ts` are
remark-parse 8 files with Obsidian's changes. All are bundled into `dist`. Each is MIT:

- remark-parse 8.0.3 -- Copyright (c) 2014-2020 Titus Wormer <tituswormer@gmail.com>;
  Copyright (c) 2011-2014, Christopher Jeffrey (https://github.com/chjj/)
- remark-footnotes 2.0.0 -- Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>
- remark-math 3.0.1 -- Junyoung Choi <fluke8259@gmail.com> (its `package.json`; the published
  tarball carries no licence file)
- parse-entities 2.0.0 -- Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com>
- character-entities 1.2.4, character-entities-legacy 1.1.4, character-reference-invalid 1.1.4
  -- Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com>
- the helper packages above: vfile-location, state-toggle, ccount, markdown-escapes and the
  is-* predicates follow Titus Wormer's MIT sources closely; trim, repeat-string and xtend are
  replaced by `String.prototype.trim`, `String.prototype.repeat` and a plain property copy, so
  no code of theirs is included

```
(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## npm packages bundled into `dist`

esbuild bundles these from `node_modules` into `dist/index.js`, at the versions
`package-lock.json` pins. They are separate from the vendored `character-entities` 1.x and
`micromark-extension-math` source above: `dist` holds both. Each is MIT:

- `character-entities`, `character-entities-legacy`, `fault`, `mdast-util-to-string`,
  `unist-util-is` -- Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com>
- `longest-streak` -- Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com>
- `unist-util-visit-parents` -- Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>
- `mdast-util-frontmatter`, `mdast-util-math`, `micromark-extension-frontmatter`,
  `micromark-extension-math` -- Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>
- `devlop` -- Copyright (c) 2023 Titus Wormer <tituswormer@gmail.com>
- `decode-named-character-reference`, `micromark-core-commonmark`, `micromark-factory-space`,
  `micromark-util-character`,
  `micromark-util-decode-numeric-character-reference`, `micromark-util-decode-string`,
  `micromark-util-normalize-identifier`, `micromark-util-symbol` -- Copyright (c) Titus Wormer
  <tituswormer@gmail.com>
- `escape-string-regexp` -- Copyright (c) Sindre Sorhus <sindresorhus@gmail.com>
  (https://sindresorhus.com)
- `format` -- Copyright 2010 - 2014 Sami Samhuri <sami@samhuri.net> (from its `Readme.md`, which
  links the MIT licence, as do `format.js`' header and `package.json`. The 0.2.2 tarball carries no
  licence file; the upstream repository's `License.md`, added later, is MIT from the same holder)

```
(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
