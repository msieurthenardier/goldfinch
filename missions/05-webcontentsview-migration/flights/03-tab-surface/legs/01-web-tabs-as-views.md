# Leg: web-tabs-as-views

**Status**: landed
**Flight**: [Tab Surface](../flight.md)

## Objective

Migrate **web** (untrusted) guest tabs from renderer `<webview>` elements to per-tab main-process
`WebContentsView`s — registry + accessor, byte-exact per-tab `webPreferences` at construction, the
guest-event predicate swap, main-process geometry/visibility, the renderer control-verb re-point, the
tab-strip-essential event re-home, the minimal media-rescan/found-in-page transport re-point, the
`download-media` active-tab fallback, and the `captureWindow` composite fix — such that the app runs with
web tabs opening, browsing, switching, and closing as native views. Internal `goldfinch://` tabs remain
`<webview>` this leg (`webviewTag` stays on; Leg 2 migrates them).

## Context

- **The architecture shift (read first).** Today the **renderer** owns everything: `createTab`
  (`renderer.js:createTab`, ~718) builds a `<webview>` DOM element, sets `partition`/`preload`, appends to
  `#webviews`, and Electron creates the guest `webContents` on attach. After this leg, **main** owns the
  guest substrate: the renderer asks main (over IPC) to create/activate/close/navigate a tab; main
  constructs the `WebContentsView`, sets its `webPreferences` at construction, `addChildView`s it, drives
  `setBounds`/`setVisible`, and forwards guest events back to the chrome renderer. **The renderer stays
  the orchestrator of *which* tab is active** (it owns the tab model + strip UI + the
  `window.__goldfinchAutomation` hook); it **delegates** the view's lifecycle/geometry/visibility to main.
- **Why this preserves the MCP foreground-to-act seam for free.** The automation engine's
  `activate(wcId)` → `tabs.activateTab(wcId, deps)` (`engine.js:62`, `engine.js:70`) drives the renderer's
  `activateTab` via `executeInRenderer` (`automation/tabs.js:18-19`). As long as the renderer's
  `activateTab` (`renderer.js:804`) **notifies main to `setVisible`**, the whole MCP observe/act path
  (`captureScreenshot`/`readDom`/`readAxTree`/input all call `activate` for guests) keeps working with no
  change to `automation/tabs.js`. This is the load-bearing design choice — keep the renderer hook intact;
  add a main-notify inside `activateTab`.
- **Design decisions in scope** (from `flight.md`): DD1 (one view per tab + `setVisible`), DD2
  (registry + `getTabContents`/`getActiveTabContents`, keep `getChromeContents`; guard the real send
  target), DD3-web (byte-exact web `webPreferences` at construction; **no `spellcheck` key**), DD4 Leg-1
  half (swap the `getType()==='webview'` predicate to registry membership — constructed views report
  `getType()==='window'`), DD5 (renderer-measures-`#webviews`-and-sends-bounds + the five apparatus
  requirements), DD6 (tab-strip-essential event re-home + the **minimal** `rescan-media`/`found-in-page`
  transport re-point — NOT the full F4 rewrite), DD7 (`download-media` → `getActiveTabContents()`), DD8
  (popups/sessions/nav guards survive), DD10 (farble main-world preload at construction), DD11
  (`captureWindow` composite fix).
- **Out of scope (later legs):** internal `goldfinch://` tabs (Leg 2); `webviewTag`/`will-attach-webview`
  *deletion* (Leg 3 — the hook still fires for internal `<webview>`s this leg); the full F4 event-seam
  rewrite (the `find.js` D1 workaround, privacy-stream re-architecture).

## Inputs

What exists before this leg (post-Flight-2, `flight/03-tab-surface` branched off the mission branch):
- `BaseWindow` + chrome `WebContentsView` shell; `getChromeContents()` accessor; `mainWindow.contentView`.
- Web tabs are `<webview>` elements created in `renderer.js:createTab`; the `will-attach-webview` hook
  (`main.js:330-346`) sets per-tab `webPreferences`; `web-contents-created` (`main.js:410-523`) wires
  guest events behind `if (contents.getType() === 'webview')`.
- `webviewTag:true` on the chrome view (`main.js:297`).
- The IPC bridge in `chrome-preload.js` (existing channel idioms — see Implementation Guidance).
- The guest preload `webview-preload.js` (`sendToHost('media-list')` ~175, `sendToHost('privacy-fp')` ~219,
  `on('rescan-media')` ~203, `sendSync('shields-farble')` ~231).
