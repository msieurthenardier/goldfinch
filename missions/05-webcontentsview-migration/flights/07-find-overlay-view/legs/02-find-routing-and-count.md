# Leg: find-routing-and-count

**Status**: completed
**Flight**: [Floating Overlay Find Bar](../flight.md)

## Objective

Wire find through the overlay: the DD4 IPC set (overlay `query` → main → guest `findInPage`; count
path B main → overlay direct), a real overlay find session replacing the Leg-1 dev stand-in, focus to
the overlay on open (DD6), and the full overlay-page UI behavior (incremental search,
Enter/Shift+Enter, ↑/↓ stepping, buttons, Esc/close) — behind a dev-gated Ctrl+F stimulus; the chrome
`#find-bar` and all renderer behavior stay untouched (cutover is Leg 3).

## Context

- **DD3 — count path B**: the count reaches the overlay by a **second branch added to the existing
  `found-in-page` handler inside `wireTabViewEvents`** (`src/main/main.js:753-754` post-Leg-1) —
  `overlayView.webContents.send('find-overlay:count', { activeMatchOrdinal, matches })` when the find
  session targets this tab. The existing `sendToChrome('tab-found-in-page', …)` branch stays (the
  chrome bar is live until Leg 3). `overlayView` is resolved at event time via the Leg-1 module-level
  `let overlayView` (`main.js:157`) — never captured at tab construction.
- **DD4 — channel set**: renderer→main `find-overlay:open` `{ wcId, findText }` / `find-overlay:close`;
  overlay→main `find-overlay:query` `{ text, findNext, forward, matchCase }` / `find-overlay:close`;
  main→overlay `find-overlay:init` `{ findText }` / `find-overlay:count`. All chrome-class trust.
- **DD6 — focus**: on open, `overlayView.webContents.focus()` + the overlay page focuses/selects its
  input. On close, focus returns to the target guest. (The `main.js:661` chrome-focus strip is Leg 3.)
- **DD9 — per-tab find state stays in the renderer**: this leg does NOT move `findText`/`findOpen`.
  Main holds only the live overlay find session (which tab the overlay currently targets).
- **Leg-1 seams consumed here**: `isFindOverlayActive()` (`main.js:166`) gets a real body;
  `showFindOverlay`/`hideFindOverlay` (`main.js:193/208`) are reused as-is; the `tab-set-active`
  overlay branch (`main.js:1584-1588`) is retargeted to session state.
- **Trigger (design refinement, recorded in the flight log):** the flight assigns the renderer
  re-point (`openFind`/`closeFind` → overlay) to Leg 3, so nothing calls `find-overlay:open` from the
  chrome renderer yet. To keep this leg end-to-end verifiable, the Leg-1 env var is **narrowed, not
  deleted**: `GOLDFINCH_FIND_OVERLAY_DEV=1` now gates ONLY the Ctrl+F stimulus in main's
  `before-input-event` branch (`main.js:655-662`) — env set → `openFindOverlaySession(contents.id, '')`
  instead of chrome-focus + `send('open-find')`; env unset → today's path byte-for-byte. Leg 3 deletes
  the env var entirely. Similarly, the chrome-preload bridge methods (`findOverlayOpen`/
  `findOverlayClose`) move to Leg 3 with their consumers — this leg registers the main-side
  `ipcMain` handlers so the DD4 contract is complete and testable, without dead preload surface.
  Both are within the flight's "minor reordering of the cutover relative to the routing leg".
- Behavior parity anchors (the overlay must match the chrome bar): count renders
  `` `${activeMatchOrdinal}/${matches}` `` or `0/0` (`src/renderer/renderer.js:2793-2800`); empty
  text → blank count, NO `stopFindInPage` (`renderer.js:2082-2091` `runFind`); keyboard map
  Enter/Shift+Enter/ArrowDown/ArrowUp/Escape (`renderer.js:2148-2169`); prev/next buttons suppress
  focus-steal via `mousedown` preventDefault (`renderer.js:2174-2175`); default find options
  `{ findNext: false, forward: true, matchCase: false }` (`renderer.js:2090`).

## Inputs

