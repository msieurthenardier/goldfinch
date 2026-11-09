# Squawk 0178: A second Ctrl+W can close the whole window (app quits) after closing the active tab

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-08
**Completed**: —

## Report
Sortie 08 HAT, step H6 (dev mode, ~27 tabs): the operator pressed Ctrl+W on a mid-strip tab — the tab closed — then pressed Ctrl+W again and the **whole window closed and the app quit** (clean exit, code 0, no crash in the log), with many tabs still open. Expected: the second Ctrl+W closes the next active tab. Exact focus state before the first Ctrl+W is unknown (the operator had been clicking the strip and pages during H1–H5). Needs a deliberate repro.

## Evidence
- No `Menu.setApplicationMenu` anywhere in `src/main/**` → Electron's DEFAULT application menu is live, and it carries Window › Close bound to `CmdOrCtrl+W` (role `close`). A Ctrl+W that no webContents handles/`preventDefault`s reaches that accelerator and closes the window; the last window closing rides `window-all-closed` → quit.
- Hypothesis (unverified): `src/main/register-tab-ipc.js` `tab-close` destroys the closed guest (`entry.view.webContents.destroy()`) and nulls `owner.activeTabWcId` when it was active; the following `tab-set-active` computes `wasPageFocused` from `owner.activeTabWcId` (now `null`) → `false`, so the incoming guest is not focused. If OS focus was in the closed guest (page-focused Ctrl+W, forwarded via `guest-forward-allowlist.js` `close-tab`), focus is left on no webContents and the next Ctrl+W falls through to the default-menu Close.
- Not on sortie 08's path: the keyboard close (`shortcut-controller.js` `case 'close-tab'` → `closeTab(ctx.activeTabId)`, no pointer) and main's tab-close/tab-set-active are untouched by the sortie; likely pre-existing — confirm on `main` during the repro.

## Corrective Action
*(written at completion)*

## Verification
Repro first (by hand — keyboard focus state is not automatable over MCP): page-focused Ctrl+W twice vs strip-focused Ctrl+W twice, on `main` and on the fix. A fix touching the default menu (e.g. setting an application menu without the Close accelerator) is a global hook — if the fix goes that way, it fails the squawk gate (shared mechanism) and escalates to a sortie.

## Sign-Off
*(written at completion)*
