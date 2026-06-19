# Leg: find-bar-ui

**Status**: completed
**Flight**: [Find in Page](../flight.md)

## Objective

Add the renderer-side **floating find bar** (`[ input ] n/m [↑] [↓] [✕]`) opened with `Ctrl+F`,
driving the active tab's `<webview>` via `wv.findInPage` / `found-in-page` with live `n/m`,
forward/back stepping, `Esc`/`✕` close + focus-restore, per-tab UI-intent persistence, and
web-content-only scoping — no automation/MCP work (that is leg `find-mcp-tools`).

## Context

- **Flight DD1** — find bar is renderer chrome, a floating top-right overlay anchored to the
  webview region, search run renderer-side on the `<webview>` tag (`wv.findInPage(text, opts)`);
  `found-in-page` returns to the renderer carrying `{requestId, activeMatchOrdinal, matches,
  finalUpdate}` under `e.result.*`. The displayed `n/m` is read **live from each event, never
  cached**.
- **Flight DD2** — `Ctrl+F` captured main-side in the existing `before-input-event` handler
  (page-focused case) + a renderer `document` keydown fallback (chrome-focused case);
  `Esc`/`Enter`/`Shift+Enter` handled while the find input has focus.
- **Flight DD3** — preserve per-tab find state by caching **UI intent only** (`{ findOpen,
  findText }` on the tab object); re-query Chromium for counts on tab restore; **invalidate on
  full `did-navigate`** (close + clear). Never cache a match count.
- **Flight DD5** — all find affordances no-op on internal `goldfinch://` tabs (the main-side
  capture already skips `__goldfinchInternal`; the renderer paths guard `isInternalTab`).
- **Carry-forward (Flight 1 debrief):** the zoom label bug came from caching session-owned
  implicit state — counts are live-queried here, not cached (mirrors `refreshZoomControl`'s
  live `getZoom` + `activeTabId` race-guard). Renderer focus logic is exactly where Flight 1's
  HAT bugs lived → **focus-restore-to-page on close is an explicit acceptance item**.
- This leg precedes `find-mcp-tools` (automation parity) and `verify-integration` (behavior
  test + docs). It has no leg dependencies — Flight 1 (zoom/print) landed the capture site and
  the renderer patterns this leg mirrors.

## Inputs

What exists before this leg runs (verified at design time):
- `src/main/main.js:357` — `before-input-event` handler on guest `webContents`, guarded by the
  `__goldfinchInternal` skip at `:356`, already handling `Ctrl +/−/0` (zoom) and `Ctrl+P`
  (print), with `if (!action) return` at `:375`.
- `src/main/main.js` — the `zoom-changed` main→renderer broadcast (search
  `mainWindow.webContents.send('zoom-changed'`, ~`:323`) is the correct mirror for the
  `open-find` send: a chrome-renderer-bound IPC event. **Do NOT** model on `:336`
  (`send('open-tab', url)`) — that lives inside `setWindowOpenHandler`, a structurally unrelated
  window-open callback, not a `before-input-event` branch (design-review fix).
- `src/renderer/renderer.js:588` — `isInternalTab(tab)` predicate.
- `src/renderer/renderer.js:663` — `wireWebview(tab)`, the per-webview listener attachment site
  (`dom-ready`, `did-navigate`, `ipc-message`, …).
- `src/renderer/renderer.js:721` — the `did-navigate` `onNav` handler resetting
  `tab.media`/`tab.selected`/`tab.privacy` on full navigation.
- `src/renderer/renderer.js:1216` — the lightbox keydown listener (`Esc`-to-close), guarded by
  `if (els.lightbox.classList.contains('hidden')) return`.
- `src/renderer/renderer.js:2053` — the chrome-focused `document` keydown handler with
  `Ctrl+M`/`Ctrl+Shift+P`/zoom-fallback shortcuts; the lightbox guard is at `:2061`.
- `src/renderer/renderer.js:1675` — `refreshZoomControl(tab)`: the live-query + `activeTabId`
  race-guard pattern to mirror.
- `src/renderer/renderer.js:502` — the Tab object shape (`id`, `webview`, `wcId`, `media`,
  `selected`, `privacy`, `container`); `activeTab()` accessor at `:583`.
- `src/preload/chrome-preload.js` — `contextBridge` `window.goldfinch.*` surface with
  `onOpenTab(cb)` (mirror for `onOpenFind`).
- `src/renderer/index.html:106` — `#webviews` container inside `#main` (`:105`).
- `src/renderer/styles.css` — `#zoom-control` (absolute overlay), `#media-panel` patterns.
- `package.json` — `npm test` → `node --test test/unit/*.test.js`; `npm run a11y` →
  `node scripts/a11y-audit.mjs`.

## Outputs

