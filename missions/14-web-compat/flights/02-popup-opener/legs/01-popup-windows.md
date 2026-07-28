# Leg: popup-windows

**Status**: landed
**Flight**: [Popup & Opener Ruling + Implementation](../flight.md)

## Objective

Implement DD1's core mechanics: qualifying popup requests become real `BrowserWindow` popups with a live opener, registered in a new popup registry, carrying guest discipline (latch, nav guards, preload, close handling) and the DD1f/DD1e lifecycle rules.

## Context

- Governing ruling: flight DD1 (Option B, human-approved) with sub-decisions DD1a–f; DD2 (no `createWindow` override — pin its absence), DD3 (scope guard: genuine request + `isSafeTabUrl` + non-internal opener).
- Spike facts (flight log): allow+override preserves opener fully; session automatically the opener's jar; preload injectable via the override (plain-allow observed); `did-create-window` fires; teardown events `close`→`destroyed`; catch-all `web-contents-created` fires before adoption-era hooks (latch timing under plain allow **unverified** → this leg's premise check #1); full webPreferences posture under allow+override **unverified** → premise check #2 (DD1d + parity ruling: preload honored, `contextIsolation:false`, `sandbox:true`, `nodeIntegration:false`, `plugins:true`).
- Challenge routing, census, addressability, and the fixture/spec are **leg 2** — this leg must leave clean seams (registry query surface) for them.

## Inputs

- Branch `flight/02-popup-opener` from Flight-1-complete tree (2993 tests green).
- Current deny site: `guest-wiring.js:89` (`setWindowOpenHandler` → forward `open-tab` → deny). Catch-all deny + non-guest guard: `app-lifecycle.js:121-126` region. `guest-window-close` handler: `register-browser-ipc.js:302`; shim send: `webview-preload.js:508`.

## Outputs

- New `src/main/popup-registry.js` (Electron-free DI): `register(popupWcId, {openerWcId, openerRecord, partition, win})`, `remove`, `getByWcId`, `isPopupWcId`, `listForRecord`, `rekeyForRecord`, `closeAllForRecord` — the seam leg 2 consumes
- DD3 predicate + allow path in `guest-wiring.js`'s handler (deny retained for non-qualifying); `overrideBrowserWindowOptions` per DD1d
- `did-create-window` wiring: registration, guest-discipline attachment, teardown hooks (`closed`/`destroyed` → deregister — destroy() skips `close`; DD1f close-with-opener in window teardown, ordered cancel→destroy→teardown)
- `guest-window-close` handler extended for popup wcIds (destroy the popup window)
- Both premise checks run live, results + pre-ruled fallbacks applied, recorded in the flight log
- DD1e pins (popups absent from snapshot/closed-tab structures); DD2 pin (no `createWindow` in the allow return); unit matrices
- Gates green

## Acceptance Criteria

