# Behavior Test: A jar-scoped key cannot run the browser's own shortcuts

**Slug**: `jar-key-shortcut-containment`
**Status**: active
**Created**: 2026-11-14
**Last Run**: 2026-11-14 — pass on Electron 45.3.2 (third run; step 12 by-eye, not performed). The first run failed step 13 and the second had a vacuous step 10, both under earlier wording of this spec — a popup left open, not the product. [run log](jar-key-shortcut-containment/runs/2026-11-14-22-46-40.md)

## Intent

Verify that a key injected through a **jar-scoped** automation key reaches only the page: it does not open or close tabs, move focus to the address bar, open DevTools, print, zoom, reload, open the find bar or the downloads page, open a window, or quit the app - while the same chord injected with the **admin** key still acts (the admin tier is how the chrome is driven in tests). Mission 23 Flight 2 (leg `automation-input`) found that the guest's `before-input-event` handler ran every browser shortcut with no knowledge of who sent the key, and that Electron's default application menu bound further chords (Ctrl+Q quits the app) that never pass through that handler at all. After the leg, a jar-tier key injection returns the handler before every branch without preventing the key, and asks the target to ignore application-menu shortcuts while it runs. This needs a behavior test because the property exists only across the real input pipeline, the real application menu and the real chrome.

## Preconditions

