# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Goldfinch — an Electron desktop browser with a media panel (scan/play/download page media) and a privacy panel (Shields + cookie-jar identities).

## Commands

- `npm start` — run the app
- `npm run dev:automation` — the canonical dev launch (`node scripts/dev-launch.mjs --enable-logging --no-sandbox --automation-dev`, WSL/headless friendly). The `dev`/`dev:automation` scripts go through **`scripts/dev-launch.mjs`** (M05 F8 Leg 6): it passes `--ozone-platform=wayland` when a Wayland compositor socket is reachable (incl. the WSLg `/mnt/wslg/runtime-dir` fallback — decision logic in `src/main/ozone-platform.js`, unit-tested), because the X11/XWayland path under WSLg RAIL swallows the first cross-window click-to-activate (any real click into the app arms it; menu-open was just the reported case). A caller-provided `--ozone-platform*` flag wins; non-WSLg X-session desktops are untouched (no socket → x11 as before). The ozone platform CANNOT be selected from app code (Electron resolves it before `main.js` runs), which is why this lives in the launcher. `--automation-dev` is the dev-only force-bind for the in-process MCP automation surface (DD4, dev-only, `!app.isPackaged`-gated). The legacy browser-process CDP debugging launch (and its dev launch script) was **removed in F9** along with the ungated CDP path — the automation surface is now driven entirely over the loopback MCP transport. See `docs/mcp-automation.md`.
- `npm run dist` — build installers (electron-builder); `npm run pack` for an unpacked `--dir` build
- `npm test` — runs `node --test` over `test/unit/**`. Unit suite covers the pure security/privacy helpers (`src/shared/url-safety.js`, `src/main/download-path.js`, `jars.js` validation + `isSafeColor`, `trackers.js`, `shields.js`). **For real-environment / UI behavior, drive the running app over the in-process MCP automation surface** (`npm run dev:automation`): connect to the loopback MCP server and use the drive/observe/eval tools against the chrome renderer or guest tabs. The behavior tests drive this surface — see `tests/behavior/` for behavior-test specs.
- `npm run lint` — ESLint over the whole repo (`eslint.config.mjs`; flat config).
- `npm run typecheck` — `tsc --noEmit -p jsconfig.json`; checks all `// @ts-check` files.
- `npm run a11y` — axe-core accessibility audit (`scripts/a11y-audit.mjs`). Attaches to the running app over the **loopback MCP automation surface** (`npm run dev:automation`), using the `injectScript`/`evaluate` eval tools (`webContents.executeJavaScript` in the guest main world — ZERO CDP, no browser-process debugging port). It acquires the chrome renderer via `getChromeTarget` (admin), drives the app into each state — the five chrome states (base chrome → media panel → privacy panel → lightbox → DevTools button) audited against the chrome wcId, plus **six sheet states** (`sheet:kebab`, `sheet:container`, `sheet:site-info`, `sheet:new-container`, `sheet:page-context`, `sheet:tab-context`) audited against the **menu-overlay sheet's wcId** (menus left the chrome DOM in M05 F8; the sheet is not in `enumerateTabs`, so since **M09 F7 (DD2)** the script resolves its wcId once per run from **`enumerateWindows`** — an exact, O(1) admin read that **retired the id-space probe walk**, with **no fallback**: if the read fails, `npm run a11y` fails loudly; menu opens are driven from chrome via the module-scope `open*Overlay` helpers, dismissal is sheet-side Escape between states). The find UI is NOT audited here — it lives in the find-overlay `WebContentsView` (not in `enumerateTabs`; its wcId is reported by `enumerateWindows` as `findWcId` at the admin tier), so its a11y rests on the verbatim attribute carry-over from the retired chrome bar + the HAT keyboard/focus pass. It injects axe-core, and **diffs each violation node against a curated `ACCEPTED` allowlist** (`{ id, selector, reason }`, optional state) baked into `scripts/a11y-audit.mjs` (DD7) — it fails only on NEW `(rule id, node-selector)` findings, not on any pre-accepted violation. **Attach + env-key model**: launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, capture the printed `AUTOMATION_DEV_MINT` key, and `export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>` (chrome mode) / `GOLDFINCH_MCP_KEY=<jarKey>` (guest mode) — see `docs/mcp-automation.md` "Dogfooding / dev key acquisition". Accepts `--rules=`, `--tags=`, and `--url=` (the media fixture to load; defaults to `http://127.0.0.1:8000/` — serve `tests/behavior/fixtures/a11y-media/` via `python3 -m http.server`). A `--target=<url-substring>` **guest mode** audits an already-loaded guest tab (found via `enumerateTabs`) instead of the chrome — skipping the chrome state-drivers. NOTE: `goldfinch://settings` is the **internal session**, which the eval tool excludes even for admin, so it can no longer be audited via `--target` (the old CDP path could; the default chrome sweep never depended on it). **Gate convention**: `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` runs only the WCAG 2.1 A/AA conformance rules (what the verify-leg sweep gates on); axe's full default set additionally flags best-practice *advisories* (e.g. `region`, the documented app-shell exception) that are not conformance failures. `nested-interactive` is **always** disabled (the tab strip's `role="tab"` wrapping a focusable close `<button>` is an accepted APG tab/close pattern). This gate is **real-environment / verify-only — NOT part of headless CI** (it needs the live GUI + the automation surface).

## Architecture

Three processes; understand the boundary before editing.

- **Main** (`src/main/`): `main.js` owns the window shell — since M09 F6 a **window registry** (`src/main/window-registry.js`, pure/Electron-free, unit-tested) of per-window records `{win, chromeView, tabViews, activeTabWcId}` keyed by `BaseWindow.id`; each window is a `BaseWindow` hosting its own chrome `WebContentsView` running `renderer.js` (per-document renderer state is per-window by construction), and guest tabs are `WebContentsView`s constructed in main via the `tab-create` IPC handler (Mission 05 Flight 3), owned by their window's record. Main↔chrome routing has **three classes** (M09 F6 DD2 — classify any new send/handler site before writing it): **(1) inbound sender-resolved** — chrome-sender IPC resolves its window via `registry.getWindowForChrome(event.sender)`, guest-sender IPC via `getWindowForGuest(event.sender.id)`; window-lifecycle events (`resize`/`maximize`/…) route to their OWN chrome via the per-window create closure (class 1b); **(2) broadcast fan-out** — `broadcastToChromeAndInternal` sends to ALL registered chromes + internal-session contents once globally; **(3) per-tab owner-routed pushes** — every main→chrome send tied to a specific tab (the `wireTabViewEvents` fan, `zoom-changed`, `devtools-state-changed`, `page-context-menu`, privacy delivery, guest-keystroke forwarders, find-overlay per-tab syncs) resolves the tab's OWNING window's chrome **at event time** via `getChromeForTab(wcId)` — never fanned out, never left on a focused-window accessor (event-time resolution is what makes move-to-new-window's re-bind automatic). `getChromeContents()` survives as the **last-focused accessor** (F6 interim, DD8): registry-tracked last-focused window, seeded at window create AND at programmatic `win.focus()` (WSLg-safe — compositor focus events may never arrive), membership-validated at read with a first-record fallback; **F7 owns true multi-window automation/capture semantics** — don't build new code against the accessor when a routing class fits. **Lifecycle split (DD3)**: per-window teardown runs at `close` (whole-window closed-tab capture → roaming-overlay detach, find before sheet → per-tab side-effect suite + **explicit guest destroy** — Electron never auto-destroys an attached view's webContents on window close) and `closed` (record removal + the chrome wc's deferred destroy via `setImmediate`); app-level teardown (MCP stop, stores, overlay DESTRUCTION with the find-before-sheet ordering pin) stays at the quit hooks (`window-all-closed`/`before-quit`/`will-quit`); closing one of N windows never quits, the last close rides `window-all-closed` (non-darwin). **⚠️ Never read `win.*` inside `closed`-or-later handlers** — capture teardown inputs (e.g. `const winId = win.id`) at create time: a destroyed-`BaseWindow` property access throws, and an uncaught throw inside the native `closed` emission aborts the listener chain AND permanently wedges the Wayland close path with zero error output (the F6 fix-cycle root cause). `main.js` also owns downloads, the combined `webRequest` pipeline, the privacy aggregate, and all IPC. `shields.js` = persisted Shields config + tracking-param stripping; `jars.js` = container definitions (both app-db-backed since M10 Flight 1, see App database below); `trackers.js` = registrable-domain (eTLD+1) + tracker classification. `settings-store.js` = durable, schema-versioned app preferences (see Settings store below). `internal-ipc.js` = origin-checked IPC bridge helpers for trusted `goldfinch://` internal pages (see Internal-bridge security model below).
- **Preloads** (`src/preload/`): `chrome-preload.js` exposes `window.goldfinch.*` (contextBridge) to the UI. `webview-preload.js` is injected into every web page via the web-branch `WebContentsView`'s `webPreferences.preload` at construction time, and runs in the page's **main world** (media scanner + fingerprint detect/farble). `internal-preload.js` is a third, distinct preload for trusted `goldfinch://` internal pages — it runs **context-isolated** (opposite of `webview-preload.js`) and exposes `window.goldfinchInternal` (`settingsGet`/`settingsSet`, `shieldsGet`/`shieldsSet`, `onSettingsChanged`/`onShieldsChanged`, the Flight-5 `downloadsList`/`downloadsAction`/`downloadsClear`/`onDownloadsChanged`, plus the M06 Flight 3 `jarsList`/`jarsAdd`/`jarsRename`/`jarsRemove`/`jarsSetDefault`/`jarsGetDefault`/`onJarsChanged`/`offJarsChanged`) guarded by an internal-origin **allowlist** check (`INTERNAL_ORIGINS.has(location.origin)` — `goldfinch://settings` + `goldfinch://downloads` + `goldfinch://jars`; defense-in-depth; the main-side `registerInternalHandler` is the authoritative boundary — see Internal-bridge security model below). Keep it separate from both `webview-preload.js` and the chrome `window.goldfinch`.
- **Renderer** (`src/renderer/`): `index.html` / `renderer.js` / `styles.css` — the browser chrome. Each tab is a `WebContentsView` constructed in main and addressed by `wcId` in the renderer. Holds the media panel, docked music player, privacy panel, Shields toggles, the jar/container picker (the `▾` menu, whose "Manage jars…" sentinel row also opens the jars page), and the **⋮ overflow (kebab) menu** at the right of the toolbar (New window, Settings, Downloads, Cookie jars, Print…, Exit; **New window** is FIRST (M09 F6 — Chrome adjacency: window/tab creation ahead of app pages) and opens a fresh window via the `window-create` IPC, also reachable via `Ctrl+N`/`Cmd+N` through the one-classifier path; **Settings** opens the internal `goldfinch://settings` page via `createTab(..., { trusted: true })`, see the internal-page security model below; **Downloads** opens the app-level downloads surface `goldfinch://downloads` via the same trusted `createTab(..., { trusted: true })` path — also reachable via `Ctrl+J`; **Cookie jars** opens the jar-management page `goldfinch://jars` (M06 Flight 3) via the same trusted path, from the shared `openJarsPage()` opener — see the three-trusted-internal-origins note below; **Print…** prints the active web tab; Exit fires the `app-quit` IPC → `app.quit()`, the only all-platform quit path — distinct from `window-close`, whose `window-all-closed` darwin guard does not quit on macOS). The tab strip is an ARIA `tablist`/`tab` roving-tabindex widget (ArrowLeft/Right + Home/End navigate and activate; Delete/Backspace closes the focused tab); its keyboard/screen-reader contract is pinned by the `tab-keyboard-operability` behavior test (`/behavior-test tab-keyboard-operability`), and accessibility across all chrome states is regression-gated by `npm run a11y` (see Commands). All popup menus (the `▾` container picker, the ⋮ kebab, the 🔒 site-info popup, the page context menu incl. toolbar-Unpin mode) and the new-container dialog render from the **menu-overlay sheet** — a main-owned transparent full-guest `WebContentsView` — NOT from chrome DOM (M05 Flight 8). The chrome owns the **triggers, menu models, and action dispatch** (it builds each menu's model and executes activated items via `window.goldfinch`); the sheet owns **presentation + the APG keyboard contract** (`role="menu"`/`menuitem` roving tabindex, Arrow/Home/End/Escape/Tab via the shared `menu-controller.js` + `focusItem` — the module is loaded ONLY by the sheet document post-cutover). Mutual exclusion falls out of the single sheet (open-while-open is a model-replace). See the "Menu-overlay sheet" section below + `docs/renderer-menu.md`.

Key cross-cutting facts:
- **Shields apply to every jar via `app.on('session-created')`** in main. Each container/burner/default tab is a session partition; new jars inherit block/strip/isolate/downloads automatically. There is **one `webRequest` listener per event per session** — recording and enforcement share it (`applyShields`).
- **Web `WebContentsView`s run with `contextIsolation:false`** (set at construction time in the `tab-create` handler's web branch), so the preload is in the page main world — required for fingerprint farbling. `nodeIntegration` stays off; preload internals stay module-scoped.
- **`asar:false`** in the build config so `src/**/*` files (including `webview-preload.js`) are kept as unpacked disk files in packaged builds; this is required for the internal-page `path.join(__dirname, …)` resolver in `main.js` to locate assets correctly.
- **Find-in-page is a floating overlay `WebContentsView` (M05 Flight 7)** — NOT chrome DOM. The bar (`src/renderer/find-overlay.{html,js,css}` + `src/preload/find-overlay-preload.js`, chrome-class trust domain) is a **PER-WINDOW lazy-singleton view** stacked above the active guest via `addChildView`-after-guest; main owns its lifecycle, positioning (the guest-bounds path), focus, and the find session, and fans `found-in-page` counts directly to it (path B). Since **M09 F7 (DD5)** the cluster is managed by the **Electron-free** `src/main/find-overlay-manager.js` (`createFindOverlayManager` — injected deps, offline-unit-tested, mirroring `menu-overlay-manager.js`) and instantiated **once per window** into the window registry record's `findOverlay` slot. The F6 roaming singleton and its attachment tracking (the `overlayView` / `findOverlayAttachedWin` / `findOverlayTabWcId` main.js module vars) are **DELETED** — a per-window instance *is* its own scope, so there is nothing to attach, re-resolve, or condition on, and `lastGuestBounds` is per-instance state rather than a shared slot. Destruction is per-window `close` (the sole site; `before-quit` retains no overlay role). The guest is **never inset for find** — the bar floats over full guest bounds. Per-tab `findText`/`findOpen` stay in the chrome renderer (DD9), which drives `find-overlay:open`/`close` (openFind, per-tab restore in `activateTab` — restore is sent AFTER `tabSetActive`, same-sender IPC ordering) and syncs back via `find-overlay-text` (every overlay query, empty included) and `find-overlay-closed` (overlay-side user Esc/✕ ONLY). Close refocus is resolved by SENDER: overlay-side close refocuses the guest; chrome-side (programmatic nav-close) moves no OS focus. The overlay is hidden (`removeChildView`) on internal tabs and while a sheet menu is open (M05 F8 DD5: hide on sheet-show; restore is `closeMenuOverlay`'s explicit owned step, with tab-lifecycle reasons deferring to the `tab-set-active` re-add); it is never in `tabViews`, so it is invisible to `enumerateTabs` and resolves only at the admin tier (probe-addressable — see the enumerable-vs-addressable rule under Overlay-view patterns).
- Per-tab privacy/shield data flows: main aggregates → `privacy-net` IPC → renderer; preload fingerprint counts → `sendToHost` → renderer. Farble config is fetched **synchronously at page load** (`shields-farble`), so toggling farble needs a reload.
- Persisted state lives in `userData/app.db` (the `documents` table, one row per store — see App database below); the `shields` and `jars` rows hold what `shields.json`/`containers.json` held before M10 Flight 1's migration. Those two files are no longer live — a pre-upgrade profile's copies are imported once on first boot after the upgrade and renamed `.migrated` (not in the repo either way). The jars row is a v2 envelope — `{ version: 2, defaultId, containers }`; a legacy v1 bare-array file migrates into that shape on import (`jars.js` DD3).
- **Frameless window** (`main.js`, a `BaseWindow` hosting a chrome `WebContentsView`; the window is `frame`-less only), branched on `process.platform`: `frame:false` on win/linux (custom window controls), `titleBarStyle:'hidden'` + `trafficLightPosition` on macOS (native traffic lights); `minWidth:900`/`minHeight:600` preserved. Custom minimize/maximize-restore/close controls live in the tab strip's reserved `#window-controls` zone, wired via `window.goldfinch` → `ipcMain` (`window-minimize` / `window-toggle-maximize` / `window-close`; `window-is-maximized`). The maximize button's `aria-label` + `data-state` stay in sync by forwarding main's `maximize`/`unmaximize` events over IPC (`window-maximized-change`) — per-window since M09 F6 (routing class 1b: each window's lifecycle events reach its OWN chrome). The window-control IPCs resolve the SENDER's window (class 1); Close calls the sender-resolved record's `win.close()` (**not** `app.quit()`) — with N windows open this closes ONE window (per-window teardown, DD3); the LAST close rides the existing `closed → window-all-closed → app.quit()` chain (non-darwin).
- **Chrome drag regions** (`-webkit-app-region`): `#tabstrip` is `drag`; the pill, tabs, and window-control buttons are `no-drag`; a `#tabstrip-drag` spacer guarantees a grab area. The strip lays out as tabs → golden `#newtab-pill` (`+`/`▾`, hugging the tabs) → `#tabstrip-drag` → `#window-controls`. `chrome-preload.js` also exposes `platform`; the renderer tags `<html>` with a `platform-{platform}` class for platform-specific CSS (macOS-only inset; non-darwin frameless border).
- **⚠️ `WebContentsView` native-surface gotcha — "DOM correct ≠ render correct."** A `WebContentsView` (and its predecessor `<webview>`) is an out-of-process **native compositing surface**, not a normal DOM box. Changing the bounds or visibility of guest views (resizing `#webviews`, opening/closing adjacent panels, etc.) can **mis-position or mis-render the guest surface even when `getComputedStyle`/`getBoundingClientRect` report every box correct** — the failure is invisible to DOM/a11y/`evaluate`-based checks and only shows in the *composited pixels*. This is a recurring failure mode in this stack: see Mission 04 Known Issues — the find-in-page `{0,0}` cold-start and **#27 side-panel animation** (`missions/04-browser-conveniences/flights/06-polish-and-mcp-hygiene/` — three CSS mechanisms all failed identically). **#27/SC10 is now RESOLVED (M05 Flight 9)** and its root cause is the load-bearing lesson: **a guest view's bounds change is a discrete `setBounds` STEP, not an animatable quantity — the guest cannot animate in lockstep.** So any chrome-side layout that *animates geometry around the guest region* (a sliding side panel that resizes `#webviews`, a split-view drag, etc.) produces a chrome-ramps-while-guest-steps mismatch, and sustaining that mismatched repaint over the live guest **mis-renders the composited frame on EVERY platform** — this was operator-confirmed on the native Windows build, NOT a WSLg quirk (that attribution was a red herring). F9 resolved #27 not by making the slide smooth (impossible — the guest steps) but by **retiring the animation** (panels open instantly). **INVARIANT: never animate chrome layout that resizes/repositions the guest slot; animate only things that float OVER the guest (the F7 find bar, F8 menu sheet — view stacking that changes no layout around the guest), or make the layout change instant.** The **menu-overlay sheet** (M05 Flight 8) is the current live example of working WITH this constraint: menus render from a transparent full-guest `WebContentsView` stacked above the live guest — compositor-level view stacking that changes no layout around the guest, pixel-proven per surface at the F8 checkpoints. (Its predecessor, the **freeze-frame pattern** — capture a still, hide the live guest, paint chrome DOM above it — coped by taking the native surface out of the frame entirely; it was retired at the F8 cutover.) **Rules:** (1) prefer compositor-only properties that do **not** change layout around the guest (and never *animate* geometry around it — see the invariant above); (2) treat "DOM geometry reads correct" as necessary-but-insufficient — the acceptance signal is the *rendered* surface, observed by a human in motion (visual HAT / operator screenshots); note that even `captureWindow` is insufficient for *inter-frame* motion defects (discrete grabs land on settled frames — F9 proved this: an automated capture read "stable" for a defect only mid-slide screenshots caught); (3) **gate any mechanism that touches the guest view region on a cheap on-platform spike** before building it. **Don't attribute a render defect to the rig (WSLg) without a cross-platform control** — F9's glitch was mislabeled WSLg until the operator reproduced it on the native Windows build; "the last one was WSLg" is not evidence the next one is.

## Patterns

### `src/shared/` ESM modules

`src/shared/` is real ESM (M07 Flight 2): pure logic modules use `export`/`import` with explicit `.js` extensions, loaded on every page via `<script type="module">`. Example: `url-safety.js` exports `isSafeTabUrl`/`isSafePosterUrl` directly —

```js
export function isSafeTabUrl(url) { … }
export function isSafePosterUrl(url) { … }
```

— and the chrome renderer imports it disk-relative:

```js
import { isSafeTabUrl, isSafePosterUrl } from '../shared/url-safety.js';
```

**Two specifier shapes, by consumer.** The chrome (`file://`, `src/renderer/index.html`) imports `src/shared/` disk-relative (`../shared/url-safety.js` — the script tag lives at the real disk path). Internal `goldfinch://` pages import **flat** specifiers instead (`./safe-color.js`, `./burner.js` in `jars.js`/`settings.js`) because `INTERNAL_PAGES` (`src/main/main.js`) is an exact-match host→pathname→file map, not a directory passthrough — a disk-true `../../shared/*.js` specifier has no route in the map and 404s at boot. `tsc` can't resolve a flat specifier against the real disk layout (TS2307), so every flat import carries a `// @ts-ignore` comment and types `any` — parity with the ambient-global typing it replaced, backlog-noted for a future typing cycle, not a bug to fix now.

Unit tests `require()` the same file the app loads — Node ≥22's synchronous `require(esm)` support (see `engines` in `package.json`) makes this work with no stub/duplicate: the test runs against the exact code the app ships.

### Two-point hostile-URL security boundary

Hostile URL injection is blocked at two independent enforcement points, both using `isSafeTabUrl`:

1. **`createTab` gate** (`src/renderer/renderer.js`) — rejects any URL that isn't `http:`, `https:`, or `about:blank` before the `tab-create` IPC fires (which constructs the `WebContentsView` in main).
2. **`will-navigate` guard** (`src/main/main.js`) — `contents.on('will-navigate', …)` calls `e.preventDefault()` on the same predicate, blocking navigation that bypasses the renderer gate (e.g. via `window.open` or `<a target=_blank>`).

The shared predicate ensures both gates stay in sync automatically.

### Recurring module shapes: Electron-free injected-deps + ESM pure decision modules

Two module shapes are the default choice for new logic, recurring across flights:

- **Electron-free, injected-deps modules.** Main-side logic that needs a live Electron handle (an `fs` path, `app`, a view constructor) takes it as a constructor/call argument instead of `require('electron')`-ing it, so the pure logic runs offline under `node --test` with fakes. Exemplars: `src/main/automation/engine.js` (`deps()` rebuilt fresh per call), `src/main/settings-store.js` (`load(userDataPath, opts?)`), `src/main/internal-assets.js` (`createResolver(map)`, `__dirname`-free), `src/main/menu-overlay-manager.js` (`createMenuOverlayManager({ getContentView, createSheetView, sendToChrome, … })`), `find-overlay-geometry.js`.
- **`src/shared/` ESM pure decision modules.** Pure functions with no Electron/Node dependency, exported via real `export`/`import` — see the ESM pattern above (`url-safety.js`). Exemplars: `jar-page-model.js` (`buildJarPageModel`, `PALETTE`), `inherit-container.js` (`inheritFromPartition`). A module consumed only main-side stays plain CJS by design instead of converting — e.g. `guest-forward-allowlist.js`.

**CJS-by-design quartet + the eslint parse-guard pair.** Four `src/shared/` files stay CJS, not ESM, for two distinct reasons: `automation-dev.js` and `internal-page.js` are **PRELOAD-REACHABLE** — required by `chrome-preload.js`'s renderer-side Node `require`, which has no `require(esm)` support (the M07 Flight 2 leg-1 divert: a preload→shared require edge landing on a converted module is the exact blocker class); `dev-profile.js` and `guest-forward-allowlist.js` stay CJS by a zero-benefit ruling (no preload edge, but no ESM upside either). `eslint.config.mjs` binds all four to `sourceType: 'commonjs'` in the `src/main/**` + preload block (:17-19), and the later `src/shared/**` module block's `ignores` entry (:29-34) is **LOAD-BEARING** — without it, later-wins would silently re-bind the quartet to `module` and delete the parse guard on exactly the preload-constrained files (an `export` in a preload-reachable file must FAIL lint, not merely misbehave at a live boot).

**Renderer evaluate-seam closed-set rule.** `src/renderer/renderer.js` is an ES module, so its top-level functions are module-scoped, not page globals — invisible to `evaluate`-driven callers (dogfooding/live-boot procedures, behavior-test specs, `scripts/a11y-audit.mjs`). The explicit `Object.assign(/** @type {any} */ (globalThis), {…})` block at the tail of `renderer.js` republishes exactly the FD-approved 19-entry set, each grouped by consumer (`// dogfooding`, `// behavior-spec`, `// a11y-audit`). This is a **CLOSED SET**: growing it requires an FD ruling, not an ad hoc addition when a new evaluate caller needs a function.

**DD3-as-permanent: the defer/module pin.** Every classic (non-module) `<script>` tag on a page that also loads a module script must carry `defer` — a non-defer classic executes DURING parse, before any module, inverting document order. DD3 started as a transitional rule for the ESM conversion and is now the **permanent** house rule for all documents, contract-tested (see below). `menu-overlay.html`'s `menu-controller.js` (the DD6 carve-out, the product's one remaining classic script) is the live binding case.

