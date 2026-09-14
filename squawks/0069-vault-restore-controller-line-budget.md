# Squawk 0069: Give vault-restore-controller.js its own line budget

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-14
**Completed**: —

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

*(written at completion — expected: add a `VAULT_RESTORE_CONTROLLER_LINE_BUDGET`
constant + assertion to seam-contract.test.js, set to the file's current
`split(/\r?\n/).length` + a small buffer (~30-50), mirroring the vault.js budget
mechanism. Test-only, no production change.)*

## Verification

*(written at completion — expected: `seam-contract.test.js` green with the new
pin; the budget equals measured + buffer.)*

## Sign-Off

*(written at completion)*
