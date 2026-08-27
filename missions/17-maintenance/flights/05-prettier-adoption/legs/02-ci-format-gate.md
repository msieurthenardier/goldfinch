# Leg: ci-format-gate

**Status**: completed
**Flight**: [Prettier Adoption](../flight.md)

## Objective

Make formatting drift fail the build — `format:check` in both CI definitions — and record Leg 1's reformat in `.git-blame-ignore-revs` and the docs, so the Prettier adoption is enforced and discoverable from now on.

## Context

- Leg 1 landed as PR #182, squash sha **`339e808f229d342c114467d0142499d8cffc3eb7`** — that is the sha this leg records (DD4). `main` is Prettier-clean (`npx prettier --check .` → "All matched files use Prettier code style!").
- DD5: the gate goes *inside* the existing Concourse lint task (`ci/tasks/lint.yml` — single `run:` block, `bash -ceu` heredoc: `npm ci` then `npm run lint`) and in the "Lint" step of `.github/workflows/ci.yml` (`:47-48`, `run: npm run lint`). `ci/pipeline.yml` loads the task as `file: repo/ci/tasks/lint.yml` from the git resource, so **no `set-pipeline`** is needed. Two describing artifacts must stay true: `ci/tasks/lint.yml`'s header comment (`# ESLint over the repo — mirrors the GitHub Actions "Lint" step (ci.yml).`) and `ci/README.md:14` (`| Lint | tasks/lint.yml | "Lint" |` in "What runs where").
- CLAUDE.md has **no** Prettier/format/budget/blame note (grep-verified); `## Commands` lists the npm scripts. Two Patterns bullets mention "line-budget" incidentally (bookmarks client, bar) — leave them.
- `package.json` scripts: `"lint": "eslint ."`, `"format": "prettier --write ."` — no `format:check`.
- Budgets after Leg 1: `RENDERER_LINE_BUDGET` 1827, `BOOKMARKS_BAR_LINE_BUDGET` 1100, both in `test/unit/seam-contract.test.js`, metric `split(/\r?\n/).length`.

## Inputs

- Clean tree on `flight/05-prettier-adoption` at `main` `339e808`.
- Test count 3839; all gates green.

## Outputs

- `package.json`: `"format:check": "prettier --check ."` beside `format`.
- `ci/tasks/lint.yml`: `npm run format:check` after `npm run lint` in the same `run:` block; header comment updated to say ESLint + Prettier check, mirrors the "Lint" step.
- `.github/workflows/ci.yml`: the Lint step runs `npm run lint` then `npm run format:check` (two `run` lines in one step, or a second step named "Format check" — pick the shape that keeps the Concourse mirror claim true; document the choice in the flight log).
- `ci/README.md`: the Lint row says lint + format check; the `fly execute` example line unchanged (it already runs the whole task).
- `.git-blame-ignore-revs` (new, repo root): a header comment explaining the file and the `git config blame.ignoreRevsFile .git-blame-ignore-revs` setup, then the line `339e808f229d342c114467d0142499d8cffc3eb7` with a trailing comment `# flight/05 leg 1 — Prettier reformat (#182)`.
- CLAUDE.md: `## Commands` gains `npm run format` (write) and `npm run format:check` (CI gate) and one line for the blame-ignore config; `## Patterns` gains one new bullet — formatting is Prettier's (`.prettierrc`; run `npm run format` before committing; CI fails on drift); the two line budgets are pinned in `test/unit/seam-contract.test.js` and measured by `split(/\r?\n/).length` on Prettier-formatted output (`renderer.js` 1827, `bookmarks-bar.js` 1100 as of 2026-08-27); the old "fold onto one line to fit the budget" trick is retired — a file at budget needs an extraction, not a compaction.
- `docs/dev-testing.md` (or wherever the lint/CI gates are described for developers): one sentence pointing at `npm run format` / `format:check`.
- Flight log leg entry; this leg's status `landed`.

## Acceptance Criteria

- [x] AC1: `npm run format:check` exists and exits 0 on the branch.
- [x] AC2: `ci/tasks/lint.yml` runs `npm run format:check` after `npm run lint`; its header comment is accurate; `ci/README.md`'s Lint row is accurate.
- [x] AC3: `.github/workflows/ci.yml` runs `npm run format:check` in (or immediately after) the Lint step; the YAML is valid (`node -e` with a YAML parser is not available — validate with `npx --yes yaml` only if present, else by careful review and `git diff`).
- [x] AC4: `.git-blame-ignore-revs` exists, contains exactly the Leg 1 squash sha `339e808f229d342c114467d0142499d8cffc3eb7`, and `git blame --ignore-revs-file .git-blame-ignore-revs src/renderer/renderer.js | head` attributes the delegator lines to their pre-reformat commits, not to `339e808`.
- [x] AC5: CLAUDE.md `## Commands` and `## Patterns` carry the additions above; `docs/dev-testing.md` (or the equivalent) carries the one sentence.
- [x] AC6: Concourse task run passes — `fly -t local-goldfinch execute -c ci/tasks/lint.yml -i repo=.` (per `ci/README.md`) — OR, if `fly`/the target is not available in this environment, the exact commands the task runs (`npm ci` is skipped; `npm run lint && npm run format:check`) pass locally and the log records that the Concourse run is deferred to the operator. (`fly` present, `local-goldfinch` target configured, but the Concourse server was unreachable — timeout, not a login/config gap; deferred to operator per the fallback path.)
- [x] AC7: `npm test` 3839/3839, `npm run lint`, `npm run typecheck`, `npx prettier --check .` all clean; the new/edited files themselves are Prettier-clean.

