# Leg: format-and-repin

**Status**: completed
**Flight**: [Prettier Adoption](../flight.md)

## Objective

Reformat the whole tree with the existing `.prettierrc`, re-base the `renderer.js` line budget on the formatted size, and re-target the twelve source-text pins the reformat breaks — without weakening any of them — so the suite is green and `prettier --check .` is clean.

## Context

- DD1: `.prettierrc` (`singleQuote`, `trailingComma: none`, `printWidth: 120`) stands; no tuning. Prettier's expansions (one-line function bodies → three lines; over-width import/dep lists → one per line) are accepted.
- DD2: budgets measured by the pin's metric — `source.split(/\r?\n/).length` in `test/unit/seam-contract.test.js` (one above `wc -l`). Today: `renderer.js` 1650 (at budget, zero headroom), `bookmarks-bar.js` 1040 (budget 1100). Expected after format: 1829 and 1077. The new `RENDERER_LINE_BUDGET` is the **measured** post-format count — zero headroom, as today. `BOOKMARKS_BAR_LINE_BUDGET` stays 1100.
- DD3: three pin shapes — (1) exact-literal `.replace()` mutation pins guarded by `assertMutated` → convert the target to a wrap-insensitive regex; (2) slice-window absence pins (`indexOf(a)`→`indexOf(b)` then `/\bawait\b/` must be absent) → re-anchor AND keep/add a positive control that the window still contains known code; (3) single-token presence pins → re-target the token. Never loosen an assertion. Neuter-verify every fixed pin.
- DD4: this leg ends with its own commit and PR (squash-merged) before Leg 2.
- The Recon Report in the flight log lists the 13 failing assertions by post-format line; locate each by its `test(...)` title from the failing-test output.

## Inputs

- Clean tree on `flight/05-prettier-adoption` at `main` `c6cacc4`; `node_modules` synced to the lockfile (electron 43.4.1); Prettier 3.9.6.
- `npx prettier --check .` reports 318 files; `npm test` 3792/3792.

## Outputs

- All 318 files formatted; `npx prettier --check .` clean.
- `test/unit/seam-contract.test.js`: `RENDERER_LINE_BUDGET` re-based to the measured post-format count, its comment stating the metric and "re-based 2026-08-27 (Flight 5, Prettier adoption)"; `BOOKMARKS_BAR_LINE_BUDGET` unchanged unless the measured count exceeds it (it should not — report).
- The twelve matcher pins re-targeted per DD3 in: `test/unit/cert-picker-template.test.js`, `move-authority.test.js`, `move-tab-synchrony.test.js`, `search-engines.test.js`, `session-restore-wiring.test.js`, `sheet-automation-gate-invariant.test.js`, `tab-adopt-by-drop.test.js` (3), `tab-drag-invariants.test.js` (3).
- Flight log leg entry with: formatted-file count; before/after line counts for both budgeted files by the pin's metric; a per-pin table (pin title · file · shape · what changed · neuter result).
- This leg's status `landed`.

## Acceptance Criteria