- `captureWindow` = `chromeContents.capturePage()` (`observe.js:212-214`); `captureScreenshot` per-guest
  (`observe.js:120-133`); `classifyContents` keys on `wc === chromeContents` (`resolve.js:48`).

## Outputs

After this leg:
- A main-process **tab-view registry** + `getTabContents(wcId)` / `getActiveTabContents()` accessors.
- Web tabs are `WebContentsView`s constructed with byte-exact web `webPreferences`; positioned/shown by
  main from renderer-sent bounds; closed/destroyed by main.
- `web-contents-created` guest wiring fires for tab views (registry predicate, not `getType()`).
- Tab-strip-essential events and `media-list`/`found-in-page` flow main→chrome over new IPC channels;
  `rescan-media` flows chrome→main→view.
- `download-media` falls back to the active tab's contents.
- `captureWindow` composites chrome + active guest on the sibling-view surface.
- Internal tabs unchanged (still `<webview>`). `webviewTag:true` still present.
- `npm test` / `npm run typecheck` / `npm run lint` green.

## Acceptance Criteria

- [ ] **AC1 — Registry + accessors.** A module-level tab-view registry exists in `main.js` keyed by guest
  `webContents.id`; `getTabContents(wcId)` returns that view's `webContents` (or null) and
  `getActiveTabContents()` returns the active tab view's `webContents` (or null). `getChromeContents()` is
  unchanged and still used for chrome-renderer sends. (DD2)
- [ ] **AC2 — Web tab views constructed with byte-exact `webPreferences`.** Web tabs are created as
  `new WebContentsView({ webPreferences: { preload: <webview-preload>, contextIsolation:false,
  sandbox:false, nodeIntegration:false, partition: <jar.partition> } })` with **no `spellcheck` key**
  (inherit default; `applySpellcheck` owns the live web toggle). Added via
  `mainWindow.contentView.addChildView(view)`; `view.webContents.loadURL(url)`. (DD3-web, DD10)
