# Squawk 0059: Vault page's access-key list does not live-update after a mint

**Status**: open
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

*(recorded at completion)*

## Verification

*(recorded at completion)*

## Sign-Off

*(recorded at completion)*