- [x] A qualifying `window.open` (`disposition === 'new-window'`, features or named non-`_blank`, safe URL, non-internal opener) yields a `BrowserWindow` popup whose opener handle is live (unit-level via fakes; live proof is leg 2's fixture spec); the unit matrix includes named-no-features → deny-convert (Chromium classifies it `foreground-tab` — the disposition conjunction intentionally narrows the "named" axis; flight-logged)
- [x] Non-qualifying requests keep the deny-convert path with **owner-aware forwarding** (popup-originated `target=_blank` opens as a tab in the owning window — never vanishes); internal openers, unsafe URLs, and tab-intent dispositions (`background-tab`/`foreground-tab`) always deny(-convert) — predicate unit matrix covers all four axes
- [x] Premise check #1 (latch timing) and #2 (webPreferences posture) executed live before dependent code lands; results + chosen path recorded in the flight log; fallback applied if adverse (DD1c pre-ruling)
- [x] Popup contents carry the latch and `guardNav` trio + `guardFrameNav` wrapper; popup nav-guard shape is the **guest** shape, never `ALLOWED_NONGUEST_SCHEMES` (unit-pinned)
- [x] `window.close()` from popup script closes the popup with preload injected (extended `guest-window-close` path; unit-pinned) — no silent no-op
- [x] Registry lifecycle: register on create, remove on destroy, `closeAllForRecord` honors DD1f order (cancel-challenges seam invoked first — stub seam this leg, real wiring in leg 2)
- [x] DD1e + DD2 pins present; popup HTML-fullscreen non-interference asserted (native BrowserWindow handling; `htmlFullscreen` untouched by popup wcIds); popup history recorded under the opener's jar (recorder wired)
- [x] `timeout 300 npm test`, lint, typecheck green

## Verification Steps

- `node --test test/unit/popup-registry.test.js` (new) + updated `guest-wiring.test.js`, `register-browser-ipc.test.js`, `app-lifecycle.test.js`; full gates
- Premise checks per flight-log recording discipline (instance identity verified first — stale-instance lesson)

## Implementation Guidance

1. Predicate first (pure, exported for tests): qualifying = `disposition === 'new-window'` ∧ (`features` string non-empty ∨ `frameName` ∉ {`''`,`'_blank'`}) ∧ `isSafeTabUrl(url)` ∧ ¬internal-opener-session. **Disposition axis is a DD3 refinement within the flight's delegated latitude** (FD ruling, flight-logged): without it, middle-clicks (`background-tab`) and plain clicks on named-target links would become focused floating popups — tab-intent dispositions must keep the deny-convert path. Unit matrix covers all four axes incl. disposition cases. Handler: qualifying → `{action:'allow', overrideBrowserWindowOptions:{ webPreferences: {preload: <webview-preload.bundle.js path — main.js:1317 value>, contextIsolation:false, sandbox:true, nodeIntegration:false, plugins:true}, autoHideMenuBar:true }}` (**`plugins:true` = guest parity ruling** — else the AC4 `guardFrameNav` carve-out is dead code in popups; folded into premise check #2's posture list); else deny path (reworked in step 1b).
1b. **Popup-originated `window.open` (review Issue 1, leg-1 scope)**: the handler's owner resolution is **popup-registry-first** — a popup opener resolves its registry entry's `openerRecord` (liveness-checked; dead/absent → deny), falling back to `getWindowForGuest` for tab openers. The deny-convert forward routes `open-tab` to the **resolved owning window's chrome** with the popup's captured partition — a "forgot password" link inside an OAuth popup must open as a tab in the opener's window, never vanish. Chained qualifying popups parent to the same `openerRecord` (flat).
2. Premise checks (temporary instrumentation, removed after): #2 first (posture — if `contextIsolation:false`/preload combination misbehaves under allow+override, stop and divert per DD1d before more lands); then #1 (latch: log first nav event vs `did-create-window` order; adverse → pending-popup-entry fallback per DD1c).
3. `did-create-window` is emitted by the **opener** webContents with the BrowserWindow in its args — wire it in `wireGuestContents` (which already holds the opener contents, `registry`, `isSafeTabUrl`, `getHistoryRecorder`; new deps threaded from main.js: `popupRegistry`, `webPreloadPath`). App-lifecycle is touched only if premise #1 forces the DD1c pending-popup latch fallback. Registration captures `{popupWcId, openerWcId, openerRecord, partition (from openerRecord.tabViews at register time), win}` — partition captured eagerly because leg 2's census/attribution needs it after the opener tab dies. Attach: latch (per premise result), `wireGuestContents` reuse for the guard/latch/input surfaces (audited: guards have no owner lookups; `htmlFullscreen.enter` early-returns on registry miss — safe), plus a **slim popup-variant** of tab-event wiring (did-navigate/in-page → recorder under the captured partition, page-title-updated, teardown) — do NOT wholesale-reuse `wireTabViewEvents`. **Named-accepted input gaps** (Electron-default parity, documented for HAT): chrome shortcuts swallowed in popups (Ctrl+L/T/F/J no-op), no context menu. Teardown hooks ride events `destroy()` actually emits (`closed` on the window, `destroyed` on contents — `win.destroy()` skips `close`); teardown inputs captured at wiring time (house destroyed-window rule); `historyRecorder.forgetTab(popupWcId)` on teardown (CLAUDE.md-required; the window-factory close loop only covers `tabViews`).
3b. **Opener-tab lifecycle (review Issue 4)**: opener tab **closed** → popup persists (browser parity); registry entry tolerates a dead `openerWcId` (leg 2's eligibility rule must not depend on it staying alive — seam note recorded). Opener tab **moved to another window** → `moveTabIntoWindow` gains a re-key hook: popup entries re-key to the destination record, so DD1f closes popups with their *current* owning window. Both in the unit matrix.
4. `guest-window-close` (`register-browser-ipc.js:302`): popup-registry lookup before the tab path; popup → destroy its BrowserWindow.
5. Window teardown (`window-factory.js` close path, `:254-305`): the existing **`authChallenges.cancelForWindow(record)` stays FIRST** (unit-pinned invariant at `:259`); `popupRegistry.closeAllForRecord` slots after it and before sheet/overlay teardown (DD1f order preserved — the cancel-challenges stub then double-cancels harmlessly). `closeAllForRecord` snapshots its list before destroying (deregister-on-`closed` mutates mid-iteration otherwise).
6. Tests per AC; source-scan pin for DD2 (allow return contains no `createWindow` key); pin that the app-lifecycle non-guest catch-all deny is byte-unchanged (DD3's "catch-all stays" clause). Registry exposes `isPopupWcId` — the exact predicate leg 2's `resolve.js:141` widening consumes (seam note).

## Edge Cases

- Popup opens while opener is fullscreen (native popup appears over; no `htmlFullscreen` interaction — assert)
- Qualifying request from a popup (chained): predicate applies identically; registry parents chained popups to the same opener record (flat, not a tree) — named simplification, documented
- Popup navigates cross-origin then back — opener handle semantics are Chromium's; no goldfinch machinery involved (assert-only)
- `window.open` during opener teardown: registry register against a dying record → refuse allow (deny path) if record absent/destroyed

## Files Affected

- `src/main/popup-registry.js` (new), `src/main/guest-wiring.js`, `src/main/register-tab-ipc.js` (`moveTabIntoWindow` re-key hook at `:390` — **synchrony-pinned function**: the hook must stay synchronous, no await), `src/main/register-browser-ipc.js`, `src/main/window-factory.js`, `src/main/main.js` (threading), `src/main/app-lifecycle.js` (DD1c fallback only — touched solely if premise #1 is adverse)
- `test/unit/popup-registry.test.js` (new) + `guest-wiring.test.js`, `register-browser-ipc.test.js`, `register-tab-ipc.test.js`, `window-factory.test.js`, `app-lifecycle.test.js` (catch-all byte-unchanged pin)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md

## Citation Audit

Verified at design time: `guest-wiring.js:89` (handler), `app-lifecycle.js:121-126` (catch-all + setter comment), `register-browser-ipc.js:302` (`guest-window-close`), `webview-preload.js:508` (shim send), `auth-challenges.js:144/150` (presentNext eligibility — leg 2's wall, cited for the seam note), `resolve.js:141` (`isTabViewWcId` gate — leg 2). All OK.
