# Squawk 0211: Chrome recovery does not re-push a tab's DevTools-open state

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
After a chrome recovery, the re-adopt path re-pushes per-tab state (load failure, security, crash, hung, nav state) but not whether DevTools is open. For the tab that stays active across the recovery, the chrome's DevTools indicator can be stale until the next tab activation (which reconciles it through `is-devtools-open`). Found by routine maintenance 2026-11-18 (roundtable on finding #22).

## Evidence
- `src/main/register-tab-ipc.js:pushTabStateFor` — sends `tab-load-failure`, `tab-security`, `tab-crash`, `tab-hung`, `tab-nav-state`; no `devtools-state-changed`.
- `src/main/chrome-recovery.js:buildRecoveryAdopts` calls `pushTabStateFor`.
- `src/main/guest-wiring.js` — `devtools-state-changed` is sent only at the open/close events.

## Corrective Action
`src/main/register-tab-ipc.js:pushTabStateFor` now always sends `devtools-state-changed { wcId, open }` (the channel and payload `guest-wiring.js` sends at devtools-opened/closed), just before `tab-nav-state`. The boolean is built in the thunk, at delivery time, as `!wc.isDestroyed() && wc.isDevToolsOpened()`, the same guard the nav-state read uses. It goes out for open and closed alike: the chrome handler (`privacy-controller.js`, `onDevtoolsStateChanged`) only calls `setDevtoolsPressed(!!open)` for the active tab, which is idempotent for `false`, so the actual value reconciles a stale indicator in both directions. The send goes through the caller's `send`: recovery's direct array push (before the gap-queue flush) and the move/adopt block's `queueChromeSend`. The move/adopt path therefore also re-pushes the state for a moved tab, which is harmless and consistent. The unqueued `guest-wiring.js` site is unchanged.

## Verification
A unit test of `pushTabStateFor` with a tab whose DevTools is open asserts a `devtools-state-changed { wcId, open: true }` push.

Ran: `node --test` on `test/unit/register-tab-ipc.test.js` + `test/unit/chrome-recovery.test.js` (150 pass, 0 fail); `timeout 300 npm test` (7466 pass, 0 fail); `npm run lint`, `npm run typecheck` clean; `npm run format:check` clean.
Tests added: `register-tab-ipc.test.js` (open boolean read at delivery time, true and false; destroyed contents does not throw and reports `open: false`), `chrome-recovery.test.js` (`buildRecoveryAdopts` pushes `{wcId:1,open:true}` and `{wcId:2,open:false}`). Existing re-push order assertions and the wc fakes were updated for the new send.
Neuter-verified: commenting out the new `send('devtools-state-changed', …)` line failed 8 tests; restored, all pass.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eleventh 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `pushTabStateFor` re-pushes `devtools-state-changed { wcId, open }` through the same boot-gated send as the other re-pushes, read at delivery time; the extra push on the move/adopt path is harmless; recovery still re-pushes before the gap-queue flush. Neuter: removing the send fails six tests. Live (dev mode): with DevTools open on the active tab, the chrome renderer was killed by PID; after recovery (about 1 s) the DevTools button still read `aria-pressed="true"`, and `false` after `closeDevTools`. Gates at review: `npm test` 7,485 tests (7,480 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-k`
