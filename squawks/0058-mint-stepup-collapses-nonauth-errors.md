# Squawk 0058: Mint step-up sheet renders every failure as "Wrong master password" — including no-vault-for-jar

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-01

## Report

Minting an access key for a jar with no vault file (no item ever saved
into it) fails with `VaultStateError('no vault for "<jar>" — save an
item first')` — but the operator sees "Wrong master password. Nothing was
minted." even with a correct password. Chain: the step-up unwrap
succeeds, `_mintAccessKey` throws `VaultStateError`
(`vault-store.js:2315-2317`); the main delegate maps only
`VaultAuthError` to `{ok:false}` so the invoke rejects
(`main.js:1786-1794`); `submitVaultStepup`'s catch collapses every
rejection into the wrong-password copy
(`menu-overlay.js:1498-1500, 1511-1517`). Fix shape (one read pass):
forward a non-secret reason through the delegate (the vault-import
precedent) and branch the sheet copy; and/or gate the jar-row mint
affordance on `hasVault`. Pre-existing (M12 F3 Leg 5 vintage — verified
byte-identical at pre-flight commit 2c5c144); surfaced 2026-09-01 during
Mission 18 Flight 2 leg-5 fixture setup on an item-less fresh profile.

## Evidence

- Live reproduction + worktree bisect to 2c5c144 (Flight 2 diagnosis,
  2026-09-01); cited lines above verified at HEAD af95fb1.
- Regression pins added (green, real-store):
  `test/unit/vault-stepup-mint-handler.test.js` — the
  correct-password/no-vault-file rejection is now modeled with a comment
  on the sheet-side collapse.

## Corrective Action

*(recorded at completion)*

## Verification

*(recorded at completion)*

## Sign-Off

*(recorded at completion)*

## Scope Annotation (2026-09-02, Flight 2 debrief)

The fix should **widen non-secret reason-forwarding to the sibling vault
delegates**, not just the mint path: Flight 2's compromise delegate
(`main.js` `vaultCompromiseRotate`) now maps `VaultPasswordReuseError` /
`VaultFormatError` / `VaultBusyError` / `VaultStateError` into
`{ok:false, reason}` — the precedent. Siblings still map only
`VaultAuthError`, so e.g. a `VaultBusyError` during a rotation window
renders as "Wrong master password" on the mint sheet — the same collapse
class this squawk pins. One fix shape covers both.