- [ ] **AC3 — Guest wiring binds to tab views via EXPLICIT construction-time wiring (DD4, mechanism
  refined at leg-design review).** The full guest-event wiring (`setWindowOpenHandler`, `will-navigate`,
  `before-input-event` zoom/find/print/devtools, `devtools-opened/closed`, `context-menu`) is extracted
  from the `app.on('web-contents-created')` body into a shared `wireGuestContents(contents)` function and
  **called explicitly in `tab-create` right after constructing the view** — because `web-contents-created`
  fires *synchronously during* `new WebContentsView()` (before the constructor returns), so a
  registry-membership test in the global handler can't see the not-yet-returned view. The global
  `web-contents-created` handler **keeps its `getType()==='webview'` filter** for internal `<webview>`s
  this leg (tab views report `getType()==='window'`, so they're naturally excluded — no double-wiring).
  Nothing else keys behavior on the `getType()` string (the chrome view also reports `'window'`). *(DD4's
  intent — tab views receive the guest wiring — is met; its prescribed "global-handler predicate swap" is
  superseded by explicit wiring per the leg-design review; see flight log.)*
- [ ] **AC4 — Geometry (all five DD5 requirements).** (a) The renderer measures the `#webviews` slot via
  `getBoundingClientRect()` and sends bounds to main, which calls `view.setBounds(...)`; (b) **the rect is
  sent DIRECTLY as DIP — NO `devicePixelRatio` division.** `getBoundingClientRect()` returns CSS logical
  px, which already equal DIP (the space `setBounds` / `getContentBounds()` use — `main.js:357`); dividing
  by `devicePixelRatio` would wrongly shrink the view at HiDPI. **Verify at `devicePixelRatio !== 1`** that
  the view exactly fills the `#webviews` slot (this is the regression check, not a reason to scale); (c) a
  **synchronous initial-bounds seed** is set at construction (no first-frame flash); (d) tab switch is
  **atomic — `tab-set-active` carries the incoming view's bounds** so main can sequence **set-bounds →
  `setVisible(true)` incoming → `setVisible(false)` outgoing** in one IPC (no race between a separate
  set-bounds and the visibility toggle); (e) the geometry IPC is sent on a chosen debounce/rAF strategy
  across resize and the #27 panel toggle (decision recorded in the flight log). (DD5)
- [ ] **AC5 — Show/hide + activation.** Only the active tab's view is visible; the renderer's `activateTab`
  notifies main to `setVisible` the right view; the automation `activate(wcId)` path (via the
  `__goldfinchAutomation` hook) still foregrounds a guest view. (DD1)
- [ ] **AC6 — Renderer control verbs re-pointed.** Every `<webview>` method callsite (loadURL, reload,
  stop, goBack, goForward, canGoBack/canGoForward, getURL, getWebContentsId, focus,
  findInPage/stopFindInPage, executeJavaScript, send, the `.remove()`, the `.classList.toggle('hidden')`)
  is re-pointed to an IPC call against the main-process view (or removed where the DOM element is gone).
  No `tab.webview` element reference remains for web tabs. (DD6/DD8)
- [ ] **AC7 — Tab-strip-essential events re-homed.** `did-navigate`/`did-navigate-in-page`,
  `page-title-updated`, `page-favicon-updated`, `did-start-loading`/`did-stop-loading`, **`did-finish-load`
  (drives the post-load zoom-label refresh, `renderer.js:1031-1033`), and `dom-ready` (drives the
  zoom-control initial reveal + cookie-fetch-on-panel-open, `renderer.js:941-960`)** fire on the
  main-process guest `webContents`, are forwarded to the chrome renderer over new IPC channels, and the tab
  strip + address bar + nav buttons + zoom label update correctly. (DD6)
- [ ] **AC8 — Media panel + in-page find stay alive (minimal re-point).** `rescan-media` flows
  chrome→main→`view.webContents.send('rescan-media')`; the guest preload's `media-list`/`found-in-page`
  reach the chrome renderer (guest `sendToHost` → `ipcRenderer.send` to main → forward to chrome). The
  media panel re-catalogs media on navigation and in-page find shows live match counts. (DD6 minimal)
- [ ] **AC9 — `download-media` active-tab fallback.** The fallback is `wc || getActiveTabContents()` (not
  `getChromeContents()`), so a download with no explicit `webContentsId` rides the active guest's session.
  (DD7)
- [ ] **AC10 — `captureWindow` composites the guest.** `captureWindow` returns a PNG showing **chrome +
  the active guest** on the sibling-view surface. **`observe.js` stays Electron-free** (its DD: no direct
  Electron requires) — the window grab is implemented in `main.js` (which already imports Electron) and
  **injected through the engine deps bag** as a bound function (e.g. `deps.grabWindow()`); `observe.js`
  only calls it via `captureWindow({ grabWindow })`. The existing **`test/unit/automation-observe.test.js`
  `captureWindow` tests (lines ~447-465) are updated** — the happy path fakes `grabWindow`; the
  null-guard test asserts `captureWindow({ grabWindow: null })` throws `'automation: chrome window
  unavailable'` (the guard moves from `chromeContents` to `grabWindow`). If the window grab
  returns empty/too-small (a WSLg risk), fall back to a chrome+active-guest composite or surface it as the
  DD11 divert (judged on the PNG). `captureScreenshot(wcId)` still works per-guest unchanged
  (`classifyContents` still classifies tab views as 'guest', `resolve.js:48`). (DD11)
- [ ] **AC11 — Guest wiring proven to FIRE on a tab view.** Smoke (manual or scripted): a
  `target=_blank`/`window.open` **opens as a new tab** (not a native window); an **unsafe nav is blocked**
  by `will-navigate`; a **DevTools toggle** works; a **page context menu** appears — all on a web tab view.
  (DD4 verification)
- [ ] **AC12 — Internal tabs untouched + suite green.** Internal `goldfinch://settings`/`downloads` still
  open as `<webview>` (unchanged this leg); `webviewTag:true` still present. `npm test`,
  `npm run typecheck`, `npm run lint` all green; the app runs and web tabs browse.

## Verification Steps

- **AC1/AC2/AC3:** `grep -n "getTabContents\|getActiveTabContents\|tabViews\b" src/main/main.js` shows the
  registry+accessors; inspect the `new WebContentsView` web-tab construction for the exact webPreferences
  (and confirm **no `spellcheck` key**); confirm `web-contents-created` gates on registry membership, not
  `getType()`.
- **AC4 (DPR):** run the app under a forced `devicePixelRatio !== 1` (e.g. `--force-device-scale-factor=1.5`
  or a HiDPI display) and confirm the active web tab view exactly fills the `#webviews` slot (no offset,
  no over/undersize). Toggle the media/privacy panel and confirm the guest tracks the slot resize. Switch
  tabs rapidly and confirm no first-frame-at-stale-bounds flash.
- **AC5/AC6:** open 3 web tabs at distinct URLs; switch between them (only the active renders);
  back/forward/reload/stop and address-bar nav all work; close a middle tab (no crash); `getWebContentsId`
  equivalent resolves (the strip + automation see the wcId).
- **AC7:** navigate a tab; the strip title/favicon, address bar, and nav buttons update.
- **AC8:** open the media panel, navigate to a media-rich page → catalog populates; click rescan → refreshes;
  Ctrl+F → find bar shows live `n/m` counts.
- **AC9:** `grep -n "getActiveTabContents()" src/main/main.js` shows the `download-media` fallback; download a
  media item with no explicit wcId and confirm it uses the active tab's session.
- **AC10:** drive `captureWindow` over the admin MCP client (or the dev seam) on a page with visible guest
  content; **read the returned PNG** — it shows the rendered guest inside the chrome, not chrome-only.
  Also confirm `captureScreenshot(wcId)` still returns the guest.
- **AC11:** the four smokes above (popup-as-tab, blocked-unsafe-nav, devtools-toggle, context-menu) on a web
  tab view.
- **AC12:** open `goldfinch://settings` (still a `<webview>`); `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

Implement in this order; each phase is an internal checkpoint. **The app need not run between phases, but
MUST run with web tabs browsing at the leg's end** (atomic). Run `npm run typecheck` frequently.

1. **Main: tab-view registry + accessors (DD2).** Add a module-level `Map` (e.g. `tabViews`) keyed by
   guest `webContents.id` → `{ view, partition, trusted, active }`. Add `getTabContents(wcId)` →
   `tabViews.get(wcId)?.view.webContents ?? null` and `getActiveTabContents()` → the active entry's
   `webContents ?? null`. Leave `getChromeContents()` untouched. **Guard the real send target** when
   sending to a tab: `const wc = getTabContents(wcId); if (wc && !wc.isDestroyed()) wc.send(...)` (the
   Flight-2 `isDestroyed()` wrong-object lesson — guard `view.webContents`, not the wrapper).

2. **Main: create/close/navigate IPC + construction (DD3-web, DD8, DD10).** Add `ipcMain.handle`/`.on`
   channels the renderer drives: `tab-create` ({url, partition, trusted}) → construct
   `new WebContentsView({ webPreferences: {...web config..., partition} })` (web branch of the
   `will-attach-webview` logic at `main.js:330-346`, moved to construction — **contextIsolation:false,
   sandbox:false, nodeIntegration:false, preload=webview-preload, NO spellcheck key**), `addChildView`,
   register in `tabViews` keyed by `view.webContents.id`, `loadURL(url)`, return the wcId.
   `tab-close` (wcId) → remove from `contentView`, destroy, delete registry entry. `tab-navigate`
   (wcId, verb, args) → dispatch loadURL/reload/stop/goBack/goForward on the view (with `isDestroyed`
   guard). **Channel kinds (align with phase 9):** `tab-create` is `ipcMain.handle` (invoke → returns the
   wcId); `tab-close`/`tab-navigate`/`tab-set-active`/`tab-set-bounds`/`tab-find`/`rescan-media` are
   `ipcMain.on` (fire-and-forget). `setWindowOpenHandler` still denies + sends `open-tab` (wired by the
   explicit `wireGuestContents` call — phase 4). **Popup partition = PARITY:** preserve today's behavior —
   `open-tab` currently sends only the URL (`main.js:415`) and the renderer opens it in the default
   container; do NOT add opener-partition inheritance this leg (parity, not a feature). **Internal tabs are
   NOT constructed here** — `tab-create` with `trusted:true` is Leg 2; the renderer keeps the `<webview>`
   path for internal tabs only this leg.

3. **Main: geometry IPC + the five DD5 requirements.** Add `tab-set-bounds` (wcId, {x,y,width,height})
   → `view.setBounds(...)`. **(a) Coordinate space — send `getBoundingClientRect()` DIRECTLY, NO
   `devicePixelRatio` division.** CSS logical px (what `getBoundingClientRect` returns) already equal DIP
   (what `setBounds` and `getContentBounds()` at `main.js:357` use). Dividing by `devicePixelRatio` is the
   classic HiDPI bug — it would make the view occupy only the top-left `1/dpr` of the slot. Pass the rect
   through. TEST at DPR≠1 (`--force-device-scale-factor=1.5`) to confirm the view exactly fills the slot. **(b) Initial seed:** at construction, seed bounds from a
   one-time full-content-area rect (mirror the chrome view seed at `main.js:316-318`) so there's no
   first-frame flash before the renderer's first measurement. **(c) Atomic ordering:** `tab-set-active`
   **carries the incoming view's bounds** so main does set-bounds → `setVisible(true)` incoming →
   `setVisible(false)` outgoing in ONE message (no race between a separate `tab-set-bounds` and the
   visibility toggle). **(d) Debounce:** send the geometry IPC on `requestAnimationFrame`
   during an active resize/panel-transition (the panel transition is `0.18s ease`, `styles.css:614`), OR
   accept a snap-after-animate and record that in the flight log + the HAT expected results — decide and
   log. **(e) Overlay occlusion:** note that `#find-bar`/`#page-context-menu`/`#site-info-popup` (over
   `#webviews`) are occluded by the opaque tab view; the find bar is handled by AC8's minimal find
   re-point staying functional; full overlay re-home is F4.