- Leg 1 landed (uncommitted): overlay view lifecycle in `src/main/main.js` (module state
  `main.js:157-166`, helpers `:169-214`, closed-teardown `:515-519`, handler touches
  `:1523-1525` tab-close, `:1532` tab-hide, `:1584-1588` tab-set-active, `:1611-1613`
  tab-set-bounds); static overlay page `src/renderer/find-overlay.{html,css,js}`; stub preload
  `src/preload/find-overlay-preload.js`.
- `src/main/main.js:655-662` — Ctrl+F `before-input-event` branch (guest-focused capture; internal
  sessions pre-excluded by the outer `__goldfinchInternal` skip).
- `src/main/main.js:716` `wireTabViewEvents`; `:753-754` `found-in-page` → `tab-found-in-page`.
- `src/main/main.js:1618` `tab-find` handler — the `stopFindInPage('clearSelection')` idiom to reuse.

## Outputs

- Modified: `src/main/main.js` (find session state + open/close/query handlers + count branch +
  stimulus reroute), `src/preload/find-overlay-preload.js` (query/close/onInit/onCount channels),
  `src/renderer/find-overlay.js` (full UI wiring).
- NOT modified: `src/renderer/renderer.js`, `src/preload/chrome-preload.js`, `index.html`,
  `styles.css` (all Leg 3).
- Behavior: env set → Ctrl+F on a web page opens the overlay find bar focused; typing searches
  incrementally with a live count; Enter/Shift+Enter/↑/↓/buttons step; Esc/✕ closes and returns focus
  to the page. Env unset → today's behavior, unchanged.

## Acceptance Criteria

- [x] **AC1 — Session state replaces the dev stand-in.** A module-level find-overlay session (e.g.
  `let findOverlayTabWcId = null`) is the single source of "overlay find is open, targeting tab X".
  `isFindOverlayActive()` (`main.js:166`) becomes `isFindOverlayActive(wcId)` → `wcId != null &&
  wcId === findOverlayTabWcId` (callers updated); `FIND_OVERLAY_DEV` no longer drives blanket
  visibility — it gates only the Ctrl+F stimulus.
- [x] **AC2 — DD4 main-side handlers.** `ipcMain.on('find-overlay:open')` (sender must be the chrome
  webContents; payload `{ wcId, findText }`; refuses internal tabs — `tabViews` entry `trusted` — and
  unknown/destroyed wcIds), `ipcMain.on('find-overlay:close')` (sender: chrome OR overlay),
  `ipcMain.on('find-overlay:query')` (sender: overlay ONLY). Open/close route through shared
  `openFindOverlaySession(wcId, findText)` / `closeFindOverlaySession()` functions also callable from
  main (the Ctrl+F stimulus uses them directly).
- [x] **AC3 — Query → findInPage.** `find-overlay:query` `{ text, findNext, forward, matchCase }`
  resolves the session's target guest and calls `wc.findInPage(text, { findNext, forward, matchCase })`
  with the chrome-bar default options; empty `text` → blank count locally page-side, no
  `stopFindInPage` issued (parity with `runFind`, `renderer.js:2082-2091`); stale/destroyed target →
  no-op.
- [x] **AC4 — Count path B.** The `found-in-page` handler in `wireTabViewEvents` (`main.js:753-754`)
  gains a second branch: when `wcId === findOverlayTabWcId` and the overlay exists, send
  `find-overlay:count` `{ activeMatchOrdinal, matches }` to the overlay webContents. The existing
  `sendToChrome` branch is untouched. Overlay renders `n/m` or `0/0` (parity with
  `renderer.js:2793-2800`).
- [x] **AC5 — Focus (DD6).** On open: `overlayView.webContents.focus()` and the overlay page focuses +
  selects its input (including on the very first open — see AC7). On **explicit** close (Esc / ✕ →
  `find-overlay:close`): focus returns to the session's guest (`wc.focus()`) and
  `stopFindInPage('clearSelection')` clears the highlight (chrome bar parity,
  `renderer.js:2125-2137`). On **implicit** close (tab-switch, tab-close, window teardown): the
  highlight is still cleared but focus is NOT touched — keyboard focus remains where the user was
  (e.g. mid-arrow-navigation on the tab strip, a pinned keyboard-nav contract). Refocusing the old
  guest there would land OS focus on a hidden view.
