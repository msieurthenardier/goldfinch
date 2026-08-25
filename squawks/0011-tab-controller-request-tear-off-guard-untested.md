# Squawk 0011: `requestTearOff`'s viewless-tab guard is exercised by no test — the "no dead controls" test overclaims

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-25
**Completed**: —

## Report

`test/unit/tab-controller.test.js:387` — `'a welcome record shows no dead controls: dragstart and requestTearOff both refuse it'` — only invokes the `dragstart` handler and asserts no `tabTearOff` IPC fired. `dragstart`'s own `preventDefault` stops the gesture before `requestTearOff` could ever run, so the assertion holds regardless of whether `requestTearOff`'s guard is intact. The guard is exercised nowhere in the suite; the test name claims coverage it does not have. Found by the M16 F2 debrief Developer interview.

## Evidence

- `src/renderer/chrome/tab-controller.js:703` — `function requestTearOff(tabId)` opens with `if (!tab || tab.wcId == null) return;` (M16 F2 leg 1, DD8: a viewless welcome record is refused).
- `test/unit/tab-controller.test.js:387` — the only test naming `requestTearOff`; it never calls `controller.requestTearOff(...)`.

Fix: call `controller.requestTearOff(tab.id)` directly on a welcome record and assert it no-ops (no `tabTearOff` invoke), either in the same test or as a split second test; a positive control on an ordinary tab already exists in the file's tear-off cases.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — the amended test goes red when the guard at `tab-controller.js:703` is removed)*

## Sign-Off

*(written at completion)*
