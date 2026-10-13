# Squawk 0147: Copy-to flow parses the destination name out of its option label

**Status**: in-progress
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-13
**Completed**: —

## Report
The Copy-to controller recovers a destination's display name ("Work") by cutting its option label ("Work — 3 secrets") at the last " — ". A jar whose name contains " — " still cuts at the right place, but a future label format change would silently break every copy notice and step-2 title. The name should come from data, not from string surgery.

Fix: have `copyDestinationOptions` return `{ vaultId, name, label }`, and have the controller read `name`.

## Evidence
- `src/renderer/pages/vault-item-actions-controller.js` ≈158 — `const i = label.lastIndexOf(' — ');`
- `src/shared/vault-page-model.js:copyDestinationOptions` (≈388), which wraps `browserImportDestinationOptions` (Global's name is "Global"; jar names come from `jarRows`). This controller is its only consumer.
- Source: Sortie 04 debrief (Architect review, Recommendation 4).

## Corrective Action
`copyDestinationOptions` now returns `{ vaultId, name, label }`; `name` is built from the jar rows (Global → "Global"; id fallback matching the label) alongside the unchanged `browserImportDestinationOptions`/`restoreDestinationOptions`. The controller's `destName` label-parsing helper is removed and it reads `chosen.name`.

## Verification
Full `npm test`, typecheck, lint and format:check green. `vault-page-model.test.js` asserts `name` for Global, jars, and a jar name containing " — ". `vault-item-actions-controller.test.js` notice and step-2 title assertions still pass, plus one case with a " — " jar name.
