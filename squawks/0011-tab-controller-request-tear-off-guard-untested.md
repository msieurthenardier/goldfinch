# Squawk 0011: `requestTearOff`'s viewless-tab guard is exercised by no test — the "no dead controls" test overclaims

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-25
**Completed**: 2026-08-25

## Report

`test/unit/tab-controller.test.js:387` — `'a welcome record shows no dead controls: dragstart and requestTearOff both refuse it'` — only invokes the `dragstart` handler and asserts no `tabTearOff` IPC fired. `dragstart`'s own `preventDefault` stops the gesture before `requestTearOff` could ever run, so the assertion holds regardless of whether `requestTearOff`'s guard is intact. The guard is exercised nowhere in the suite; the test name claims coverage it does not have. Found by the M16 F2 debrief Developer interview.

## Evidence

- `src/renderer/chrome/tab-controller.js:703` — `function requestTearOff(tabId)` opens with `if (!tab || tab.wcId == null) return;` (M16 F2 leg 1, DD8: a viewless welcome record is refused).
- `test/unit/tab-controller.test.js:387` — the only test naming `requestTearOff`; it never calls `controller.requestTearOff(...)`.

Fix: call `controller.requestTearOff(tab.id)` directly on a welcome record and assert it no-ops (no `tabTearOff` invoke), either in the same test or as a split second test; a positive control on an ordinary tab already exists in the file's tear-off cases.

## Corrective Action

`requestTearOff` is not on `createTabController`'s returned API (`src/renderer/chrome/tab-controller.js:1139-1157` — no `requestTearOff` entry), and its drag session (`dnd`, `tab-controller.js:521`) is private module state, so it cannot be called directly from a test without exposing a new method (a shared-interface change, out of squawk scope). `dragend` (`tab-controller.js:236`, `if (doTearOff) requestTearOff(tabId);`) is `requestTearOff`'s only call site, so the guard has to be reached through the real `dragstart`→`dragend` gesture on the tab's own listeners — the same mechanism the file already drives elsewhere (e.g. `applyToolbarAffordances` at line ~369 drives `activateTab`/`onViewCreated` the same indirect way).

Two problems, fixed together in `test/unit/tab-controller.test.js`:

1. The original test (`'a welcome record shows no dead controls...'`) only ever invoked `dragstart`, whose own `wcId` gate (`tab-controller.js:164`) refuses a viewless tab before a drag session (`dnd`) even exists — `requestTearOff`'s own guard at line 703 was reached by nothing.
2. Independently, the harness's `tabTearOff` bridge stub (line 83) was `async () => ({ ok: true })` — it never pushed to `h.calls`. Every existing assertion filtering `h.calls` for `'tabTearOff'` was therefore vacuously `0` regardless of whether `requestTearOff` ever actually dispatched. Fixed to `tabTearOff(payload) { calls.push(['tabTearOff', payload]); return Promise.resolve({ ok: true }); }`, matching every other tracked bridge call in the harness.

Split the original test into three, all in `test/unit/tab-controller.test.js`:

- `'a welcome record refuses to start a drag: dragstart preventDefaults on a viewless tab'` — the original assertion, accurately named (dragstart's own gate only).
- `'requestTearOff refuses a tab that lost its view mid-drag: no tabTearOff IPC fires'` — the new coverage for `requestTearOff`'s own guard (`tab-controller.js:705`, `if (!tab || tab.wcId == null) return;`). Creates a real tab (`wcId` set, so `dragstart`'s gate passes and a session starts), then sets `tab.wcId = null` between `dragstart` and `dragend` to simulate the guest view going away mid-drag — the exact race the guard exists for, distinct from and in addition to `dragstart`'s own gate. `classifyDragPoint` is stubbed per-test (`h.deps.classifyDragPoint = () => ({ zone: 'tearOff' })`, the same dependency-injection seam `currentHomePage`/`currentSearchEngine` already use) so `dragend`'s release-point classification lands in the tear-off zone without needing real DOM geometry.
- `'requestTearOff dispatches tabTearOff for a tab with a live view (positive control)'` — same gesture, `wcId` left intact, asserts `tabTearOff` fires with the tab's `wcId` in the payload. Proves the harness/gesture genuinely reaches `requestTearOff`'s dispatch, so the guard test above isn't vacuously green because the mechanism never fires at all.

No source files were changed — `src/renderer/chrome/tab-controller.js` is untouched; the fix is entirely in `test/unit/tab-controller.test.js` (both the new tests and the `tabTearOff` harness-stub fix).

## Verification

- Neuter check: temporarily changed `tab-controller.js:705` from `if (!tab || tab.wcId == null) return;` to `if (!tab) return;`, ran `timeout 60 node --test test/unit/tab-controller.test.js` → **19 pass / 1 fail** (the new `'requestTearOff refuses a tab that lost its view mid-drag'` test failed: `expected: 0, actual: 1` on the `tabTearOff` call count), all other 19 tests (including the positive control) still green. Restored the guard from a pre-edit backup copy; `git diff --stat src/renderer/chrome/tab-controller.js` confirmed a byte-identical restore (no diff).
- `timeout 60 node --test test/unit/tab-controller.test.js` (guard restored) → 20/20 pass.
- `timeout 120 npm test` — before: `# tests 3763 / # pass 3763 / # fail 0` (~3.5s). After: `# tests 3765 / # pass 3765 / # fail 0` (~3.5s) — net +2 tests (one split into three), no regressions.
- `npm run typecheck` (`tsc --noEmit -p jsconfig.json`) → clean, no output.
- `npm run lint` (`eslint .`) → clean, no output.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — one review round, batch turnaround 2026-08-25
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-25 (0011, 0012)` on `squawk/turnaround-2026-08-25` (PR number recorded on the PR itself)

Reviewer independently ran the suite (3765/3765), typecheck and lint clean, and reproduced the red-when-neutered check: with the guard weakened to `if (!tab) return;`, exactly the new guard test fails (19 pass / 1 fail); source tree confirmed unchanged afterwards. Traced the positive control through `dragstart` → `dragend` → `classifyDragPoint` stub → `requestTearOff` → `tabTearOff`; confirmed the harness-stub fix touches only the three `tabTearOff` assertion sites.