4. **Main: extract `wireGuestContents` + wire tab views explicitly at construction (DD4, refined).**
   `web-contents-created` fires **synchronously during** `new WebContentsView()` — before the constructor
   returns — so you cannot insert `view.webContents.id` into a registry and have the already-fired global
   handler see it. Therefore: **extract** the guest-event body of `app.on('web-contents-created')`
   (`main.js:412-520` — `setWindowOpenHandler`, `will-navigate`, `before-input-event`,
   `devtools-opened/closed`, `context-menu`) into a standalone `function wireGuestContents(contents)`. In
   `tab-create` (phase 2), **call `wireGuestContents(view.webContents)` explicitly** right after
   construction. **Leave the global `app.on('web-contents-created')` handler with its
   `if (contents.getType() === 'webview')` filter** (`main.js:411`) — it now wires ONLY internal
   `<webview>`s this leg; tab views report `getType()==='window'` so they are naturally excluded (no
   double-wire). Confirm no other code branches on `getType()` for guests
   (`grep -n "getType()" src/main`). *(Leg 3 will collapse this: once internal pages are views too and no
   `<webview>` remains, the global handler's webview branch is removed and ALL guests wire via the explicit
   construction-time call.)*

5. **Main: tab-strip-essential event re-home (DD6) + media/find transport (DD6 minimal).** On each tab
   view's `webContents`, listen for `did-navigate`/`did-navigate-in-page`/`page-title-updated`/
   `page-favicon-updated`/`did-start-loading`/`did-stop-loading` and forward to the chrome renderer via
   `getChromeContents()?.send('tab-<event>', { wcId, ...payload })` (mirror the `zoom-changed` broadcast
   idiom). Add the **media/find transport**: `ipcMain.on('rescan-media', (_e, {wcId}) =>
   getTabContents(wcId)?.send('rescan-media'))`; and have the guest preload's `media-list`/`found-in-page`
   arrive via `ipcRenderer.send` to main (phase 7) → forward to chrome with the wcId. (Found-in-page:
   `view.webContents.findInPage`/`stopFindInPage` are driven by a `tab-find` IPC from the renderer; the
   result arrives via the guest `found-in-page` webContents event → forward to chrome. This is the
   *minimal* path; the `find.js` D1 workaround cleanup is F4.) **Main forwards `found-in-page`
   UNCONDITIONALLY (keyed by wcId); the renderer applies the per-tab guards** (`tab.id === activeTabId` +
   `tab.findOpen` no-flash, `renderer.js:1064-1071`) — main has no visibility into `tab.findOpen`.

