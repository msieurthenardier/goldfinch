# Squawk 0004: repo declares MIT in package metadata but ships no LICENSE file

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-10
**Completed**: 2026-08-10

## Report

`package.json` declares `"license": "MIT"`, but there is no `LICENSE` file anywhere in the
repository. The metadata makes a licensing claim the repo does not substantiate: anyone
cloning it — or GitHub's own license detection — finds no license text and no copyright line.
For a public repo that is effectively unlicensed in practice, whatever the manifest says.

Nothing is broken at runtime; this is a missing standard repository file. Doing it now because
the repo is public and the claim has been unbacked since the initial commit.

## Evidence

The declared license, with no file backing it:

```
package.json:7 — "license": "MIT",
package.json:6 — "author": "msieurthenardier <msieurthenardier@gmail.com>",
```

```
$ ls | grep -iE 'licen|copying'
(no output)
$ grep -niE 'licen|copyright' README.md
(no matches)
```

Copyright year from the repo's first commit:

```
$ git log --reverse --format='%ad %s' --date=format:'%Y' | head -1
2026 Initial commit: Goldfinch browser
```

Blast radius confirmed to be the repo root only — electron-builder does not reference a
license file, and `files` packages just `src/**/*` and `package.json`, so no installer or
packaging behavior changes:

```
$ grep -n -i 'license' package.json          # single hit: line 7, the SPDX field
$ grep -n -A3 '"files"' package.json         # "src/**/*", "package.json"
```

## Corrective Action

Added a `LICENSE` file at the repo root containing the canonical, verbatim MIT License
text (OSI/SPDX `MIT` template), unmodified so SPDX/GitHub license detection matches it.
Copyright line reads `Copyright (c) 2026 msieurthenardier` — year from the first commit,
holder from `package.json`'s `author` field (email omitted per convention for copyright
lines). No other files touched: `package.json`'s existing `"license": "MIT"` was already
correct and needed no change, and the electron-builder config, `files` array, and README
were left alone as this is purely a missing standard repo file, not a packaging or docs
change.

## Verification

Confirmed `LICENSE` exists at repo root with the unmodified canonical MIT template
(compared clause-by-clause against the standard text: permission grant, the "as is"/"AS IS"
disclaimer, and liability limitation are all present verbatim, nothing paraphrased or
dropped).

```
$ npm test
...
# tests 3667
# suites 13
# pass 3667
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3732.834799
```

```
$ npm run lint
> goldfinch@0.13.4 lint
> eslint .
(no output — clean)
```

```
$ git status --short
?? LICENSE
?? missions/16-search-and-startup-choice/
?? squawks/0004-missing-license-file.md
```

Only `LICENSE` (new) and this squawk artifact changed; the untracked mission directory
(operator's unrelated in-progress work) was left untouched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementer's reasoning) —
one review round
**Verdict**: confirmed

Verified the LICENSE text clause by clause against the canonical OSI/SPDX `MIT` template:
permission grant complete including the full rights list and the "subject to the following
conditions" clause, copyright-notice-inclusion condition unaltered, warranty disclaimer
present in full ALL CAPS with the MERCHANTABILITY / FITNESS FOR A PARTICULAR PURPOSE /
NONINFRINGEMENT enumeration and the authors-and-copyright-holders liability sentence intact.
No paraphrasing, no added or omitted sentences, no leftover placeholders. Copyright line
carries no email, machine username, or absolute path. Confirmed `package.json` unmodified and
the change confined to `LICENSE` plus this artifact. Re-ran verification independently rather
than trusting the recorded output — 3667/3667 tests pass, lint clean, both matching.

**Commit**: `squawk/0004-missing-license-file`
