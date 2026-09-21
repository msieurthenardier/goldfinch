# Squawk 0069: Give vault-restore-controller.js its own line budget

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-14
**Completed**: 2026-09-21

## Report

`src/renderer/pages/vault-restore-controller.js` (created in M19 F2 Leg 1, ~855
lines) houses five nontrivial modals (export, restore pick, color-swatch,
mapping with its own collision/recompute state, completion) and carries NO line
budget in `test/unit/seam-contract.test.js` — unlike `vault.js`
(`VAULT_PAGE_LINE_BUDGET`), `renderer.js`, and `bookmarks-bar.js`. Its sibling
`vault-browser-import-controller.js` is also unbudgeted but is only ~330 lines.
At 855 lines and unguarded, this file is positioned to become the next
multi-flight "thrice-named debt" if future vault-page work accretes into it —
the exact re-accretion cycle `vault.js` just finished paying off. Cheapest to
pin a budget while the file is fresh.

Surfaced by the M19 F2 flight debrief (Developer + Architect interviews).

## Evidence

- `src/renderer/pages/vault-restore-controller.js` — ~855 lines, no budget.
- `test/unit/seam-contract.test.js` — `VAULT_PAGE_LINE_BUDGET` (the mechanism
  to mirror), `RENDERER_LINE_BUDGET`, `BOOKMARKS_BAR_LINE_BUDGET`.
- M19 F2 debrief, "What could be improved / Technical" + recommendation 2.

## Corrective Action

Added a `VAULT_RESTORE_CONTROLLER_LINE_BUDGET` constant and a matching
assertion test to `test/unit/seam-contract.test.js`, mirroring the existing
`VAULT_PAGE_LINE_BUDGET`/`BOOKMARKS_BAR_LINE_BUDGET`/`RENDERER_LINE_BUDGET`
idiom exactly: same `split(/\r?\n/).length` metric, same comment discipline
("landed size plus a small buffer, rounded to a clean number"), same
`fs.readFileSync` + `assert.ok(lines <= BUDGET, ...)` test shape, placed
immediately after the `vault.js` budget test. Added a
`VAULT_RESTORE_CONTROLLER_JS` path constant beside the other `*_JS` constants.

Measured `src/renderer/pages/vault-restore-controller.js` at **855 lines**
(this test's own metric, confirmed via a one-off `node -e` check before
choosing the number — matches the squawk report's "~855"). Set the budget to
**900** (855 + ~50 headroom, rounded to a clean number) — the same buffer size
the `VAULT_PAGE_LINE_BUDGET` comment's own precedent uses ("a small buffer
(~30-50 lines)").

Test-only change; no production file was touched.

## Verification

- `node --test --test-timeout=60000 test/unit/seam-contract.test.js` — 11/11
  pass (was 10; the new `vault-restore-controller.js stays within its
  VAULT_RESTORE_CONTROLLER_LINE_BUDGET line budget (squawk 0069)` test passes
  at the measured 855 lines against the 900 budget).
- `npm test` — 5456 pass, 0 fail, 3 todo (pre-existing, unrelated).
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format` — no changes (file already Prettier-clean).
- `npm run format:check` — "All matched files use Prettier code style!"
- `git status --short` confirms only `test/unit/seam-contract.test.js` and
  this squawk file changed — no production code touched.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
