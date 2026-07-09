# Leg: internal-tabs-as-views — Internal `goldfinch://` tabs as WebContentsViews (trust model intact)

**Status**: completed
**Flight**: [Tab Surface](../flight.md)

> **Security-critical leg (DD0 / DD3-internal).** Migrates internal `goldfinch://` pages (settings,
> downloads) from renderer `<webview>` elements to directly-constructed main-process
> `WebContentsView`s, reproducing the internal trust boundary **byte-exact at construction**. Leg 1
> already built the entire view infrastructure for web tabs (registry, accessor, geometry,
> `setVisible`, `wireGuestContents`, `wireTabViewEvents`, the tab lifecycle IPC); this leg routes the
> internal/trusted branch through that same path with internal `webPreferences`. The risk is **not**
> render (the view model is proven) — it is silent drift of the partition/session identity that the
> trust model keys on.

## Objective

Construct internal tabs as `WebContentsView`s with byte-exact internal `webPreferences` set at
construction (the config the `will-attach-webview` hook applied for `<webview>`, which never fires for
a constructed view), route the renderer `createTab` trusted branch through the view IPC path, and
remove the internal `<webview>` machinery in the renderer. At the end: `goldfinch://settings` and
`goldfinch://downloads` load and operate as views with the **internal session, the four gates, the
session-scoped `protocol.handle`, and the origin-checked bridge all intact**, and **no internal
`<webview>` path remains** in the renderer. (`webviewTag` / `will-attach-webview` removal is the
separate Leg 4 cleanup, gated on this leg.)

## Context (current code, recon-verified 2026-06-26)

**The trust model keys on SESSION IDENTITY + PARTITION, not on the `<webview>` substrate** — so most
of it transfers automatically once the constructed view uses the byte-exact partition:

- **Internal `webPreferences` (the byte-exact target)** — `main.js:452–462` (`will-attach-webview`
  internal branch): `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`,
  `spellcheck:false`, preload = `src/preload/internal-preload.js`, `partition = INTERNAL_PARTITION`.
  `INTERNAL_PARTITION = 'goldfinch-internal'` (`src/shared/internal-page.js:8`) — **no `persist:`
  prefix** (static in-memory session). Contrast web branch (`main.js:464–466`):
  `contextIsolation:false`, `sandbox:false`, no `spellcheck` key.
- **Internal session + marker** — created once at startup (`main.js:1786–1789`):
  `session.fromPartition(INTERNAL_PARTITION)` under the `creatingInternalSession` flag; the
  `session-created` hook (`main.js:1746–1765`) sets `ses.__goldfinchInternal = true` and **skips**
  `applyShields`/`wireDownloadHandler`/`applySpellcheck` for it. A constructed view with
  `partition:'goldfinch-internal'` resolves **this existing session** (marker already set) — no
  re-creation.
- **The four gates** (all key on `wc.session.__goldfinchInternal === true`, so they fire on the
  constructed view automatically — **no gate code changes**, but each must be VERIFIED on the view):
  1. `session-created` hook skips shields/downloads/spellcheck wiring for the internal session
     (`main.js:1746–1765`).
  2. `will-navigate` (`main.js:558–566`): internal session → only `isInternalPageUrl(url)` allowed.
  3. `setWindowOpenHandler` (`main.js:550–553`): deny native windows → `open-tab` (common path).
  4. `before-input-event` zoom/F12/print (`main.js:571–621`): **skipped** for internal session.
- **`protocol.handle`** — registered on the **internal session object**:
  `internalSession.protocol.handle('goldfinch', handleInternal)` (`main.js:1790`); scheme privileged
  at module load (`main.js:55`, `standard:true, secure:true`). Byte-exact partition → the view
  resolves the same handler. **No change** (verify load).
- **Origin-checked bridge** — preload `src/preload/internal-preload.js` exposes `goldfinchInternal`
  only when `location.origin ∈ {goldfinch://settings, goldfinch://downloads}` (`:23–27`); the
  authoritative main-side check is `isTrustedInternalSender(origin, isInternalSession)`
  (`src/main/internal-ipc.js:40–45`) wrapping every internal IPC via `registerInternalHandler`
  (`:67–82`, checks `event.senderFrame.origin` + `event.sender.session.__goldfinchInternal`). Keyed on
  origin + session marker → **transfers** to the view (verify settings get/set, downloads list).