6. **Main: `download-media` (DD7) + `captureWindow` (DD11).** Change `main.js:549`
   `const downloader = wc || getChromeContents();` → `wc || getActiveTabContents();`. For `captureWindow`
   (`observe.js:212-214`): **keep `observe.js` Electron-free** — implement the window grab in `main.js`
   (which already imports Electron) as a bound function and **inject it via the engine deps bag** (e.g.
   `deps.grabWindow`), so `observe.captureWindow` calls `await deps.grabWindow()` instead of
   `chromeContents.capturePage()`. **New signature: `captureWindow({ grabWindow })`** — the null-guard
   moves to `grabWindow` (`if (!grabWindow) throw new Error('automation: chrome window unavailable')`,
   reusing the exact existing message). Recommended grab: `desktopCapturer.getSources({ types:['window'],
   thumbnailSize: <window content size> })` matched to the app window (Flight-1 spike-validated; zero-dep),
   returning the thumbnail as PNG. **WSLg fallback:** if `getSources` returns empty / a too-small
   thumbnail, fall back to a chrome+active-guest composite, or surface the DD11 divert (judged on the PNG).
   **Update `test/unit/automation-observe.test.js`** — its `captureWindow` test currently asserts
   `chromeContents.capturePage()`; rewrite it to fake `deps.grabWindow`. Extend the deps bag WITHOUT
   breaking the other observe signatures (`captureScreenshot`/`readDom`/etc. keep `{ chromeContents, ... }`).
   `captureScreenshot` (`observe.js:120-133`) is otherwise UNCHANGED — `classifyContents` still classifies
   tab views as 'guest' (`resolve.js:48`, `wc !== chromeContents`).