**Shared-global onboarding checklist (post-ESM, DD10(b), M06 Flight 4 / M07 Flight 2/3).** When adding a new `src/shared/` module, or a new page that consumes one:
- Add the page's `<script type="module">` tag — never a classic tag on a `src/shared/*.js` file (the module pin below is a suite-level guard, not just a style preference).
- If the consumer is an internal `goldfinch://` page, add a flat `pathname → file` entry to that host's `INTERNAL_PAGES` sub-map (`src/main/main.js`) — internal pages resolve subresources ONLY through this allowlist, never a directory passthrough.
- If the entry point must be reachable from `evaluate` (dogfooding/behavior-spec/a11y-audit), add it to the closed-set seam in `renderer.js` — FD ruling required (see above).
- **Preload-bridge declare rule.** `contextBridge` methods (`GoldfinchBridge`/`GoldfinchInternalBridge` in `renderer-globals.d.ts`) are the preload's exposed surface, NOT shared modules — ESM did **not** retire them. A new bridge method still needs its own `renderer-globals.d.ts` entry.
- Retired by the ESM conversion, no longer needed: the dual-export tail (`if (typeof module !== 'undefined') { module.exports = … } else { globalThis.x = … }`); the shared-predicate **ambient** `declare` entries that used to live in `renderer-globals.d.ts` (the file itself survives at 376 lines — `menu-controller`/`MenuEntry`/the bridge interfaces stay; only the shared-predicate ambient declares are gone, since pages now `import` those functions directly); and the injected eslint shared-globals entries for `src/renderer/**` (pages import what they use — only `menuController`/`focusItem` remain injected, the DD6 carve-out).

**Two real-boot defect classes these shapes don't catch by construction** — both invisible to `npm test`, only found by booting the real app:

1. **`mkdirSync`-before-synchronous-persist.** A store that must synchronously persist on first boot (before Electron has lazily created `userData`) needs an `fs.mkdirSync(dir, { recursive: true })` ahead of the write. Pre-M10-Flight-1, `jars.js` owned this call itself (its synchronous seed-path `save()`); since the app-db consolidation every store's write runs through `app-db.js`'s document-row seam, so `app-db.js`'s own `open(userDataPath)` does the `mkdirSync` once for the whole substrate (`src/main/app-db.js`) and no individual store needs its own call anymore. `settings-store.js` never needed one: it only ever saves after a user action, by which point the directory already exists. Unit fixtures built on `mkdtempSync` always pre-create their temp dir, so this class never surfaces in the suite.
2. **Classic-`<script>` shared top-level lexical-scope collision — retired for `src/shared/`.** Module scripts get their own scope, so two `src/shared/` files can no longer collide by independently declaring the same top-level `const`/`let`/`class` — the class is structurally gone, not merely guarded. The surviving residue is `menu-controller.js`, the product's one remaining classic script (DD6 carve-out): it and any future classic script still share one document-level scope with each other. The former `vm`-replay collision nets (`chrome-shared-scripts.test.js`, `jars-page-shared-scripts.test.js`) are retargeted as **script-tag contract tests** (F2 leg 6) — not collision nets: a tag-count guard (a parse regression that silently matched zero `<script>` tags would make every other pin vacuously green), the DD3 defer/module pin (above), and a module pin (every `src/shared/*.js` script tag is `type="module"` — a classic tag on an ESM file is a parse-time `SyntaxError` only a live boot would otherwise catch).

**Grep-AC convention.** Some acceptance criteria are negative/invariant assertions ("this function's body must not change") that a unit test can't cheaply encode. A leg's Verification Steps may instead specify a literal, reproducible `grep`/diff and treat every hit as requiring individual exempt-or-real judgment rather than automatic pass/fail — e.g. confirming a function's body is byte-unchanged after a refactor (grep + diff), or that a retired literal no longer appears under `src/` (grep → 0 hits, with any hit inspected and marked exempt or real).

**MockTimers recipe (per-test, never file-global).** For retry/timeout logic that runs on real timers, enable Node's fake timers **per test**, e.g. `t.mock.timers.enable({ apis: [...] })` inside the test body — never file-global (a file-global enable leaks fake time into every other test in the file). Drain with real `setImmediate` around single-step ticks: advance the clock one step, `await` a real `setImmediate` to flush the microtask/macrotask queue, then assert — never one big tick that jumps past every intermediate state (a single large tick can skip over a retry's intermediate promise resolutions and hide ordering bugs the real runtime would hit). Exemplar: `test/unit/automation-find.test.js`. Source: M07 Flight 1 debrief — the six real-timer tests converted from ~5s wall-clock to ~50ms with zero production change once the engine's retry logic was confirmed to use global timers (MockTimers intercepts global timers in-process; no injection seam needed).

### Internal `goldfinch://` pages — the trusted-embedder security model

Goldfinch's own chrome pages (currently just the **Settings** stub) are served from a privileged `goldfinch://` scheme, **not** from a web origin. This is a genuinely separate, privileged trust domain from web-content tabs — treat it as security-critical.

