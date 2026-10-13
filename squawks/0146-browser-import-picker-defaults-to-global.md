# Squawk 0146: Browser-import destination picker silently defaults to Global

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-13
**Completed**: 2026-10-13

## Report
The vault page's "Import from a browser…" destination modal pre-selects Global. If the operator presses Import without choosing, the CSV lands in a vault they never chose. The native confirm names the destination, so this is not silent data loss, but it is the same unsafe default Sortie 04 removed from the copy picker (HAT fix F3).

Fix: start the select on a disabled `Choose a vault…` placeholder (value `''`), keep Import disabled until a real destination is chosen, and keep the Replace/Merge row hidden while the placeholder is selected. Mirror the copy picker in `vault-item-actions-controller.js`.

## Evidence
- `src/renderer/pages/vault-browser-import-controller.js:renderDestinationModal` — `destSelect.value = 'global';` (≈212) and `submitEnabled: n > 0`.
- Reference fix: the Sortie 04 F3 copy picker in `src/renderer/pages/vault-item-actions-controller.js:openCopyTo` (disabled+selected placeholder, then `change` → `handle.setSubmitEnabled(select.value !== '')`). Its tests are in `test/unit/vault-item-actions-controller.test.js`.
- Source: Sortie 04 debrief, Recommendation 3 (`sorties/04-copy-item-to-vault/flight-debrief.md`).

## Corrective Action
`renderDestinationModal` (`src/renderer/pages/vault-browser-import-controller.js`) now prepends a disabled+selected `Choose a vault…` placeholder (value `''`) instead of `destSelect.value = 'global'`, opens the modal with `submitEnabled: false`, and a `change` listener attached after the handle exists calls `updateModeVisibility()` and `handle.setSubmitEnabled(n > 0 && destSelect.value !== '')`. `onSubmit` no-ops on `''` defensively. `updateModeVisibility` already hides the Replace/Merge row for an unknown id (`''`). Mirrors the Sortie 04 copy picker. `docs/vault.md` Browser import section updated.

## Verification
Added `test/unit/vault-browser-import-controller.test.js` (4 tests: placeholder selected + Import disabled, enable/disable on change + no-op submit, mode row hidden on placeholder, zero-candidate stays disabled). Commands: `timeout 300 npm test` (all green incl. `vault-browser-import-invariants.test.js`), `npm run typecheck`, `npm run lint`, `npm run format:check` — all pass. The test loads the shipped controller with only its flat `./vault-page-model.js` specifier rewritten to the shared file (temp copy). The test removes its temp dir in an `after()` hook (no `gf-bimport-*` left in /tmp).

## Sign-Off
**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0146–0148; [HANDOFF:confirmed] (one non-blocking nit on 0146's test temp-dir cleanup, fixed and re-reviewed: [HANDOFF:confirmed])
**Verdict**: confirmed
**Commit**: `e43472e` (squawk/turnaround-2026-10-13)