- **Automation/MCP exclusion** — `resolveContents` rejects internal by `isInternalContents(wc)`
  (`resolve.js:76–99`, keyed on the session marker, `=== true` strict at `resolve.js:28–30`); the
  enumerate filter skips internal by the same marker (`main.js:1094`); observe ops re-check post-resolve
  (`observe.js:30–34`). All survive the substrate swap (the view's session still carries the marker).
  **The `getType()` collision is safe**: `classifyContents` (`resolve.js:48`) keys 'chrome' on
  `wc === chromeContents`; internal views are `!== chromeContents` → classified 'guest', and
  `isInternalContents` independently flags them internal. **Verify** internal-session-exclusion holds.

**Leg-1 web-view construction (the pattern to mirror)** — `ipcMain.handle('tab-create')`
(`main.js:1397–1436`): builds `new WebContentsView({ webPreferences: {...} })` (`:1403–1412`), adds to
`mainWindow.contentView`, seeds full-content bounds (`:1416–1419`), `setVisible(false)` (`:1420`),
registers in `tabViews` (`main.js:144`) as `{ view, partition, trusted:false, active:false }` (`:1423`),
calls `wireGuestContents` (`:1428`, explicit — fires during construction) and `wireTabViewEvents`
(`:1431`, forwards did-navigate/in-page, title, favicon, load-start/stop, found-in-page to chrome via
`getChromeContents()?.send`), then `loadURL`. **Currently `tab-create` returns `null` for the trusted
case (`main.js:1400`)** — that early-out is what this leg replaces. Accessors `getTabContents`/
`getActiveTabContents` (`main.js:150–160`), lifecycle IPC `tab-close`/`tab-hide`/`tab-navigate`/
`tab-set-active`/`tab-set-bounds`/`tab-find` (`main.js:1439–1519`) are all substrate-agnostic and
reused as-is.

**Renderer fork** — `createTab` (`renderer.js:709–811`) forks at `:727` on `trusted`: trusted →
builds a `<webview id=webview-${id}>` (`:728–735`, sets `src`/`preload`=`internalPreloadPath`/
`allowpopups`/`partition`), appends to `#webviews`, wired via `wireWebview` (`:787`, `:1089–1204` DOM
listeners); untrusted → `tabCreate` IPC + `tabSetActive` on wcId (`:790–806`). Internal-specific
renderer paths to retire: the `<webview>` creation (`:728–735`), `wireWebview` for internal,
`closeTab` internal branch removing `tab.webview` (`:817`), `activateTab` internal branch toggling
`t.webview.classList` (`:839–841`). `isInternalTab(tab)` (`:912`) keys on
`container.id==='internal' || container.partition===internalPartition` — substrate-independent, **keep**.

## Inputs

- Branch `flight/03-tab-surface` at `b6b1b48` (Legs 1, 2, 02b landed; web tabs are views; internal
  tabs still `<webview>`).
- Leg-1 view infrastructure (registry, accessors, `wireGuestContents`, `wireTabViewEvents`, lifecycle
  IPC) — reused.
- The intact trust model (internal session, four gates, `protocol.handle`, origin-checked bridge,
  automation exclusion) — preserved, not rebuilt.

## Outputs

- Internal `goldfinch://` tabs constructed as `WebContentsView`s with byte-exact internal
  `webPreferences`; trust model intact on the view surface.
- No internal `<webview>` construction in the renderer; `tab.webview` no longer used for guests.
- `webviewTag`/`will-attach-webview` still present (removed in Leg 4) but no longer exercised by any tab.
- `test`/`typecheck`/`lint` green; internal trust verified at runtime (and via the Leg-5 security specs).

## Acceptance Criteria

- [ ] **AC1 — Internal views constructed byte-exact.** `tab-create` constructs internal tabs as
  `WebContentsView` with EXACTLY `{ preload: <abs path to internal-preload.js>, contextIsolation:true,
  sandbox:true, nodeIntegration:false, partition:'goldfinch-internal', spellcheck:false }` and returns
  the `wcId` (the `main.js:1400` trusted early-return-null is gone). Registered in `tabViews` as
  `trusted:true`; added to `contentView`; bounds-seeded; `setVisible(false)` until activated;
  `wireGuestContents` + `wireTabViewEvents` called **before** `loadURL`. The web branch is unchanged.
- [ ] **AC2 — `goldfinch://settings` + `goldfinch://downloads` load as views.** Both open, render, and
  are visible/switchable/closable as per-tab views (no `<webview>` element in the DOM for them — verify
  via DevTools/readDom that `#webviews` has no `<webview>` child). The session resolved by the view is
  the internal session (`__goldfinchInternal === true`).
- [ ] **AC3 — Four gates fire on the view.** (a) The view's session does NOT have shields/download/
  spellcheck wiring (internal session exemption). (b) `will-navigate` to a non-internal URL is blocked
  on the internal view; an internal allowlisted nav is allowed. (c) `window.open`/target=_blank from an
  internal page denies the native window and opens a tab. (d) Zoom/F12/print shortcuts are inert on the
  internal view.
- [ ] **AC4 — `protocol.handle` serves the view.** `goldfinch://settings` and `goldfinch://downloads`
  assets resolve (the page renders its real content, not a 404), proving the byte-exact partition
  resolves the internal session's `protocol.handle`.
- [ ] **AC5 — Origin-checked bridge works on the view.** Settings get/set round-trips, the downloads
  list renders and an action works, shields/automation internal bridge calls succeed — AND a
  non-internal sender is still rejected (the `isTrustedInternalSender` guard holds: origin ∈ internal
  set AND `__goldfinchInternal === true`).
- [ ] **AC6 — Automation still excludes internal.** With the app on the automation surface: `enumerate`
  does NOT list the internal view; a directly-supplied internal `wcId` is rejected at resolve-time with
  the `automation: internal-session` error for jar keys; admin behaves per existing `allowInternal`
  policy. (Confirms `isInternalContents` still flags the constructed internal view.)
- [ ] **AC7 — EVERY renderer internal `<webview>` coupling retired (review-expanded).** `createTab`
  no longer constructs a `<webview>` for trusted tabs (it uses the `tabCreate`/`tabSetActive` IPC path,
  mirroring web). **All `tab.trusted && tab.webview` branches are updated** (post-migration
  `tab.webview` is `null` for internal tabs, so each silently degenerates if left):
  - `createTab` trusted branch (`:727–735`) → view IPC path.
  - `activateTab` internal branch (`:866–878`) → **must call `tabSetActive(tab.wcId, …)`** for the
    incoming internal view (else it stays invisible when switching back to an already-open internal tab).
  - `closeTab` internal branch (`:817`) → `tabClose(tab.wcId)`.
  - `updateNavButtons()` (`:1228`) → internal tabs must **explicitly disable** back/forward (currently
    relies on `tab.webview` `canGoBack/Forward`; with `null` it leaves stale state). Add an
    `else if (tab.trusted)` that disables both (or drive from the `tab-nav-state` IPC).
  - `navigate()` (`:1256–1259`) and the back/forward/reload click handlers (`:1285–1306`) → the dead
    `tab.trusted && tab.webview` checks (the `isInternalTab` early-return already covers `navigate`)
    are removed/cleaned.
  - `__goldfinchAutomation.openTab` (`:2790–2798`) → retire the dead `tab.trusted && tab.webview`
    dom-ready poll branch (falls through to the wcId-poll path, which is correct).
  - `wireWebview` (`:1089–1204`) → no longer invoked for any tab once `:787` is removed; remove it
    (confirm fully unused via grep) or leave a Leg-4 note.
  - `grep` shows no `document.createElement('webview')` and no `tab.webview` guest usage remains.
  (`webviewTag`/`will-attach-webview`/`internalPreloadPath` in main/bridge stay — Leg 4.)
- [ ] **AC8 — Freeze/capture unaffected by internal (guard BOTH sides).** `captureActiveGuest`'s
  **main-side** `ipcMain.handle('capture-active-guest')` (`main.js:~1526`) gains an explicit
  `if (wc && isInternalContents(wc)) return null;` guard (matching the both-sides internal-guard
  discipline used by `toggle-devtools`/`print`/`get-zoom`/`page-context-*`), and its stale comment
  ("internal tabs use `<webview>` … not occluding") is corrected. The renderer freeze guard
  (`!t.trusted`) is unchanged (it remains the only caller path). `captureWindow` unchanged.
- [ ] **AC9 — Gates green + no regressions.** `npm test` (update any test that pinned internal as a
  `<webview>`; `internal-ipc`/`automation-resolve`/`internal-assets` unit suites pass), `npm run
  typecheck`, `npm run lint`, `npm run a11y` all green. Web tabs + all menus (Legs 1/2/02b) still work.

## Verification Steps

- **AC1/AC2/AC4 (runtime):** launch `npm run dev:automation`; open Settings (⋮ → Settings) and
  Downloads; confirm both render real content; `readDom`/DevTools the chrome doc → `#webviews` has no
  `<webview>` child; confirm switch/close work as views.
- **AC3 (gates):** from an internal page attempt a disallowed navigation (e.g., set `location.href` to
  an external URL) → blocked; trigger `window.open` → opens a tab, no native window; press Ctrl+'+'/F12
  on the internal view → no zoom/DevTools. Confirm (via a dev readback or logs) the internal session has
  no shields/download listeners.
- **AC5 (bridge):** change a setting in Settings and confirm it persists (round-trip); open Downloads
  and confirm the list renders + an action works.
- **AC6 (automation):** with a jar key, `enumerate` → internal absent; drive the internal `wcId`
  directly → `automation: internal-session` error. (Full coverage is the Leg-5 `internal-session-exclusion`
  + `mcp-jar-scoping` specs — this leg smokes them; Leg 5 runs them as the gate.)
- **AC7:** `grep -n "createElement('webview')\|tab\.webview\|wireWebview" src/renderer/renderer.js`.
- **AC9:** `npm test && npm run typecheck && npm run lint && npm run a11y`.

## Implementation Guidance

**Incremental; smoke after each. The byte-exact `webPreferences` is the single most load-bearing line.**

1. **main: construct internal views in `tab-create`.** Replace the trusted early-return-null
   (`main.js:1400`) so that when `trusted` (or `partition === INTERNAL_PARTITION`) the handler builds
   the view with the **internal** `webPreferences` (preload = `path.join(__dirname,'..','preload','internal-preload.js')`,
   `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `partition:INTERNAL_PARTITION`,
   `spellcheck:false`) instead of the web prefs; everything else (add to `contentView`, seed bounds,
   `setVisible(false)`, register `{ view, partition, trusted:true, active:false }`, `wireGuestContents`
   **then** `wireTabViewEvents` **then** `loadURL(url)`) mirrors the web path exactly. Return the `wcId`.
   Keep the web branch byte-identical. **Do NOT** set a `spellcheck` key on the web branch.
   - *Carry the DD2 `isDestroyed()` lesson:* guard the real send target (`view.webContents.isDestroyed()`).
   - **Smoke:** internal tab opens as a view and renders.
2. **renderer: route trusted createTab through the view IPC.** In `createTab` (`:727`), make the
   trusted branch call `window.goldfinch.tabCreate({ url, partition: jar.partition, trusted: true })`
   and handle the returned `wcId` exactly like the web branch. **Async-timing (review LOW):** at
   `createTab` time `activateTab(id)` runs synchronously while `tab.wcId` is still `null` (the IPC is
   async), so — exactly as the web path does — the `tabCreate(...).then(wcId => …)` callback must, when
   this tab is the active tab, call `tabSetActive(tab.wcId, measureWebviewsSlotWithInsetDIP())` once the
   `wcId` arrives. Set `tab.wcId = wcId`; set `tab.webview = null`. **`visibleWebTabWcId` is web-only —
   internal does NOT set it** (internal never freezes). Remove the `<webview>` construction (`:728–735`).
   Ensure `tabCreate` passes `trusted: true` to main.
   - **Smoke:** Settings/Downloads open via the IPC path and become visible.
3. **renderer: retire EVERY internal `<webview>` coupling (review-expanded — see AC7).** Internal tabs
   now receive tab-strip events through the existing main→IPC `onTab*` subscriptions (same as web).
   Update/clean each `tab.trusted && tab.webview` site:
   - `activateTab` internal branch (`:866–878`): **call `window.goldfinch.tabSetActive(tab.wcId,
     measureWebviewsSlotWithInsetDIP())`** for the incoming internal view (and keep `visibleWebTabWcId =
     null`) — without this, switching back to an already-open internal tab leaves the view hidden. Hide
     the outgoing tab via the existing path.
   - `closeTab` (`:817`): `tabClose(tab.wcId)`; drop the `tab.webview` DOM removal.
   - `updateNavButtons()` (`:1228`): add an explicit internal branch that disables back/forward (no
     `tab.webview` to query), or drive it from the `tab-nav-state` IPC the view path already emits.
   - `navigate()` (`:1256–1259`) + back/forward/reload handlers (`:1285–1306`): remove the dead
     `tab.trusted && tab.webview` branches (behavior already correct via the `isInternalTab` guard /
     disabled buttons).
   - `__goldfinchAutomation.openTab` (`:2790–2798`): retire the dead trusted-webview dom-ready poll
     branch (the wcId-poll path is correct for view-backed internal tabs).
   - Remove the `wireWebview(...)` call (`:787`); if `wireWebview` (`:1089–1204`) is then fully unused,
     remove it (confirm via grep; else Leg-4 note).
   - Confirm `isInternalTab` (`:912`) still works (keyed on container — unaffected).
   - **Smoke:** switch/close internal tabs; tab strip reflects internal title/favicon/load; back/forward
     disabled on internal pages.
4. **Defensive internal guards (review HIGH).** Add an explicit `if (wc && isInternalContents(wc))
   return null;` to the **main-side** `ipcMain.handle('capture-active-guest')` (`main.js:~1526`) after
   the `wc` resolve — once an internal tab can be the active tab, `getActiveTabContents()` is not
   session-aware, so without this the handler could `capturePage()` the internal session view; the
   renderer `!t.trusted` guard is the only caller today but the codebase guards internal on BOTH sides
   (cf. `toggle-devtools`/`print`/`get-zoom`/`page-context-*`). **Fix the stale comment** there
   ("internal tabs use `<webview>` … not occluding" → "renderer `!t.trusted` guard prevents internal
   calls; this is defense-in-depth"). Confirm the enumerate filter (`main.js:1094`) and
   `resolveContents` exclusion still flag the constructed internal view (they key on the session marker —
   automatic; verify at runtime, AC6).
5. **Tests.** Update any unit/renderer test that asserted internal tabs are `<webview>` elements (invert/
   rewrite, don't silently delete). Confirm `internal-ipc`, `automation-resolve`, `internal-assets`
   suites pass (they're substrate-independent — keyed on session/origin). Add a unit test if practical
   that the internal-view construction path requests the byte-exact internal `webPreferences`.
6. **Cleanup notes (do NOT do Leg-4 work here).** Leave `webviewTag:true` and `will-attach-webview` in
   place. Note in the flight log that after this leg no tab is a `<webview>`, so Leg 4 can remove them.
   The renderer `internalPreloadPath` global may become unused (main now owns the preload path) — note
   for Leg 4, don't chase it here unless trivially dead.
7. **Full gate** + runtime trust verification (AC2–AC6) + smoke the Leg-5 security specs.

## Edge Cases

- **Partition byte-exactness is the security boundary.** Any drift from `'goldfinch-internal'` (typo,
  stray `persist:`, wrong constant) silently resolves a DIFFERENT session → the marker is absent → the
  gates/bridge/exclusion all silently fail open. Construct from the `INTERNAL_PARTITION` constant
  (`require('../shared/internal-page')`), never a literal.
- **Internal session already exists at startup** (`main.js:1786`). Constructing a view with the
  partition must NOT re-enter `creatingInternalSession` logic — `session.fromPartition` returns the
  existing session; the marker is already set. Verify no second `session-created` fires for it (it
  won't — same session object).
- **`spellcheck` asymmetry:** internal sets `spellcheck:false` explicitly at construction (matches the
  attach-hook internal branch); web must NOT set a `spellcheck` key (the session-layer applier owns the
  live web toggle — DD3 / Architect catch). Don't accidentally unify them.
- **`allowpopups`:** the `<webview>` used `allowpopups=''`; the constructed view's `setWindowOpenHandler`
  (already wired via `wireGuestContents`) is the equivalent — denies native windows, sends `open-tab`.
  No `allowpopups` equivalent needed.
- **Origin string:** the privileged scheme yields `location.origin` like `goldfinch://settings` (no
  port) — the preload allowlist + `isTrustedInternalSender` already expect exactly that; constructing as
  a view doesn't change the origin (the URL is identical).
- **getType() collision:** internal views report `getType()==='window'` (like chrome and web views) —
  nothing may key on the type string; `classifyContents` keys on `=== chromeContents` and
  `isInternalContents` on the session marker — both correct. Audit for any new `getType()` reader.
- **Internal tab as active tab + geometry:** internal views use the same geometry/`setVisible` path;
  `visibleWebTabWcId` stays web-only (internal never participates in freeze). Ensure activate/bounds
  for an internal active tab work (they should — substrate-agnostic IPC).

## Files Affected

- `src/main/main.js` — `tab-create` internal-view construction branch (byte-exact internal prefs);
  defensive `captureActiveGuest` internal guard (confirm). (Gates, session, `protocol.handle`,
  `internal-ipc` wiring unchanged.)
- `src/renderer/renderer.js` — `createTab` trusted branch → view IPC; remove internal `<webview>`
  construction + `wireWebview`-for-internal + `tab.webview` lifecycle branches.
- `test/unit/*` — update any internal-as-`<webview>` assertions; keep `internal-ipc`/`automation-resolve`/
  `internal-assets` green; optional construction-prefs unit test.
- (No change to `internal-ipc.js`, `internal-preload.js`, `internal-page.js`, the gate code, or the
  automation exclusion — they key on session/origin and transfer as-is.)

## Post-Completion Checklist

- [ ] AC1–AC9 verified (incl. runtime trust verification + smoke of the Leg-5 security specs)
- [ ] Tests/typecheck/lint/a11y green
- [ ] Flight log updated (byte-exact prefs confirmed; each gate verified on the view; renderer
  `<webview>` retirement; note that no tab is a `<webview>` → Leg 4 unblocked; any test inversions)
- [ ] Leg status `landed` (NOT committed); `[HANDOFF:review-needed]`

## Citation Audit

Citations recon-verified against branch `b6b1b48` on 2026-06-26 (design-review spot-checked the set as
accurate, off-by-one corrected): internal prefs `main.js:451–462`;
`INTERNAL_PARTITION` `src/shared/internal-page.js:8` (`'goldfinch-internal'`); internal session +
marker `main.js:1746–1765,1786–1790`; gates `main.js:550–553,558–566,571–621`; `protocol.handle`
`main.js:55,1790`, handler `main.js:107–130`; origin bridge `src/preload/internal-preload.js:23–27`,
`src/main/internal-ipc.js:40–45,67–82`; automation exclusion `resolve.js:28–30,48,76–99`,
`main.js:1094`, `observe.js:30–34`; web-view construction `main.js:1397–1436` (trusted null-return
`:1400`, prefs `:1403–1412`, registry `:144`,`:1423`, accessors `:150–160`, lifecycle IPC
`:1439–1519`); renderer fork `renderer.js:709–811` (trusted `:727–735`, web `:790–806`, `wireWebview`
`:1089–1204`, `closeTab` `:817`, `activateTab` `:839–841`, `isInternalTab` `:912`). Line numbers to be
re-verified by the implementer (intervening legs shift them; symbols + partition/marker strings are
stable).