After this leg completes:
- A floating find bar exists in `index.html` (styled in `styles.css`), opened by `Ctrl+F` on a
  web tab and absent on internal tabs.
- `src/main/main.js` `before-input-event` handler intercepts `Ctrl+F` → `open-find` to renderer.
- `src/preload/chrome-preload.js` exposes `onOpenFind(cb)`.
- `src/renderer/renderer.js` drives `wv.findInPage`/`found-in-page` with the `activeTabId`
  race-guard, live `n/m`, `Enter`/`Shift+Enter`/`Esc`, `stopFindInPage('clearSelection')` +
  focus-restore on close, per-tab `{ findOpen, findText }` cache, re-query-on-restore, and
  `did-navigate` invalidation.
- `npm run a11y` passes with no new violations.

## Acceptance Criteria

- [ ] **AC0 — WSLg spike (gate).** Before building the bar, a ~5-minute spike confirms the
  `<webview>` `found-in-page` event fires reliably on this dev platform (WSLg). If it does NOT
  fire reliably, **stop and escalate to the Flight Director** — this triggers the flight's
  Adaptation Criteria (divert to the main-side `webContents` + IPC-broadcast path, a materially
  different leg). Record the spike result in the flight log.
- [ ] **AC1 — `Ctrl+F` opens the bar (page-focused).** With a web page focused, `Ctrl+F` opens
  the find bar via the main-side `before-input-event` capture → `open-find` IPC; the input is
  focused on open. `event.preventDefault()` is called so Chromium's native find does not also open.
- [ ] **AC2 — `Ctrl+F` opens the bar (chrome-focused).** With the Goldfinch chrome focused
  (e.g. address bar), `Ctrl+F` opens the bar via the renderer `document` keydown fallback,
  guarded by `isInternalTab` and the open-lightbox check.
- [ ] **AC3 — Live search + `n/m`.** Typing in the input runs `wv.findInPage(text, …)`; the
  `found-in-page` event updates the displayed `activeMatchOrdinal`/`matches` as `n/m`, read live
  from `e.result.*` (never cached). Empty input shows no count and runs no search.
- [ ] **AC4 — Stepping.** `Enter` advances to the next match (`findNext: true, forward: true`),
  `Shift+Enter` to the previous (`forward: false`); `n/m` updates accordingly; the nav buttons
  `↑`/`↓` do the same.
- [ ] **AC5 — Close + clear + focus-restore.** `Esc` or `✕` closes the bar, calls
  `wv.stopFindInPage('clearSelection')` (highlight cleared), and **restores keyboard focus to
  the page** (the active `<webview>`).
- [ ] **AC6 — No fight with the lightbox.** When the image lightbox is open, `Ctrl+F` does not
  open the find bar and the find bar's `Esc` does not interfere with the lightbox's `Esc`-close
  (the lightbox guard at `renderer.js:2061` / `:1216` is respected).
- [ ] **AC7 — Internal-tab no-op.** On a `goldfinch://` internal tab, `Ctrl+F` opens no bar
  (main-side `__goldfinchInternal` skip + renderer `isInternalTab` guard); the bar is absent/inert.
- [ ] **AC8 — Per-tab persistence (UI intent only).** Switching away from a find-open tab and
  back re-shows the bar with the prior `findText` and **re-issues `findInPage(findText,
  { findNext: false })`** to refresh the live count — no cached count is shown. The tab being
  left is **not** stopped (its highlight survives across the switch): **do NOT call
  `stopFindInPage` on tab-leave** (design-review fix — removed the ambiguous `'keepSelection'`
  alternative). Only `{ findOpen, findText }` is stored on the tab.
- [ ] **AC9 — `did-navigate` invalidation.** A full `did-navigate` on a find-open tab clears
  `findOpen` and calls `stopFindInPage('clearSelection')` **unconditionally**, but only hides the
  `#find-bar` DOM **if that tab is the active tab** (design-review clarification — `did-navigate`
  can fire on a backgrounded tab; its state must reset even though no visible bar is showing).
  Added beside the existing media/selected/privacy reset in `onNav` (`renderer.js:721`).
  `did-navigate-in-page` does **not** invalidate.
