# Leg: basewindow-chrome-shell

**Status**: completed
**Flight**: [Window Shell](../flight.md)

> **Implemented in a prior session** of this resumed `/agentic-workflow` run (working-tree diff to
> `src/main/main.js` + `src/main/automation/engine.js`, uncommitted). Static gates re-verified on adoption
> (2026-06-24): `grep -n "mainWindow\.webContents" src/main/main.js` → **0 matches**; `npm run typecheck`
> → clean; `npm run lint` → clean. **AC9 PROVEN live this session** (not deferred): instrumented relaunch +
> real MCP drive (27 tools; `openTab`/`navigate`/`readDom` against `example.org` → real DOM; per-tab +
> whole-window capture). The flight's carried `captureWindow`-composites-guest unknown / divert trigger was
> tested and **resolved favorably** (composites when the guest has painted; paint-timing caveat noted). See
> flight-log "Runtime verification" + "captureWindow guest-compositing". Commit batched at end-of-flight review.

## Objective

Swap the window host from `BrowserWindow` to `BaseWindow` + a chrome `WebContentsView`, and re-point every `mainWindow.webContents.*` site (including the automation-engine accessor contract) through a `getChromeContents()` accessor — in one atomic change so the app runs at the leg's end.

## Context

- **DD1** — Incremental migration: shell only. Guest tabs stay `<webview>` *inside* the chrome doc this flight (their migration to per-tab `WebContentsView`s is Flight 3). The planning premise-spike proved `<webview>` renders inside a view-hosted chrome.
- **DD2** — Single `chromeView` reference behind a `getChromeContents()` accessor; **re-point EVERY site** (grep-driven, not a hand-list). `mainWindow` becomes the `BaseWindow`, used only for window-level ops. The load-bearing correction: the automation engine takes a *window* accessor (`createEngine(() => mainWindow, …)`) and dereferences `mw.webContents` internally — `BaseWindow` has no `.webContents`, so the engine, `captureWindow`, and the dev seam silently break unless the accessor contract is changed window→contents.
- **DD3** — Chrome view fills the window; geometry from `win.getContentBounds()` at create + on `resize`.
- **DD6** — Preserve launch appearance: `backgroundColor:'#1e1f25'` on the `BaseWindow` and a matching background on the chrome view (no white flash).
- This is the first production migration flight; the real risk is the **wide re-point surface** (silent dead-`webContents` sends), gated by `typecheck`/`lint` + a working MCP op, not just "tabs browse."

## Inputs

What exists before this leg runs:
- `src/main/main.js` — `createWindow()` builds a `BrowserWindow` (`main.js:250`), `loadFile` on the window (`276`), `will-attach-webview` on `mainWindow.webContents` (`286`), maximize/unmaximize forwarders (`310–311`), and ~10 renderer-send sites + downloads + dev-seam + the two `createEngine(() => mainWindow, …)` sites (`151`, `1387`).
- `src/main/automation/engine.js` — `createEngine(getMainWindow, opts)` dereferences `mw.webContents` in `deps()` (`48`, `51`), `getChromeTarget` (`96–99`), with a `@param` JSDoc typing the accessor as `Electron.BrowserWindow` (`22–23`).
- A pre-existing window-based accessor already exists: `scopeCtx.getChromeContents: () => (mainWindow ? mainWindow.webContents : null)` (`main.js:159`).
- App runs on `main` (mission branch) under Linux/WSLg; `<webview>` tabs browse.

## Outputs

What exists after this leg completes:
- `createWindow()` builds a `BaseWindow` and a chrome `WebContentsView`, added via `win.contentView.addChildView(chromeView)`, with `chromeView.webContents.loadFile(index.html)`.
- A module-level `chromeView` reference and a single `getChromeContents()` accessor returning `chromeView.webContents`.
- Every `mainWindow.webContents.*` site routes through `getChromeContents()` (grep clean — zero remaining `mainWindow.webContents` references).
- `engine.js`'s accessor contract changed window→contents; both `createEngine` call sites pass the contents accessor.
- App runs, `<webview>` tabs browse, `npm run typecheck` + `npm run lint` green.

## Acceptance Criteria

