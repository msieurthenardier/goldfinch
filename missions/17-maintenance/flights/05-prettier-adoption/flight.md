# Flight: Prettier Adoption

**Status**: ready
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] Prettier is enforced in CI: `prettier --check .` is clean on `main` and runs in both CI definitions; the `renderer.js` line budget is re-based on the formatted size and both budgets still guard growth (criterion 7)

---

## Pre-Flight

### Objective

Land the one-time Prettier reformat of the whole tree under the existing
`.prettierrc`, re-base the two line-budget pins on the formatted sizes,
re-pin the twelve source-text matchers the reformat breaks (plus the budget pin), and wire
`format:check` into both CI definitions so drift fails the build from now
on. Escalated from [squawk 0039](../../../../squawks/0039-prettier-drift-not-enforced.md).

### Open Questions

- [x] Can `.prettierrc` be tuned so the reformat preserves the house style
      (one-line delegator bodies, compact import lists) and keeps
      `renderer.js` under its 1650 budget? → **No.** See DD1.
- [x] Accept defaults and re-base, or drop Prettier? → **Accept and re-base**
      (operator ruling 2026-08-27, option (b)). See DD1/DD2.
- [x] HAT leg? → No; gates only (operator, 2026-08-27).

### Design Decisions

**DD1 — Prettier's existing config stands; no tuning toward house style.**
Spike (2026-08-27, reverted, tree left clean): the current `.prettierrc` is
`{ singleQuote: true, trailingComma: "none", printWidth: 120 }`. Formatting
at `printWidth` 100 / 120 / 140 / 160 changes 355 / 318 / 321 / 325 files
and leaves `renderer.js` at 1871 / 1828 / 1787 / 1774 lines (`wc -l`; the
pin's metric is one higher — see DD2) with 16 / 13 /
13 / 12 failing pins — width is not the driver. `arrowParens: avoid`,
`bracketSameLine`, `quoteProps: preserve`, `objectWrap: collapse`,
`experimentalTernaries` and their combination all leave `renderer.js` at
1810–1828 (`wc -l`). The diff is Prettier's fixed opinions: one-line function bodies
(`function navigate(input) { return navigationController.navigate(input); }`)
always expand to three lines, and compact multi-symbol import / dependency
lists split one per line. There is no option for either.
- Rationale: the operator's "enforce" ruling can only be met by accepting
  Prettier's output; tuning was tried and measured.
- Trade-off: the one-liner delegator idiom in `renderer.js` (and the
  "fold onto an existing line to respect the budget" trick squawk 0020 used)
  is retired. Formatting becomes automatic.

**DD2 — Line budgets are re-based, not repealed — measured by the pin's own
metric.** `test/unit/seam-contract.test.js` counts
`source.split(/\r?\n/).length`, which is **one above `wc -l`** (this repo
recorded the same `wc -l`/split correction at the M15 F3 design review). By
that metric today: `renderer.js` = **1650** (exactly at budget — the
existing pin carries **zero headroom**), formatted = **1829**;
`bookmarks-bar.js` = 1040, formatted = 1077 (under its 1100 pin).
`RENDERER_LINE_BUDGET` 1650 → **1829** — the measured post-format count,
preserving today's zero-headroom policy rather than inventing a round
number; `BOOKMARKS_BAR_LINE_BUDGET` stays **1100**. Leg 1 re-measures both
on the actual formatted output with the pin's metric and records the pair
in the flight log; the pin's comment states the metric and the re-base
date.
- Rationale: the budgets guard growth of two files the project has ruled
  too large to keep growing; formatting inflation is a one-time step change,
  and the guard is exactly as tight afterwards as before (at budget).
- Trade-off: the absolute numbers lose comparability with pre-flight
  history; the flight log records the before/after pair.

**DD3 — Matcher fixes only; pins keep their teeth.** Twelve of the thirteen
failing assertions (Recon Report, flight log) are source-text matchers (the
thirteenth is the budget pin, DD2); they fall into three shapes, each with its
own fix rule — never a loosening of what is asserted:
1. *Literal-target `.replace()` mutation pins* (e.g.
   `tab-adopt-by-drop.test.js`: a four-line exact source literal, indentation
   included, guarded by `assertMutated`) — convert the target to a
   wrap-insensitive **regex** (`\s+` between tokens) rather than authoring a
   new exact literal that the next nearby edit will break; `assertMutated`
   already makes a stale target loud, so the conversion is safe.
2. *Slice-window pins that assert absence* (e.g. `tab-drag-invariants.test.js`:
   `indexOf(anchorA)` → `indexOf(anchorB)`, then `/\bawait\b/.test(body) ===
   false`) — a shifted anchor can narrow the window so the absence passes
   vacuously. Every absence assertion in a re-anchored window MUST keep or
   gain a **positive control** that the window still contains known code
   (`body.includes('dnd = null;')` is the existing example). This is the
   sweep's F7 rule ("positive controls on absence scans") applied.
3. *Single-token presence pins* — re-target to the token; prefer a short
   regex over a long literal.
Every fixed pin is neuter-verified after the fix: delete or invert the
guarded line → red; the flight log carries a per-pin table (pin · shape ·
fix · neuter result).
- Rationale: the sweep already flagged grep-shape tests as a liability; this
  flight must not make them vaguer.

**DD4 — Two PRs, one per leg, squash-merged; Leg 2 writes the real
blame-ignore sha.** History since 2026-07-19 is pure squash (one `(#NNN)`
commit on `main` per PR). Leg 1 (reformat + re-pin + re-base) lands as its
own PR; once merged, Leg 2 creates `.git-blame-ignore-revs` containing that
squash sha (no placeholder, no follow-up squawk), wires the CI gate, and
adds the CLAUDE.md note on `git config blame.ignoreRevsFile
.git-blame-ignore-revs`. This deviates from the flight-level single-commit
default deliberately; the flight log records both PR numbers.
- Rationale: the sha must be real, and it only exists after the Leg 1 merge.
- Trade-off: a short window where `main` is formatted but ungated — no
  other branch is open, so nothing can drift in that window.

**DD5 — CI gate lives in both definitions, mirrored, inside the existing
lint task.** Add `"format:check": "prettier --check ."` to `package.json`
and call it after `npm run lint` inside `ci/tasks/lint.yml`'s single
`run:` block (Concourse — the live gate; `ci/pipeline.yml` loads the task
as `file: repo/ci/tasks/lint.yml` from the git resource, so an edited task
takes effect on the next push with **no `set-pipeline`**) and in the "Lint"
step of `.github/workflows/ci.yml` (`workflow_dispatch`-only). Update the
two artifacts that describe the task: `ci/tasks/lint.yml`'s header comment
("ESLint over the repo — mirrors …") and `ci/README.md`'s "What runs where"
row for Lint. `.prettierignore` is unchanged — the spike confirmed it
already excludes the generated bundle (so the `pretest` preload rebuild
cannot dirty the check), the lockfile, `*.md`, `missions/`, `maintenance/`,
`tests/`; `prettier --check .` never visits files with no inferred
parser (e.g. `public_suffix_list.dat`) on directory expansion, so the vendored
data cannot fail the check. `eslint-config-prettier`
is applied last in `eslint.config.mjs`, so lint will not fight the reformat.
- Rationale: one task, one signal, no pipeline re-set; the header comment's
  mirror claim stays true.
- Alternative rejected: a separate `format` task in `pipeline.yml` — clearer
  signal but requires `./ci/set-pipeline.sh`.

### Prerequisites

- [x] Squawk 0039 escalation record (the pin list) — verified live by the
      spike at the flight's base commit
- [x] Local `node_modules` resynced to the lockfile (`electron@43.4.1`,
      2026-08-27) so the suite runs against the pinned toolchain
- [x] Prettier 3.9.6 installed (devDependency)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

**Leg 1 — format and re-pin.** `npm run format` on a clean tree at the
flight's base commit (318 files expected; count recorded). Then
`timeout 300 npm test`; fix exactly the failing pins per DD3, one at a time,
with the neuter check on each. Re-base the two budgets per DD2 on the
measured sizes. Exit criteria: `npx prettier --check .` clean, suite green
with the pre-flight test count unchanged (3792 at base; no test added or
removed — pins are re-targeted, not rewritten), lint and typecheck clean.
Known pins from the Recon Report (line numbers there are **post-format
addresses** — locate each by its `test(...)` title from the failing-test
output, not by line): `cert-picker-template`, `move-authority`,
`move-tab-synchrony`, `seam-contract` (the budget pin — DD2, not a matcher), `search-engines`,
`session-restore-wiring`, `sheet-automation-gate-invariant`,
`tab-adopt-by-drop` (3), `tab-drag-invariants` (3). If the reformat surfaces
a pin outside this list, fix it the same way and note it in the log; if any
pin cannot be re-targeted without weakening it, stop and raise it at flight
review rather than loosening. Leg 1 ends with its own PR (DD4).

**Leg 2 — CI gate, blame-ignore, docs** (starts after Leg 1's PR is merged).
`package.json` `format:check` script; both CI definitions per DD5 plus the
`lint.yml` header comment and the `ci/README.md` row; `.git-blame-ignore-revs`
created with a header comment and Leg 1's squash sha (DD4); CLAUDE.md
`## Commands` gains `format` / `format:check` and the
`git config blame.ignoreRevsFile .git-blame-ignore-revs` line; CLAUDE.md
currently has **no** line-budget or formatting note (grep-verified), so Leg 2
**adds** a short Patterns entry: formatting is Prettier's (run `npm run
format`), the two line budgets are pinned in `seam-contract.test.js` and
measured by `split(/\r?\n/).length` on formatted output, and the retired
"fold onto one line to fit the budget" trick must not come back. Exit
criteria: `npm run format:check` exits 0 locally; both CI files reference
it; `fly -t local-goldfinch execute -c ci/tasks/lint.yml -i repo=.` (or the
project's equivalent per `ci/README.md`) passes as the primary evidence,
with a `workflow_dispatch` of `ci.yml` as secondary; `npm run
lint`/typecheck/test green.

### Checkpoints

- [ ] CP1: `npx prettier --check .` clean; formatted-file count and the
      two post-format line counts recorded in the flight log
- [ ] CP2: suite green at the pre-flight test count; every re-targeted pin
      neuter-verified (log lists each with its neuter result)
- [ ] CP3 (after Leg 1's PR merges): `format:check` wired in both CI
      definitions and passing in a Concourse task run; `ci/tasks/lint.yml`
      header, `ci/README.md` row, CLAUDE.md Commands + Patterns updated;
      `.git-blame-ignore-revs` carries Leg 1's squash sha

### Adaptation Criteria

**Divert if**: a pin cannot be re-targeted without weakening it (raise at
flight review — the answer may be to replace that grep-shape pin with a
behavioral test, which is Mission 17 Flight 6 (DOM harness) territory, not this flight).

**Acceptable variations**: the measured post-format counts differing from
DD2's 1829 / 1077 by a few lines (the budget is whatever Leg 1 measures with
the pin's metric); a pin outside the Recon list needing the same treatment.

### Legs

- [ ] `format-and-repin` - the reformat, the thirteen matcher fixes, the two
      budget re-bases; all gates green
- [ ] `ci-format-gate` - `format:check` script, both CI definitions,
      `.git-blame-ignore-revs` scaffold, CLAUDE.md / docs

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Both PR numbers recorded in the flight log; `.git-blame-ignore-revs`
      holds Leg 1's squash sha (DD4)
- [ ] Squawk 0039 disposition annotated with the landing PRs

### Verification

No behavior test — nothing observable in the running app changes. Gates:
`npx prettier --check .` clean on the merged `main`; `npm test` green at the
pre-flight count; `npm run lint` and `npm run typecheck` clean; a Concourse
run of the lint task (primary — it is the live gate) and a
`workflow_dispatch` of `ci.yml` (secondary) show `format:check` executing
and passing; the flight log's per-pin table shows every re-targeted pin
going red when its guarded line is removed and every absence assertion
keeping a positive control.
