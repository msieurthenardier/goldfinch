# Flight: Floating Overlay Find Bar

**Status**: in-flight
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC4 (UX enhancement)** — the find bar floats over the live guest instead of insetting it,
  removing the push-down the native-view surface forces on the current bar. (SC4-adjacent; not a mission
  landing gate — the mission lands without it, but it improves the conveniences surface SC4 covers.)

---

## Pre-Flight

### Objective

Replace the inset (push-down) find bar with a **floating overlay `WebContentsView`** stacked above the
active guest, so the find bar floats over the live page. The primitive is proven (an in-goldfinch WSLg
spike was green — the overlay paints its web content above the live guest, takes keyboard input, and the
page stays live). This flight builds it for real: a dedicated overlay view + page + preload; main owns
the overlay's lifecycle, positioning (centralized in the guest-bounds path), focus, and teardown; find
routing reuses the existing `found-in-page` path; the chrome `#find-bar` is retired.

### Origin

Surfaced during the Flight-4 HAT (operator asked to float the find bar); de-risked by a green in-goldfinch
spike; the first single-leg design was reviewed as flight-sized + needs-rework and spun out here. The
design below incorporates that review (the "Flight-7 seed" in the Flight-4 flight log). Recon (2026-07-01)
re-confirmed every integration point against current post-Flight-4 code — see the flight log.

### Open Questions
- [x] Overlay primitive feasible on WSLg? → **YES**, in-goldfinch spike green (see F4 log). See DD1.
- [x] How does count reach the overlay? → **Path B**: main's `wireTabViewEvents` `found-in-page`
  (`main.js:677`) fans the count **directly** to the overlay's `webContents` when find is overlay-active
  — no renderer round-trip. See DD3.
- [x] How is the overlay kept above the guest across tab switches? → `tab-set-active` (`main.js:1473`)
  re-adds the guest via `addChildView` (`:1486`); the overlay must be re-`addChildView`'d **after** the
  guest there. See DD2.
- [x] Where does freeze-hide/restore live? → hide the overlay on menu freeze; **restore in
  `unfreezeGuest`** (not the bounds handler — `sendActiveBounds` early-returns when `guestFrozen`). See
  DD5.
