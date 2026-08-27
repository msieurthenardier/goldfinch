# Squawk 0018: `onViewCreated` early return leaks the guest `WebContentsView` when the tab closed before `tab-create` resolved

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

GitHub issue #134 item 3. `tab-create` is synchronous on the main side (view constructed, attached, `loadURL` issued, wcId returned), so when the renderer's `onViewCreated` bails with `if (!tabs.has(tab.id)) return;` — the tab was closed while the invoke was in flight — a fully constructed view exists that nothing will ever close. Fix: call `tabClose(wcId, -1)` (or the equivalent close IPC) in the early-return branch; guard `closed-tab-capture` accordingly; unit-test `onViewCreated` for the closed-before-resolve case using the existing factory-deps harness.

Source: maintenance report 2026-08-27, finding F46 (Architect ruling: main-side race closed, renderer-side leak real).

## Evidence

- `src/renderer/chrome/tab-controller.js:343-345` — `onViewCreated` … `if (!tabs.has(tab.id)) return;` with no close
- `src/main/register-tab-ipc.js:75-163` — non-async `ipcMain.handle('tab-create', …)`: `addChildView`, `wireGuestContents`, `loadURL`, `return wcId` all synchronous

## Corrective Action

- `src/renderer/chrome/tab-controller.js:343-354` — `onViewCreated`'s early-return branch (`!tabs.has(tab.id)`) now calls `window.goldfinch.tabClose(wcId, -1, { skipCapture: true })` before returning, tearing down the orphaned guest view that main already constructed and attached during the in-flight `tab-create`. `-1` mirrors the append-sentinel shape ordinary closes send (the value is otherwise moot since capture is skipped); shared by both `createTab` and `attachView` since both funnel through this one function.
- `src/preload/chrome-preload.js:225-231` — `tabClose` bridge now forwards an optional third `opts` argument to the `tab-close` IPC send (additive; existing 2-arg call sites unaffected).
- `src/renderer/renderer-globals.d.ts:291-296` — `tabClose` type signature updated to include `opts?: { skipCapture?: boolean }`.
- `src/main/register-tab-ipc.js:169,183-206` — `tab-close` handler now reads a fourth `opts` parameter and wraps the `closed-tab-stack` capture block in `if (!(opts && opts.skipCapture))`, so a renderer-initiated orphan close tears down the view (`removeChildView`/`webContents.destroy`/`tabViews.delete`, all otherwise unaffected) without pushing a phantom reopen entry for a tab the user never saw. Every other step in the handler (auth-challenge cancel, history/favicon forget, active-tab/overlay/fullscreen checks) is a no-op for an orphan wcId that was never set active — confirmed by reading the handler, not touched.
- `test/unit/tab-controller.test.js:471-506` — new test using the existing factory-deps harness: overrides `tabCreate` to return a controllable pending promise (queued per call, since the last-tab-closed backfill via `openNewTab` issues its own unrelated `tabCreate`), closes the tab before resolving, then resolves the wcId and asserts `tabClose` is invoked exactly once with `(wcId, -1, { skipCapture: true })` and that no tab record exists for the orphan's wcId. M16's viewless welcome tab record (`tab.wcId === null`, no `tab-create` ever sent) is a distinct, untouched case — confirmed via the existing `closeTab on a welcome record sends no tabClose...` test, still passing unmodified.

## Verification

- `timeout 180 npm test` — 3796 tests, 3796 pass, 0 fail.
- `npm run lint` — clean, no findings.
- `npm run typecheck` — clean, no errors.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
