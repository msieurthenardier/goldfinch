# Squawk 0103: Vault page copy still says "the manager"

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-23
**Completed**: 2026-09-29

## Report

Squawk 0102 renamed the vault's user-facing name to "Vault"/"Vaults", but the
vault page's locked-state and auto-lock copy still calls it "the manager". Found
incidentally during the `vault-filter` behavior test (Mission 22 F1,
checkpoint 10). Rename the visible copy to say "the vault" (copy only; code
comments and identifiers unchanged). Also sweep other user-visible strings in
`src/` for "the manager" / "secrets manager".

## Evidence

- `src/renderer/pages/vault.js` — `'Unlock the manager to view and edit items.'`
  (locked banner)
- `src/renderer/pages/vault.js` — `'Unlock the manager to view this vault’s items.'`
  (`buildLockedVaultSection`)
- `src/renderer/pages/vault.js` — `'Automatically lock the manager after a period of inactivity.'`
  (auto-lock lede)
- `tests/behavior/vault-filter/runs/2026-09-23-17-09-28.md` — checkpoint 10 raw
  state shows the banner. Check behavior specs that quote these strings.

## Corrective Action

Visible copy only (comments/identifiers untouched):

- `src/renderer/pages/vault.js`: `Unlock the manager to view and edit items.` -> `Unlock the vault to view and edit items.`
- `vault.js`: `Unlock the manager to view this vault’s items.` -> `Unlock to view this vault’s items.`
- `vault.js`: `Automatically lock the manager after a period of inactivity.` -> `Automatically lock your vaults after a period of inactivity.`
- `src/renderer/menu-overlay.js`: `The manager locked — unlock it and try again` -> `The vault locked — unlock it and try again`
- `menu-overlay.js`: `Couldn’t set up the manager. Please try again.` -> `Couldn’t set up the vault. Please try again.`
- `menu-overlay.js` (x3 step-up ledes): `…even while the manager is unlocked.` -> `…even while the vault is unlocked.`
- `src/shared/vault-stepup-template.js`: same lede -> `…while the vault is unlocked.`
- `src/shared/vault-recover-template.js`: `…to unlock the manager, then…` -> `…to unlock the vault, then…`
- `src/renderer/pages/vault-restore-controller.js`: `The manager locked — export canceled…` -> `The vault locked — export canceled…`

Judged exempt: `vault-browser-import-controller.js` "your browser's password manager" (refers to the other browser's feature). No unit tests or behavior specs quote the changed strings (historical `runs/` logs left as-is).

## Verification

`npm test` 5682 pass / 0 fail; `npm run typecheck` clean; `npm run lint` clean; prettier applied to changed files. Grep of test/ and tests/behavior (excluding runs/) for the old strings: no hits.

## Sign-Off

**Reviewer**: Reviewer agent (independent, batch review — turnaround 2026-09-29)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-29 (branch `squawk/turnaround-2026-09-29`)