- [x] **AC6 — Session lifecycle.** (a) `tab-set-active` to a DIFFERENT tab than the session target
  closes the session (stopFind clearSelection on the old guest, hide, clear state, NO refocus — AC5) —
  internal or web alike; (b) `tab-set-active` to the SAME target (the unfreeze path, DD5) re-shows the
  overlay after the guest re-add — session survives freeze; (c) `tab-hide` of the target hides the
  overlay but keeps the session (freeze); (d) `tab-close` of the target clears the session (no
  refocus; the stopFind must tolerate the guest mid-destruction); (e) re-open (Ctrl+F) while the
  session is already open for the active tab re-focuses the overlay WITHOUT re-seeding `init` (don't
  wipe what the user typed); (f) window `closed` teardown (`main.js:515-519`) also clears the session
  state (no refocus).
- [x] **AC7 — First-open init race + crash recovery.** On the first open the overlay page may not have
  finished loading; `find-overlay:init` + focus are deferred until the page is ready (one-shot
  `did-finish-load`) so the seed/focus are never lost. Crash recovery: a `render-process-gone`
  listener installed at construction tears the overlay down (destroy + `overlayView = null` +
  `overlayVisible = false` + ready-flag reset + session cleared) so the next open recreates cleanly —
  note a plain `isDestroyed()` guard does NOT cover this (after `render-process-gone` the
  `WebContents` object is alive), which is why the listener is required. The ready flag is reset on
  every null/recreate, and any queued one-shot init attaches to the NEW webContents.
- [x] **AC8 — Overlay UI complete.** `find-overlay.js` wires: `input` → incremental query
  (`findNext: false`); Enter/Shift+Enter → step forward/back; ArrowDown/ArrowUp → step; prev/next
  buttons (with `mousedown` preventDefault focus-steal suppression); ✕ button and Esc → close; count
  from `onCount`; seed + focus + select from `onInit`. Preload exposes exactly
  `query`/`close`/`onInit`/`onCount` (+ the Leg-1 `platform`).
- [x] **AC9 — Zero renderer/chrome change.** `git diff` shows NO changes to `src/renderer/renderer.js`,
  `src/preload/chrome-preload.js`, `src/renderer/index.html`, `src/renderer/styles.css`. With the env
  var unset, Ctrl+F behavior is today's (chrome focus + `open-find`), and no overlay session can ever
  open.
- [x] **AC10 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Verification Steps

- AC1/AC2/AC4: grep — `findOverlayTabWcId` single definition; `ipcMain.on('find-overlay:` × 3;
  sender-validation present in each; second branch inside the `wireTabViewEvents` `found-in-page`
  handler (not a new standalone listener).
- AC3/AC5/AC6/AC8 (live): `GOLDFINCH_FIND_OVERLAY_DEV=1` + `dev:automation` (dev mint, admin, pinned
  port — the Leg-1 apparatus, wiring litmus first). Drive Ctrl+F into the focused guest (the MCP input
  op / `sendInputEvent` path — `before-input-event` fires for synthetic input; if the apparatus can't
  deliver a chorded key to the guest, fall back to invoking the session open directly at the IPC seam
  and record the substitution). Then: type a term present on the page → count `n/m` via pixel capture
  of the overlay; step with Enter/buttons → ordinal advances; open kebab menu → overlay gone, close →
  overlay back with text + count intact (freeze survival, AC6b/c); switch tab → session closed (AC6a);
  Ctrl+F again → fresh open; Esc → closed, highlight cleared, page focused. Interactive checks the
  apparatus cannot drive (e.g. real keystrokes into the overlay input) are **deferred-to-HAT** (Leg 4
  runs the full interactive pass on-screen) — record exactly which were deferred in the flight log.
- AC7: kill + relaunch, make the very first action Ctrl+F → overlay opens seeded/focused (no lost
  init) — verify via the observable (input focused/selected on cold start), not log lines.
- AC9: `git diff --stat` inspection; env-unset relaunch → Ctrl+F opens the inset bar as today.
- AC10: `npm test && npm run typecheck && npm run lint` (with timeouts; fail fast).

## Implementation Guidance

