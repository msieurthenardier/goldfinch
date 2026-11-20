# Squawk 0175: "Automation has vault access" copy has no drift guard

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-06
**Completed**: 2026-11-19

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
Added a drift test (no source change) to `test/unit/page-context-model.test.js`: it takes the note text from the real `pageContextModel({}, 'vault', { vaultLocked: true, automationHeld: true })` output and the label from a source scan of `vault-controller.js` `renderVaultIndicator` (`model.automationHeld ? '…'`), asserts the label contains the note case-insensitively, and throws (assert.ok) if either cannot be found.

## Verification
Either a shared constant imported by both modules (via a `src/shared/` export; the controller
already imports shared models), or a drift test asserting the indicator label contains the menu
note's text, case-insensitively. Neuter-verify that the guard fails on a one-sided edit.
`npm test` passes.

Ran: `node --test test/unit/page-context-model.test.js` 18 pass / 0 fail. Neuter-verified: note edited alone (`...accessX`) -> 2 fail (guard plus an existing assertion); label edited alone (`automation holds vault access`) -> 1 fail; both restored via git checkout. `npm test` 7444 pass / 0 fail; lint, typecheck clean; `npm run format` then `format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eighth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The guard reads the note from the real `pageContextModel` output and the label by a source scan of `vault-controller.js`, and throws if either is missing. Re-neutered by the Reviewer: a note-only edit fails 2 tests, a label-only edit fails 1. Test-only change. Not checked live: no runtime change. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 5 skipped or todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-h`