- [ ] **AC10 — Race-guard + no post-close flash.** A `found-in-page` event whose target tab is no
  longer active updates that tab's stored UI intent but does **not** repaint the visible bar
  (mirrors `refreshZoomControl`'s `activeTabId` guard). Additionally, the handler **does not
  repaint when `tab.findOpen` is false** (design-review fix) — Chromium can fire a trailing
  `matches:0` event after `stopFindInPage`, which must not flash `0/0` into a just-closed bar.
  The listener is attached **per-webview in `wireWebview`** so a backgrounded tab's late
  `finalUpdate` is not lost.
- [ ] **AC11 — A11y.** The bar is keyboard-operable (Tab order: input → ↑ → ↓ → ✕), the count
  uses `aria-live="polite"` so screen readers announce `n/m` changes, controls have accessible
  names, and `npm run a11y` reports **no new violations**.

## Verification Steps

- **AC0**: Run the app (`npm run dev` or `npm run dev:automation`), open a page with a repeated
  term, attach a temporary `found-in-page` logger on the active `<webview>`, call
  `wv.findInPage('term')`, confirm the event fires (one or more times, ending `finalUpdate:true`).
- **AC1–AC5, AC8–AC9**: Manual run-through in the live app on `https://example.com` (term
  `"example"`/`"domain"`): `Ctrl+F` (page- and chrome-focused) → type → observe `n/m` →
  `Enter`/`Shift+Enter` → `Esc` → confirm highlight cleared and page focused; switch tabs and back;
  navigate and confirm the bar closes.
- **AC6**: Open the lightbox (click an image in the media panel), press `Ctrl+F` → no find bar;
  `Esc` closes the lightbox as before.
- **AC7**: Open Settings (`goldfinch://`) tab, press `Ctrl+F` → no bar.
- **AC10**: Open find on tab A, switch to tab B while a search is in flight → tab A's late event
  does not repaint the (tab-B) bar.
- **AC11**: `npm run a11y` exits clean; tab through the bar and confirm focus order + visible
  focus rings; verify `aria-live` on the count element.
- Full visual/keyboard sign-off is deferred to the optional `hat-and-alignment` leg; this leg's
  bar must be functionally complete and a11y-clean first.

## Implementation Guidance

1. **WSLg spike first (AC0).** Do the lightweight `found-in-page` reliability check before
   writing the bar. If it fails, halt and signal `[BLOCKED:found-in-page-unreliable]` to the
   Flight Director rather than improvising the main-side path.

2. **Markup (`index.html`).** Add a find-bar overlay element (e.g. `#find-bar`) inside `#main`,
   placed **after `#webviews`** (`:106`) in DOM order so the natural Tab order flows
   page → bar (design-review suggestion) — it is absolutely positioned over the webview region
   regardless. Contents: text input, an `n/m` count element (**statically present in the markup**,
   `aria-live="polite"`, accessible label — do not create it via JS on open, so the live region
   is registered from load), `↑` previous, `↓` next, `✕` close buttons (each with `aria-label`).
   Default hidden (`.hidden`).

3. **Styles (`styles.css`).** Anchor top-right of the webview region, `position: absolute`,
   above webviews (z-index over `#webviews`), matching the dark/gold chrome. Reuse the
   `#zoom-control` / panel idioms; `.hidden { display: none }`. Keep it out of the way of the
   address bar and tab strip.

4. **Main-side `Ctrl+F` capture (`main.js:357`).** In the `before-input-event` handler, add a
   branch beside the `Ctrl+P` print branch (before `if (!action) return` at `:375`):
   `if ((input.control || input.meta) && (input.key === 'f' || input.key === 'F')) {
   event.preventDefault(); mainWindow?.webContents.send('open-find'); return; }`. Note: the
   `Ctrl+P` branch calls `contents.print()` **main-side** (the dialog is OS-native); `Ctrl+F` is
   deliberately different — it sends an IPC event to the chrome renderer where the bar lives, so
   model the send on the `zoom-changed` broadcast, **not** on the `Ctrl+P` branch nor on
   `:336`'s `open-tab` (design-review fix). `event` here is Electron's `before-input-event`
   event object (not a DOM event); `event.preventDefault()` suppresses Chromium's native find.
   The existing `__goldfinchInternal` skip at `:356` (the outer registration guard) already keeps
   internal tabs from ever getting this handler (AC7).
   **Send contract (design-review Q1):** send **no payload**; the renderer infers the target via
   `activeTab()` on delivery — matching the `refreshZoomControl`/`open-tab` "operate on the active
   tab" model. The page-focused capture fires on the focused guest, which is by definition the
   active tab, so the theoretical fast-tab-switch TOCTOU is not worth threading `contents.id`.

5. **preload bridge (`chrome-preload.js`).** Add `onOpenFind: (cb) => ipcRenderer.on('open-find',
   () => cb())` to the `window.goldfinch` surface, mirroring `onOpenTab`.

6. **Renderer open path.** Register `window.goldfinch.onOpenFind(() => openFind())`. `openFind()`:
   guard `const t = activeTab(); if (!t || isInternalTab(t) || t.wcId == null) return;` and the
   open-lightbox check (`renderer.js:2061` pattern); show `#find-bar`, focus the input, set
   `t.findOpen = true`, and if `t.findText` exists, prefill + re-issue the search.

7. **Chrome-focused fallback (`renderer.js:2053`).** In the `document` keydown handler add
   `else if (e.key === 'f') { ... }` (with the lightbox + internal guards) → `e.preventDefault()`
   + `openFind()`, alongside the existing `Ctrl+M`/`Ctrl+Shift+P` shortcuts.

8. **Find input key handling.** While the find input is focused: `Enter` → step forward,
   `Shift+Enter` → step back, `Esc` → close. Input changes run `runFind(t, { findNext: false })`
   **on each keystroke** (commit to per-keystroke / instant search — `findInPage` is cheap and it
   sidesteps the stale-event class a debounce can introduce; design-review suggestion).

9. **`runFind` + `found-in-page` listener.** `runFind(tab, opts)` calls
   `tab.webview.findInPage(tab.findText, { findNext, forward, matchCase: false, ...opts })` and
   stores `tab.findText` (UI intent). Attach the `found-in-page` listener **per-webview in
   `wireWebview` (`renderer.js:663`)**: on event, read `e.result.{activeMatchOrdinal, matches,
   finalUpdate}` (`selectionArea`/`requestId` are present but unused). **Repaint guards** — only
   repaint the visible `#find-bar` when **both** `tab.id === activeTabId` (race-guard, mirror
   `refreshZoomControl`) **and** `tab.findOpen` is true (so a trailing `matches:0` event after
   `stopFindInPage` cannot flash `0/0` into a just-closed bar; design-review fix). The tab's UI
   intent (`findText`) is always kept current regardless of repaint. Empty `findText` → no
   search, blank count.

10. **Close (`closeFind`).** Hide `#find-bar`, `tab.webview.stopFindInPage('clearSelection')`,
    `tab.findOpen = false`, and **restore focus to the page** (`tab.webview.focus()`). This is
    the explicit a11y/focus acceptance item (AC5).

11. **Per-tab restore + invalidation (DD3).** On tab activation (the `activateTab` path, ~`:563`,
    where `refreshZoomControl` is already called) of a tab with `findOpen`, re-show the bar with
    `findText` and re-issue `runFind(tab, { findNext: false })`. New tabs start with `findOpen`
    falsy, so this no-ops safely. In `onNav` (`renderer.js:721`, beside the media/privacy reset):
    if `tab.findOpen`, **unconditionally** clear `tab.findOpen` and call
    `stopFindInPage('clearSelection')`, but only hide the `#find-bar` DOM **if `tab.id ===
    activeTabId`** — `onNav` can fire on a backgrounded tab whose state must still reset even
    though no visible bar is showing (design-review clarification). Do **not** invalidate in
    `did-navigate-in-page`.

12. **a11y.** `aria-live="polite"` on the count; logical tab order; visible focus styles;
    accessible names on all buttons. Run `npm run a11y` and fix any new violations.

## Edge Cases

- **No active web tab / internal tab**: `openFind()` no-ops (guarded). No bar, no error.
- **Empty query**: no `findInPage` call; count blank; pressing `Enter` on empty is a no-op.
- **`finalUpdate` multi-fire**: the renderer reads each event and repaints live; intermediate
  updates are fine (no caching), the last one is `finalUpdate: true`.
- **Tab switch mid-search (race)**: race-guard prevents a backgrounded tab's event from
  repainting the visible bar; per-webview listener prevents lost events (AC10).
- **Lightbox open**: `Ctrl+F` suppressed; find `Esc` must not close the lightbox and vice-versa
  (AC6).
- **Tab closed/recreated while find-open**: the `{ findOpen, findText }` cache dies with the tab
  object; no dangling state.
- **`did-navigate` vs `did-navigate-in-page`**: only the former invalidates (AC9).

## Files Affected

- `src/renderer/index.html` — add `#find-bar` overlay markup inside `#main`.
- `src/renderer/styles.css` — find-bar styles (absolute top-right overlay, `.hidden`).
- `src/main/main.js` — `Ctrl+F` branch in the `before-input-event` handler (~`:357`),
  `send('open-find')`.
- `src/preload/chrome-preload.js` — `onOpenFind(cb)` bridge.
- `src/renderer/renderer.js` — open/close/runFind logic, `found-in-page` per-webview listener in
  `wireWebview` (`:663`), chrome-focused fallback in the keydown handler (`:2053`), `onNav`
  invalidation (`:721`), per-tab restore on activation, `{ findOpen, findText }` on the tab object.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (NOT `[COMPLETE:leg]` — review
and commit are deferred to the end of the flight):**

- [ ] All acceptance criteria verified (AC0 spike result recorded)
- [ ] `npm run a11y` clean (no new violations)
- [ ] Update flight-log.md with this leg's progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT commit, do NOT check off the flight, do NOT signal `[COMPLETE:leg]`