- Goldfinch running via `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_IPC_TRACE=1 npm run dev:automation` against a **scratch profile** (`XDG_CONFIG_HOME` set to a fresh temporary directory; never the operator's dev profile), stdout captured to a file the Executor can read. **Two clients** are attached with `connectAutomation()` (`scripts/lib/mcp-client.mjs`) from the one printed `AUTOMATION_DEV_MINT` line: one with the **jar key** (the actor), one with the **admin key** (observation and the control). **Never** a registered MCP server.
- The fixture server `tests/behavior/fixtures/page-containment-probe/server.cjs` on `127.0.0.1:8231`, serving `key-recorder.html`: a page that records every `keydown` it receives (`window.keyLog()`, `window.keyCount()`, `window.keyReset()`).
- **Non-vacuity is established outside this spec, by measurement.** Leg `automation-input` recorded, on the pre-change tree (Electron 45.3.2, scratch profile, a jar key), that **each chord in the table below acted**. The run reads the table from the flight log; a chord that did not act pre-change is not a row here.

  | Chord | What acted pre-change | Path |
  |---|---|---|
  | F6, Shift+F6, Ctrl+L | focus moved to the address bar / the chrome's last control | cross-view hop |
  | Ctrl+T | new tab | chrome shortcut |
  | Ctrl+W | tab closed | chrome shortcut |
  | Ctrl+N | a second window opened | chrome shortcut |
  | Ctrl+Shift+T | closed tab reopened | chrome shortcut |
  | Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1, Ctrl+9 | active tab changed | chrome shortcut |
  | Ctrl+M, Ctrl+Shift+P, Ctrl+Shift+B | media panel / privacy panel / bookmarks bar toggled | chrome shortcut |
  | Ctrl+D | the bookmark popover opened (`sheetVisible` true) | chrome shortcut |
  | Ctrl+R, Ctrl+Shift+R, F5, Ctrl+F5 | page reloaded (`performance.timeOrigin` changed) | chrome shortcut |
  | Ctrl+F | the find bar showed (`findVisible` true) | main-side branch |
  | Ctrl+J | a downloads tab opened | main-side branch |
  | Ctrl+=, Ctrl+-, Ctrl++, Ctrl+0 | zoom changed | main-side branch |
  | Ctrl+Shift+I | DevTools opened (`isDevtoolsOpen` true) | main-side branch |
  | Ctrl+P | the page stopped answering `evaluate` (a print job started) | main-side branch |
  | **Ctrl+Q** | **the app quit** | **the default application menu - not the guest handler** |

  Chords that did not act pre-change and are not rows: Escape, Ctrl+U, Ctrl+S (the page received them and nothing else happened). F11 and F12 are not in `pressKey`'s vocabulary and cannot be sent by any tier. For a **popup** opened from a jar tab the same handler ran: zoom acted and print stalled the page; the chrome-bound chords did nothing there (no owning chrome); DevTools on a popup is not observable through `isDevtoolsOpen` (it refuses popups) and is asserted by the unit tests only.
- **Apparatus (act)**: `pressKey` with `name` and `modifiers` from the jar client. **Apparatus (observe)**, all through the admin client: `enumerateTabs` and `enumerateWindows` (tab census, active tab, `sheetVisible`, `findVisible`); `evaluate` on the chrome target for the chrome's own state (`document.activeElement.id`, the class of `#media-panel`, `#privacy-panel`, `#bookmarks-bar`, the `#address` value, `window.goldfinch.isDevtoolsOpen({ webContentsId })`); `getZoom`; `evaluate` on the tab for `performance.timeOrigin` and `window.keyLog()`. **Zoom is per origin and persists across tabs**: set it to 1.2 with `setZoom` before the zoom rows so Ctrl+0 is visible, and reset it to 1 afterwards. `readAxTree` does **not** reveal an open DevTools on this runtime.
- **Unobservable, not asserted here**: whether a print dialog is on screen (only that the page kept answering); the toast layer; a native window's placement.
- No step types a master password or touches a vault sheet.

## Observables Required

- mcp (`enumerateTabs`, `enumerateWindows`, `openTab`, `closeTab`, `activateTab`, `pressKey`, `evaluate`, `getZoom`, `setZoom`, `getChromeTarget`)
- shell (the app's captured stdout; the fixture's HTTP status)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Attach both clients; `tools/list` on each; with the admin client `enumerateWindows` and `getChromeTarget`; `curl` the fixture. | Both attach; `pressKey`, `enumerateTabs`, `evaluate` present; one booted window; the fixture answers 200. **If either client cannot attach or the fixture is down, halt.** |
| 2 | **Set-up.** With the jar client `openTab` on `http://127.0.0.1:8231/key-recorder.html`; record its wcId **T**. With the admin client: `activateTab(T)`; on the chrome target `evaluate` `window.goldfinch.focusActiveGuest()`; blur the chrome's active element; jar `click` on the page body at (600, 300); `setZoom(T, 1.2)`. Take snapshot **S0**: tab census (ids and which is active), `enumerateWindows`, the chrome's state (above), `isDevtoolsOpen(T)`, `getZoom(T)`, the page's `performance.timeOrigin` and `keyCount()`. | The page is loaded and focused (`document.hasFocus()` true); zoom reads 1.2; DevTools closed; `keyCount()` is 0. *(Setup row.)* |
| 3 | **Control first: the admin key still runs a shortcut.** With the **admin** client `pressKey` Ctrl+T on **T**; wait 1.2 s; take **S1** and compare to **S0**. Admin `pressKey` Ctrl+= on **T**; `getZoom`. Admin `pressKey` F6 on **T**; read the chrome's active element. Then reset: `closeTab` every tab except the first, repeat the step 2 set-up. | After Ctrl+T the address field is empty and **T** is no longer the active tab (the welcome tab is). After Ctrl+= the zoom exceeds 1.2. After F6 the chrome's active element is `address`. *(This proves the observation works and the admin tier is unchanged. A control that shows nothing halts the run: apparatus failure, not a pass.)* |
| 4 | **Cross-view hops.** For each chord in F6, Shift+F6, Ctrl+L: re-run the step 2 set-up; jar `pressKey` the chord on **T**; wait 1.2 s; take **S1**. | For every chord: the page's `keyLog()` ends with that key (it reached the page); the chrome's active element is unchanged from **S0**; the tab census, `enumerateWindows` flags, zoom and `timeOrigin` are all unchanged. |
| 5 | **Tab management.** Same shape for Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1, Ctrl+9 (for Ctrl+9 first open a second tab with the jar client and re-activate **T**), and Ctrl+N. | For every chord: the page recorded the key; the tab census and which tab is active are exactly **S0**'s; no second window appears (`enumerateWindows` still lists one window row); **T** is still listed. |
| 6 | **Panels and bars.** Same shape for Ctrl+M, Ctrl+Shift+P, Ctrl+Shift+B, Ctrl+D, Ctrl+F, Ctrl+J. | For every chord: the page recorded the key; the media panel, privacy panel and bookmarks bar classes are unchanged; `sheetVisible` is false (no bookmark popover); `findVisible` is false; no downloads tab is in the census. |
| 7 | **Reload.** Same shape for F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5. | For every chord: the page recorded the key (`keyCount()` is 1, so the page did **not** reload, which would reset it); `performance.timeOrigin` is unchanged. |
| 8 | **Zoom, DevTools, print.** Same shape for Ctrl+=, Ctrl+-, Ctrl++, Ctrl+0, Ctrl+Shift+I and Ctrl+P (zoom starts at 1.2). | For every chord: the page recorded the key; `getZoom` reads 1.2 throughout; `isDevtoolsOpen(T)` is false; after Ctrl+P the page still answers `evaluate` within 2 s (a print job would stall it). |
| 9 | **Popup.** From **T** with the jar client `evaluate` `window.open('/key-recorder.html','pp','width=500,height=400')`; find the popup's wcId in `enumerateWindows` (a row with `popupWcId`); jar `click` in it; jar `pressKey` Ctrl+= then Ctrl+P on it. | The popup's page recorded both keys; `getZoom(popup)` is unchanged; the popup's page still answers `evaluate` within 2 s after Ctrl+P. |
| 10 | **The application menu: Ctrl+Q.** First close the popup from step 9 — jar `evaluate` `window.close(), 1` in the popup (the `closeTab` tool does not close a popup) — and confirm `enumerateWindows` has no row with `popupWcId`: while a popup is open, a Ctrl+Q injected into the opener never reaches the application menu at all, so this row would prove nothing. Then jar `pressKey` Ctrl+Q on **T**; wait 3 s; admin `evaluate` `window.keyLog()` on **T**; `enumerateTabs`. *(Run this row last among the jar rows: it is the chord that quit the app pre-change.)* | The app is **still running** (the admin client still answers); the page recorded `q` with control; the census is unchanged. |
| 11 | **Page still receives everything else.** Jar `click` and `typeText` into the fixture's `#f` field; jar `pressKey` Tab and Escape. | The field holds the typed text; the page recorded the Tab and Escape keydowns. *(Ordinary page input is untouched.)* |
| 12 | **The operator's own shortcut is untouched** `[by-eye]`. After the run's last injection, wait 2 s, then press Ctrl+T on the keyboard in a tab. | A new tab opens. *(Not judged by the unattended run: the apparatus cannot press a physical key.)* |
| 13 | **Closing liveness and teardown.** Confirm `enumerateWindows` still has no row with `popupWcId` (the popup was closed in step 10). Wait 2 s so the menu hold has lapsed. Admin `pressKey` Ctrl+Q on **T**; wait 4 s. If the process is still alive, stop it with a plain `kill` of the PID the run launched. | No popup row remains before the chord. The admin client's Ctrl+Q **quits the app** — the application menu is live again after the jar injections; a non-quit here is a **FAIL**. Stdout has no `Error` line from the injected-input code. *(Why the popup is closed first — measured 2026-11-14: while a popup is open, a Ctrl+Q injected into the **opener** tab does not reach the application menu at all, with or without any jar key having been sent; injected into the popup it quits. The first run of this spec left the popup open and mis-read that as the menu staying ignored; the second closed it only here, which left step 10 proving nothing. This row is also step 10's control: the same chord, on the same tab, in the same state, from the admin tier, does quit.)* |

## Out of Scope

- The admin tier's own shortcut behaviour beyond the step 3 control (`chrome-guest-keyboard-nav` and `mcp-drive-end-to-end` carry it).
- A physical keypress (step 12 is the operator's).
- DevTools on a popup (not observable here; unit-tested in `test/unit/guest-wiring.test.js`).
- The vault fill icon and the witness: `vault-gesture-trust`.
- Session expiry and permission handling: leg `automation-bounds`.