7. **Renderer: refactor `createTab`/`closeTab`/`activateTab` + the control verbs (DD6/DD8).** In
   `createTab` (`renderer.js:718`): for **web** tabs, stop creating a `<webview>` element — instead
   `await window.goldfinch.tabCreate({url, partition: jar.partition, trusted:false})`, store the returned
   `wcId` on the tab object, and keep `#webviews` as an empty measured slot. **Internal tabs keep the
   `<webview>` path this leg.** **Add a `trusted` field to the tab object literal (`renderer.js:743-754`,
   which has none today): `tab.trusted = trusted`** — the ~31 re-pointed callsites and the
   `tab.webview`-null-by-type check discriminate on `tab.trusted` (explicit at the construction site;
   equivalent to the existing `isInternalTab(tab)` at `renderer.js:863`). Replace every control-verb callsite (enumerated; ~31 sites) with an IPC
   call: nav verbs (`renderer.js:320,1108,1136,1144,1152,1153,2259,2303,2572`), `getURL`
   (`997,1035` — now from the cached `tab.url` updated by the re-homed `did-navigate`), `canGoBack/Forward`
   (`1080,1081` — from main, or cached nav-state pushed with the events), `getWebContentsId` (`943` — now
   the create-return value), `findInPage`/`stopFindInPage` (`2080,1017,2120` → `tab-find` IPC), `send`
   (`1239` → `rescan-media` IPC), `focus` (`599,2124`), `.remove()` (`793` → `tab-close` IPC),
   `.classList.toggle('hidden')` (`811` → `tab-set-active` IPC → main `setVisible`). Make `activateTab`
   (`804`) notify main with bounds: `window.goldfinch.tabSetActive(tab.wcId, measureWebviewsSlotDIP())`
   (atomic set-bounds-before-reveal, AC4d). **`tab.webview` is null for web tabs after this leg** —
   distinguish by tab type (`tab.trusted` / a `tab.isWebView` flag): web-tab callsites use the wcId/IPC
   path; **internal-tab callsites that legitimately keep `<webview>` survive** (e.g.
   `existing.webview.loadURL('goldfinch://…')` at `renderer.js:320`, the `newIdentity` reload at
   `renderer.js:2303`). The grep-driven "no `tab.webview` for web tabs" check must be type-predicated, not
   global. **`getURL` callsites (`997,1035`)** read the cached `tab.url` (kept current by the re-homed
   `did-navigate`), not a live element call. **`closeTab` (`790`)**: optimistically remove the tab from the
   `tabs` Map + strip immediately, then fire `window.goldfinch.tabClose(wcId)` (don't lag the close button
   on main's ack). **`openTab` race guard (`renderer.js:2595,2612`)**: for web tabs, `createTab` is now
   async and returns the wcId directly from the `tab-create` invoke — no `dom-ready` listener needed; for
   internal tabs (still `<webview>`), keep the existing `dom-ready` Promise path. Hybrid on `trusted`.
   **Keep `window.__goldfinchAutomation` (`renderer.js:2602`) working** — `listTabs`/`activate`/`openTab`
   still operate on the tab model; only the substrate changed (`createTab` becoming async is the one ripple
   — adapt its callers).

8. **Renderer: subscribe to the re-homed events.** Replace the `<webview>` DOM listeners
   (`renderer.js:941-1071`) with `window.goldfinch.onTab<Event>(cb)` subscriptions (new bridge methods,
   phase 9) keyed by wcId → update the matching tab's strip/title/favicon/url/loading/nav state and the
   media/find UI. Preserve the existing repaint/active-tab guards (the `tab.id === activeTabId` checks, the
   find no-flash guard at `renderer.js:1064-1071`).

9. **Preload (`chrome-preload.js`): add the bridge methods.** Following the existing idiom (invoke for
   request/response, send for fire-and-forget, on for push): add `tabCreate`→invoke `tab-create`,
   `tabClose`→send `tab-close`, `tabNavigate`→send `tab-navigate`, `tabSetActive`→send `tab-set-active`,
   `tabSetBounds`→send `tab-set-bounds`, `tabFind`→send `tab-find`, `rescanMedia`→send `rescan-media`; and
   pushes `onTabDidNavigate`/`onTabTitle`/`onTabFavicon`/`onTabLoading`/`onTabMediaList`/`onTabFoundInPage`
   → `ipcRenderer.on('tab-*', ...)`.

10. **Preload (`webview-preload.js`): swap the upstream transport (DD6 minimal).** `sendToHost('media-list',
    …)` (`~175`) and `sendToHost('privacy-fp', …)` (`~219`) → `ipcRenderer.send('guest-media-list', …)` /
    `ipcRenderer.send('guest-privacy-fp', …)` to main (main forwards `media-list`/`found-in-page` to chrome
    keyed by the sender's wcId; `privacy-fp` MAY stay inert until F4 — confirm nothing user-visible
    regresses, per DD6). `on('rescan-media')` (`~203`) stays (now delivered via main→view send).
    `sendSync('shields-farble')` (`~231`) is UNCHANGED (already main-targeted; survives). **Verify the
    farble preload still runs in the page main world** on the constructed view (DD10 — spike 6a/6b proved
    it; confirm in the running app).

## Edge Cases

- **`web-contents-created` fires synchronously DURING `new WebContentsView()`** (before the constructor
  returns) — so a registry-membership test in the global handler can't see the not-yet-returned view. This
  is why AC3/phase 4 use **explicit `wireGuestContents(view.webContents)` at construction** instead of a
  global-handler predicate. (AC3 hazard, resolved by the explicit-wiring mechanism.)
- **Burner partitions (`burner:<n>`) are non-persistent in-memory sessions** (no `persist:` prefix —
  `renderer.js:123` `makeBurner`). `tab-create` must pass the partition string **verbatim** — never
  normalize or add `persist:`. `session.fromPartition('burner:<n>')` yields the in-memory session;
  `session-created` still fires (so `applySpellcheck`/`applyShields`/`wireDownloadHandler` run as today).
- **The internal-jar DATA-LOSS TRAP** (`renderer.js:725-732`) is internal-only and untouched this leg
  (internal tabs stay `<webview>`); do not refactor that synthetic-jar logic here.
- **DPR≠1** — the single most likely silent bug, AND an easy place to over-correct: `getBoundingClientRect`
  CSS-px **already equal** `setBounds` DIP, so pass through with **no** `devicePixelRatio` division (a
  division would shrink the view at HiDPI). Test explicitly at DPR≠1 (AC4b).
- **Tab-switch race** — set bounds before `setVisible(true)`; hide the outgoing view last (AC4d). A fast
  double-switch must not paint the wrong tab's bounds (mirror the existing `activeTabId === tab.id`
  re-check guard at `renderer.js:851`).
