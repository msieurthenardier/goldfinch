# Squawk 0175: "Automation has vault access" copy has no drift guard

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-06
**Completed**: —

## Report
The Sortie 07 HAT copy fix spells the automation-held wording in two places independently. One is
the right-click menu note, "Automation has vault access". The other is the vault indicator's
aria-label and tooltip, "Vault locked — automation has vault access". Nothing ties them together,
so a future copy edit could change one and not the other. The project's norm for repeated copy is
to single-source it or drift-guard it (CLAUDE.md → Recurring module shapes → *Drift guard*).

## Evidence
- `src/shared/page-context-model.js` `pageContextModel`, toolbar `'vault'` branch:
  `model.push({ type: 'note', text: 'Automation has vault access' }, …)`
- `src/renderer/chrome/vault-controller.js` `renderVaultIndicator`:
  `? 'Vault locked — automation has vault access'`
- `sorties/07-automation-honors-vault-lock/flight-debrief.md`: Technical.

## Corrective Action
*(written at completion)*

## Verification
Either a shared constant imported by both modules (via a `src/shared/` export; the controller
already imports shared models), or a drift test asserting the indicator label contains the menu
note's text, case-insensitively. Neuter-verify that the guard fails on a one-sided edit.
`npm test` passes.

## Sign-Off
*(written at completion)*
