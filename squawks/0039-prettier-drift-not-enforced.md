# Squawk 0039: Prettier drift on 315 files; `prettier --check` not enforced in CI

**Status**: escalated
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

`npx prettier --check .` flags 315 files (289 `.js`, 8 yml, 6 html, 5 mjs, 5 css, 2 ts); `ci/tasks/lint.yml` only mirrors ESLint, so the formatter has drifted into a decorative script. Operator ruling 2026-08-27: **enforce**. Two steps in one squawk: (1) a single formatting-only commit (`npm run format`), then (2) add `npx prettier --check .` to the CI lint task (`ci/tasks/lint.yml`, and `.github/workflows/ci.yml` if it runs lint) so drift fails the build. Watch item for the Developer: 17 unit-test files read source text (grep-shape structural pins, e.g. `test/unit/search-engines.test.js`, `homepage-literal-scan.test.js`); reformatting can move or rewrap the lines they match. Run the suite after formatting; if a pin breaks, fix the pin's matcher — not the formatting — and if more than a handful break, stop and escalate rather than hand-editing pins. Review `.prettierignore` first so generated files (the preload bundle) and vendored data stay excluded.

Source: maintenance report 2026-08-27, finding F41; operator decision 2026-08-27.

## Evidence

- `npx prettier --check .` (2026-08-27) — 315 files
- `ci/tasks/lint.yml` — ESLint only; `.prettierrc`, `.prettierignore` present at repo root

## Corrective Action

*(not completed — escalated; see Disposition)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —

## Disposition

**Escalated** (2026-08-27) — failed qualification criteria 2 (no design decisions) and 3 (bounded blast radius).

A Developer ran `npm run format` on merged main `c1a6695`: all 318 files formatted cleanly, but the suite then failed 13 assertions across 9 test files, and the tree was reverted without changes:

- `test/unit/seam-contract.test.js:198` — `RENDERER_LINE_BUDGET`: `renderer.js` goes **1650 → 1827 lines** under Prettier (by `wc -l`; 1650 → 1829 by the budget pin's own `split` metric — corrected at flight design). The line budget is a house rule (Mission 16 debrief; squawk 0025 added a second one for `bookmarks-bar.js`), so "reformat everything" silently repeals it. That is the design decision.
- Mutation-testing pins whose `.replace()` target literal no longer matches the reformatted source: `cert-picker-template.test.js:129`, `move-authority.test.js:95`, `move-tab-synchrony.test.js:376`, `search-engines.test.js:387`, `session-restore-wiring.test.js:181`, `sheet-automation-gate-invariant.test.js:251`, `tab-adopt-by-drop.test.js:178,205,354`, `tab-drag-invariants.test.js:258,402,455` — nine files, above the squawk's own ~6-file ceiling.

What the flight has to decide: (a) tune `.prettierrc` toward the current house style (a larger `printWidth` would remove most of the rewrapping and likely keep the budgets intact — measure the delta first); or (b) keep Prettier defaults, re-base the two line budgets on the formatted sizes, and re-pin the 13 matchers. Either way the CI wiring (`format:check` script in `ci/tasks/lint.yml` and `.github/workflows/ci.yml`) is the same one-line addition and can ride along.

→ [Mission 17 Flight 5: Prettier Adoption](../missions/17-maintenance/flights/05-prettier-adoption/flight.md) — planned 2026-08-27. The flight's spike found option (a) not achievable (no Prettier setting preserves one-line function bodies; `printWidth` 100–160 all leave 318–355 files and `renderer.js` at 1774–1871 lines); operator chose (b). Operator ruling to enforce stands.
