# Squawk 0059: Vault page's access-key list does not live-update after a mint

**Status**: completed
**Completed**: 2026-09-02
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-02

## Report

Minting an access key while the vault page is rendered leaves that jar's
"Access keys" list showing "No access keys." until the page re-renders
(reload/reopen or a lock-state refresh) — observed twice during behavior
test run 2026-09-02-12-32-45 (DOM read 63s after the mint, and again a
minute later; the disk envelope existed from mint time). The mint flow
routes page → sheet → store, and the store write does not push a page
refresh; the page refreshes only on `vault-lock-state`. Fix shape (one
read pass expected): broadcast/refresh after `mintAccessKey` (and
`revokeAccessKey`) completes, mirroring the compromise-completion
re-broadcast idiom added in Flight 2's flow-wiring leg.

## Evidence

- Behavior-test run log
  `tests/behavior/compromise-mode-rotation/runs/2026-09-02-12-32-45.md`
  (Orchestrator Notes + Executor closing; Validator recommends squawk).
- Disk envelope present (keyId `t2ahJMdSlT0`, mtime 12:43:30Z) while the
  rendered page read "No access keys." at ~12:44:33Z.

## Corrective Action

Re-broadcast `vault-lock-state` after both access-key writes, mirroring the
compromise-completion idiom from Flight 2 (M18 F2: `ackCompromiseReveal` re-broadcasts;
chrome's handlers verified inert on the duplicate unlocked state). The page refreshes
only off that channel, so the re-broadcast makes an open vault page re-list the jar's
access keys immediately.

- **Mint** — `src/main/register-overlay-ipc.js`: new optional `broadcastVaultLockState`
  injection; the `menu-overlay:vault-stepup-mint` handler calls it FIRST in its success
  branch (post-write, before any sheet/window handle is touched, so a window that died
  during the scrypt await can never skip the refresh). Placed in the testable overlay
  handler, not the untestable `main.js` delegate — the injected-seam idiom the
  compromise handlers use.
- **Revoke** (symmetry) — `src/main/register-vault-ipc.js`: same optional injection;
  `internal-vault-accesskey-revoke` broadcasts only when `revoked === true` (a stale
  keyId writes nothing → no broadcast). The revoking page already re-lists its own
  view; the broadcast covers other windows' pages.
- **Wiring** — `src/main/main.js`: both registrars now receive
  `broadcastVaultLockState: () => broadcastVaultLockState()` (narrow bound function,
  the `ackCompromiseReveal` precedent).

Auth failures, non-auth rejections, foreign senders, stale tokens, stale keyIds, and
the locked path all still broadcast nothing; the seam is optional, so offline harnesses
omitting it get the prior behavior unchanged.

## Verification

- Re-read `src/renderer/pages/vault.js` before claiming the fix shape: the page's
  `vault-lock-state` listener drives `refresh()`, which re-renders each unlocked vault
  section and re-runs `refreshKeys()` (lines ~1475–1487) — so the re-broadcast does
  re-list access keys. Re-read `src/main/main.js` `broadcastVaultLockState` /
  `ackCompromiseReveal` (the completion-broadcast idiom, with the design-review M3 note
  that chrome treats the duplicate state as inert) and the M18 F2 comment in
  `src/renderer/chrome/vault-controller.js` confirming the duplicate is nothing-to-do.
- Regression tests at the stubbed-sheet layer:
  - `test/unit/vault-stepup-mint-handler.test.js` — broadcast fires exactly once on
    mint success (fake delegate AND real-store harness), and does NOT fire on auth
    refusal, delegate throw, foreign sender, or the real wrong-password / no-vault
    rejections; plus a seam-optional test (success with no injection).
  - `test/unit/register-vault-ipc.test.js` — real-store revoke broadcasts exactly
    once; stale keyId, locked store, and the read-only list channel broadcast nothing.
- Full battery (2026-09-02): `npm test` 4120 pass / 0 fail (baseline before change:
  4118 pass / 0 fail — +2 new tests); `npm run typecheck`, `npm run lint`,
  `npm run format:check` all clean.

## Sign-Off

**Reviewer**: independent batch Reviewer (squawk turnaround 2026-09-02, scoped to the diff)
**Verdict**: confirmed — broadcast placement post-write/pre-sheet-handles, revoke gated on revoked===true, narrow bound-function injections, seam-optional behavior byte-identical; tests cover fires-once + five silent cases. Process deviation flagged: the implementing Developer prematurely self-marked completed with a self-recorded sign-off — that section was disregarded; THIS batch review's verdict is the sign-off of record.
**Commit**: `squawk/turnaround-2026-09-02` (via its PR)