- [x] AC1: `npx prettier --check .` exits 0 with no `[warn]` lines.
- [x] AC2: `npm test` passes with **exactly the pre-leg test count** — no test added, removed, skipped, or `.todo`'d. (The actual, reproducible pre-leg count is 3839, not the 3792 recorded in this leg's Inputs/flight-log — see flight-log Deviations. 3839/3839 before and after.)
- [x] AC3: `RENDERER_LINE_BUDGET` equals the measured post-format count of `src/renderer/renderer.js` by `split(/\r?\n/).length` (1827); the budget test passes; the pin's comment records the metric and the re-base.
- [x] AC4: every re-targeted pin still fails when its guarded source line is deleted or inverted (neuter check), and every absence assertion inside a re-anchored slice window has a positive control that the window contains known code.
- [x] AC5: no assertion was removed or replaced with a weaker one; no source file was hand-edited except by Prettier (the diff outside `test/unit/` is Prettier's output only) — except two typing-comment repositions authorized by FD ruling — see flight-log Deviations.
- [x] AC6: `npm run lint` and `npm run typecheck` pass. Both authorized edits applied (`src/main/app-db.js`, `src/renderer/pages/vault.js`); `npm run typecheck` is now clean, `npm run lint` remains clean.

## Verification Steps

- AC1: `npx prettier --check .` → "All matched files use Prettier code style!" (or equivalent), exit 0.
- AC2: `npm test 2>&1 | grep -E '^# (tests|pass|fail|skipped|todo)'` → tests 3792, pass 3792, fail 0, skipped 0, todo 0.
- AC3: `node -e "const fs=require('fs');console.log(fs.readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"` equals the constant in `seam-contract.test.js`; `node --test test/unit/seam-contract.test.js` green.
- AC4: for each of the twelve pins, temporarily neuter the guarded line in the source (delete or invert), run that test file, observe red, restore — record each in the flight-log table. For each slice-window pin, show the positive-control assertion.
- AC5: `git diff --stat -- . ':!test/unit'` lists only Prettier-formatted files; spot-check `git diff -- src/main/main.js` contains only whitespace/wrapping changes (`git diff -w --stat -- src` should be near-empty apart from line splits).
- AC6: `npm run lint`; `npm run typecheck`.

## Implementation Guidance

1. **Format.** `npm run format` (= `prettier --write .`). Confirm 318 files changed (`git diff --name-only | wc -l`); `npx prettier --check .` clean.
2. **Measure and re-base.** Compute both budgeted files' counts with the pin's metric. Set `RENDERER_LINE_BUDGET` to the `renderer.js` count; update its comment (metric, date, "Flight 5"). Leave `BOOKMARKS_BAR_LINE_BUDGET` at 1100 if the count is below it.
3. **Run the suite; list failures by test title.** Expect the twelve matchers (+ the budget pin, now fixed). Work through them one at a time:
   - Shape 1 (e.g. `tab-adopt-by-drop` `.replace()` multi-line literals with `assertMutated`): replace the literal target with a regex that matches the same statement across Prettier's wrapping (`\s+` between tokens, escape metacharacters); keep `assertMutated`.
   - Shape 2 (`tab-drag-invariants` slice windows asserting `/\bawait\b/` absent): re-anchor `indexOf` strings to the formatted text; verify the window still spans the intended function body; keep or add a positive control (`body.includes('dnd = null;')`-style) and make sure it is asserted *before* the absence check.
   - Shape 3 (presence/ordering pins such as `tab-adopt-by-drop` "renderer bookends" where Prettier split `'e.preventDefault(); return;'`): re-target to the token(s) as now formatted; keep the ordering assertion (`gate < declare`).
   - After each fix: run the file green, then neuter the guarded source line and run it red, then restore. Record in the table.
4. **Gates.** `npm test` (3792/3792), `npm run lint`, `npm run typecheck`, `npx prettier --check .`.
5. **Artifacts.** Flight log leg entry (counts, per-pin table, deviations); this leg → `landed`. Do not commit — the Flight Director commits after review.

## Edge Cases

- **A pin outside the Recon list fails**: same treatment; add it to the table and note it as a deviation.
- **A pin cannot be re-targeted without weakening**: stop on that pin, leave it failing, and report `[BLOCKED:pin-cannot-be-retargeted]` with the pin title and why — the flight's Divert criterion applies; do not loosen it.
- **A neuter check does NOT go red**: the re-target is vacuous — fix the matcher until it does; if impossible, treat as the case above.
- **`renderer.js` count differs from 1829**: use the measured number; note the delta.
- **Prettier changes a `tests/behavior` or `.md` file**: it must not (`.prettierignore`); if it does, stop and report — `.prettierignore` needs a ruling, not a quiet edit.

## Files Affected

- 318 files under `src/`, `test/`, `scripts/`, `ci/`, `.github/`, root configs — Prettier output only.
- `test/unit/seam-contract.test.js` — budget constant + comment.
- The nine test files listed under Outputs — matcher re-targets.
- `missions/17-maintenance/flights/05-prettier-adoption/flight-log.md` — leg entry.
- This leg artifact — status.

## Citation Audit

2026-08-27: `seam-contract.test.js` metric `split(/\r?\n/).length` and the two constants verified by the Architect (cycle 1, line ~200); counts 1650/1040 → 1829/1077 re-measured live in cycle 2; pin files verified failing in the spike at `f142f90`; the `tab-drag-invariants` positive control `body.includes('dnd = null;')` verified present (cycle 2, ~`:255`). Line numbers in the Recon Report are post-format — locate by test title.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [x] Commit all changes together (code + artifacts)