1. **Session state + shared open/close (main.js, next to the Leg-1 overlay block `:149-214`).**
   ```js
   let findOverlayTabWcId = null;   // wcId of the tab the overlay find session targets (null = closed)
   function isFindOverlayActive(wcId) { return wcId != null && wcId === findOverlayTabWcId; }
   ```
   `openFindOverlaySession(wcId, findText)`:
   - entry = `tabViews.get(wcId)`; refuse if absent/`trusted`/destroyed (find is web-tab-only, DD4);
   - already open for this wcId → `overlayView.webContents.focus()` and return (AC6e — no re-init);
   - already open for a DIFFERENT wcId → `closeFindOverlaySession({ refocusGuest: false })` first
     (clears the old guest's highlight; unreachable via this leg's stimulus but makes the seam safe
     for Leg 3's renderer-driven opens);
   - set `findOverlayTabWcId = wcId`; `showFindOverlay()`; then **init-when-ready** (step 2) sends
     `find-overlay:init` `{ findText }` and focuses the overlay webContents.
   `closeFindOverlaySession({ refocusGuest })`:
   - no-op when closed; `getTabContents(findOverlayTabWcId)` live → `stopFindInPage('clearSelection')`
     (idiom at `main.js:1618-1621`, destroyed-guarded); `if (refocusGuest) wc.focus()` — **true ONLY
     from the explicit-close path** (`find-overlay:close`); false from `tab-set-active`, `tab-close`,
     window `closed` (AC5 — refocusing there lands OS focus on a hidden view and steals focus from
     tab-strip keyboard nav); `hideFindOverlay()`; `findOverlayTabWcId = null`.

2. **Init-race handling + crash recovery (AC7).** In `ensureFindOverlayView()` (`main.js:169`):
   - destroyed-recreate guard (`if (overlayView && overlayView.webContents.isDestroyed())
     overlayView = null;`) before the existing early-return;
   - at construction, install `render-process-gone` → full teardown (destroy the webContents if not
     already gone, `overlayView = null`, `overlayVisible = false`, ready flag reset,
     `findOverlayTabWcId = null`) — required because after `render-process-gone` the WebContents is
     NOT destroyed and an `isDestroyed()` guard alone would re-show a dead view;
   - readiness: a module flag set by a `did-finish-load` listener installed at construction; **reset
     the flag whenever `overlayView` is nulled/recreated**, and attach any queued one-shot init to the
     NEW webContents. `openFindOverlaySession` sends init+focus immediately when ready, else queues a
     one-shot for `did-finish-load`. Keep it to one pending init (latest wins).

3. **DD4 ipcMain handlers (main.js, near the tab-view IPC block).**
   - `find-overlay:open` — `if (event.sender !== getChromeContents()) return;` then
     `openFindOverlaySession(wcId, typeof findText === 'string' ? findText : '')`.
   - `find-overlay:close` — accept `event.sender === getChromeContents()` OR
     `overlayView?.webContents`; `closeFindOverlaySession({ refocusGuest: true })` (the ONLY
     refocusing close path).
   - `find-overlay:query` — `if (!overlayView || event.sender !== overlayView.webContents) return;`
     resolve `wc = getTabContents(findOverlayTabWcId)`; empty/non-string `text` → return (page blanks
     its own count); else `wc.findInPage(text, { findNext: !!findNext, forward: forward !== false,
     matchCase: !!matchCase })`.

4. **Count path B (DD3) — modify `main.js:753-754`,** inside the existing `found-in-page` guard:
   ```js
   wc.on('found-in-page', guard((_e, result) => {
     sendToChrome('tab-found-in-page', { wcId, result });
     if (isFindOverlayActive(wcId) && overlayView && !overlayView.webContents.isDestroyed()) {
       overlayView.webContents.send('find-overlay:count', {
         activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches });
     }
   }));
   ```

5. **Retarget the Leg-1 handler touches.**
   - `tab-set-active` (overlay branch at `main.js:1582-1589`, including the `entry.trusted` line):
     replace the `else if (isFindOverlayActive())` branch — new logic: if a session exists and
     `wcId !== findOverlayTabWcId` → `closeFindOverlaySession({ refocusGuest: false })` (AC6a; covers
     internal tabs too — the session must CLOSE, not merely hide; NO refocus — the new guest was
     already added/raised at `main.js:1577` before this branch runs, and refocusing the OLD guest
     would land focus on a view about to be hidden); if `isFindOverlayActive(wcId)` →
     `lastGuestBounds` update + `showFindOverlay()` as Leg 1 wrote it (AC6b, DD5 unfreeze).
   - `tab-hide` (`main.js:1532`): unchanged (hide only — session survives, AC6c).
   - `tab-close` (`main.js:1523-1525`): when the closed wcId is the session target →
     `closeFindOverlaySession({ refocusGuest: false })`, placed with the existing overlay lines AFTER
     `tabViews.delete(wcId)` — the target guest is being destroyed; the stopFind inside close must
     tolerate that (destroyed-guard already in step 1). Keep the Leg-1 no-web-tab-left
     `hideFindOverlay()` as a belt-and-suspenders after the session close.
   - window `closed` (`main.js:515-519`): add `findOverlayTabWcId = null;` + ready-flag reset (no
     refocus concern — everything is tearing down).

6. **Stimulus reroute (Ctrl+F branch, `main.js:653-664`; load-bearing lines `:661-662`).** Inside
   the branch:
   ```js
   if (FIND_OVERLAY_DEV) { openFindOverlaySession(contents.id, ''); }
   else { getChromeContents()?.focus(); getChromeContents()?.send('open-find'); }
   ```
   Update the `FIND_OVERLAY_DEV` comment block (`main.js:162-166`) to describe the narrowed scope and
   that Leg 3 deletes it.

7. **Preload (`find-overlay-preload.js`).** Add `ipcRenderer`; expose
   `query: (payload) => ipcRenderer.send('find-overlay:query', payload)`,
   `close: () => ipcRenderer.send('find-overlay:close')`,
   `onInit: (cb) => ipcRenderer.on('find-overlay:init', (_e, d) => cb(d))`,
   `onCount: (cb) => ipcRenderer.on('find-overlay:count', (_e, d) => cb(d))`.
   Stays in the eslint node-globals block (DD1 contract note is inline there).

8. **Overlay page (`find-overlay.js`).** Mirror the chrome bar's handlers
   (`renderer.js:2141-2185` shape): local `let text = ''`; `input` event → `text = input.value`;
   empty → `count.textContent = ''` (NO query — parity); else `query({ text, findNext: false,
   forward: true, matchCase: false })`. Keydown: Enter → `findNext: true, forward: !shiftKey`;
   ArrowDown/ArrowUp → forward/back; Escape → `close()`; all preventDefault, all no-op on empty text.
   Buttons: prev/next click → step (guard empty), `mousedown` preventDefault on both; ✕ → `close()`.
   `onInit({ findText })` — **full open-parity with `openFind` (`renderer.js:2110-2118`)**: empty
   seed → clear input AND blank the count (a stale count from a prior session must not survive a
   fresh open); non-empty seed → seed input + `text` AND issue `query({ text, findNext: false,
   forward: true, matchCase: false })` so the highlight/count appear (Leg 3 passes real `findText` —
   without this the seed would show with no highlight); focus + select the input in both cases.
   Reset-on-next-open is the contract — there is NO separate reset channel; session close is
   main-side only. `onCount({ activeMatchOrdinal, matches })` →
   `matches ? `${activeMatchOrdinal}/${matches}` : '0/0'`. Also handle Ctrl/Cmd+F inside the overlay
   → re-select the input (cheap parity with standard find bars; main's stimulus only fires on guest
   focus). Note for typecheck: this document has `window.findOverlay`, not `window.goldfinch` — do
   not reference the latter (the project-wide d.ts makes it *appear* typed here; it is absent at
   runtime). Preferably add `// @ts-check` plus a small local shim (e.g.
   `src/renderer/find-overlay-globals.d.ts` declaring `window.findOverlay`) so typecheck actually
   covers the page module; if that fights the jsconfig setup, match the repo's existing pattern and
   record which.

## Edge Cases

- **Query after target destroyed** (tab closed between keystrokes): destroyed-guard no-op (AC3).
- **Query while frozen**: the guest is hidden but live; `findInPage` is harmless — allow it (count
  updates land when the overlay re-shows).
- **Sender spoofing**: every handler validates `event.sender` (step 3) — a guest page must never be
  able to open/drive the overlay.
- **Double Ctrl+F**: AC6e — re-focus only, never re-seed (would wipe the user's typed text).
- **Ctrl+F on internal tab**: unreachable — the `before-input-event` wiring is inside the
  `!__goldfinchInternal` guard (`main.js:617-620` region); `openFindOverlaySession` refuses `trusted`
  entries anyway (defense in depth).
- **Overlay crash mid-session**: `render-process-gone` on the overlay → next open recreates (AC7
  guard); the in-flight session may drop — acceptable, record if observed.
- **`found-in-page` for a non-target tab** (stale result after fast tab switch): the
  `isFindOverlayActive(wcId)` guard in step 4 drops it.
- **Known dev-gate gap (not a defect)**: the Ctrl+F stimulus always seeds `''`, so close-then-reopen
  loses prior search text — per-tab `findText` restore is renderer-owned (DD9) and arrives with
  Leg 3. The Leg 4 HAT must not file this as a bug against this leg.
- **Unfreeze focus (HAT observation)**: after a menu close re-shows the overlay, its input does not
  regain OS focus (focus stays in the chrome) — roughly parity with the inset bar. Flag for a
  deliberate judgment at the HAT rather than silently shipping either way.

## Files Affected

- `src/main/main.js` — session state, open/close/query handlers, count branch, stimulus reroute,
  handler retargets
- `src/preload/find-overlay-preload.js` — DD4 channels
- `src/renderer/find-overlay.js` — full UI wiring

## Workaround Log

- **`GOLDFINCH_FIND_OVERLAY_DEV` narrowed (was: blanket visibility; now: Ctrl+F stimulus gate).**
  **Why**: the renderer re-point is Leg 3's cutover; without a stimulus this leg's routing would be
  unverifiable end-to-end. **Removed**: Leg 3 deletes the env var and makes the overlay path
  unconditional (renderer-driven).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit are
deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (interactive checks the apparatus can't drive recorded as
  deferred-to-HAT in the flight log)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against the working tree (post-Leg-1, uncommitted) at leg design time (2026-07-02):

- `src/main/main.js:157` `let overlayView = null` (module-level, DD3 comment at `:152-153`) — **OK**
- `src/main/main.js:166` `isFindOverlayActive()` Leg-2 seam — **OK**
- `src/main/main.js:169-187` `ensureFindOverlayView()` — **OK**
- `src/main/main.js:193-214` `showFindOverlay`/`hideFindOverlay` — **OK**
- `src/main/main.js:515-519` window-`closed` overlay destroy + null-out — **OK**
- `src/main/main.js:655-662` Ctrl+F branch (`getChromeContents()?.focus()` at `:661`,
  `send('open-find')` at `:662`) — **OK**
- `src/main/main.js:716` `wireTabViewEvents`; `:753-754` `found-in-page` → `sendToChrome` — **OK**
- `src/main/main.js:1523-1525` tab-close `wasActive`/`anyWebTabLeft` hides — **OK**
- `src/main/main.js:1532` tab-hide overlay hide — **OK**
- `src/main/main.js:1584-1588` tab-set-active overlay branch — **OK**
- `src/main/main.js:1611-1613` tab-set-bounds reposition — **OK**
- `src/main/main.js:1618` `tab-find` (`stopFindInPage(options || 'clearSelection')`) — **OK**
- `src/renderer/renderer.js:2082-2091` `runFind` empty-text parity — **OK**
- `src/renderer/renderer.js:2125-2137` `closeFind` stop + clearSelection parity — **OK**
- `src/renderer/renderer.js:2148-2169` find keydown map — **OK**
- `src/renderer/renderer.js:2174-2175` button `mousedown` preventDefault — **OK**
- `src/renderer/renderer.js:2793-2800` count format `n/m` / `0/0` — **OK**

17 citations verified against the post-Leg-1 working tree; no drift. Design review (2026-07-02,
Developer agent, approve-with-changes) re-verified all 17 and corrected two cosmetic ranges (Ctrl+F
branch spans `:653-664`; tab-set-active overlay branch spans `:1582-1589`) — both updated in place.
Review issues incorporated: refocus-flagged session close (high), `onInit` open-parity + reset-on-open
contract (medium), `render-process-gone` crash recovery (medium), ready-flag lifecycle + verification
observable + ranges (low).