- **Async tab creation** — `createTab` becomes async (awaits the wcId). The `__goldfinchAutomation.openTab`
  dom-ready race guard (`renderer.js:2595`) must be adapted to the create-returns-wcId model.
- **Close of the active tab** — main destroys the view; the renderer activates the next tab (existing logic
  at `renderer.js:797-801`), which notifies main to `setVisible` the new active view. Never leave zero tabs.
- **`isDestroyed()` on every main→view send** — guard `view.webContents.isDestroyed()` (DD2). A view closed
  mid-event must not throw.
- **Internal tabs still `<webview>`** — the predicate must match both registry tab views AND
  `getType()==='webview'` this leg (phase 4); do not break internal-tab wiring.
- **`captureWindow` paint timing** — a capture before the guest paints returns guest-blind; keep the
  Flight-1 "settle before capture" discipline if compositing.

## Files Affected

- `src/main/main.js` — registry + accessors; `tab-create`/`tab-close`/`tab-navigate`/`tab-set-active`/
  `tab-set-bounds`/`tab-find`/`rescan-media` handlers; web-tab `WebContentsView` construction (web
  `webPreferences`); the `web-contents-created` predicate swap (`~411`); tab-strip-essential event
  forwarding; `guest-media-list`/`guest-privacy-fp` receivers; `download-media` fallback (`~549`).