- **Scheme + session.** `goldfinch` is registered privileged (`{ standard: true, secure: true }`) at **module load** in `main.js` (before `app.ready`, which `registerSchemesAsPrivileged` requires). `standard: true` is load-bearing — it gives the scheme real origin/host semantics (`new URL('goldfinch://settings').host === 'settings'`) and lets it enforce CSP. Pages are served from a **dedicated in-memory internal session** (`session.fromPartition(INTERNAL_PARTITION)`) whose `protocol.handle('goldfinch', …)` is registered **session-scoped** — the global `protocol` would bind the default session and the internal `WebContentsView` wouldn't see it. (DD2/DD3)
- **`goldfinch-internal` partition is single-sourced — import, never re-derive.** The partition string lives **only** in `src/shared/internal-page.js` (`INTERNAL_PARTITION`), imported by both the main process (session + handler; `tab-create` trusted branch) and the renderer (surfaced via `window.goldfinch.internalPartition`). Any literal drift silently resolves a different session — the `__goldfinchInternal` marker is absent and every gate (`applyShields`, automation exclusion, protocol handler) fails open. Import the constant byte-for-byte; never re-type or re-derive it. No `persist:` prefix — the stub is static, nothing to persist.
- **CSP is set IN the response, not via `onHeadersReceived`.** `handleInternal` stamps the strict CSP (`default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`) directly on the `Response` headers. **Custom-protocol responses bypass the `webRequest`/`onHeadersReceived` pipeline**, so that hook would silently never fire — do not move CSP there. The CSP value lives in the `INTERNAL_CSP` constant in `main.js`; do not relax it without a security review.
- **Subresource-serving model.** `INTERNAL_PAGES` is a **host → pathname → absolute-file-path** map (e.g. `settings: { '/': …settings.html, '/settings.css': …settings.css, '/settings.js': …settings.js }`). `main.js` builds absolute paths with `path.join(__dirname, …)` and passes the map to `createResolver(INTERNAL_PAGES)` at startup (imported from `src/main/internal-assets.js`). `handleInternal` calls the returned `resolve(host, pathname)` per request; a `null` return is a 404. This is **traversal-proof by design**: the resolved `file` is taken directly from the map value — no path arithmetic is ever performed on `url.pathname`. Content-type is derived by `contentTypeFor(file)` (keyed on the map entry's *file extension*, never the raw URL). `internal-assets.js` is `__dirname`-free and Electron-free so it can be unit-tested with a synthetic map (see `test/unit/internal-assets.test.js`). When adding a new subresource to an existing internal page, add an explicit `pathname → file` entry to that host's sub-map in `INTERNAL_PAGES`; never introduce a directory passthrough.
- **The four gates.** Internal pages open **only** through the trusted path, defended in depth:
  1. **Provenance flag** — `createTab(url, container, { trusted: true })` in the renderer. Trust is the **call site**, never inferred from the URL. The trusted call sites are the kebab **Settings** and **Downloads** action bodies (`KEBAB_ACTIONS`, executed in the chrome's menu-overlay channel-6 dispatch) and `openSiteSettingsTab` (the site-info "Site settings →" destination).
  2. **`isInternalPageUrl` allowlist** — the trusted branch validates the URL with `isInternalPageUrl` (canonical `goldfinch://settings` root only); the untrusted branch uses `isSafeTabUrl`, which **rejects** `goldfinch://`. The page-reachable `onOpenTab` IPC route calls `createTab(url)` with **no** trusted flag, so web content reaching `createTab` can never select the internal branch.
  3. **Session-aware `will-navigate`** — the guard in `main.js` branches on `contents.session.__goldfinchInternal`: the internal session may navigate only within `isInternalPageUrl`; every web-origin `WebContentsView` keeps the stricter `isSafeTabUrl` rule (which still rejects `goldfinch://`).
  4. **Internal-session-only handler** — the `protocol.handle` lives on the internal session alone, so web-origin tabs literally have no handler for `goldfinch://`.
- **NEVER widen `isSafeTabUrl` to admit `goldfinch://`.** That predicate guards untrusted web content; widening it would let any page open/navigate to internal chrome. Internal pages get in **only** via the trusted `createTab` path above. Net effect: web content cannot navigate to, open, embed, or `fetch` the scheme.
- **The internal `WebContentsView` runs context-isolated + sandboxed.** Its `webPreferences` are set at construction time in the `tab-create` handler's trusted branch: `contextIsolation: true`, `sandbox: true`, `preload: internal-preload.js` (opposite of web views, which run `contextIsolation:false` for farbling). The internal session is **excluded** from the web-content wirings (`applyShields`, download handler) — primarily via a module-scoped `creatingInternalSession` flag read inside the synchronous `session-created` hook, with a post-creation `__goldfinchInternal` marker as belt-and-suspenders.

- **Address-bar chip + read-only address bar.** `updateAddressChip(tab)` (in `renderer.js`) is called from every address-sync site (`activateTab`, `did-navigate`, `did-navigate-in-page`). It sets `els.addressChip` to `data-state="internal"` and makes the address `<input>` `readOnly` when the active URL matches `isInternalPageUrl`; `data-state="web"` (with host label) for `http(s)` tabs; neutral default for blank/new tabs. The `#address-chip` element (`index.html`) also acts as the trigger for the **site-info popup**, rendered from the menu-overlay sheet's `info-popup` template (registered sheet-side without an `items` getter — the controller's roving-tabindex contract no-ops when `!entry.items`; the template's own `keydown` covers Escape/Tab, both resolving to the chip-refocus flavor). The chip carries `aria-expanded` while the popup is open.
- **"Site settings →" destination.** `siteInfoModel(activeTab())` in `renderer.js` builds the site-info model from the shared `deriveSiteInfo` (`src/shared/site-info.js` — the ONE derivation source, unit-tested); the sheet renders it. Activating **"Site settings →"** dispatches `openSiteSettingsTab()` (renderer.js — the shared body), which navigates to `goldfinch://settings/#privacy`: it finds an existing internal tab via `[...tabs.values()].find(isInternalTab)` and calls `window.goldfinch.tabNavigate({ wcId: existing.wcId, verb: 'loadURL', args: ['goldfinch://settings/#privacy'] })` + `activateTab(existing.id)`, or opens a new trusted tab (`createTab('goldfinch://settings/#privacy', null, { trusted: true })`) when none exists. This replaced the earlier `togglePrivacy(true)` call (which opened the slide-out Shields panel); the slide-out panel is still accessible via the toolbar Shields icon and `Ctrl+Shift+P`.
- **Internal-tab navigation lock (UX-only — `navigate()` in `renderer.js`).** When `navigate(input)` is called while `isInternalTab(tab)` is true, any non-internal URL is rerouted to `createTab(url)` (a new normal tab, web branch) and the internal tab is left untouched. The `readOnly` address bar prevents direct user entry, but this lock is belt-and-suspenders for programmatic callers. **This is the UX half of internal-page isolation.** The security half — main-side `registerInternalHandler` in `src/main/internal-ipc.js` verifying `event.senderFrame.origin === 'goldfinch://settings'` AND the `__goldfinchInternal` session marker before forwarding any call to the privileged backend — **landed in Flight 6** (closing the Flight-4/5 "internal-bridge Known Issue"). Both halves are now present: the nav lock keeps the internal tab on its URL; the origin-check gates the privileged IPC so web-origin code cannot invoke internal bridge APIs even if it somehow obtained an `ipcRenderer` reference.

When adding an internal page (Flight 5+): add a `host → pathname → file` entry tree to `INTERNAL_PAGES`, add the host to `isInternalPageUrl`'s allowlist (`INTERNAL_HOSTS` in `url-safety.js`), add its origin to the internal-origin allowlists (`INTERNAL_ORIGINS` in both `internal-ipc.js` and `internal-preload.js`), and open it via the trusted `createTab` path — never by relaxing the web gates.

**There are now THREE trusted internal origins (Flight 5 added `goldfinch://downloads`; M06 Flight 3 added `goldfinch://jars`): `goldfinch://settings`, `goldfinch://downloads`, and `goldfinch://jars`.** The trust boundary is **"internal page vs web," NOT "settings vs downloads vs jars"** — every internal origin is equally privileged, so the SAME `goldfinchInternal` bridge is exposed to each page and any internal page can call any `registerInternalHandler` channel. `isTrustedInternalSender` and `isInternalPageUrl` are **allowlist-based** (`INTERNAL_ORIGINS` / `INTERNAL_HOSTS` sets), not single-string matches. The `goldfinch://downloads` page (`downloads.{html,css,js}`) is the app-level downloads surface; its `internal-downloads-*` channels resolve the actionable `savePath` MAIN-SIDE by id (never trusting a renderer-supplied path) for open/show. The `goldfinch://jars` page (`jars.{html,css,js}`) is the cookie-jar management surface (M06 Flight 3); its `internal-jars-*` channels share their handler bodies with the chrome-trusted `jars-*` channels (see `src/main/jar-ipc.js`) rather than forking logic per trust domain. Flight 4 added two per-jar data-control pairs sharing the same twin-registration pattern: `jars-clear-data`/`internal-jars-clear-data` clears one or more requested data classes (cookies, site storage, or cache — see `src/shared/jar-data-classes.js`) from a jar's session partition, strict fail-closed on any unknown class/jar id; `jars-wipe`/`internal-jars-wipe` performs the full identity wipe (all storage + cache, plus a fingerprint-seed reroll) and broadcasts `jar-wiped { id }` on success so the chrome renderer can reload the jar's open tabs.

**`goldfinch://jars` panel structure (M08 Flight 2).** Each persistent jar's section renders three independent WAI-ARIA disclosure panels — History / Cookies / Other site data (`src/shared/jar-panel-model.js`'s `JAR_PANELS`, default collapsed) — plus a footer (Wipe + Delete, jar-level identity actions, outside every panel). Panel toggle/region DOM ids use a **double-hyphen** separator, `jar-<jarId>--<panelId>` (e.g. `jar-work--history`), never single-hyphen — `slug()` collapses non-alnum runs to one `-` and never emits `--`, so a jar id that itself ends in a panel token (`jar-personal` vs a jar literally named "Personal Cookies") can't collide with the region id. The hash deep-link (`goldfinch://jars/#jar-<id>--<panel>`) and the scroll-spy nav both key off these same ids. The History panel's live visit count renders **only** inside its disclosure-button label (`<span class="jar-panel-count">`); `render()`/`updateJarSection` never write that span — its only two writers are the section's build-time fetch and the module-level `onHistoryChanged` handler, both re-querying via `historyCount` rather than trusting broadcast payloads. Burner has no panels (structurally driven by `row.isBurner`, never an id check).

**History joins the data-class control as a fourth class; its panel gets its own content module (M08 Flight 3).** `JAR_DATA_CLASSES` (`src/shared/jar-data-classes.js`) gains a fourth descriptor, `{ id: 'history', label: 'History', storages: null, custom: 'history' }` — `storages: null` is already the `cache` sentinel, so `history` is distinguished via the `custom` discriminator, and `jar-ipc.js`'s `handleClearData` dispatches on `d.custom === 'history'` **first**, ahead of the storages-null cache fallback (a naive fallthrough would clear the session cache while reporting history cleared). `'history'` was added to `CONFIRM_REGIONS` and the History region now calls the shared `buildRegionControls()` like every other panel, so its "Clear history" button + confirm (copy: `"Clears this jar's browsing history."`) are auto-generated, not bespoke. The panel's actual content — retention select, search, the visit list, paging, per-row delete — lives in a **new page module**, `src/renderer/pages/jars-history-panel.js` (`createHistoryPanel({ bridge, jarId, mountEl, onError, getRetentionDays })`), one instance per persistent jar, mounted as the History region's second child (`div.jar-history-mount`) beside jars.js's own `.jar-data-controls` block — the DOM contract is exactly two children, and jars.js never writes inside the mount. This is Flight 2's DD2 growth-trigger firing proactively: jars.js grew only ~55 lines integrating the module instead of the ~400 direct implementation would have cost.
- **Retention control.** A `<select>` at the top of the mount (presets 7/14/30/90/180/365 days plus the jar's current value as an extra option if it isn't a preset) applies instantly on `change` via `bridge.jarsSetRetention({ id, days })` (internal-bridge only — no chrome-preload parity, since the jars page is the only consumer); a failed call reverts the select and surfaces the section's error line.
- **`setRetention` + `pruneOneJar`.** `jars.js` (the main-process store) gains `setRetention(id, days)`, which **rejects** (never coerces) an out-of-range/non-integer `days`. The `jars-set-retention`/`internal-jars-set-retention` IPC twins (`src/main/jar-ipc.js`) persist the new value, broadcast `jars-changed`, then immediately run `historyStore.pruneOneJar(jarId, days, Date.now())` — a **new single-jar store method** (`src/main/history-store.js`) added specifically so a retention edit can't reuse `pruneExpired`'s multi-jar map contract, which treats every absent jar id as orphaned and would otherwise delete every *other* jar's entire history on a single jar's retention edit. `pruneOneJar` runs only that jar's cutoff delete, no orphan sweep, and broadcasts `history-changed { jarId }` when it deletes rows — so shortening retention takes effect at once.
- **History purges on wipe and on jar delete.** `handleWipe` and `handleRemove` (`src/main/jar-ipc.js`) both call a shared `wipeJarData(ses, jarId)` helper — the storage+cache+seed-reroll composition that already appeared three times pre-flight (`handleRemove`, `handleWipe`, and `main.js`'s `identity-new`); this flight's new history-purge concern is what tips the extraction per M06 F4 DD3's "revisit at the next copy" clause, not a literal fourth call site. `wipeJarData` now also purges that jar's history rows — in its own try/catch, fail-soft, after the session-data calls, so a purge failure never blocks the identity wipe or the `jar-wiped` broadcast. `handleWipe` broadcasts `history-changed { jarId }` when the purge actually deleted rows. `main.js`'s `identity-new` copy stays separate per flight DD3 (cross-module coupling for three lines was rejected in M06 F4 DD3's rationale and stands) and deliberately does **not** purge history — it is an anti-tracking identity break, not a data-visibility control; only the data-class control, jar wipe, and jar delete clear history.

### Settings store (`src/main/settings-store.js`)

The **canonical home for app preferences** going forward. Do not scatter new preferences into ad-hoc constants or into `shields.js`.

- **Electron-free.** `settings-store.js` does not `require('electron')` and does not call `app.getPath` at module scope. The `userData` directory is **injected** at `load(userDataPath, opts?)` (called from `init-profile.js`'s `initProfileAndStores`, alongside `shields`/`jars`/`downloads.load()` — after `appDb.open(userDataPath)`, which every store's row read/write depends on; see App database below). This makes the pure core unit-testable with a synthetic temp dir and no Electron stub.
- **Durable through the app-db document-row seam (M10 Flight 1).** `save()` writes the serialized config as a transactional UPSERT into `app.db`'s `documents` row keyed `'settings'` (`app-db.js`'s `createDocumentStore('settings').write(...)`) — no tmp-file/rename dance; `node:sqlite`'s synchronous write is the durability primitive. On error, the call propagates (callers, including the bridge, learn the write failed). See "App database" below for the substrate.
- **Schema-versioned with safe-default repair.** The schema is the `DEFAULTS` constant (`{ version: 1, homePage: '...' }`). `load()` merges the stored row (or, on a row-absent profile with a legacy `settings.json` still present, that file's migrated contents — see "App database" below) onto a fresh copy of `DEFAULTS` using per-key validation: a corrupt field is silently repaired to its default while valid siblings are kept. `load()` **never throws** — the app must still boot on a corrupt row or file.
- **Per-key validation.** `VALIDATORS` (`settings-store.js`) maps each settable key to a predicate. `homePage` requires `isSafeTabUrl(v) && v !== 'about:blank'` — `about:blank` is excluded because `isSafeTabUrl` admits it but it is not a meaningful home page. `set(key, value)` validates **before** mutating so the prior value is kept on rejection; it throws `TypeError` for unknown keys or invalid values. Unknown keys in the stored row are silently dropped on load.
- **Pluggable serialization seam (DD6).** `load` and `save` use a `{ serialize, deserialize }` codec that defaults to `JSON.stringify`/`JSON.parse`; the codec's output is exactly what lands in the row's `payload` TEXT column. When a secrets manager is built, a `safeStorage`-backed codec replaces only that pair — the row-write path, schema, and validation are unaffected. **Do not add encryption now** — the seam is built in so it can be layered in later.
- **Persisted location.** `userData/app.db`'s `documents` row keyed `'settings'` (the `userData` directory Electron provides via `app.getPath('userData')`). A pre-M10-Flight-1 profile's `userData/settings.json` is imported once, on the first boot after the upgrade, and renamed `settings.json.migrated` — see "App database" below.

**Home-page setting.** `homePage` is the first live key. It is promoted from a compile-time constant in `renderer.js` to a store value loaded at startup and kept live by a `settings-changed` broadcast. The renderer holds a `homePageCache` filled from `window.goldfinch.settingsGet('homePage')` at startup (the initial `createTab` awaits this to avoid a startup race); every `no-arg createTab()` reads `currentHomePage()` from the cache. The `settings-changed` broadcast arrives via `window.goldfinch.onSettingsChanged(cb)` (chrome trust domain) and via `window.goldfinchInternal.onSettingsChanged(cb)` (internal guest).

**`toolbarPins` setting.** `toolbarPins: { media: true, shields: true, devtools: false }` is a boolean map controlling which toolbar icon buttons are visible. Media and Shields default `true` (preserves today's toolbar on first run / upgrade); **DevTools defaults `false` (unpinned)** — a power-user tool, opt-in (DD4, M04 Flight 3). Notes:
- **Object-typed keys need an explicit `VALIDATORS` entry.** The no-validator fallback uses `typeof val === typeof DEFAULTS[key]`, but `typeof null === 'object'` and `typeof [] === 'object'` — the fallback would wrongly accept `null`/arrays. `VALIDATORS.toolbarPins` explicitly rejects those.
- **Normalize-at-load for forward-compat.** `NORMALIZERS.toolbarPins` deep-merges the stored value onto `DEFAULTS.toolbarPins`: `(v) => ({ ...DEFAULTS.toolbarPins, ...v })`. This means `store.get('toolbarPins')` always returns a fully-populated object. When a new pinnable item is added to `DEFAULTS.toolbarPins`, old config files that lack it have it filled in with **its `DEFAULTS.toolbarPins` value** automatically — no consumer spreads defaults manually. (That default is per-key: Media/Shields default `true`, DevTools defaults `false` — there is **no** general "filled in as `true`" rule; the normalizer copies whatever the key's default is.) The same normalizer runs in `set()` after validation (partial writes are safe). Adding `devtools` needed **no** validator/normalizer logic change and **no** schema-version bump (the spread auto-populates it) — only the `@typedef Settings` `toolbarPins` type + the `applyToolbarPins` JSDoc param type gained the `devtools` key (for `npm run typecheck`).
- **`getAll()` deep-copies the nested object** (`{ ...config, toolbarPins: { ...config.toolbarPins } }`) so callers cannot mutate the live config through the returned reference.

**DevTools affordance (M04 Flight 3 / SC5).** Goldfinch opens Chromium DevTools for the **active web tab** as a first-class, user-facing tool — separate from the M03 automation/MCP `openDevTools`/`closeDevTools` ops. The two entry points share one code path:
- **The human path.** The chrome renderer calls `window.goldfinch.toggleDevtools(wcId)` / `window.goldfinch.isDevtoolsOpen(wcId)` — two-way `ipcRenderer.invoke` bridges in `chrome-preload.js` (mirroring `zoomApply`/`getZoom`; `invoke` not `send`, because the button must reflect the authoritative open/closed state). They reach `ipcMain.handle('toggle-devtools' / 'is-devtools-open', …)` in `main.js`, which act on the **passed `webContentsId`** (never `activeTab()` — a TOCTOU guard, DD1), apply the `isInternalContents` guard (web-content-only, DD5 — returns `false` on internal/dead contents), and delegate to the shared `src/main/devtools.js` helper (`setDevTools(wc, open)` / `toggleDevTools(wc)` → `wc.openDevTools({mode:'detach'})` / `wc.closeDevTools()`; detached only — in-window docked DevTools via `setDevToolsWebContents` is a BACKLOG item, not yet implemented).
- **The agent path reuses the same helper.** The MCP `openDevTools`/`closeDevTools` ops (`observe.js`) delegate to `setDevTools` — one code path for the actual open/close + guard; the MCP tool is the agent entry, the IPC is the human entry (the renderer must NOT go through the loopback MCP transport).
- **Triggers.** `F12` (modifier-less) and `Ctrl+Shift+I`: captured main-side in the guest `before-input-event` (`F12` branch **before** the modifier gate, `Ctrl+Shift+I` in the gated section, both `isAutoRepeat`-guarded) and in the chrome renderer keydown fallback (`F12` before the `if (!mod) return;` gate; `Ctrl+Shift+I` a chain `else if`, key-letter-disambiguated from `Ctrl+Shift+P`). The pinnable `#toggle-devtools` toolbar button (`toolbarPins.devtools`, **default `false`**) is the third entry — its click also routes through `toggleDevtools`. **All three work regardless of pin state**; all are inert on `goldfinch://` (button click no-ops, shortcuts open nothing — DD5).
- **Live button state.** The Leg-1 spike was POSITIVE: `devtools-opened`/`devtools-closed` fire on the guest `webContents`, so `main.js` forwards `devtools-state-changed` to the chrome renderer (mirroring `zoom-changed`), and `onDevtoolsStateChanged` updates the button's `aria-pressed` live — including a DevTools-window-initiated close. `wc.isDevToolsOpened()` is the source of truth (queried on tab activation + post-toggle, never cached); the live event is the enhancement.
- **CDP single-client lock cross-ref.** Opening native DevTools makes it the one CDP client Chromium allows per `webContents`, so the automation ops that attach the in-process debugger (`readAxTree`, `scroll` via `cdp.js` `withDebuggerSession`) surface the discriminated `{ automation: 'debugger-unavailable', reason: 'attach-failed' }` refusal; the CDP-free ops (`evaluate`, `injectScript`, `captureScreenshot`, `readDom`) keep working; closing DevTools restores. This is the existing M03 refusal (no new lock UI — DD7); the non-CDP human affordance is what lets `tests/behavior/devtools-cdp-conflict.md` finally observe the conflict for real (macOS-authoritative). See the `cdp.js` single-client-lock note below.

**Pin-state propagation — `applyToolbarPins` + `settings-changed` broadcast.** On startup the chrome reads `window.goldfinch.settingsGet('toolbarPins')` and calls `applyToolbarPins(pins)` (`renderer.js`), which toggles `.hidden` on `els.toggleMedia` / `els.togglePrivacy` / `els.toggleDevtools` per each pin value. The existing `window.goldfinch.onSettingsChanged(all)` handler also calls `applyToolbarPins(all.toolbarPins)` when the broadcast arrives, so any write from any surface (Appearance toggle, right-click Unpin) propagates to the toolbar live.

**Pinnable toolbar buttons are TAB-SCOPED (HAT, M04 Flight 3 Leg 4).** Media (`#toggle-media`), Shields (`#toggle-privacy`), and DevTools (`#toggle-devtools`) all act on the **active tab's web content**, so their enabled/disabled state is coupled to the active tab type, not to pin state. They are set `disabled` on `goldfinch://` internal tabs (where they are functionally inert) and re-enabled on web tabs — driven from `activateTab` (reading `isInternalTab(tab)`), reusing the existing `.icon-btn:disabled` dim. This is **separate from `applyToolbarPins`**, which remains pin-driven visibility-only (DD5's still-valid contract): `applyToolbarPins` toggles `.hidden`; the tab-activation path toggles `disabled`. **Forward guidance:** keep the pinnable toolbar area **tab-scoped only** — do NOT intermingle tab-scoped and application-scoped controls there. The kebab menu is the lone app-scoped exception; any future app-scoped buttons belong elsewhere (e.g. a menu bar).

When a toolbar icon is **unpinned**, `applyToolbarPins` adds `.hidden` to the button. The panel behind it (`#media-panel`, `#privacy-panel`) and keyboard shortcuts (`Ctrl+M`, `Ctrl+Shift+P`) remain fully active — the shortcut reaches the panel even when the toolbar button is hidden. The focus-restoration guard in `togglePanel` and `togglePrivacy` skips `.focus()` on a hidden button (a hidden button is not in the reachable focus order; calling `.focus()` on it is a silent no-op that strands focus on `<body>`).

**Right-click Unpin — page-context menu in toolbar-mode + main-owned write path (migrated M04 Flight 4; sheet-rendered since M05 F8).** Right-clicking (or pressing the Context-Menu key on) a pinned toolbar icon fires a `contextmenu` event on `els.toggleMedia` / `els.togglePrivacy` / `els.toggleDevtools` in `renderer.js`. The handler `e.preventDefault()`s (suppress the OS menu) and calls `openToolbarContextMenu(item, button)`, which opens the **page-context menu surface on the menu-overlay sheet** in **toolbar-mode**: `pageContextModel(params, toolbarItem)` short-circuits on the toolbar item to a single **"Unpin {Media|Shields|DevTools}"** `role="menuitem"` item, anchored just below the button via the `chromePointToSheet` chrome→sheet translation (no native Electron `Menu.popup` — that path was **retired** in M04 F4; the chrome-DOM render was retired in F8). Activating the item runs the chrome's channel-6 dispatch body, which calls the narrow chrome-trusted **`window.goldfinch.unpinToolbarItem(item)`** bridge (`ipcRenderer.send('unpin-toolbar-item', item)`, no origin gate — same chrome-trust domain as `window-minimize`/`app-quit`/`chrome-clipboard-write`). `ipcMain.on('unpin-toolbar-item', ...)` in `main.js` validates `item ∈ ['media', 'shields', 'devtools']` and does the **read-modify-write**:
1. Reads the current `toolbarPins` via `settings.get('toolbarPins')`, sets `[item]: false` on a copy (`{ ...settings.get('toolbarPins'), [item]: false }` — **required**: `settings.set` replaces `toolbarPins` and `NORMALIZERS.toolbarPins` deep-merges over `DEFAULTS`, so a bare `{ [item]: false }` would silently reset the other items to their defaults).
2. Writes the updated map via `settings.set('toolbarPins', ...)`.
3. Broadcasts via `broadcastToChromeAndInternal('settings-changed', settings.getAll())`.

The Unpin dispatch body also calls `els.address.focus()` **after** the send (a dispatch-body refocus, deliberately NOT the channel-7 reason map — page-context stays escape-only there), because the unpin hides the button the menu was anchored to (a trigger-focus return would otherwise strand focus on the about-to-be-hidden button / `<body>`). A focused toolbar pin button + the Context-Menu key double-fires deterministically (both a `contextmenu` event and a global `keydown`), so the renderer's chrome-focus keydown handler returns early when `document.activeElement` is one of the three pin buttons — only the `contextmenu` path opens.

**Main owns the write.** The renderer never writes settings directly; it only fires a one-way IPC send. The main process is the single writer for all settings. The broadcast then propagates the update back to both the chrome renderer (`onSettingsChanged → applyToolbarPins`, the live button `.hidden` flip) and any open internal guest (two-audience fan-out — same mechanism as `shields-changed`), so the settings-page pin toggle and the toolbar stay in sync, and the write persists across restart.

**Page context menu (M04 Flight 4 / SC6; sheet-rendered since M05 F8) — custom cross-process menu, web-content-only.** Right-clicking web content opens Goldfinch's own on-brand context menu instead of the native OS menu. The capture flow is **guest → main → chrome** (unchanged): the guest `webContents.on('context-menu', …)` listener is wired inside the `!__goldfinchInternal` guard in `web-contents-created` (`main.js`) — it `event.preventDefault()`s the native menu and forwards `{ wcId, params }` to the tab's OWNING window's chrome (event-time `getChromeForTab` resolution — M09 F6 routing class 3; an owner-null covers the window-gone case). Because the listener sits behind the internal guard, internal `goldfinch://` guests are **auto-excluded** (no per-page renderer gate needed — the menu is a no-op on internal tabs by construction). The chrome renderer subscribes via `window.goldfinch.onPageContextMenu(...)`, builds the model with the pure **`pageContextModel(params, toolbarItem)`** (`src/shared/page-context-model.js` — ESM, unit-tested; typed `item`/`separator`/`note` array; NAMESPACED ids `link:*`/`image:*`/`sel:*`/`edit:*`/`spell:<index>`/`action:inspect`/`action:unpin:*`; spelling suggestions dispatch by **INDEX**, so guest strings never round-trip as commands), and opens it **on the menu-overlay sheet**: sections link → image → selection → editable (`editFlags`-gated, omitted-not-disabled) → spelling suggestions (when spellcheck is on) → always **Inspect** (which routes through the existing `toggle-devtools` IPC path — web-only). The menu opens at the cursor at **1:1 guest coordinates** — the sheet covers exactly the guest region, so `params.x/y` need **no offset translation** (the old webview-rect mapping was deleted at the F8 cutover); a chrome-focused Shift+F10 / Context-Menu key opens an Inspect-only menu at the focused element via the `chromePointToSheet` translation (the in-guest keyboard case synthesizes a real guest `context-menu` event, so it flows through the same path as a right-click — no synthetic handling needed). The chrome's channel-6 dispatch validates every id before acting (vanished params → no-op, never `createTab(undefined)`; edit actions re-checked against the allowlist; `spell:<i>` bounds-validated) and acts on the `wcId` captured at right-click (TOCTOU — never `activeTab()`). Escape's focus return is **escape-only** and goes to the captured `returnFocus` element when one exists (keyboard invocations), else the address bar (`els.address.focus()`, `renderer.js`) — never the guest; the transient trigger means no `aria-expanded` is stamped for this surface. Three narrow chrome-trusted IPC channels back the menu, all refusing the internal session: **`page-context-correct`** (`replaceMisspelling`, spelling correction), **`page-context-action`** (an allowlisted `{cut,copy,paste,undo,redo}` edit-action dispatch), and **`chrome-clipboard-write`** (a string-only OS-clipboard write, for Copy link / Copy image address / Copy selection — same trust domain as `window-minimize`). The toolbar Unpin reuses this same surface in toolbar-mode (see "Right-click Unpin" above); `openPageContextMenuForAudit()` is the a11y-audit's synthetic-params open hook.

**Menu-overlay sheet — all chrome menus render from a transparent overlay view (M05 Flight 8).** The sheet replaced the M05-F4 freeze-frame pattern (`freezeGuest`/`unfreezeGuest` + the `capture-active-guest` IPC — all **retired**, deleted at the F8 cutover): menus now composite above the **live** guest instead of a captured still.
- **Architecture.** A **PER-WINDOW** lazy-singleton transparent full-guest `WebContentsView` ("the sheet": `src/renderer/menu-overlay.{html,js,css}` + `src/preload/menu-overlay-preload.js`, chrome-class trust domain), managed by the **Electron-free** `src/main/menu-overlay-manager.js` (`createMenuOverlayManager` — injected deps, offline-unit-tested). Show = `addChildView` **after** the guest (z-order invariant); the sheet is never focused before its model init lands; hide = `removeChildView`; bounds track the active guest through the `tab-set-bounds`/`tab-set-active` hook points; `render-process-gone` → teardown-and-rebuild. Since **M09 F7 (DD5)** the manager is instantiated **once per window** into the window registry record's `sheet` slot, and F6's roaming interim is **RETIRED**: there is no longer ONE sheet crossing windows, so the nine `getAttachedWindow() === X` conditioning checks and the cross-window routing rules are **deleted** — a per-window instance *is* its own scope. **Two windows can therefore hold an open menu simultaneously** (`enumerateWindows` reports `sheetVisible: true` for both, with two distinct `sheetWcId`s) — under the F6 interim, opening a menu in window B closed A's first, by construction. Destruction is per-window `close` (the sole site; `before-quit` retains no overlay role). The sheet covers the **guest region only** (DD12 — the toolbar stays clickable; toolbar-anchored menus render flush at the sheet's top edge). Internal `goldfinch://` tabs are **in scope** (DD7): the sheet stacks above whichever view is active; only the page context menu keeps its internal-guest exclusion (the main-side guard above). Hosted surfaces: kebab, container picker, site-info, page context (+ toolbar-Unpin mode), the new-container dialog (an `input-dialog` template — the F8 fix for the old chrome dialog's occlusion defect), and (M09 Flight 5) the **tab-context** menu — see the Tab strip section below. Chrome owns triggers/models/actions; the sheet holds **no business logic and no privileged APIs** — it renders the model (labels via `textContent` only — guest/user strings never markup) and runs the APG contract via the shared `menu-controller.js`.
- **Channel protocol (1–7).** 1 `menu-overlay:open` (chrome→main: `{menuType, model, anchor, startIndex, token}`); 2 `menu-overlay:close` (chrome→main, programmatic — incl. the trigger re-click `toggle`); 3 `menu-overlay:init` (main→sheet; a **pending-init queue**, latest-wins, absorbs the lazy first-load race); 4 `menu-overlay:activated` (sheet→main: `{id, token, value?}` — the optional `value` is sanitized main-side by `src/main/menu-overlay-value.js` `sanitizeActivatedValue`, string ≤24 or dropped); 5 `menu-overlay:dismissed` (sheet→main: `{reason, token}`); 6 `menu-overlay-activated` (main→chrome — the chrome's dispatch executes the action, validated-no-op on every id); 7 `menu-overlay-closed` (main→chrome — chrome resets `aria-expanded` and resolves refocus per entry policy). On activation, channel 7 is emitted **before** channel 6. A chrome-minted monotonic **open-token** rides 1/3/4/5/7; stale-token closes are dropped (the same-menuType re-open race).
- **Close family.** Every hide routes through the manager's **`closeMenuOverlay(reason)`** — idempotent, the single mutation point. Reasons: `escape` / `outside-click` / `blur` (sheet blur + each window's `blur` — fired ONLY when the blurred window is the sheet's current attachment window, M09 F6 DD7), `activated`, `superseded` (open-while-open = **model-replace**, no hide/re-show flicker — mutual exclusion), `toggle`, `tab-switch` / `tab-hide` / `tab-close` (tab lifecycle), `teardown`. `focusChrome()` runs for `escape`/`activated` only; the chrome side then applies the per-entry refocus policy (fixed-trigger menus focus their trigger; page-context and tab-context are escape-only → captured `returnFocus` else the address bar). A **300 ms same-menuType suppress window** (chrome-side, armed on blur-reason closes) kills the trigger re-click close-then-reopen blink.
- **DD5 find interplay.** Sheet-show hides the find overlay; `closeMenuOverlay` restores it as an **owned, explicit step** — except the tab-lifecycle reasons (`tab-switch`/`tab-hide`/`tab-close`), which skip the restore and defer to `tab-set-active`'s per-tab find-restore (no double-handling).
- **DD8 hardening.** All `menu-overlay:*` ipcMain handlers are **sender-validated by webContents identity** (chrome for 1/2; the sheet's own webContents for 4/5 — never payload-declared identity). The sheet is **NOT in `tabViews`**: invisible to `enumerateTabs`, and the resolver-level rule makes non-tab, non-chrome wcIds resolve **admin-only** (`isTabViewWcId` predicate threaded into `createEngine`/`resolveContents` — admin's SECOND relaxation alongside `allowInternal`; defense-in-depth, not a live-vulnerability fix — jar keys were already refused on session identity). Test/audit driving of the sheet is by **probed wcId at the admin tier** (use the background-tab-safe walk — skip every `enumerateTabs` wcId + the chrome).
- **DD13 accelerators.** The sheet's `before-input-event` forwards the **union** accelerator set via the pure ESM `src/shared/sheet-accelerator.js` mapper: guest-class actions (zoom, print, find, Ctrl+J…) replicate against the active guest (with the `isInternalContents` guard; Ctrl+F closes the menu then opens find), chrome-class actions (incl. `Ctrl+N` → `new-window` since M09 F6, with `autoRepeatGuard: true` on the sheet copy — windows are heavier than tabs) ride the `chrome-shortcut-action` channel → `dispatchChromeAction`. Since M09 F6 the accelerator resolves the **ATTACHMENT window's** chrome and active tab (DD7 — from the manager's tracked attachment, never global singletons). Unmodified APG keys (arrows/Home/End/Enter/Space/Escape/Tab) stay with the sheet — the menu contract wins inside the menu.

**Spellcheck (M04 Flight 4 / SC3) — opt-in, session-layer gating, accepted CDN egress.** Spellcheck is a `settings-store` boolean (`spellcheck`, **default `false`** — no schema-version bump, no migration; it rides the no-validator `typeof` fallback). It is gated at the **session layer**: `applySpellcheck(ses, enabled)` in `main.js` calls `setSpellCheckerLanguages(enabled ? ['en-US'] : [])` and is applied to `defaultSession` + every live web jar (deduped by session; jar sessions get the current setting at creation via the `session-created` hook, M06 F2 DD5 — no `PAGE_PARTITION` pre-warm) — **never** the internal session (it early-returns on `__goldfinchInternal`, and the `tab-create` trusted branch sets `webPreferences.spellcheck = false` at construction as defense-in-depth). The Settings → Appearance checkbox (`#spellcheck-enabled`) writes via the internal-origin-gated `internal-settings-set` path, whose `key === 'spellcheck'` branch drives every live web session so already-open tabs are reached (the conservative user-facing help text still says "applies to new tabs; reload open tabs to enable", because the squiggle render was inconclusive on the WSLg dev platform — Leg-2 premise-audit). **Accepted egress:** on **Linux/Windows**, the first editable-field focus *after opt-in* triggers a **one-time per-language Hunspell `.bdic` GET** from the Chromium dictionary CDN (`redirector.gvt1.com/edgedl/chrome/dict/…`); **nothing fetches while spellcheck is OFF** (the default — no spellchecker language is set on any web session until opt-in); on **macOS** Electron uses the native `NSSpellChecker` (**no `.bdic` fetch** — `setSpellCheckerLanguages` is a documented no-op there). This egress is **accepted** per DD1 (honors the mission no-silent-egress constraint: nothing until explicit opt-in, then documented — in README + here).

**Appearance pin-icon toggles (settings page).** `src/renderer/pages/settings.js` (appearance pins controller IIFE) reads `toolbarPins` via `goldfinchInternal.settingsGet('toolbarPins')` at load and calls `apply(pins)`, which sets `aria-pressed` on `#pin-media` and `#pin-shields` (the pushpin toggle buttons) and caches the current map. A click on either button flips that key: `goldfinchInternal.settingsSet('toolbarPins', { ...current, [k]: !current[k] })`. A two-way sync listener (`goldfinchInternal.onSettingsChanged`) re-applies when any surface (right-click Unpin or another settings tab) changes the map. The listener handle is captured and cleaned up on `pagehide` (see internal-preload listener cleanup below).

**Two-audience fan-out — `broadcastToChromeAndInternal(channel, payload)`.** Changes to shared state (settings writes, shields writes from either surface) must reach **both** every chrome renderer (since M09 F6: ALL registered windows' chrome `WebContentsView`s — routing class 2; a `file://` surface) and any open `goldfinch://` internal guest — internal contents receive the payload ONCE GLOBALLY, never per-window. The helper in `main.js` does exactly that: it sends to every registry record's chrome directly (excluded from the `__goldfinchInternal` filter below), then iterates `webContents.getAllWebContents()` and sends to every `wc` whose `wc.session.__goldfinchInternal === true`. Used for `settings-changed` (on any `internal-settings-set`) and `shields-changed` (on any write from either the chrome `shields-set`/`shields-pause` channels or the internal `internal-shields-set` channel).

**Settings read channel for the chrome (`settings-get`).** `ipcMain.handle('settings-get', ...)` in `main.js` is intentionally **not** behind `registerInternalHandler` — its trust domain is the `file://` chrome (the `window.goldfinch` surface in `chrome-preload.js`), the same as `shields-get`. Web webviews have no `ipcRenderer.invoke`, so only the chrome and the internal guest can reach IPC at all.

### App database (`src/main/app-db.js`)

Durable, schema-versioned substrate for the five small config/state stores —
settings, downloads, session, jars, shields (M10 Flight 1, consolidating the
BACKLOG "JSON stores → SQLite" seed onto the same live-SQLite pattern
`history-store.js` proved first). It is a **clone of `history-store.js`'s
seams, not a shared import**: `app.db` is a **separate, independent
database** from `history.db`, with its own `user_version` ladder — a corrupt
`app.db` quarantines config alone, a corrupt `history.db` quarantines
history alone, and the write-hot, high-cardinality visits table never shares
a file with small config rows (flight DD2).

- **Substrate ruling — DD1 re-affirmed and widened.** M08 F1's DD1 ruling
  (built-in `node:sqlite`, no vendored native module, preserving Goldfinch's
  zero-runtime-dependency identity) is **re-affirmed by M10 Flight 1 DD1**
  and widened from history alone to the **whole persistence layer**: every
  one of the five stores below now runs on the same experimental API. The
  standing tax widens with it — **every future Electron major bump re-runs
  the full store suite (`history-store` + `app-db` + all five converted
  stores) and treats a `node:sqlite` API break as a first-class migration
  cost**, now blocking the whole persistence layer, not just history. This
  also corrects the BACKLOG seed's stale "Node ≥ 22.12" note: Electron
  42.6.1 bundles Node **24.18**, and `node:sqlite` loads unflagged there.
  Full decision record:
  `missions/10-persistence-consolidation/flights/01-sqlite-store-consolidation/flight.md`
  DD1 (history's own record: `missions/08-history/flights/01-history-store/flight.md` DD1).
- **One `documents` table, one row per store (DD3).** Schema v1:
  `documents(store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at
  INTEGER NOT NULL)`. `createDocumentStore(name)` returns the shared
  `{ read(), write(payload, now?), remove() }` seam that every converted
  store resolves once at `load()` and reuses for every persist; every store
  write is a transactional whole-document UPSERT of its serialized payload,
  every load reads one row. This is a doc-per-row design, not per-field
  columns, because all five stores are low-cardinality wholesale-replace
  workloads — exactly the workload JSON already served fine; what the
  substrate buys is one corruption/quarantine discipline and transactional
  writes, not indexing. Each store's public API,
  `DEFAULTS`/validators/normalizers, legacy-shape handling, and
  `{ serialize, deserialize }` codec seam survive **verbatim** — the codec
  output simply lands in the row's `payload` TEXT column instead of a file,
  keeping a future `safeStorage`-encrypted codec swap codec-only.
- **`app.db` WAL file family + lifecycle placement (DD7).** `app-db.js`
  opens `userData/app.db` in `journal_mode=WAL` + `synchronous=NORMAL`
  (mirroring `history-store.js`), so the live database is a three-file
  family on disk: `app.db`, `app.db-wal`, `app.db-shm`.
  `appDb.open(userDataPath)` runs inside `init-profile.js`'s
  `initProfileAndStores`, **before** the four in-seam store loads (shields,
  settings, jars, downloads — they all resolve their row through it) and
  **after** the dev-profile `setPath('userData', …)` redirect.
  `session-store.load()` stays a `main.js` sibling call (a deliberate M09
  choice preserved by design review) — under the module-singleton design it
  simply reads the already-open `app-db.js` singleton, no signature
  threading needed. `appDb.close()` joins `historyStore.close()` at
  **`will-quit`** — deliberately after `before-quit`'s writers (the session
  terminal snapshot, the downloads interrupted-flush, any settings/jars/
  shields saves) have already run, preserving the existing
  write-before-close ordering; the order between the two DBs' closes is
  itself immaterial. `close()` checkpoints the WAL file, same as history's.
- **Migration semantics — import once, then rename `.migrated` (DD5).** At
  each store's `load()`, row-absent + legacy JSON present → the JSON is
  parsed through that store's **existing** load/repair/legacy-shape logic
  (settings merge-repair, jars' three-shape load, downloads record
  validation, session snapshot validation, shields merge-over-DEFAULTS) →
  the repaired result is written as the row → the legacy file is
  best-effort renamed `<name>.json.migrated` (never fatal — a rename
  failure doesn't undo the completed row write). A fresh profile (no JSON,
  no row) seeds in-memory defaults with no row write. A corrupt legacy JSON
  file still migrates — the repaired-to-defaults/empty result is what
  migrates, and the file is renamed regardless. Once a row exists, the
  legacy file (bare, non-`.migrated`) is ignored outright and never
  re-imported.
  - **Carve-out: jars' unknown-version envelope never migrates.** `jars.js`
    deliberately keeps a readable-but-unknown-schema-version
    `containers.json` in memory without ever writing a row or renaming the
    file (pinned by `jars-security-forward-version.test.js`), so a future
    version-compatible build can still recover the original envelope
    unchanged — migrating that branch would lossily re-validate through v2
    rules AND rename the original away, defeating the guarantee. The probe
    re-runs every boot until a compatible build handles it. Only
    known-shape jars files (the v2 envelope, a v1 bare array, or the
    no-file/seed case) migrate.
- **Quarantine → fresh defaults; `.migrated` files are never re-imported
  (DD6).** A corrupt `app.db` (and its `-wal`/`-shm` siblings) is
  quarantined to a `.corrupt-<ms-epoch>` sibling and recreated fresh on the
  next `open()` — the app must boot. Every store then seeds its in-memory
  defaults; the `.migrated` JSON siblings from an earlier migration are
  **NOT** re-imported — they are arbitrarily stale by then, and silently
  resurrecting month-old settings/jars would be worse than clean defaults.
  This is parity with the `history-store.js` quarantine precedent.
  - **Jars' post-quarantine reseed is deliberately branch-dependent.**
    Jars' no-row seed path probes `userData/Partitions/goldfinch`
    (existence only, never contents) and seeds either the fresh two-jar set
    or the four-jar legacy set. After an `app.db` quarantine, a profile
    that ever had the legacy `default` jar reseeds the legacy set — this
    mirrors today's behavior on a corrupt `containers.json` exactly
    (keeping a legacy partition's data reachable rather than orphaning it),
    and is accepted as intentional parity rather than forced to one
    deterministic seed.
- **Shields brought up to house discipline; write errors now propagate
  (DD8/DD10).** `shields.js` dropped `require('electron')`, takes the
  injected `userDataPath` like every other store, gained the codec seam,
  and writes transactionally through the shared document seam. `save()`'s
  not-loaded state (no prior `load()`) stays a **silent no-op** — the
  existing semantics its pre-load mutation call sites depend on — but once
  loaded, a row-write failure now **propagates uncaught** instead of being
  silently swallowed (the pre-flight behavior ate write errors, weakening
  the no-data-loss story). This matches the existing
  `internal-settings-set` precedent (`settings.set` already throws uncaught
  into an `ipcMain.handle` rejection): `shields.set()`/`setPaused()` can now
  reject through their IPC handlers, a new named failure mode.
- **Never throws on a corrupt existing file; `close()` is idempotent** — the
  same two seams `history-store.js` established: `open()` quarantines
  rather than propagating a corrupt-file error (and its `-wal`/`-shm`
  siblings), and `close()` tracks its own open/closed flag because
  `DatabaseSync.close()` throws on a second call.
- **`user_version` ladder — schema v2 (M10 Flight 2, Leg 3).** `attemptOpen`
  is a real, cumulative version STEP ladder, not a single version-0 branch:
  v0 → creates `documents` (v1) then steps straight through to v2 in the
  same open (a fresh profile never pauses at an intermediate version); v1 →
  applies only the v2 step; v2 → no-op. The v2 step adds `cookie_seen
  (jar_id, name, domain, path, first_seen_ms, PRIMARY KEY (jar_id, name,
  domain, path))` — the retention sweep's cookie first-seen bookkeeping
  (metadata only, DD7 — see "Retention sweep" below). This is the first
  ladder step this module has actually exercised; no real v1-only `app.db`
  exists in the wild (F1 shipped v1+v2 together), so the ladder protects a
  hypothetical future F1-ships-alone scenario, unit-pinned against a
  hand-crafted v1 fixture. `createCookieSeenStore()` is the shared
  `{ insertIfAbsent, deleteByIdentity, deleteByJar, selectExpired }` seam —
  the SAME house pattern as `createDocumentStore`, a module-singleton
  reachable from anywhere via `appDb.createCookieSeenStore()` (both
  `main.js`'s cookies listener and `jar-ipc.js`'s sweep build their own
  instance; both resolve against the one live table).

### History store (`src/main/history-store.js`)

Durable, per-jar browsing-history persistence (M08 Flight 1). Unlike the
document-row stores above (settings/downloads/session/jars/shields, each a
single wholesale-replaced row), the history store needs indexed range
queries (recent paging) and full-text search at scale, so it predates them
as the **first house store built on a live SQLite handle** with real
schema/indexes, rather than a single serialized row.

- **Substrate ruling (DD1).** The store runs on Node's built-in `node:sqlite`
  (`DatabaseSync`) — an operator ruling at mission design, not a vendored
  native module — preserving Goldfinch's zero-runtime-dependency identity
  (the M03 MCP-SDK precedent set the bar for what earns a dependency; a
  storage engine the runtime already ships does not). Full decision record:
  `missions/08-history/flights/01-history-store/flight.md` DD1 — **re-affirmed
  and widened to the whole persistence layer by M10 Flight 1 DD1**, see
  "App database" above.
- **The accepted ongoing cost — widened by M10 Flight 1.** `node:sqlite` is
  an **experimental** Node API: it emits `ExperimentalWarning` at require
  time (in the app console and in `npm test` output — cosmetic, accepted)
  and its surface may shift across Electron/Node upgrades. **Every future
  Electron major bump must re-run the full store suite —
  `history-store` + `app-db` + all five app-db-backed stores — and treat a
  `node:sqlite` API break as a first-class migration cost** — this is a
  standing tax, not a one-time risk, and as of M10 Flight 1 it blocks the
  whole persistence layer, not just history (see "App database" above).
- **Recording pipeline.** `src/main/history-recorder.js` (`createHistoryRecorder`
  — Electron-free, injected-deps factory, not a module singleton; one instance
  built in `main.js` at boot) is the recording GATE, called from the existing
  `did-navigate` / `did-navigate-in-page` / `page-title-updated` guards in
  `wireTabViewEvents` (`main.js`), which threads the tab's **partition** into
  the recorder alongside the events it already forwards. Decision gates, in
  order: (1) **positive registered-jar allowlist** — records only when the
  tab's partition exactly matches a live jar's `partition`
  (`jars.list().find(j => j.partition === partition)`); this is a positive
  resolution against the registry, never an "is not a burner" negative check,
  so burner (`burner:<n>`) and internal (`goldfinch-internal`) partitions
  structurally match nothing and record nothing — no dedicated exclusion code
  exists or is needed for them; (2) an `http:`/`https:` scheme allowlist,
  independently excluding `goldfinch://` and `about:blank`; (3) a per-jar
  in-memory consecutive-duplicate suppression window (default 30 s) that
  bounds reload/redirect spam without a DB read on the hot path. A per-`wcId`
  map backfills titles arriving later via `page-title-updated`; `forgetTab(wcId)`
  clears it on tab teardown (a crashed tab leaks its entry — accepted, bounded,
  wcIds are never reused).
- **`retentionDays` + prune cadence.** Each jar record (`jars.js`) carries a
  `retentionDays` field (integer, 1–3650, default `30`, validated by
  `cleanRetention`) — retention is operator-facing jar configuration, so it
  lives on the jar record, not in the history store itself. `pruneAllJars()`
  (`main.js`) builds a `{ jarId: retentionDays }` map from the live registry
  and calls `historyStore.pruneExpired(...)` once at store open and again on
  an hourly `setInterval(...).unref()`; it also garbage-collects orphan rows
  whose `jar_id` no longer resolves to a registered jar (defense-in-depth for
  jar deletions). Up to ~1 h of over-retention between ticks is accepted as
  invisible at a 30-day granularity.
- **`history-changed { jarId }` invalidation contract.** Every mutation (a
  recorded visit, a title backfill, a per-entry delete, a jar clear, a prune
  deletion) broadcasts `history-changed` with **only** `{ jarId }` via
  `broadcastToChromeAndInternal` — never row data or counts. Subscribers
  re-query through their own read path (the same invalidation-not-snapshot
  lesson as `jars-changed`/`shields-changed`).
- **IPC twins + static error strings.** `src/main/history-ipc.js`
  (`registerHistoryIpc`) defines each handler body once and registers it
  twice, mirroring `jar-ipc.js`'s extract-don't-fork pattern: a bare
  `ipcMain.handle('history-*', ...)` on the chrome-trusted channel, and
  `registerInternalHandler(ipcMain, 'internal-history-*', ...)` on the
  internal-origin-gated twin (reached today only by `goldfinch://jars` — history
  has no page of its own). The four ops (`list`/`search`/`delete`/`clear`)
  validate fail-closed, in order (malformed payload → unknown jar → bad args),
  and every failure returns a **static, non-interpolated** `history: <op> —
  <code>` string — deliberately not repeating `jar-ipc.js`'s
  `clear-data`/`wipe` dynamic-interpolation branches.
- **`history.db` WAL file family.** The store opens `userData/history.db` in
  `journal_mode=WAL` + `synchronous=NORMAL`, so the live database is actually
  a **three-file family on disk**: `history.db`, `history.db-wal`, and
  `history.db-shm`. `app.on('will-quit', ...)` closes the store (checkpointing
  the WAL) — a deliberately later lifecycle seam than `before-quit`'s
  teardown, chosen so no in-flight navigation can still be writing once
  windows are torn down. A corrupt `history.db` (and its `-wal`/`-shm`
  siblings) is quarantined to a `.corrupt-<ms-epoch>` sibling and recreated
  fresh on next `open()` — the app must boot.
- **Two live-probed sqlite gotchas** (design review, verified live): never mix
  a bare `?` placeholder with numbered `?1`/`?2`/… placeholders in the same
  statement (SQLite collapses them onto one bound slot), and keep the FTS5
  index on the **default `unicode61` tokenizer** — a `tokenchars` override
  turns a whole URL into one token and silently breaks prefix search.

### Jars page data panels (`goldfinch://jars`, M10 Flight 2)

The jars management page's per-jar section is a WAI-ARIA tab strip (History
/ Cookies / Other site data — `src/shared/jar-panel-model.js`'s
`JAR_PANELS`, tab dispatch in `src/renderer/pages/jars-tabs.js`), each panel a self-contained module sharing the same
constructor-deps shape (`{ bridge, jarId, mountEl, onError, onActivated? }`)
so a fourth panel is a drop-in, not a rethink.

- **Cookies panel (`src/renderer/pages/jars-cookies-panel.js`).** Lists a
  jar's LIVE session cookies (name, domain, expiry) via `jars-cookies-list`
  — never a `value` field, at any layer (DD7 least-privilege: the IPC
  handler strips it before it ever crosses the payload). Per-cookie delete
  reconstructs the removal URL from the listed identity fields via
  `jar-data-helpers.js`'s `cookieUrl` (scheme from `secure`, leading dot
  unconditionally stripped from `domain` — safe for both host-only and
  domain-attribute cookies, spike-verified). No confirm step (a single
  cookie is low-stakes, matching the panel's manual-refresh convention).
- **Other-site-data panel (`src/renderer/pages/jars-sitedata-panel.js`).**
  Lists storage-bearing origins via `jars-sitedata-list` — a **composite
  union, two-tier honest labeling** (flight DD3 VERDICT, mission-Architect
  premise: `Session` exposes no origin-enumeration or usage/quota API):
  - **"Has stored data"** — origins with an on-disk IndexedDB leveldb
    directory (`ses.storagePath/IndexedDB/<scheme>_<host>_<port>.indexeddb.leveldb`,
    parsed by `originFromIndexedDbDirname`; a literal `_0` port segment is
    Chromium's default-port sentinel, normalized to portless so it merges
    with `origin()`'s own default-port omission — live-measured, not a
    documented format). **Known gap**: `Local Storage` is a single
    consolidated, non-origin-keyed leveldb store — its origins are NOT
    recoverable and are invisible to this tier, named in the panel.
  - **"Visited — storage unconfirmed"** — origins with history activity in
    the jar (`historyStore.originsForJar`, the `suggest` query's `GROUP BY`
    idiom at origin grain) that have NO IndexedDB confirmation. Both a
    never-visited third-party-only origin AND a localStorage-only origin
    are invisible to BOTH tiers — an accepted, documented gap, not silently
    presented as a complete list.
  - **No usage/quota figure anywhere** — confirmed absent from Electron's
    public API; raw on-disk file sizes exist but would mislabel leveldb
    implementation overhead as user-meaningful storage.
  - Per-origin delete calls `clearStorageData({ origin, storages })` with
    the SAME storage-class set (cookies excluded) the retention sweep uses
    (`src/shared/jar-data-classes.js`'s `'storage'` descriptor) — a history
    row for a cleared origin survives (storage and history are independent
    data; the origin downgrades from "stored" to "visited" on next paint,
    it does not disappear).
- **Freshness (DD2/DD10).** Both panels query on tab-SELECTION (not
  section-visibility — a live session/CDP-adjacent read is not cheap enough
  for the history panel's "queries whenever scrolled into view" trigger) and
  re-query on their own mutations directly. No live `cookies.on('changed')`
  UI subscription (page activity would spam every open jars page). Cross-path
  staleness (another jar tab's Clear/Wipe, or the retention sweep) is closed
  by the `jar-data-changed { jarId, classes }` broadcast (DD10) — fired by
  `handleClearData` (cookies/storage classes actually cleared),
  `handleWipe` (unconditional), and the retention sweep's own COMPLETION
  (never the `setRetention` invoke, which resolves before the async sweep
  finishes and would paint pre-sweep state).

### Retention sweep — cookies + site data (`src/main/retention-sweep.js`, M10 Flight 2, Leg 3)

Generalizes the per-jar `retentionDays` dial (one window, all classes — DD5)
from history-only pruning to cookies and site data, riding the SAME prune
cadence (boot + hourly, plus an immediate one-jar sweep on a retention
edit). The engine is **Electron-free, injected-deps** (`createRetentionSweep`
— the `jars.js`/`jar-ipc.js`/`history-store.js` precedent): no live session,
no real sqlite, no Electron import; every dependency (`cookieSeen`,
`historyOrigins`, `sessionFor`, `cookieUrl`, `now`) is a fake in the unit
suite.

- **Two independently-aged classes — different signals, both documented
  user-facing (DD4b).** Cookies age by **first-seen** (creation-age);
  storage ages by **since-last-activity**. This is a deliberate, named
  asymmetry, not an oversight — cookie creation time isn't exposed by
  Electron's API at all (the reason the bookkeeping table exists), while
  history already carries a last-activity signal for free.
  - **Cookies (DD4 VERDICT, candidate 1).** `main.js`'s `session-created`
    hook attaches a `cookies.on('changed')` listener for every session
    whose partition (recovered from `ses.storagePath`'s `Partitions/<name>`
    on-disk segment — the hook receives only the `Session` object, no
    partition field; `jar-data-helpers.js`'s `partitionFromStoragePath`)
    positive-matches a registered jar (never an eager `fromPartition` warm
    — `session-created` fires synchronously on a partition's FIRST
    `fromPartition` call only, measured). Each event upserts/deletes a
    `cookie_seen` row (jar id, cookie identity, `first_seen_ms` — DD7, no
    value ever). **The overwrite-cause ruling** (measured): a same-identity
    value refresh fires an `overwrite`/`removed:true` + `inserted`/
    `removed:false` PAIR — the removal handler SKIPS deletion on
    `cause === 'overwrite'` (the row survives with its original
    `first_seen_ms`) and deletes on `explicit`/`expired`/
    `expired-overwrite`/`evicted`; inserts are `INSERT OR IGNORE` (never
    clobbers a surviving row). **Cold start**: a live cookie with no
    bookkeeping row (predates the listener, or predates this feature) gets
    stamped `first_seen_ms = now` at the next sweep — honest, not backdated.
  - **Storage (DD4b, candidate 2's storage half).** Ages by ORIGIN
    last-activity from `historyStore.expiredOriginsForJar(jarId, cutoffMs)`
    — origins with NO history signal are never auto-swept (no honest age
    signal exists for them; operator-deletable from the Other-site-data
    panel, gap named there too). This is a desk ruling (not rig-probed),
    honest because both empirical halves (`originsForJar`,
    `clearStorageData({origin})`) were independently measured.
- **SEQUENCING invariant — the load-bearing fix (leg-3 design review,
  HIGH).** The aged-out-origin snapshot MUST be taken BEFORE the same
  pass's history prune runs, in BOTH `main.js`'s `pruneAllJars` and
  `jar-ipc.js`'s `handleSetRetention`: `pruneExpired`/`pruneOneJar` delete
  every visit row older than the SAME cutoff, which is exactly the evidence
  `expiredOriginsForJar` reads — a post-prune read sees nothing for exactly
  the target case. Order, pinned and unit-tested: (1) snapshot, (2) history
  prune (sync, unchanged), (3) the async cookie/storage sweep from the
  snapshot.
- **Cadence + isolation (DD6).** Boot + hourly sweeps ride `pruneAllJars`;
  `jars-set-retention` triggers the same immediate one-jar sweep discipline
  `pruneOneJar` already had. Sweeps are async, fire-and-forget, per-jar
  isolated (one jar's failure — or one cookie's, or one origin's — never
  blocks a sibling); every promise chain ends in a terminal catch (log-and-
  drop — quit-during-sweep is named-accepted). `jar-data-changed` (DD10)
  fires on sweep COMPLETION carrying only the classes actually swept that
  pass, per jar.
- **Will-quit quiesce guard (the F6-hang class).** The cookies listener
  outlives `will-quit`'s `appDb.close()` (Electron doesn't tear down session
  listeners on quit) — every write checks `appDb.isOpen()` FIRST and is
  wrapped in try/catch, so a write-after-close can never throw uncaught into
  Electron's event dispatch and wedge the quit path.
- **DD7 lifecycle — bookkeeping dies with its data.** Every destructive jar
  path clears `cookie_seen` rows: a per-cookie delete
  (`handleCookiesRemove`) deletes-by-identity; a cookies-class clear
  (`handleClearData`) and a full wipe/remove (`wipeJarData`, shared by
  `handleWipe`/`handleRemove`) delete-by-jar. All fail-soft (logged, never
  flips an otherwise-successful session-level result) — a cleanup miss just
  means the next sweep's stamp pass re-treats a survivor as "new", a
  harmless staleness, never a correctness bug.
- **Honest gaps, documented, not silently absent:** no-history-signal
  origins are never auto-swept for storage; storage ages by last-activity,
  not creation (the panel and this section both say so); up to ~1 h of
  over-retention between cadence ticks (existing history-prune acceptance,
  now shared by cookies/storage too); a page can refresh a cookie between
  the sweep's read and its `cookies.remove` call (TOCTOU, named-accepted,
  bounded by the 1-day window floor).

### Address-bar suggestions (`src/shared/omnibox-suggest-model.js`)

As the operator types in the address bar, a dropdown of frecency-ranked,
prefix-matched history suggestions renders on the **menu-overlay sheet** — the
only surface that can composite below the toolbar, since chrome DOM is
occluded by the guest view (M08 Flight 4).

- **Surface — the `suggestions` sheet template.** Registered like the
  info-popup precedent (no `items` getter; `onOpen` focuses nothing). Rows are
  `role="listbox"`/`option` (`aria-selected` on the model's `selectedIndex`;
  primary = title-or-URL, secondary = URL host; all via `textContent`). A row
  click sends channel-4 `{ id: 'sug:<i>' }` — INDEX dispatch (the `spell:<i>`
  idiom; `sanitizeActivatedValue`'s 24-char cap forbids a URL riding `value`).
- **The `noFocus` regime.** `deliverInit` in `menu-overlay-manager.js` is the
  sheet's SOLE focus site; a channel-1 `noFocus: true` payload flag
  (`openOverlayMenu`'s optional 5th `opts` param, merged into the Ch1 payload)
  gates that `view.webContents.focus?.()` call, so keyboard-driven and
  programmatic suggestion repaints never move OS focus off `#address` — every
  existing template/caller omits `opts` and is unaffected. A POINTER click
  landing on the sheet still moves native focus per Chromium's click-to-focus
  (the grace timer below exists for exactly that race).
- **Chrome-owned close-trigger matrix.** Because the non-focusing regime means
  no blur/outside-click dismissal ever fires while focus stays in the chrome,
  every close trigger is fired explicitly from `renderer.js`, never sheet-side:
  Enter-with-selection or a row click → `'activated'`; Escape → `'escape'`
  (input keeps focus and text); input emptied → `'input-empty'`; `#address`
  blur → `'blur'`, via a 150 ms grace timer (`SUGGEST_BLUR_GRACE_MS`) whose
  callback re-checks the captured open-token AND `document.activeElement`
  before closing (lets a pointer click's activation win the blur-vs-click
  race it itself causes); tab switch/activation → main's existing
  tab-switch sheet-close, PLUS the brand-new-tab path's explicit
  `closeSuggestions('navigation')` (`createTab`'s synchronous `activateTab()`
  runs before any `tab-set-active` IPC reaches main, so the ordinary
  tab-switch close never fires in that one window) — `activateTab` also bumps
  `suggest.seq` unconditionally on every activation, invalidating any
  in-flight response for the previous tab's jar; navigation of the active tab
  (`did-navigate`/`did-navigate-in-page`) → `'navigation'`. Main's Ch2 handler
  (`menu-overlay:close`) validates the reason against an explicit
  `MENU_CLOSE_REASONS` allowlist (`toggle`/`superseded`/`escape`/`blur`/
  `navigation`/`input-empty`/`activated`) — an unrecognized reason falls back
  to `'superseded'`.
- **The Ch7-before-Ch6 activated-reset nuance.** Main emits channel 7 (close)
  strictly BEFORE channel 6 (activated) for the same row-click activation. The
  Ch7 sink (`onMenuOverlayClosed`) cancels the suggestion timers
  unconditionally on every close — including `'activated'`, so the grace
  timer dies the instant a real click wins its race rather than 150 ms later
  — but clears `suggest.items`/`selectedIndex` for every OTHER reason,
  deliberately leaving them intact on `'activated'` so the immediately
  following Ch6 `sug:<i>` dispatch can still resolve the clicked row's URL
  from `suggest.items`; the Ch6 handler finishes the reset itself once it has
  read the target. A naive "reset on every reason including activated" would
  silently break pointer-click navigation on every click — clearing the array
  before the handler that reads it ever ran.
- **Data path — `history-store.js`'s `suggest` query.** `suggest(jarId, query,
  { limit = 6, now })` is an age-bucketed frecency query over the
  FTS-narrowed subset (score = SUM of per-visit age-bucket weights: ≤4d→100,
  ≤14d→70, ≤31d→50, ≤90d→30, else 10; grouped by URL, `ORDER BY score DESC,
  MAX(visited_at) DESC, url`), reached via the `history-suggest`/
  `internal-history-suggest` IPC twins and the chrome-only `historySuggest`
  bridge method (`chrome-preload.js`). See "History store" above for the
  store's general shape; `suggest` has its OWN 1–10 limit clamp
  (`SUGGEST_MIN_LIMIT`/`SUGGEST_MAX_LIMIT`), distinct from the store's general
  1–500 clamp — the dropdown is a small, fixed-height list, never a paged
  view. Scale-probed at 50k rows (flight-4 leg-4 flight log has the numbers):
  the **1-char query rides an UNCOVERED prefix path** — the FTS `prefix='2 3
  4'` index only covers 2/3/4-char terms, so a 1-char query is a full-token
  scan rather than an indexed prefix lookup, and is measured separately for
  exactly that reason.
- **Jar/burner/internal gates.** The pure `src/shared/omnibox-suggest-model.js`
  module's `shouldQuery({ focused, isInternal, isBurner, value })` gate
  (wired from the renderer's `suggestGateNow()`) engages suggestions only when
  `#address` is focused, the active tab is neither internal
  (`isInternalTab(tab)`) nor burner (`tab.container.burner`), and the trimmed
  input is non-empty — burner and internal tabs structurally never issue a
  query, with no dedicated skip code beyond the gate (the same "positive
  allowlist, no negative exclusion" shape as the history recorder's jar
  gate). Suggestions are scoped to the active tab's own jar (`tab.container.id`
  passed as `jarId`) — jar exclusivity rides the store's existing per-jar
  `WHERE jar_id = ?` scoping, the same isolation every other history op
  relies on. A `historySuggest` response re-validates the FULL gate at
  arrival (`acceptSuggestResponse`, the response-time revalidation gate)
  before painting — a stale response from a since-switched tab or a
  since-closed dropdown never model-replaces a menu the operator didn't ask
  for (the kebab-while-typing race).

### Internal-bridge security model (`src/main/internal-ipc.js`)

The trusted internal pages (`goldfinch://settings`, `goldfinch://downloads`, `goldfinch://jars`) have **privileged IPC channels** (`internal-settings-get/set`, `internal-shields-get/set`, `internal-downloads-*`, `internal-jars-*`) that must not be reachable by web content. Two guard layers defend this, with the main-side check as the authoritative boundary:

**Authoritative boundary — `registerInternalHandler` (main-side, `src/main/internal-ipc.js`).**
`registerInternalHandler(ipcMain, channel, handler)` wraps `ipcMain.handle` with a two-condition sender check performed **before** the handler is called:
1. `INTERNAL_ORIGINS.has(event.senderFrame?.origin)` — an allowlist membership check against the Chromium-serialized tuple origins of the trusted internal pages (`goldfinch://settings`, `goldfinch://downloads` as of Flight 5, `goldfinch://jars` as of M06 Flight 3). If `senderFrame` is `null` (frame destroyed mid-IPC), `origin` is `null` and the check fails.
2. `event.sender.session.__goldfinchInternal === true` (strict equality, not truthy) — the session carrying the internal marker is the one created by `session.fromPartition(INTERNAL_PARTITION)`.

Any mismatch throws `'forbidden: non-internal sender for <channel>'`, which Electron translates into a rejected `ipcRenderer.invoke()` promise on the renderer side. **Allowlist-based, not single-origin (Flight 5):** the trust boundary is "internal page vs web," not "settings vs downloads vs jars" — any internal origin can call any registered channel.

**Node-vs-Blink origin gotcha.** `INTERNAL_ORIGINS = new Set(['goldfinch://settings', 'goldfinch://downloads', 'goldfinch://jars'])`. Chromium/Blink serializes a `{standard, secure}` scheme's frame origin to these tuple-origin strings — the correct values to match in `event.senderFrame.origin`. Node's WHATWG `new URL('goldfinch://settings').origin` returns `'null'` (Node doesn't know the scheme is standard, so it treats it as an opaque origin). Do NOT "fix" `INTERNAL_ORIGINS` to match Node's output.

**Defense-in-depth — `location.origin` guard in `internal-preload.js`.**
The preload exposes `window.goldfinchInternal` only when `location.origin` is in the internal-origin allowlist (`INTERNAL_ORIGINS`, the same set as main-side). If the preload somehow runs in the wrong context (e.g. after a navigation into web content — `webPreferences` are immutable post-attach), the bridge simply isn't exposed. Any stored reference would still fail at the main-side check. **This guard is not the security boundary** — it is defense-in-depth. The main-side `registerInternalHandler` check is authoritative.

**Separate trust domains.**
- **`internal-*` channels** (`internal-settings-get/set`, `internal-shields-get/set`, `internal-downloads-list/action/clear`, `internal-jars-list/add/rename/remove/set-default/get-default/clear-data/wipe`) — wrapped by `registerInternalHandler`; origin-locked to the internal-origin allowlist (`goldfinch://settings` + `goldfinch://downloads` + `goldfinch://jars`); only an internal guest can call them.
- **Chrome `shields-*`, `settings-get`, and `automation:get-activity` channels** — `ipcMain.handle` without `registerInternalHandler`; trust domain is the `file://` chrome (`window.goldfinch` surface in `chrome-preload.js`). Do NOT close these with `registerInternalHandler` — they are intentionally on a different trust boundary. **Rule (recurring): a read-only channel that BOTH the `file://` chrome and a `goldfinch://` internal page consume must be a bare `ipcMain.handle`**, because `registerInternalHandler`'s origin check (`goldfinch://settings`) rejects the chrome's `file://` origin — wrapping it silently breaks the chrome consumer. `automation:get-activity` (Flight 5: the chrome toolbar automation indicator + the settings audit viewer both read it) is the third such channel. Only ever expose **non-secret** data this way (no keys/hashes) — these channels are reachable by any renderer with an `ipcRenderer` (the chrome + internal guest; never a web webview).

**Internal-preload listener-handle pattern (`on…` returns handle + `off…(handle)` cleanup).** The `goldfinch://settings` guest can reload (e.g. when electronmon re-injects in dev). Each reload creates a new document context; `ipcRenderer.on(channel, wrapper)` listeners registered in the previous context are **never automatically removed** — each reload would add another permanent listener, causing the handler to fire multiple times per broadcast. The `internal-preload.js` bridge prevents this with a handle map:
- `let nextHandle = 1; const listeners = new Map()` — module-scoped in the preload.
- `on(channel, cb)` creates a wrapper `(_e, x) => cb(x)`, stores `{ channel, wrapper }` under a numeric handle, calls `ipcRenderer.on(channel, wrapper)`, and **returns the numeric handle**.
- `off(h)` looks up the handle, calls `ipcRenderer.removeListener(channel, wrapper)`, and deletes the map entry.
- `onSettingsChanged(cb)` and `onShieldsChanged(cb)` delegate to `on(...)` and return the handle; `offSettingsChanged(h)` and `offShieldsChanged(h)` delegate to `off(h)`.
- `contextBridge` cannot return a function across the boundary, but it CAN return a number — handles are the right cross-boundary currency for this pattern.
- **Every `settings.js` controller that subscribes** (home-page, shields, appearance pins) captures its handle, then registers a `pagehide` listener (`{ once: true }`) that calls the appropriate `off…(handle)`. `pagehide` fires in the OLD document context where the handle and wrapper are still valid — this is the correct cleanup point. Without it, each electronmon-triggered reload would accumulate an extra live `ipcRenderer` listener.

**Flight-4/5 internal-bridge Known Issue — CLOSED.** Before Flight 6, `internal-preload.js` exposed only `{ version: 1 }` and had no real IPC; the bridge-origin-check was a deferred TODO. Flight 6 grew the bridge into real IPC (`settingsGet/Set`, `shieldsGet/Set`, `onSettingsChanged/onShieldsChanged`) and simultaneously introduced `registerInternalHandler` as the main-side gatekeeper. The Known Issue (web content in the internal session could call privileged IPC) is now closed: privileged IPC is gated at the main boundary.

### Overlay-view patterns (M05 Flights 7–8 — find overlay + menu-overlay sheet)

Five patterns earned by the two overlay-`WebContentsView` flights (F7 debrief Rec 3). They apply to any future main-owned overlay view:

1. **Electron's `findNext` semantics are INVERTED vs. the legacy reading — adapt, don't trust parity.** `findInPage`'s `findNext: true` means "start a NEW find session", not "step to the next match" — the exact inverse of the `<webview>`-era assumption, carried silently as "faithful parity" for two migrations before the F7 HAT caught it. The fix is the main-side **`findOverlayLastQueryText` adapter**: track the last query text and map the UI's step/edit intent onto correct engine semantics (same text + Enter = step; changed text = new session). Migration parity ACs need a spot-check of the underlying API contract, not just byte-parity with the old code.
2. **Pending-init queue for lazily-loaded overlay first-load races.** A lazy-singleton overlay view can receive its first payload before `did-finish-load`; sending immediately drops it. Queue **at most one** pending init (latest wins) and flush on readiness — `find-overlay` first, now `menu-overlay-manager.js`'s `pendingInit`. Any lazily-constructed view that gets pushed state needs this.
3. **Sender-resolved close refocus.** When one IPC channel serves actors with different focus consequences (overlay-initiated close should refocus the guest/chrome; a programmatic chrome-side close must move no OS focus), resolve the behavior from the **sender's webContents identity**, never from a payload flag. The find overlay's `find-overlay:close` established it; the sheet generalizes it to the reason-resolved `closeMenuOverlay` family (`focusChrome()` on `escape`/`activated` only).
4. **Electron-free, injected-deps module for main-side view logic.** Keep the lifecycle/geometry logic in a module that never `require('electron')` — live handles are injected (`find-overlay-geometry.js` as the template; `menu-overlay-manager.js`'s `createMenuOverlayManager({ getContentView, createSheetView, sendToChrome, … })` follows it). The logic becomes `node --test`-able offline with fakes, matching the automation engine's injection discipline.
5. **`WebContentsView`s not in `tabViews` are invisible to `enumerateTabs` — enumerable vs. addressable.** A view deliberately kept out of `tabViews` never appears in `enumerateTabs` (a design choice to document AT CONSTRUCTION), yet remains **addressable** by wcId — and since F8 DD8, non-tab non-chrome wcIds resolve only at the **admin tier**. **Since M09 F7 (DD2) the overlay views are LISTABLE too: `enumerateWindows` reports every window's `sheetWcId`/`findWcId` directly**, so apparatus resolves them with one exact, O(1) admin read. **The id-space probe walk is RETIRED** — it was an O(64) guess that existed only because nothing could enumerate non-tab contents (the admin relaxation made these views addressable but never listable); `scripts/a11y-audit.mjs` was its canonical implementation and now reads `enumerateWindows` with **no fallback** (a silent fallback would let DD2 break while the checkpoint stayed green). Two related facts survive the retirement: the walk's old foreground-first hazard is **gone** since F7 DD6 (`readDom`/`evaluate` no longer activate their target), and `activateTab` on a non-tab wcId still returns a harmless `false` (it is not a registry-owned tab). An absent `sheetWcId`/`findWcId` means that overlay was **never created** in that window (both are lazy) — distinct from a present id with `sheetVisible: false` (instantiated but hidden).

### Cross-view focus + tab-type idioms

Three conventions earned across the M05 view-migration flights (F4 rec #3) and M06 Flight 4:

- **Focus-then-send when routing a keyboard-input-expecting action to the chrome view.** Any `before-input-event` / IPC branch that forwards a keyboard-input action to the chrome `WebContentsView` — e.g. the guest→chrome Ctrl+L / Tab handoff in `handleGuestCrossViewNav` (`src/main/main.js`), which runs the pure `src/shared/cross-view-nav.js` decision — MUST call `getChromeContents()?.focus()` **before** `getChromeContents()?.send(...)`. The `send('chrome-shortcut-action', …)` alone only drives **DOM** focus in the renderer (`dispatchChromeAction('focus-address')` → `els.address.focus()`); the chrome view must hold **OS** keyboard focus for the target to actually accept typing — otherwise you ship a focused-but-untypeable control. The sheet's own chrome-shortcut branch (the `sheet-accelerator.js` path in `main.js`) deliberately omits `.focus()` and is therefore **NOT** a copyable template for keyboard-input handoffs.
- **Decide tab type with `isWebTab()` / `isInternalTab()`, never by reading `.trusted` directly.** Renderer tab-type decisions (`src/renderer/renderer.js`) go through the `isInternalTab(tab)` predicate (which tests `tab.container.id === 'internal'` / the internal partition) and its `isWebTab = !isInternalTab` complement — the single decision idiom. Do **not** branch on a raw `.trusted` field downstream: trust is the **call-site provenance** at `createTab(url, container, { trusted: true })` (the internal-page security model above), not a tab-shape flag to re-read.
- **Uniform focus rule: patch in place, never rebuild, whatever currently holds `document.activeElement`.** On every broadcast-rendered page, any DOM container that currently holds the focused element — a name input, a swatch grid, a nav list — is patched in place on re-render; it is never wholesale-rebuilt. A rebuild that replaces the focused element loses the caret and fires `blur` → a spurious commit (commit-on-blur models, e.g. jar rename, treat that blur as a real edit). One rule, applied uniformly across widget kinds — no per-widget carve-outs. Source: M06 F4 DD6 named the name-input case (`missions/06-cookie-jar-management/flights/04-per-jar-data-controls/flight.md:152-170`); the F4 leg-2 design-review FD ruling generalized it to swatch grids and nav (`missions/06-cookie-jar-management/flights/04-per-jar-data-controls/legs/02-page-relayout.md:174-178`).

### Tab strip: structure, order authority, keyboard navigation (M09 Flights 1–5)

**DOM/CSS structure (`src/renderer/styles.css`).** `.tab` (:197) is the pure sizing/query container: `flex: 0 1 240px`, `overflow: hidden`, `container-type: inline-size`, and **no padding of its own** — its container-query size equals `getBoundingClientRect().width` directly. `.tab-row` (:216), the inner span, carries the flex layout (`display:flex`, `gap`, `padding`). The split exists because **a CSS `@container` rule cannot restyle the element that establishes its own container** — see the pitfall below. Three `@container` disclosure stages fire as the tab narrows: title-hide at `max-width: 72px` (:246), inactive-only close-hide at `max-width: 56px` (:264, `.tab:not(.active) .tab-close` — the active tab's close is never hidden), padding-compress at `max-width: 40px` on `.tab-row` (:269, the padding-bearing descendant). `.tab.active` carries a **64px `min-width` floor** (:285, M09 F1 DD2 amendment) paired with hiding its favicon once narrow (:260) — without the floor, the active tab's 16px close button can shrink to render outside its own clipped bounds (`display:block` in the DOM ≠ painted; caught live by the `responsive-tab-strip` behavior test). Every other tab keeps shrinking with **no floor at all**. `#tabs` (:153) is `overflow: hidden` — no scrollbar at any tab count, by design.

**Recurring failure mode: container-query self-restyle is a silent no-op.** A `@container` rule whose selector targets the container element itself (e.g. a bare `.tab { … }` inside `@container (max-width: …) { }` scoped to `.tab`'s own size) **never applies — no error, no warning**, `getComputedStyle` simply never reflects it. Only descendant selectors work. Discovered M09 F1 via a live probe after a suggested implementation snippet no-op'd; the next `@container` disclosure stage anywhere in the app will hit this again if the rule targets the sized element directly instead of a child.

**DOM order is the strip's single order authority (M09 F2 DD1).** The renderer's `tabs` Map (`src/renderer/renderer.js:114`) is **id→tab lookup ONLY** — its iteration/insertion order is not load-bearing and permanently diverges from visual order once a tab is moved. `orderedTabIds()` (:1330) is the one order-reading accessor (filters `els.tabs.children` to `.tab` elements); `commitTabMove(id, targetIndex)` (:1340) is the one order-mutating call (`insertBefore`-based, instant, no animation). Any order-consuming code must go through these two — **never** `[...tabs.keys()]` or another ad hoc Map walk. `window.__goldfinchAutomation.listTabs()` (backing `enumerateTabs`) deliberately stays **creation-order** — an explicit FD ruling, not an oversight — because its consumers address tabs by `wcId`, never by position. **The pre-registered multi-window revisit is LANDED: M09 F7 (DD1) redefined `enumerateTabs` as an ALL-WINDOWS census** — every row carries a `windowId` stamped from the window registry (the ownership authority; the renderer is authoritative only for `url`/`title`/`jarId` and never learns `windowId`), ordered by window creation order then each window's own creation order, returned as a **plain array**. A mid-boot window contributes zero rows; `enumerateWindows().booted` is the completeness discriminator. `listTabs()`'s per-window creation order is unchanged — the census composes it, it does not replace it. See *Multi-window semantics* in `docs/mcp-automation.md`.

**Tab activation under native HTML5 DnD (M09 F11 DD3) — no click-suppression flag.** All tab drags (reorder, tear-off, cross-window) are native HTML5 DnD; the pointer-drag state machine and the M09 F2 DD2 two-set-point `suppressClickActivate`/`markClickSuppressed` click-suppression flag were REMOVED with it. Native DnD fires no trailing `click` after a completed drag, so the tab `click` handler's activate is **unconditional** (a plain click — real or synthetic/AT-driven — simply activates), and a drag activates its tab in `dragstart` (Chrome parity: dragging a background tab activates it). There is no suppression flag to preserve or reintroduce.

**Keyboard tab-navigation map (M09 F3–F4).** `Ctrl+Tab`/`Ctrl+Shift+Tab` and `Ctrl+PageDown`/`Ctrl+PageUp` cycle the active tab through **visual (DOM) order** with wrap at both ends; `Ctrl+1`–`Ctrl+8` jump to position N (out-of-range = no-op, Chrome-parity) and `Ctrl+9` jumps to the last tab (`renderer.js` dispatch :~3501, over `orderedTabIds()`). `Ctrl+Shift+T` reopens the most recently closed tab (`reopen-closed-tab`, M09 F4 — see the closed-tab-stack note below); this RETIRES the M05-era reserved-and-unassigned classifier slot (the chord previously classified `null` by design, pinned by unit tests waiting for a stack to exist) — every pin site flipped in lockstep, and no "reserved" comment or null-pin for this chord remains anywhere in `src/` or `test/`. These are all GLOBAL chrome shortcuts, never lightbox-deferred, reachable from all three capture points via the one classifier, `keydownToAction` (`src/shared/keydown-action.js`) — which now takes an `alt` parameter (default `false`): the digit tab-jump branch is gated on `!alt` (AltGr layouts report ctrl+alt for digits — `Ctrl+Alt+7..9` must keep producing its character, never a jump) and the digit match is **shift-tolerant** (AZERTY needs Shift to produce digits). `Ctrl+N` opens a **new window** (`new-window`, M09 F6 DD5 — app-level like new-tab, never lightbox-deferred; **lowercase-only** in the classifier, `Ctrl+Shift+N` deliberately unassigned; `guest-forward-allowlist.js` carries `new-window` in BOTH guest kinds, covered by the blanket `!isAutoRepeat` guard). `Ctrl+Shift+ArrowLeft`/`ArrowRight` reorders the focused tab (M09 F2 DD3; strip-scoped — the roving-tabindex handler, not a global shortcut). **`src/shared/sheet-accelerator.js` hand-mirrors `keydownToAction` rather than sharing it** — every classifier change (including the `alt` parameter, the `Ctrl+Shift+T` addition, and the `Ctrl+N` `new-window` addition — whose sheet copy also pins `autoRepeatGuard: true`) must land in both files in the same change, or the menu-overlay sheet's accelerator path silently diverges on AltGr locales; unification is a documented future maintenance candidate, not yet done.

**Closed-tab stack (M09 F4; multi-window since M09 F6).** `src/shared/closed-tab-stack.js` is a pure, main-owned bounded stack (`MAX_ENTRIES = 25`, oldest evicted; `push`/`pop`/`peek`/`size`, no Electron; entry-shape-agnostic — untouched by F6). The stack is **ONE global stack with `windowId`-tagged entries** (F6 DD4 — a documented divergence from Chrome's per-window reopen; entries must outlive their window for whole-window capture, and F9's session layer can group by windowId). Capture happens at **TWO sites**, both through `src/main/closed-tab-capture.js` (pure, Electron-free — the shared allowlist body): (1) main's `tab-close` handler, before `destroy()`, tagging the owner-resolved window's id; (2) **whole-window capture at the window's `close` event** — every persist-jar tab in `tabViews` **insertion order** with `stripIndex` = the append sentinel (guests are alive and `navigationHistory` fully readable at `close` — spike-verified; `win.destroy()` skips `close`, so it skips capture — accepted, documented edge; the capture block is try/caught so it can never break close). Both sites are gated by the same **positive persist-jar allowlist** idiom as the history recorder — burner and internal partitions match nothing, so they're structurally never captured. Reopen is **renderer-orchestrated**, not main-reconstructs: `Ctrl+Shift+T` invokes `tabReopen()`; main pops the stack and returns the entry (or `null` on an empty stack — silent no-op) with the **pop rule** applied: `stripIndex` is honored **iff `entry.windowId` === the invoking (sender-resolved) window's id**, else the append sentinel — whole-window entries therefore always append (their window is gone by construction). The renderer resolves the jar exactly like a popup and calls `createTab(url, container, { restoreHistory, insertAt })`. `tab-create`'s tail branches on `restoreHistory` and **SKIPS `loadURL` entirely**, calling `navigationHistory.restore({entries, index})` instead — running both would race. **Stack-size is PUSH-fed (F6 DD6)**: every mutation (both capture pushes + the reopen pop) broadcasts `closed-tab-stack-changed {size}` to ALL registered chromes (chromes-only — no internal-page consumer); the renderer caches it via `src/shared/push-cache.js` (`createPushCache` — **a received push always wins; the boot-seed `closed-tab-stack-size` invoke applies only if no push arrived**, monotonic by arrival). A `toJSON()`/`fromJSON()` seam is designed but unused, reserved for the Flight 9 session-restore hook.

**Tab context menu (M09 F5 Leg 1).** Right-click a tab, or press the Context-Menu key / Shift+F10 while it's focused, for a `tab-context` menu rendered from the menu-overlay sheet like every other chrome menu — a single `contextmenu` listener wired per tab button (at creation, alongside its click/auxclick/pointerdown siblings) handles BOTH invocation paths, since Chromium dispatches the same native `contextmenu` DOM event for a real right-click and for the Context-Menu key/Shift+F10 on a focused element (the toolbar-pin-button precedent); the document-level keydown catch-all's exclusion gate (used by the toolbar pins to avoid double-firing) is extended with `target.closest('.tab')` — no parallel keydown listener was added. The pure model, `src/shared/tab-context-model.js`'s `tabContextModel({tabId, isLastTab, tabsToRight, stackSize, isInternal})` (the `isInternal` param landed M09 F6, default `false` — pre-F6 callers unaffected), namespaces ids `tab:{close,close-others,close-right,duplicate,move-new-window,reopen-closed}` and is **omitted-only** (the sheet has no disabled-item shape): `close-others` omitted when the tab is the only one; `close-right` omitted when none sit to its right; `reopen-closed` omitted at an empty closed-tab stack; `duplicate` is always present; **`move-new-window` ("Move to new window", M09 F6 DD5 — the Duplicate section, Chrome adjacency) is omitted at `isLastTab` (a sole-tab move is a no-op window swap) AND for internal tabs** (design-review M4) — its dispatch sends the source strip snapshot (`{wcId, url, title, favicon, container}`) to the `tab-move-to-new-window` invoke, and main re-parents the live guest into a `noBootTab` window via the adopt protocol (see the window-registry Main bullet). Batch closes (`close-others`/`close-right`) are **ordered sweeps**: snapshot the target ids, activate the ANCHOR (the invoking tab) FIRST when the active tab is among the targets (Chrome parity), THEN close each target — this way `closeTab`'s own next-tab fallback never fires mid-sweep. `duplicate` reads the source tab's live `url`/`title`/`container` renderer-side (no round-trip) and fetches its navigation history via the new `tab-history-snapshot` chrome-trust-domain invoke (web tabs only; null for internal/dead targets), then calls `createTab(url, sourceContainer, { restoreHistory, insertAt: sourceIndex + 1 })` — the same F4 restore seam reopen uses. `reopen-closed` dispatches through the EXISTING `dispatchChromeAction('reopen-closed-tab')` case (dispatch reuse — Ctrl+Shift+T's jar-fallback/positional-reopen logic rides along free), fed since M09 F6 by the **DD6 push-cache** (`closed-tab-stack-changed` pushes; the `closed-tab-stack-size` invoke survives as the boot seed only) — `openTabContextMenu` is **synchronous** again (the awaited invoke and the cross-type stale-resolve guard were deleted; the F5 known edge is structurally gone).

### `action:rowId` confirm-transition key

When a shared confirm area serves N sibling-visible actions on one row (e.g. the per-jar data-controls block — clear cookies / clear storage / clear cache / wipe, all five buttons stay visible and clickable while one confirm is open), key the open/swap transition on the **`(action, rowId)`** pair, compared as a string-or-null — never a boolean. A boolean silently breaks the same-row action swap: clicking wipe on a row already showing the cookies-clear confirm would not trigger a rebuild (the boolean is already `true`), leaving stale copy and stale button handlers wired to the wrong action. Source: M06 F4 leg 3 design review (`missions/06-cookie-jar-management/flights/04-per-jar-data-controls/legs/03-data-controls-ui.md:70-81`).

### Automation engine (`src/main/automation/`)

The automation surface — programmatic drive (navigate / click / type / scroll / keypress) and observe (screenshot / window capture / DOM read / accessibility tree) of tabs — lives entirely under `src/main/automation/`. `engine.js` is the single entry point; the pure op modules (`tabs.js`, `nav.js`, `input.js`, `observe.js`, plus the `resolve.js` handle resolver) hold the actual logic.

- **Injected deps, Electron-free at the top.** Op modules do **not** `require('electron')` at module scope. Every live Electron handle (`fromId`, `chromeContents`, `executeInRenderer`, `activate`) is built fresh per call by `engine.js`'s `deps()` and injected. This keeps the op modules unit-testable offline with fakes — no Electron stub, no live runtime. `deps()` rebuilds per call so a recreated/closed window is always picked up. When adding a new op, follow the same shape: pure logic in its module, Electron handles passed in via deps.
- **`webContentsId` (`wcId`) is the canonical tab handle.** Tabs are addressed by their integer `webContents.id`, resolved to a live `webContents` via `resolveContents(wcId, …)`. The lock and other per-tab state are keyed on the **stable `wcId`**, never on a per-resolve `wc` object reference.
- **Foreground-to-act + re-resolve discipline — and the M09 F7 read/act ASYMMETRY.** A guest tab is brought to the foreground (`activate`) before an action or a capture — capturing/acting on a background guest fails (blank screenshots, etc.). After the `await activate(...)`, the handle is **re-resolved** (`resolveContents` again): the pre-activate `wc` may be stale after the async hop, and re-resolving re-applies the bad-handle / dead / internal-session exclusion post-activation. Chrome targets are always live and never activate.

  **This sequence (resolve → activate → re-resolve → act) is NO LONGER uniform** — M09 F7 DD6 made it conditional on a stated predicate: **an op that needs RENDERED OUTPUT raises the owning window; an op that reads live JS/DOM state does not.** So it holds for `input.js`'s `actOn`/`actOnPaced`/`scroll`, `observe.js`'s `captureScreenshot` and `readAxTree` (the AX tree is a rendered artifact), `print.js`'s `printToPDF`, and `find.js`'s `findInPage` — but **`readDom` and `evaluate` do NOT activate at all**: they resolve once and read. `executeJavaScript` works fine on a background guest, and under N windows a *read* that steals the operator's foreground is a worse bug than the cross-window no-op DD6 fixes. Both halves are pinned in `automation-observe.test.js`; do not "harmonize" them.

  **The raise is at WINDOW scope, and it lives in the shared primitive.** `tabs.activateTab` routes to the tab's **owning** window's chrome (`chromeForTab`, resolved at event time) and then raises that window (`win.focus()` + `registry.noteFocus()` — both halves; programmatic focus fires no focus event under WSLg). Because only the raising ops still call `activate`, the predicate is **structural**, not a per-op flag: ops that call `activate` raise; ops that don't, don't.
- **`executeJavaScript` is the main→guest read path — not CDP.** DOM reads (and the tab enumeration read) evaluate a self-contained expression in the guest's main world via `wc.executeJavaScript(...)`. This is the established precedent (`engine.js`'s chrome-renderer read): debugger-free, no single-client CDP conflict, and CSP-safe for self-contained property-read expressions. Do **not** reach for CDP `Runtime.evaluate` for ordinary reads — that mechanism exists only to bypass page CSP for *library* injection (as the a11y audit script does), which is the opposite use case.
- **`webContents.debugger` use is centralized in `cdp.js` and limited to TWO ops: `observe.js`'s `readAxTree` and `input.js`'s `scroll`.** The shared discipline lives in `src/main/automation/cdp.js` (`withDebuggerSession` + a single shared single-client lock `Set` keyed on `wcId` + the `debuggerUnavailable` refusal): attach the in-process CDP debugger on demand, hold the synchronous lock, run the command, detach in a `finally` (never left attached). A busy debugger (DevTools open, or a second client) returns a discriminated `{ automation: 'debugger-unavailable', … }` refusal rather than throwing. The lock is **shared**, so a concurrent `scroll` + `readAxTree` on one `wcId` cannot both attach (the second gets `locked`). Why these two: there is no pure-JS path to the platform a11y tree, and `sendInputEvent` mouseWheel does **not** scroll `WebContentsView` guest tabs (produces zero movement — confirmed live; so `scroll` uses CDP `Input.dispatchMouseEvent`; the other input ops — click/type/key — stay on `sendInputEvent`). Every other op and module stays debugger-free; route any new debugger need through `cdp.js`'s shared lock — never a second independent attach path.
- **The dev seam is a deprecated dev-only seam.** The engine is also reachable through a development-only IPC seam in `main.js` (`automation:dev-invoke` → `engine[op](...args)`). New dispatch keys auto-expose through it because the dispatch is dynamic — no seam edit needed when adding an op. The gated MCP transport landed in Flight 3 (the durable consumer path) and is the supported drive path; this seam is **deprecated** — it **remains only a dev-only convenience**, `!app.isPackaged`-gated (registered only on an unpackaged dev run). Do not build durable consumers against it.
- **Gating landed (Flight 4); production bind landed (Flight 8).** The surface is **off by default, per-jar-key authenticated (`Authorization: Bearer`), jar-scoped, with an env-gated admin tier and an audit data layer** — see `docs/mcp-automation.md`. **In production the Settings `automationEnabled` toggle is the SOLE bind gate** (`shouldBindAutomation` in `src/shared/automation-dev.js`; launch-time bind at `whenReady` + live wiring in `applyAutomationEnabledChange`) — it ships in the installed binary and binds when a human turns it on. Enablement is **human-only** (no programmatic enable; minting a key does not enable). `--automation-dev` is now a **dev-only force-bind/auth-override convenience** that is a **complete no-op when packaged** (every call site ANDs `!app.isPackaged`); dev runs are **profile-isolated** (`~/.config/goldfinch-dev` via `app.setPath` when `!app.isPackaged`, DD1). Headless test apparatus: an env-gated auto-mint-to-stdout (`--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, prints a jar key once; `GOLDFINCH_AUTOMATION_ADMIN=1` also mints the admin key) — **kept** as the behavior-test apparatus, now `!app.isPackaged`-gated via the dev-enable override. The ungated legacy CDP debugging path (and its dev launch script) was **removed in F9** — `--automation-dev` over the loopback MCP transport is the sole dev-automation path.
- **Management UI landed (Flight 5).** The operator-facing control surface lives in `goldfinch://settings` ("Automation" section): an opt-in enable toggle, the live MCP address + a `.mcp.json` config block (+ copy), a **persisted/configurable port** (`automationPort`, default `49707` off the squatted 7777) that **rebinds the running server live on save** (`startMcpServerInstance` / `rebindMcpServer` / `currentAutomationStatus` in `main.js`). `resolvePort` precedence is **dev/prod split** (DD6, Flight 8): in **dev** (`honorEnv: !app.isPackaged`) `env GOLDFINCH_MCP_PORT > setting > default`; in **production** the env is **ignored** → `setting > default`, with **free-fallback** (a taken port auto-moves to the next free one; the persisted preference is not overwritten) — the **bound** port is captured live (`mcpServer.port` getter) and surfaced. A dev env pin is **bind-exactly-or-fail-loudly** (no fallback). Per-jar + env-gated admin key generate/rotate/revoke (origin-checked `automation:jar-key-*` / `admin-key-*` IPC; show-once plaintext, only hashes stored — DD2), and a chrome activity indicator + settings audit-log viewer. The Flight-4 `automation:dev-enable-mint` IPC was **retired** here (superseded by the real controls). Session lifecycle: an ungraceful client disconnect (a dropped standalone GET SSE stream, no DELETE) tears the session down so the indicator clears — `routeRequest` attaches the teardown on the **GET** stream only (POST/DELETE complete normally). This trades away resumable-SSE reconnect, which is correct for Goldfinch's clients; revisit if a reconnecting consumer is ever added.
- **Convention — settings writes from a handler must broadcast.** `broadcastToChromeAndInternal('settings-changed', settings.getAll())` is what re-syncs live UI (the settings page toggle, the chrome). A main-process function that calls `settings.set(...)` **directly** (e.g. `automation:jar-key-mint` writing `automationKeyHashes`) does **not** fire that broadcast on its own — only the `internal-settings-set` IPC path does. So any IPC handler that mutates settings directly or transitively MUST broadcast `settings-changed` itself (as `automation:jar-key-mint` does after minting — note that minting writes only the key hash and never `automationEnabled`, which stays human-only). Otherwise the live UI silently lags until the next reload.

#### `runSerialized` async-serialization mutex (`src/main/automation/toggle.js`, lines 52-57)

`runSerialized(body)` is the single shared mutex that serializes `applyEnabledChange` and `rebind` through one `inFlight` promise chain. Three properties to know:

1. **Single in-flight chain.** Only one op runs at a time — each `runSerialized` call chains its body after the current `inFlight` before replacing it.
2. **Rejection-tolerant continuation.** The chain awaits the prior op with `.catch(() => {})`, so a failed op does not wedge the chain for the next op. Each op's body still surfaces its own error to its own caller via the outer `await mine`.
3. **Identity-guarded `finally` clear.** The `finally` block only nulls `inFlight` when `inFlight === mine` — it skips the clear when a later op has already extended the chain.

**Reuse rule:** prefer `runSerialized` over a bare `await prior` whenever serializing mutating ops (bind / rebind / toggle). A bare `await prior` wedges the chain if the prior op rejected; `runSerialized` tolerates the rejection and lets the next op proceed. For inject-then-run no-persistence semantics (`injectScript` + immediate `evaluate`), see `docs/mcp-automation.md`.

#### MCP transport — the sanctioned first runtime dependency (`@modelcontextprotocol/sdk`)

Flight 3 introduces **`@modelcontextprotocol/sdk`** (pinned to an **exact** version in `package.json` `dependencies` — no `^`/`~`), Goldfinch's deliberate **first runtime dependency** (DD1). It is **confined to the transport layer**: it is imported **only** in `src/main/automation/mcp-server.js` and the `main.js` mount. `engine.js` and the `resolve`/`tabs`/`nav`/`input`/`observe` op modules stay **SDK-free and dependency-free** — the MCP layer is a thin adapter over `engine.js`. Do not import the SDK anywhere else.

- **`mcp-server.js`** stands up an MCP `Server` fronted by a Node `http.createServer` bound to **`127.0.0.1` only**, default port **`49707`** (the `automationPort` setting with free-fallback; `GOLDFINCH_MCP_PORT` is a **dev-only** override, honored only when `!app.isPackaged`), via the SDK's `StreamableHTTPServerTransport`. The transport's `handleRequest(req, res)` consumes the **raw Node `(req, res)` pair** — no Express, no Fetch shim (premise verified live at the scaffold leg). Session model is **stateful** (per-connection `randomUUID` session id) — the SDK's robust handshake path for one local consumer.
- **SC7 Origin/Host guard runs FIRST.** `src/main/automation/origin-guard.js` is a **pure, dependency-free** loopback Origin/Host allow-list predicate (`isAllowed({ host, origin, peerAddress })`), unit-tested exhaustively. The http handler runs it before any MCP processing; a denied request gets a `403` and never reaches the SDK. A `127.0.0.1` bind is necessary but not sufficient — *this browser renders hostile pages*, which can reach a loopback server via DNS-rebinding unless Origin/Host are pinned.
- **Bound by the Settings toggle (production) or `--automation-dev` (dev).** `shouldBindAutomation` (`src/shared/automation-dev.js`) is the single bind rule: in production the **`automationEnabled` toggle is the sole bind gate**; on an unpackaged dev run, `--automation-dev` force-binds via the dev-enable override (`isMcpAutomationEnabled` AND `!app.isPackaged`) **without writing the setting** — every dev-flag call site ANDs `!app.isPackaged`, so the flag is a **complete no-op when packaged** (DD4, Flight 8). The flag is **structurally independent** of any legacy browser-process CDP debugging switch (that ungated path was removed in F9), so `--automation-dev` over the loopback MCP transport is the sole path that starts the MCP server. Dev runs are **profile-isolated** (`~/.config/goldfinch-dev`, DD1). Launch the dev harness with **`npm run dev:automation`**; a packaged binary binds via the toggle (no dev launch needed for dogfooding/external drives). The server advertises **30 tools** — **18 drive** (`enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `getZoom`, `setZoom`, `printToPDF`, `findInPage`, `stopFindInPage`, `click`, `typeText`, `scroll`, `pressKey`, `dragPointer` — the last a paced synthetic pointer drag, mouseDown→N interpolated mouseMoves (buttons held)→mouseUp, added M09 Flight 2 Leg 2 (originally for tab reorder; since M09 F11 tab drags are native HTML5 DnD, which synthetic pointer injection cannot drive — the op remains for NON-tab, in-page drags); an unpaced synchronous event burst gets coalesced by Chromium down to essentially the first+last move, so each event is dispatched one macrotask apart) + **4 observe** (`captureScreenshot`, `captureWindow` — takes an optional `windowId` (omitted → last-focused, unknown → `automation: no-such-window`) and binds the capture by window IDENTITY since M09 F7 DD3/DD4; its **image content is unchanged** — it returns pixels, not topology, so `enumerateWindows` is the window read —, `readDom`, `readAxTree`) + **2 eval** (`evaluate`, `injectScript` — debugger-free `webContents.executeJavaScript` in the guest main world, ZERO CDP; the internal `goldfinch://settings` session is excluded even for admin, and `evaluate`'s return must be JSON-serializable) + **2 devtools** (`openDevTools`, `closeDevTools` — `webContents.openDevTools({mode:'detach'})` / `closeDevTools()`, NO CDP from the ops themselves; the detached DevTools front-end IS a CDP client, so a concurrent `readAxTree`/`scroll` surfaces `attach-failed` while `evaluate`/`injectScript` keep working; internal session excluded even for admin) + **3 admin chrome/app-level** (`getChromeTarget` — admin-only, returns a chrome renderer's `wcId` so drive/observe tools can act on the app shell; takes an optional `windowId` (omitted → last-focused, unknown → `automation: no-such-window`) and returns it on the target (M09 F7 DD3). `enumerateWindows` — admin-only, no input, the **single window-topology discovery primitive** (M09 F7 DD2): one row per open window `{ windowId, chromeWcId, booted, activeTabWcId, lastFocused, sheetWcId?, sheetVisible, findWcId?, findVisible }`, derived from the live registry at call time with **zero cached state**. It **retires the id-space probe walk** (overlay views are now listable, not merely addressable), supplies the `windowId` vocabulary `enumerateTabs`/`getChromeTarget`/`captureWindow` use, and carries `booted` — `enumerateTabs`'s completeness signal. `downloadsList` — admin-only, app-level, no `wcId`, returns the app-level downloads records `{ id, url, filename, savePath, state, received, total, … }`; jar keys get `automation: admin-only` on all three) + **1 history (jar-confined)** (`getHistory` — Mission 08 Flight 5; NOT admin-only, contrast with the three admin chrome/app-level tools above: a jar key reads its own jar's history (`jarId` optional, must match if supplied); admin reads any known jar (`jarId` required). Backed by two accessors injected into `createEngine` the same way as `getDownloads` — `getHistoryReads` (`{ listRecent, search }`, threaded from `historyStore`) and `isKnownJar` (threaded from `jars.list()`), both wired at both engine-construction sites in `main.js`). Result semantics (DD6): drive ops → JSON text (`{"ok":true}` for void ops, boolean/`null`/array otherwise), screenshots → image content, DOM/a11y → JSON text; the `openTab`-`null` and `readAxTree` `debugger-unavailable` outcomes are **normal results** (read and react), while genuine engine throws are `isError`. See `docs/mcp-automation.md` for the consumer reference (endpoint, Origin/Host requirement, full tool reference, refusal semantics, the a11y stale-handle caveat) and `scripts/mcp-example-client.mjs` for a runnable SDK-client example. The repo's `.mcp.json` ships an empty `mcpServers` map (no standing `goldfinch` entry — off-by-default); a consumer who opts in adds the entry at their configured port (the Settings UI shows the live address).

## Release / CI

The two workflows are **supply-chain hardened** (mission `01-maintenance`, Flight 4). Preserve these invariants when editing them:

- **All `uses:` are pinned to full commit SHAs** with a trailing `# vX.Y.Z` comment — never mutable `@vN` tags. When bumping an action, **including accepting a Dependabot PR**, resolve the new version's commit SHA and pin to that (Dependabot proposes mutable tags; applying them verbatim un-pins the action and regresses the hardening). Dependabot (`.github/dependabot.yml`) surfaces both npm and github-actions updates as PRs.
- **Least privilege**: both workflows set top-level `permissions: contents: read`; only the `release` and `update-readme` jobs escalate to `contents: write` per-job. Don't widen the top-level scope.
- **`ci.yml`**: lightweight Linux build-check on PRs — `npm ci → test → typecheck → lint → npm audit --audit-level=high → package`. A high in a *dev-only* dep is fixed by bumping the dep, never by lowering the gate (triage policy is commented at the audit step).

### Cutting a release (`build.yml`, triggered on `v*` tag push)

1. Bump `package.json` (`npm version patch --no-git-tag-version`) in a `release: vX.Y.Z` commit on `main`.
2. `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`.

What the tag triggers — and the gating to know:
- **Strict semver is enforced.** The `release` job validates `vMAJOR.MINOR.PATCH[-prerelease][+build]` and refuses to publish a non-semver `v*` tag (`vtest`, `v1`, …). A malformed tag also fails earlier at the build job's `npm version` step. The **git tag is the source of truth for the version** — it syncs `package.json` at build time.
- **Stable vs prerelease.** A prerelease tag (`v1.2.3-rc.1`) publishes as a GitHub **prerelease** (does *not* move `latest`) and **does not touch `main`**. Only a **stable** tag runs the `update-readme` job, which regenerates the README download links (`scripts/update-readme.mjs`, between `<!-- DOWNLOADS:START/END -->`) and commits them to `main` as `github-actions[bot]`.
- **Recovery / rollback**: `gh release delete vX.Y.Z --yes --cleanup-tag` (removes the release, its assets, and the tag), then fix and re-tag.
- **App icon**: `build/icon.png`. `goldfinch-*.png` at repo root and `.claude/settings.local.json` are gitignored.

## Flight Operations

This project uses [Flight Control](https://github.com/msieurthenardier/mission-control).

**Before any mission/flight/leg work, read these files in order:**
1. `.flightops/README.md` — What the flightops directory contains
2. `.flightops/FLIGHT_OPERATIONS.md` — **The workflow you MUST follow**
3. `.flightops/ARTIFACTS.md` — Where all artifacts are stored
4. `.flightops/agent-crews/` — Project crew definitions for each phase (read the relevant crew file)