- [x] Sequencing vs the deferred Flight-4 corpus? → **Operator: proceed with F7 now**; fold the find
  verification in (update `tab-surface-geometry`'s find-bar step to float-not-inset); the rest of the F4
  corpus (unaffected by F7) runs later in an admin-wired session. See DD10.
- [ ] Does the overlay's own `webContents` need `readDom` access for the behavior spec, or is
  `captureWindow` + the guest-bounds tell sufficient? → resolved during the `find-overlay-geometry` spec's
  first run (apparatus-calibration). Recorded in Leg 4.

### Design Decisions

**DD1 — Overlay `WebContentsView` primitive (spike-proven).** A dedicated overlay view hosts the find
UI; `mainWindow.contentView.addChildView(overlay)` **after** the active guest z-orders it above (proven
green in-goldfinch). New surface: `src/renderer/find-overlay.html` + `find-overlay.js` (+ CSS, reusing the
`#find-bar` blocks) and `src/preload/find-overlay-preload.js`. Trust domain = chrome-class `file://`
(mirrors `chrome-preload.js`, no origin gate — the overlay is app chrome, not web content). Created lazily
on first find-open; reused via show/hide + add/removeChildView (not churned per open).
- Rationale: the only way to float live HTML over an opaque guest view; z-order is native, no CSS trick.
- Trade-off: a second `WebContents` (its own page/preload/focus/IPC) — the cost the review flagged.
- **Teardown (review):** hide/`removeChildView` the overlay when the last web tab closes or the active
  state goes all-internal (`tab-close` handler, `main.js:1434`); on window `closed` (`main.js:441`)
  explicitly `overlayView?.webContents?.destroy(); overlayView = null;` (mirrors the `chromeView` cleanup
  pattern). Assigned to Leg 1.

**DD2 — Position-sync in main's guest-bounds path (two IPC sites + the ResizeObserver).** The overlay
repositions to the **top strip** of the active guest's bounds at the two sites where main sets guest
bounds: `tab-set-active` (`:1473`, tab switch) and `tab-set-bounds` (`:1500`, bounds updates). Crucially,
`tab-set-bounds` is fed by BOTH `sendActiveBounds`→`tabSetBounds` (resize, click panel toggles) AND the
`#webviews` **ResizeObserver** (`renderer.js`, which fires `sendActiveBounds` as the panel CSS transition
settles). **Correction (review):** DD2 is NOT a "single choke point" — the **keyboard** panel toggles
(Ctrl+M / Ctrl+Shift+P, `renderer.js:~2591`) do **not** call `sendActiveBounds` directly; they rely on the
ResizeObserver, so the overlay tracks *after* layout settles (a mid-transition drift that already exists
for the inset bar, now more visible). Acceptable; not blocking. **Invariant:** on `tab-set-active`,
re-`addChildView(overlay)` **after** the guest add (`:1486`) — a guest re-add there buries the overlay
otherwise. Reuse the Flight-3 **DPR→DIP** discipline (`getBoundingClientRect()` is DIP on Chromium; test
at DPR≠1).
- Divert: if a guest-bounds change is found that does NOT reach `tab-set-active`/`tab-set-bounds` (nor the
  ResizeObserver), add the overlay reposition at that site too (record it).

**DD3 — Count delivery path B (main → overlay direct).** The overlay `query` → main → active guest
`wc.findInPage(...)` (reusing the existing find path). **Modify the existing `found-in-page` handler
inside `wireTabViewEvents` (`main.js:677`)** — it currently has one branch (`sendToChrome`); add a
**second** branch that, when find is overlay-active for this tab, also calls
`overlayView.webContents.send('find-overlay:count', { activeMatchOrdinal, matches })`. This is a
modification to the existing per-tab fan-out, not a standalone new function. **Overlay reference at event
time (review Q1):** `wireTabViewEvents` runs at tab construction, before the overlay exists (lazy). The
handler resolves the overlay via a **module-level `let overlayView = null`** (set on lazy creation) read
at event time — not captured at construction. Single-hop; no renderer round-trip.

**DD4 — IPC channel set (specified up front).**
- renderer → main: `find-overlay:open` `{ wcId, findText }` (show + seed), `find-overlay:close`.
- overlay → main: `find-overlay:query` `{ text, findNext, forward, matchCase }`, `find-overlay:close`.
- main → overlay: `find-overlay:init` `{ findText }` (seed on show), `find-overlay:count`
  `{ activeMatchOrdinal, matches }`.
- All chrome-class channels (same trust domain as `window.goldfinch`); the internal-tab exclusion is
  enforced at the guest-resolution point (find is web-tab-only), unchanged.

**DD5 — Freeze/find-open interaction: hide overlay on freeze, restore in `unfreezeGuest`.** When a chrome
menu opens (freeze) while find is open, hide (`removeChildView`) the overlay (it's a separate view above
the guest); restore it in `unfreezeGuest` — **not** the bounds handler, because `sendActiveBounds`
early-returns when `guestFrozen`. **Z-order re-assert on unfreeze (review):** `unfreezeGuest` calls
`window.goldfinch.tabSetActive(...)`, whose `tab-set-active` handler re-adds the guest via `addChildView`
(`:1486`) — which would sit **above** the overlay. So the `tab-set-active` handler's overlay re-assert
(DD2 invariant) must **re-add AND re-show** the overlay after the guest whenever find is active on a web
tab — this is the single mechanism that restores the overlay on unfreeze (unfreeze rides `tab-set-active`).
This also delivers the operator's earlier "find should hide when a context menu appears" instinct.

**DD6 — Focus retargeted to the overlay.** On open, `overlayView.webContents.focus()` (the overlay page
autofocuses its input) — this supersedes the Flight-4 chrome-view Ctrl+F focus fix for find. **Cutover
must update `main.js:585` (review):** the `before-input-event` Ctrl+F branch currently does
`getChromeContents()?.focus()` then `send('open-find')` — after F7 that focuses the *chrome* right before
the overlay should get focus (redundant/conflicting). Leg 3 removes the `getChromeContents()?.focus()`
line (main focuses the overlay directly on `find-overlay:open`). On close, focus returns to the guest.
The focus-then-act rule still holds — now targeting the overlay.

**DD7 — Overlay removed on internal tabs (`isInternalTab(activeTab())`).** Whenever the active tab is
internal `goldfinch://`, the overlay is taken **out of the view stack** — `removeChildView(overlay)`, not
merely `setVisible(false)` (review: a hidden-but-present sibling view still occupies the compositing stack;
`removeChildView` is unambiguous and avoids any platform hit-test/z-order artifact). Gate *presence*, not
just find-routing. **Leg-1 checkpoint** confirms on-screen that an internal tab shows no overlay artifact.

**DD8 — No inset: the bar floats.** Remove the find-bar branch from the guest top-inset computation
(`computeTopInsetDIP`/`measureWebviewsSlotWithInsetDIP` in `renderer.js`) so the guest stays full-size;
the overlay floats over the top strip. **Confirmed (review): find is the ONLY inset contributor** — the
function comment already states site-info uses freeze-frame, and there is no other inset accumulator. So
after Leg 3, `computeTopInsetDIP` returns 0 unconditionally and `measureWebviewsSlotWithInsetDIP` becomes
identical to `measureWebviewsSlotDIP` — Leg 3 simplifies/inlines both to `measureWebviewsSlotDIP()` at all
call sites rather than leaving dead branches.

**DD9 — Per-tab find state stays in the renderer.** `findText`/`findOpen` remain per-tab in the chrome
renderer (the tab model lives there). On open/close/tab-switch the renderer drives the overlay
show/hide/seed via main (`find-overlay:open`/`close` carrying the active tab's `findText`). Keeps the tab
model single-sourced; main owns only the overlay view + routing.

**DD10 — Verification = HAT + a new `find-overlay-geometry` behavior spec** (operator choice), with the
**apparatus-wiring litmus** prerequisite (the Flight-4 lesson: confirm the MCP client is bound to *this*
instance at the admin tier before any Witnessed run). Also **update `tab-surface-geometry`'s find-bar
step** from inset to float-not-inset (F7 obsoletes the inset assertion). The rest of the deferred F4
corpus is unaffected and runs later.

**DD11 — Retire the chrome `#find-bar` at cutover.** Remove `#find-bar` markup (`index.html:135-148`),
its CSS (`styles.css:556-606`), and the in-chrome find handlers that move to the overlay. The overlay is
the sole find UI.

**DD12 — a11y carries over.** The `role="search"`, the `aria-live`/`aria-atomic` count region, and the
button labels move to `find-overlay.html` intact; `npm run a11y` runs on the new surface in the wired
session (it's a live gate).

### Prerequisites
- [ ] App launches via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  `GOLDFINCH_AUTOMATION_ADMIN=1` + a pinned free `GOLDFINCH_MCP_PORT` (port-conflict check at run time).
- [ ] **Apparatus-wiring litmus (Flight-4 carry-forward):** before any `find-overlay-geometry` Witnessed
  run, confirm the session's goldfinch MCP client is wired to **this** flight instance at the **admin**
  tier — litmus: `getChromeTarget()` returns a chrome wcId and `enumerateTabs()` lists *this* instance's
  tabs (not a foreign session's). If it fails, the spec parks (HAT still proceeds).
- [x] Flight branches `flight/07-find-overlay-view` off the mission branch (not `main`). *(2026-07-02)*

### Pre-Flight Checklist
- [x] All open questions resolved or assigned to a leg
- [x] Design decisions documented
- [x] Prerequisites verified *(2026-07-02: branch created; app launches + apparatus wiring litmus
  passed in all three legs' live verification; HAT-leg litmus re-checked at Leg 4)*
- [x] Validation approach defined
- [x] Legs defined *(design-reviewed 2026-07-01)*

---

## In-Flight

### Technical Approach

Build the overlay view + page + preload; main creates it lazily, positions it in the guest-bounds path
(re-adding above the guest on tab switch), fans the find count to it directly, hides it on internal tabs
and during freeze (restoring in `unfreezeGuest`), and focuses it on open. The renderer keeps per-tab find
state and drives show/hide/seed via main; the inset is removed so the bar floats; the chrome `#find-bar`
is retired. Verified by an interactive HAT + a new `find-overlay-geometry` Witnessed spec (apparatus-wiring
litmus first).

### Checkpoints
- [x] Overlay view stacks above the live guest, tracks geometry across resize/maximize/panel/tab-switch,
  is hidden on internal tabs and during menu freeze (restored on unfreeze) — **no find routing yet**.
- [x] Find works through the overlay: incremental search, Enter/Shift+Enter + ↑/↓ stepping, buttons,
  Esc/close; count via path B; per-tab restore; focus lands in the overlay input on open.
- [x] Chrome `#find-bar` retired; guest no longer inset for find; no dead inset code; `find-in-page.md`
  + `tab-surface-geometry` find-bar step updated. `npm test`/`typecheck`/`lint` green.
- [ ] HAT passed + `find-overlay-geometry` PASS (or operator-accepted known issue) in an admin-wired
  session; `npm run a11y` green on the new surface.

### Adaptation Criteria
**Divert if**:
- The overlay destabilizes on a specific geometry trigger not covered by the guest-bounds path → add the
  reposition at that site; if position-sync proves unreliable on WSLg beyond inline-fixable, park the
  cutover (keep the inset `#find-bar` as the shipped bar) and record — the overlay is an enhancement, not
  a mission gate.
- The `find-overlay-geometry` apparatus proves un-observable as authored → fix the apparatus (or fall
  back to HAT-only for the affected checkpoint), record.

**Acceptable variations**:
- Overlay theming refinements during the HAT.
- Minor reordering of the cutover relative to the routing leg.

### Legs

> **Note:** Tentative; planned one at a time. Staged per operator choice (3 build legs + HAT).

- [x] `scaffold-overlay` — new `find-overlay.html`/`.js`/`.css` + `find-overlay-preload.js`; main creates
  the overlay view (lazy, module-level `overlayView`), positions it in the `tab-set-active`/`tab-set-bounds`
  path (re-add **and re-show** after the guest add at `:1486`; DPR→DIP), **`removeChildView` on internal
  tabs** (DD7 — Leg-1 checkpoint confirms no artifact), `removeChildView` on freeze / re-assert on
  unfreeze via the `tab-set-active` re-add (DD5), and **teardown** (hide/remove on last-web-tab-close /
  all-internal; `destroy()` on window `closed`). Prove the view stacks + tracks + hides/removes correctly
  with a static (non-wired) bar UI. No find routing.
- [x] `find-routing-and-count` — wire the DD4 IPC set: overlay `query` → main → guest `findInPage`; **add
  the count path-B branch inside the `found-in-page` handler in `wireTabViewEvents` (`main.js:677`)** →
  `overlayView.webContents.send('find-overlay:count', …)`; per-tab `open`/`init`/`close`; focus to overlay;
  incremental + Enter/Shift+Enter + ↑/↓ stepping + buttons + Esc.
- [x] `cutover` — retire the chrome `#find-bar` (markup + CSS); re-point `openFind`/`closeFind` to drive
  the overlay via main (remove ALL `els.findBar`/`els.findInput`/`els.findCount` refs from them) **and the
  `activateTab` per-tab find-restore (`renderer.js:~840-852`)** so it calls the overlay path, not the
  retired DOM (avoid a half-cutover); **update `main.js:585`** (remove `getChromeContents()?.focus()`,
  DD6); remove the find inset — **simplify `computeTopInsetDIP`/`measureWebviewsSlotWithInsetDIP` to
  `measureWebviewsSlotDIP()`** (DD8); update `find-in-page.md` + `tab-surface-geometry`'s find-bar step
  (float-not-inset).
- [ ] `hat-and-alignment` *(optional — operator opted in)* — guided HAT (float-not-inset, position-sync,
  internal-tab hidden, freeze-hide/restore, focus, stepping) + run `/behavior-test find-overlay-geometry`
  (apparatus-wiring litmus first) + `npm run a11y` on the new surface.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged (flight branch → mission branch, local; `main` untouched)
- [ ] Tests passing (`npm test` / `typecheck` / `lint`; `a11y` on the wired session)
- [ ] Documentation updated (`find-overlay.*` surface; `find-in-page.md` + `tab-surface-geometry` steps;
  CLAUDE.md find-bar architecture note → overlay)

### Verification
The overlay find bar floats over the live guest (guest not inset), tracks geometry across
resize/maximize/panel/tab-switch, is hidden on internal tabs and during menu freeze (restored on
unfreeze), focuses on open, and steps/searches correctly — confirmed by the HAT and the
`find-overlay-geometry` Witnessed spec (apparatus-wiring litmus first), with `npm run a11y` green.
