# Squawk 0211: Chrome recovery does not re-push a tab's DevTools-open state

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
After a chrome recovery, the re-adopt path re-pushes per-tab state (load failure, security, crash, hung, nav state) but not whether DevTools is open. For the tab that stays active across the recovery, the chrome's DevTools indicator can be stale until the next tab activation (which reconciles it through `is-devtools-open`). Found by routine maintenance 2026-11-18 (roundtable on finding #22).

## Evidence
- `src/main/register-tab-ipc.js:pushTabStateFor` — sends `tab-load-failure`, `tab-security`, `tab-crash`, `tab-hung`, `tab-nav-state`; no `devtools-state-changed`.
- `src/main/chrome-recovery.js:buildRecoveryAdopts` calls `pushTabStateFor`.
- `src/main/guest-wiring.js` — `devtools-state-changed` is sent only at the open/close events.

## Corrective Action
*(written at completion)*

## Verification
A unit test of `pushTabStateFor` with a tab whose DevTools is open asserts a `devtools-state-changed { wcId, open: true }` push.
