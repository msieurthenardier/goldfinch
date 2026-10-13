# Squawk 0146: Browser-import destination picker silently defaults to Global

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-13
**Completed**: —

## Report
The vault page's "Import from a browser…" destination modal pre-selects Global. If the operator presses Import without choosing, the CSV lands in a vault they never chose. The native confirm names the destination, so this is not silent data loss, but it is the same unsafe default Sortie 04 removed from the copy picker (HAT fix F3).

Fix: start the select on a disabled `Choose a vault…` placeholder (value `''`), keep Import disabled until a real destination is chosen, and keep the Replace/Merge row hidden while the placeholder is selected. Mirror the copy picker in `vault-item-actions-controller.js`.

## Evidence
- `src/renderer/pages/vault-browser-import-controller.js:renderDestinationModal` — `destSelect.value = 'global';` (≈212) and `submitEnabled: n > 0`.
- Reference fix: the Sortie 04 F3 copy picker in `src/renderer/pages/vault-item-actions-controller.js:openCopyTo` (disabled+selected placeholder, then `change` → `handle.setSubmitEnabled(select.value !== '')`). Its tests are in `test/unit/vault-item-actions-controller.test.js`.
- Source: Sortie 04 debrief, Recommendation 3 (`sorties/04-copy-item-to-vault/flight-debrief.md`).

## Corrective Action
*(written at completion)*

## Verification
Controller-level tests covering: the placeholder is selected, Import is disabled until a choice is made, and the mode row stays hidden while the placeholder is selected. The browser-import invariant scans must still pass.
