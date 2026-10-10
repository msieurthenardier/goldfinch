# Behavior Test: Hard reload bypasses the cache

**Slug**: `hard-reload`
**Status**: active
**Created**: 2026-10-10 (Sortie 03 — Hard Reload)
**Last Run**: 2026-10-10-20-29-57 (pass — 14/14 checkpoints; step 15 run as 11 controlled operator trials; see `hard-reload/runs/2026-10-10-20-29-57.md`)

## Intent
Verify that every hard-reload trigger (Ctrl+Shift+R, Shift+F5, Ctrl+F5, Shift+click on the reload button, MCP `reload` with `ignoreCache: true`) re-fetches a cached subresource from the network, that every normal-reload trigger (Ctrl+R, F5, plain click, MCP `reload`) still serves it from the cache, and that neither reloads the chrome view (the Electron default menu's own Force Reload accelerator must not fire — Sortie 03 DD7). Whether a resource came from the HTTP cache is a property of the running Chromium network stack, invisible to the unit suite, so it is observed server-side by counting requests.

## Preconditions
- Goldfinch running via **`GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`** (loopback MCP transport, admin tier).
- **Apparatus-wiring litmus passed**: the MCP client is bound to *this* instance at admin tier — `getChromeTarget()` returns this instance's chrome `wcId`; `enumerateTabs()` lists *this* instance's tabs.
- The Sortie 03 build is running: `pressKey(G, "F5")` is accepted (`F5` in the automation `KEY_MAP`) and the `reload` tool schema lists `ignoreCache`.
- Fixture server running: `node tests/behavior/fixtures/hard-reload/server.mjs` (listens on `127.0.0.1:8766`). `GET /index.html` → `Cache-Control: no-store`, sets `window.__loadId` to a per-response counter, loads `/asset.js?n=<nonce>`. `GET /asset.js` → `Cache-Control: max-age=3600`. `GET /hits` → JSON `{ asset: <count>, last: { cacheControl, pragma } }`. `GET /reset` zeroes the counters **and mints a new nonce**, so an `asset.js` cached by an earlier run is never reused (the profile's HTTP cache persists across runs).

## Observables Required
- mcp (MCP tool results over loopback — `getChromeTarget`/`enumerateTabs`/`enumerateWindows`/`openTab`/`activateTab`/`pressKey`/`evaluate`/`reload`/`captureWindow`; measured via the Goldfinch MCP client at `127.0.0.1:$GOLDFINCH_MCP_PORT`). The `chrome-devtools` MCP does **not** qualify (it launches its own browser).
- http (the fixture's `/hits` counter — measured via `curl -s http://127.0.0.1:8766/hits` in the shell). **Read path (load-bearing):** the server-side `asset` count is the cache observable; it moves only when Chromium actually sends a request for `/asset.js`.
- browser (corroborators): `evaluate(G, "window.__loadId")` proves a reload happened; `evaluate(G, "performance.getEntriesByType('resource').find(e=>e.name.endsWith('/asset.js'))?.transferSize")` is `0` on a cache hit; `evaluate(C, "window.__hrMarker")` plus `enumerateWindows()` `chromePid` prove the chrome did not reload.

## Steps

Each reload step: wait until the previous load has finished (`enumerateTabs()` row for G has `loadState: 'ok'` and `evaluate(G, "document.readyState")` is `complete` — otherwise the reload button may still show ✕ and a click would stop instead), then record `L = evaluate(G, "window.__loadId")` and `H = curl /hits .asset`; after acting, wait up to 5 s for `__loadId` to change.

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Wiring litmus.** `getChromeTarget()`; `enumerateTabs()`; `enumerateWindows()`. | `getChromeTarget()` returns a numeric chrome `wcId` (record **C**); `enumerateTabs()` lists this instance's tabs; record the window's `chromePid` as **P**. |
| 2 | (Setup) `curl -s http://127.0.0.1:8766/reset`. `openTab("http://127.0.0.1:8766/index.html")` (record **G**); `activateTab(G)`; wait for `evaluate(G, "window.__loadId")` to be a number. `evaluate(C, "window.__hrMarker = 1")`. | (empty) |
| 3 | **Baseline.** `curl -s http://127.0.0.1:8766/hits`. | `asset` is `1` (the first load fetched it). |
| 4 | **Ctrl+R from the page is a normal reload.** `pressKey(G, "r", ["control"])`. | `__loadId` changed; `asset` is unchanged (served from the cache); the `asset.js` `transferSize` is `0`. |
| 5 | **F5 from the page is a normal reload.** `pressKey(G, "F5")`. | `__loadId` changed; `asset` is unchanged. |
| 6 | **Ctrl+Shift+R from the page is a hard reload.** `pressKey(G, "R", ["control", "shift"])`. | `__loadId` changed; `asset` went up by exactly 1; `last.cacheControl` is `no-cache`. |
| 7 | **Shift+F5 from the page is a hard reload.** `pressKey(G, "F5", ["shift"])`. | `__loadId` changed; `asset` went up by exactly 1. |
| 8 | **Ctrl+F5 from the page is a hard reload.** `pressKey(G, "F5", ["control"])`. | `__loadId` changed; `asset` went up by exactly 1. |
| 9 | **Ctrl+Shift+R with the chrome focused is a hard reload.** `evaluate(C, "document.getElementById('address').focus()")`; `pressKey(C, "R", ["control", "shift"])`. | `__loadId` changed; `asset` went up by exactly 1. |
| 10 | **Ctrl+R with the chrome focused is a normal reload.** `evaluate(C, "document.getElementById('address').focus()")`; `pressKey(C, "r", ["control"])`. | `__loadId` changed; `asset` is unchanged. |
| 11 | **Shift+click on the reload button is a hard reload.** `evaluate(C, "document.getElementById('reload').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))")`. | `__loadId` changed; `asset` went up by exactly 1. |
| 12 | **Plain click on the reload button is a normal reload.** `evaluate(C, "document.getElementById('reload').click()")`. | `__loadId` changed; `asset` is unchanged. |
| 13 | **MCP reload, both modes.** `reload({ wcId: G })`; wait; then `reload({ wcId: G, ignoreCache: true })`. | After the first call `__loadId` changed and `asset` is unchanged; after the second `__loadId` changed again and `asset` went up by exactly 1. |
| 14 | **The chrome never reloaded on the synthetic paths.** `evaluate(C, "window.__hrMarker")`; `enumerateWindows()`; `captureWindow()`. | `__hrMarker` is `1`; `chromePid` equals **P**; the captured window shows the fixture page in the tab strip and content area (the chrome is intact, no blank or rebooting chrome). |
| 15 | **[by-eye] Real keypress (DD7).** The operator focuses the address bar and physically presses Ctrl+Shift+R, then clicks into the page and physically presses Ctrl+Shift+R again. After each: `evaluate(C, "window.__hrMarker")`, `enumerateWindows()`, `curl /hits`. | `asset` went up by exactly 1 each time; `__hrMarker` is still `1` and `chromePid` still equals **P** (the Electron default menu's Force Reload did not also fire; `pressKey`'s `sendInputEvent` may bypass the native accelerator path, so steps 6–14 cannot prove this). |

## Out of Scope
- The menu-overlay sheet path (shortcuts pressed while a menu is open): the sheet is not scriptable (`docs/mcp-automation.md`, standing unobservable-surfaces list); covered by `sheet-accelerator.test.js` and `shortcut-classifier-parity.test.js`.
- The no-op on internal `goldfinch://` and welcome tabs: `evaluate` is refused on internal guests and a welcome tab has no guest; covered by `shortcut-controller.test.js`, `guest-forward-allowlist.test.js` and `guest-wiring.test.js`.
- Service-worker and memory-cache behavior: `reloadIgnoringCache` is Chromium's own semantics; this test checks only that Goldfinch reaches it.
- Related: [`chrome-guest-keyboard-nav`](chrome-guest-keyboard-nav.md) (the guest key-forwarding mechanism this relies on).
