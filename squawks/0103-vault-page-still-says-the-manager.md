# Squawk 0103: Vault page copy still says "the manager"

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-23
**Completed**: —

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
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