- [ ] **AC1** — `createWindow()` constructs a `BaseWindow` (not `BrowserWindow`) and a chrome `WebContentsView` with `webPreferences`: chrome preload, `contextIsolation:true`, `nodeIntegration:false`, `webviewTag:true`, `sandbox:false`, and the dev `additionalArguments` conditional spread carried over unchanged.
- [ ] **AC2** — The chrome view is added with `win.contentView.addChildView(chromeView)` (NOT `win.addChildView`), and the chrome doc is loaded with `chromeView.webContents.loadFile(...)` (NOT on the window).
- [ ] **AC3** — Chrome-view geometry fills the window: bounds set from `win.getContentBounds()` (x:0, y:0, full width/height) at create AND re-applied on the window `resize` event.
- [ ] **AC4** — `backgroundColor:'#1e1f25'`, `minWidth:900`, `minHeight:600`, `icon`, `title`, and the per-platform `frameOpts` (mac `titleBarStyle:'hidden'`+`trafficLightPosition`; non-mac `frame:false`) carry to the `BaseWindow` ctor; the chrome view background is set so launch shows no white flash (DD6).
- [ ] **AC5** — A single module-level `chromeView` + `getChromeContents()` accessor (returning `chromeView.webContents`) is introduced, and **every** chrome-send site routes through it: all renderer `*.webContents.send(...)` sites — `zoom-changed`, `open-tab`, `open-find`, `open-downloads`, `devtools-state-changed`, `page-context-menu`, `privacy-net`, `privacy-permission`, the `broadcastToChromeAndInternal` chrome send, **and the two `window-maximized-change` sends (`main.js:310–311`)** — plus the `will-attach-webview` hook, the `downloadURL` retry, the `download-media` fallback, and the dev-seam identity check (`event.sender === getChromeContents()`). **Guard conversion (required):** the `isDestroyed()`-gated sends (`broadcastToChromeAndInternal` at `850`, `downloadURL` retry at `993`, `privacy-net` at `681–682`, `privacy-permission` at `824–825`) must have their guards re-expressed against the chrome contents, not against the now-`BaseWindow` `mainWindow` — a `BaseWindow.isDestroyed()` guard compiles and lints clean while gating the wrong object, so this is a silent-break risk.
- [ ] **AC6** — The engine accessor contract is changed window→contents: both `createEngine(...)` sites (`main.js:151`, `main.js:1387`) pass `getChromeContents` (the contents accessor); `engine.js` treats its arg as a contents accessor — in `deps()` (the `chromeContents` derivation **and** the `executeInRenderer` guard/call defined inside it, `engine.js:47–52`) and in `getChromeTarget` (`engine.js:96–99`) — and the `@param` JSDoc is updated (`Electron.BrowserWindow` → `Electron.WebContents`, `engine.js:22`).
- [ ] **AC7** — `grep -n "mainWindow\.webContents" src/main/main.js` returns **zero** matches. **This includes comment/JSDoc occurrences** — the JSDoc at `main.js:839` literally contains `mainWindow.webContents` and must be updated to reference `getChromeContents()` (the chrome contents) or the grep gate is unsatisfiable.
- [ ] **AC8** — `dialog.showOpenDialog(mainWindow, …)` (`main.js:531`) is **left unchanged** — a `BaseWindow` is a valid dialog parent.
- [ ] **AC9** — App launches under WSLg, the chrome renders frameless, `<webview>` tabs browse, AND at least one MCP automation op succeeds end-to-end (engine alive — proves the accessor-contract change is wired correctly).
- [ ] **AC10** — `npm run typecheck` and `npm run lint` both pass.

## Verification Steps