- `src/main/automation/observe.js` — `captureWindow` (`~212-214`) → calls an injected `deps.grabWindow`
  (stays Electron-free).
- `src/main/automation/engine.js` — extend the deps bag with the bound `grabWindow` (keep existing
  signatures working).
- `src/main/automation/find.js` — **NO CHANGE.** The automation engine resolves the tab view's
  `webContents` via `webContents.fromId(wcId)`, which has `findInPage`/`stopFindInPage` — the automation
  find path works as-is on the view surface. (Stated to stop an implementor from needlessly re-pointing it.)
- `test/unit/automation-observe.test.js` — update the `captureWindow` test (faked `deps.grabWindow`
  instead of `chromeContents.capturePage()`).
- `src/renderer/renderer.js` — `createTab`/`closeTab`/`activateTab` refactor; the ~31 control-verb
  callsites; replace `<webview>` DOM listeners with bridge subscriptions; keep `__goldfinchAutomation`;
  renderer-side geometry measurement (`getBoundingClientRect` of `#webviews` → `tabSetBounds`).
- `src/preload/chrome-preload.js` — new `tab*` bridge methods + `onTab*` push subscriptions.
- `src/preload/webview-preload.js` — `sendToHost` → `ipcRenderer.send` for `media-list`/(`privacy-fp`).
- `src/renderer/index.html` / `styles.css` — `#webviews` becomes an empty measured slot (likely no markup
  change; verify it still defines the guest rect via flex).
- Tests under `test/unit/` touching tab/partition/automation — update any that assume `<webview>` or the
  `getType()==='webview'` filter (state-machine reachability: invert/rename rather than delete).

## Post-Completion Checklist

- [ ] All acceptance criteria (AC1–AC12) verified
- [ ] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [ ] Update flight-log.md with the leg progress entry (incl. the DD5 debounce-strategy decision and the
  `captureWindow` approach chosen)
- [ ] Set this leg's status to `landed` (NOT `completed` — `/agentic-workflow` reviews + commits at flight
  end) and do NOT commit (per the workflow)
- [ ] Signal `[HANDOFF:review-needed]` (do NOT signal `[COMPLETE:leg]`, do NOT commit)

## Citation Audit

12 source citations verified against current code at leg design time (2026-06-25), via direct reads and a
codebase enumeration during Flight-3 planning:
- `src/main/main.js`: `will-attach-webview` 330–346 (OK), `web-contents-created` 410–411 `getType()==='webview'`
  filter (OK), `webviewTag:true` 297 (OK), chrome-view seed 316–318 (OK), resize handler 357 (OK),
  `download-media` fallback 549 `wc || getChromeContents()` (OK).
- `src/renderer/renderer.js`: `createTab` 718, `closeTab` 790, `activateTab` 804, webview DOM listeners
  941–1071, `__goldfinchAutomation` 2602, `findTabByWcId` 1772 (OK); control-verb callsites per the
  enumeration (OK).
- `src/main/automation/observe.js`: `captureWindow` 212–214, `captureScreenshot` 120–133 (OK).
- `src/main/automation/engine.js`: `createEngine` 36, `activate` 62/70 (OK).
- `src/main/automation/resolve.js`: `classifyContents` 48 (OK).
- `src/preload/webview-preload.js`: `sendToHost('media-list')` ~175, `sendToHost('privacy-fp')` ~219,
  `on('rescan-media')` ~203, `sendSync('shields-farble')` ~231 (OK, approximate lines from enumeration).
- `src/preload/chrome-preload.js`: bridge idiom verified against the full method enumeration (OK).
- `src/renderer/styles.css`: panel transition `0.18s ease` ~614, `#main` flex 526–536 (OK).
