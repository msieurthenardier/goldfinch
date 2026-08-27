# Squawk 0018: `onViewCreated` early return leaks the guest `WebContentsView` when the tab closed before `tab-create` resolved

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

GitHub issue #134 item 3. `tab-create` is synchronous on the main side (view constructed, attached, `loadURL` issued, wcId returned), so when the renderer's `onViewCreated` bails with `if (!tabs.has(tab.id)) return;` — the tab was closed while the invoke was in flight — a fully constructed view exists that nothing will ever close. Fix: call `tabClose(wcId, -1)` (or the equivalent close IPC) in the early-return branch; guard `closed-tab-capture` accordingly; unit-test `onViewCreated` for the closed-before-resolve case using the existing factory-deps harness.

Source: maintenance report 2026-08-27, finding F46 (Architect ruling: main-side race closed, renderer-side leak real).

## Evidence

- `src/renderer/chrome/tab-controller.js:343-345` — `onViewCreated` … `if (!tabs.has(tab.id)) return;` with no close
- `src/main/register-tab-ipc.js:75-163` — non-async `ipcMain.handle('tab-create', …)`: `addChildView`, `wireGuestContents`, `loadURL`, `return wcId` all synchronous

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