- AC1–AC4: read `createWindow()` — confirm `BaseWindow`, `WebContentsView`, `contentView.addChildView`, `loadFile` on webContents, geometry wiring, ctor options.
- AC5/AC7: `grep -n "mainWindow\.webContents" src/main/main.js` → no matches; spot-check each former send site now uses `getChromeContents()`.
- AC6: read `engine.js` `deps()`/`getChromeTarget` — arg is treated as a contents accessor; both `createEngine` call sites in `main.js` pass `getChromeContents`.
- AC8: confirm `dialog.showOpenDialog` still passes `mainWindow`.
- AC9: `npm start` (or `npm run dev:automation` for the MCP op); confirm window renders, a tab browses, and one MCP op (e.g. `captureWindow` or `enumerateTabs`) returns. *(Full visual + capture-path verification is Leg 3's HAT — this gate is "engine alive + tabs browse," not the pixel HAT.)*
- AC10: `npm run typecheck`, `npm run lint`.

## Implementation Guidance

1. **Introduce the chrome-view reference + accessor.**
   - Add a module-level `let chromeView = null;` alongside `mainWindow`.
   - Replace the existing window-based `scopeCtx.getChromeContents` (`main.js:159`) with the single canonical `getChromeContents = () => (chromeView ? chromeView.webContents : null)` and reuse it everywhere (the scope ctx points at the same accessor).

2. **Rebuild `createWindow()` (`main.js:244–312`).**
   - `mainWindow = new BaseWindow({ width, height, minWidth, minHeight, backgroundColor, title, icon, ...frameOpts })` — note `BaseWindow` takes **no** `webPreferences`.
   - `chromeView = new WebContentsView({ webPreferences: { preload, contextIsolation:true, nodeIntegration:false, webviewTag:true, sandbox:false, ...(dev additionalArguments spread) } })`.
   - `mainWindow.contentView.addChildView(chromeView)`.
   - Set chrome-view background `chromeView.setBackgroundColor('#1e1f25')` (`WebContentsView extends View`; `View.setBackgroundColor` exists in Electron 42 — belt-and-suspenders with the chrome doc's own `#1e1f25`) and set initial bounds (see the geometry-timing note below).
   - `chromeView.webContents.loadFile(path…/index.html)`.
   - Move `will-attach-webview` onto `getChromeContents()`.
   - `mainWindow.on('resize', …)` → re-apply chrome-view bounds from `getContentBounds()`.
   - Keep `closed → mainWindow = null` (also null `chromeView`).
   - **Leg 1 / Leg 2 split on the maximize forwarders:** Leg 1 re-points only the `.send` *payload* on `main.js:310–311` (`mainWindow.webContents.send('window-maximized-change', …)` → `getChromeContents()?.send('window-maximized-change', …)`) — this is REQUIRED to satisfy AC7's zero-match grep. Leave the `mainWindow.on('maximize'/'unmaximize')` event *registration* as-is (a `BaseWindow` still emits these events, so it keeps working). Leg 2 owns moving/confirming that registration on the `BaseWindow` alongside the DD4 window-control method re-point. Do NOT touch the window-control IPC handlers or `app.on('activate')` here — that is Leg 2.
   - **Initial geometry timing:** set the chrome-view's initial bounds from the constructed width/height (or after the window is realized), not by trusting `getContentBounds()` at the exact instant of construction — on some platforms the first read can lag the requested size and flash a gap before the first `resize`. Steady-state geometry is owned by the `resize` handler.

3. **Re-point every DD2 send site** — mechanical: `mainWindow.webContents.send(...)` → `getChromeContents()?.send(...)` (preserve the existing `if (mainWindow ...)` / `isDestroyed()` guards, adapting them to the accessor as needed). Cover all sites listed in AC5.

4. **Re-point downloads + dev seam.**
   - `download-media` fallback (`main.js:495`) and `downloadURL` retry (`main.js:993`) → use `getChromeContents()`; convert the `mainWindow && !mainWindow.isDestroyed()` guard on the retry to a contents-based check.
   - Dev-seam identity check (`main.js:1392`): `event.sender === getChromeContents()`.
   - Update the JSDoc comment at `main.js:839` (currently references `mainWindow.webContents`) so AC7's grep reaches zero.

5. **Change the engine accessor contract (engine.js).**
   - `createEngine(getChromeContents, opts)`; in `deps()` set `const chromeContents = getChromeContents();` and guard `executeInRenderer` on it; in `getChromeTarget` use `getChromeContents()` directly. Update the `@param` JSDoc type to `Electron.WebContents`.
   - Update both call sites: `main.js:151` and `main.js:1387` → `createEngine(getChromeContents, { … })`.

6. **Require `BaseWindow`/`WebContentsView`** from `electron` at the top of `main.js` (keep `BrowserWindow` imported — still used by `app.on('activate')` until Leg 2 / DD7).

7. **Gate**: `npm run typecheck && npm run lint`; launch; browse a tab; run one MCP op.

## Edge Cases

- **Null window during startup/teardown**: `getChromeContents()` returns `null` when `chromeView` is null — every call site must keep a guard (`?.` or existing `if`). The engine already guards (`!mw` → clean error); preserve equivalent guarding after the contract change.
- **`BaseWindow` has no `webContents`**: any stray `mainWindow.webContents` is a silent break — AC7's grep is the backstop.
- **`addChildView` vs `contentView.addChildView`**: `BaseWindow` exposes children via `contentView`; calling `win.addChildView` is wrong. (Called out explicitly in the flight leg description.)
- **Resize before view exists**: ensure the `resize` handler no-ops if `chromeView` is null.
- **First-paint geometry lag**: `getContentBounds()` at the construction instant can lag the requested size on some platforms — set initial bounds from the ctor width/height (or post-realization) and let `resize` own steady state, to avoid a gap flash before first `resize`.
- **`isDestroyed()` guarding the wrong object**: after the swap `mainWindow` is a `BaseWindow` whose `isDestroyed()` compiles fine — re-express the chrome-send guards against `getChromeContents()` so they gate the contents, not the window.

## Files Affected

- `src/main/main.js` — `BaseWindow` + `WebContentsView` swap, `getChromeContents()` accessor, all DD2 re-points, both `createEngine` call sites, electron require.
- `src/main/automation/engine.js` — accessor contract window→contents (`deps()`, `executeInRenderer`, `getChromeTarget`, `@param` JSDoc).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(NOTE: this leg is autonomous and batched — the Developer does NOT commit. The Flight Director commits all autonomous legs together after the end-of-flight review.)*

- [ ] All acceptance criteria verified
- [ ] `npm run typecheck` + `npm run lint` passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (Flight Director marks `completed` at flight commit)
- [ ] Do NOT commit, do NOT check off in flight.md yet (batched at flight review)