## Verification Steps

- AC1: `npm run format:check; echo $?` → 0.
- AC2: `grep -n 'format:check' ci/tasks/lint.yml ci/README.md`; read the header comment.
- AC3: `grep -n -A3 'name: Lint' .github/workflows/ci.yml`.
- AC4: `cat .git-blame-ignore-revs`; the `git blame --ignore-revs-file` command above vs. `git blame src/renderer/renderer.js | head` without it — the ignored version should not show `339e808`.
- AC5: `grep -n -E 'format:check|blame.ignoreRevsFile|split\(/\\r\?\\n/\)' CLAUDE.md`; `grep -n format docs/dev-testing.md`.
- AC6: run `fly` if available (`which fly`, `fly targets`); otherwise run the task's commands locally and record the deferral.
- AC7: the four gates.

## Implementation Guidance

1. **Script.** Add `format:check` to `package.json` scripts, adjacent to `format`. Keep `package.json` Prettier-clean (`npx prettier --check package.json`).
2. **Concourse.** In `ci/tasks/lint.yml`, append `npm run format:check` as the last line of the heredoc. Rewrite the header comment: "ESLint + Prettier check over the repo — mirrors the GitHub Actions "Lint" step (ci.yml)." Do not touch `ci/pipeline.yml` or other tasks.
3. **GitHub Actions.** In `.github/workflows/ci.yml`, extend the Lint step to a multi-line `run: |` with both commands (keeps the step count and the mirror claim), unless the file's existing steps all use single-line `run:` and a separate "Format check" step reads cleaner — either is acceptable; say which in the log.
4. **README row.** `ci/README.md:14` → `| Lint | tasks/lint.yml | "Lint" (ESLint + Prettier check) |` or equivalent wording matching the table's style.
5. **Blame-ignore.** Create `.git-blame-ignore-revs` with a 3–4 line header comment (`#` lines: purpose; the `git config blame.ignoreRevsFile .git-blame-ignore-revs` one-liner) and the sha line. Verify with the `git blame` comparison in AC4.
6. **CLAUDE.md.** Commands: add the two scripts and the blame config line in the existing list's style. Patterns: one bullet in the style of the neighbours (dense, factual, cites the file); place it near the structural-test / line-budget prose if there's a natural neighbour, else at the end of the section.
7. **docs/dev-testing.md.** One sentence in the section that describes running lint/tests locally.
8. **Gates + artifacts.** AC7 gates; flight-log leg entry (files changed, the CI step shape chosen, the AC6 disposition, the `git blame` before/after evidence — two short lines); leg → `landed`. Do not commit.

## Edge Cases

- **`fly` not installed or target missing**: do not install or log in; run the task's commands locally and record "Concourse run deferred to operator" in the log (AC6 alternative).
- **`git blame --ignore-revs-file` still shows `339e808` for some lines**: expected for lines the reformat *created* (e.g. new `}` lines from expanded function bodies); the check is that lines whose *content* predates the reformat attribute to older commits. Record a two-line example.
- **A Prettier-check failure on a file this leg creates**: format it with `npx prettier --write <that file>` only.

## Files Affected

- `package.json` — one script.
- `ci/tasks/lint.yml`, `.github/workflows/ci.yml`, `ci/README.md` — gate wiring + descriptions.
- `.git-blame-ignore-revs` — new.
- `CLAUDE.md`, `docs/dev-testing.md` — docs.
- Flight log; this leg artifact.

## Citation Audit

2026-08-27 (FD, on `main` `339e808`): `package.json:19-20` scripts `lint`/`format` present, no `format:check`; `ci/tasks/lint.yml` header comment line 2 as quoted; `.github/workflows/ci.yml:47-48` Lint step as quoted; `ci/README.md:14` row and `:30` fly line as quoted; CLAUDE.md grep for `prettier|format|budget|blame` → only two incidental "line-budget" mentions in Patterns bullets; `.git-blame-ignore-revs` absent; Leg 1 squash sha from `git rev-parse HEAD` after merging #182.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight:
  - [x] Update flight.md status to `landed`
  - [x] Check off flight in mission.md
- [x] Commit all changes together (code + artifacts)
