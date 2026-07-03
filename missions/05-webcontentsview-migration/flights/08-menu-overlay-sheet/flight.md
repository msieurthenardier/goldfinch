# Flight: Menu Overlay Sheet

**Status**: in-flight
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria

- [ ] **SC3/SC4-adjacent (menus at parity on a better mechanism)** — all five chrome menu surfaces keep
  their behavior while the freeze-frame mechanism beneath them is replaced; not a mission landing gate
  (same class as Flight 7).
- [ ] **Known-issue retirement** — the WSLg internal-tab menu-open blip (F3 carry), the freeze-frame
  capture-latency risk (F3 02b AC1), frozen-page staleness (video/animation halts under any menu), and
  Flight 7's "focus doesn't return to overlay after unfreeze" known item are all structurally retired
  when the freeze is deleted.
- [ ] **Flight-9 enabler** — the media/privacy panel flight inherits a menu-free freeze story (no
  DD5-class hide/restore interplay to design against) and a second proven overlay consumer.

---

## Pre-Flight

### Objective

Replace the freeze-frame HTML-menu mechanism (capture guest → paint still → hide live view → chrome DOM
menu at z:60) with a single transparent **menu overlay sheet**: a lazy-singleton `WebContentsView`
covering the guest region, stacked above the live guest, hosting all five menu surfaces (kebab ⋮,
container ▾, page context menu, toolbar-unpin mode, site-info 🔒) as ordinary DOM/CSS inside one page.
The guest stays live and visible through the sheet's transparency; clicks outside a menu land in the
sheet, dismiss the menu, and are swallowed — exact parity with today's dismissal semantics. At cutover
the entire freeze apparatus (`freezeGuest`/`unfreezeGuest`, `capture-active-guest`, the `guestFrozen`
bounds guard, the chrome menu DOM/CSS) is deleted.

### Open Questions

- [x] Mechanism direction (cheaper "pause hit-testing" vs overlay views) → **DD1**
- [x] Overlay shape (sized-to-menu vs full-guest sheet) → **DD2**
- [x] Menu sizing protocol → dissolved by DD2/DD10 (CSS inside the sheet)
- [x] Find bar visible under an open menu? → **DD5** (hidden — parity, operator decision)
- [x] a11y audit coverage after menus leave chrome DOM → **DD6** (preserved via wcId injection)
- [x] Scope: all surfaces in one flight vs staged → **DD3** (all five)
- [ ] **WSLg full-guest transparency** — does a guest-sized transparent `WebContentsView` composite
  correctly over the live guest on WSLg? *Resolved by the Leg-1 pixel probe (Checkpoint 1). This is a
  gate with a recorded fallback (DD2), not a blocking unknown.*
- [ ] **`#new-container-dialog` disposition** — design-review resolved the mechanism question: the
  inline "New container…" dialog is **not** a freeze consumer (it opens *after* `closeContainerMenu()`
  → `unfreezeGuest()` — `src/renderer/renderer.js:238-242`) and it is `position:fixed; inset:0;
  z-index:80` chrome DOM (`styles.css:1348+`, `index.html:58`) — so today it is most likely **already
  occluded by the live guest** in the guest region: a latent pre-existing defect, not a Flight-8
  blocker. **Operator confirmed the defect is real (2026-07-02: "the new container dialog is
  broken").** Remaining open (Leg 3, operator call): fix it via the sheet (render the dialog in the
  sheet — parity-plus-correctness, adds scope) or accept-and-record as a known issue.

### Design Decisions

**DD1 — Commit to overlay views; retire freeze-frame outright**
- The Flight-7 debrief (Key Learning 5) recommended investigating a cheaper "pause guest hit-testing"
  mechanism first, with menus-as-overlays as fallback. **Considered and overridden by operator decision
  (2026-07-02)**: that recommendation predates full confidence in the Flight-7 result; the overlay
  primitive is now proven end-to-end (shipped, HAT-verified, Witnessed PASS 6/6), and freeze-frame's
  limitations are structural — capture latency on heavy pages, frozen-page staleness, the WSLg blip
  family, and a hide/restore tax (DD5-class) imposed on every other overlay in the system.
- Trade-off: more implementation surface than a hit-testing pause; accepted for the parity-plus wins
  and the deletion of an entire mechanism.

**DD2 — Full-guest transparent sheet (single view), not sized-to-menu views**
- One lazy-singleton `WebContentsView` whose bounds always equal the active guest's bounds; page
  background fully transparent (`#00000000`, the F7-proven setting); menus are absolutely-positioned
  DOM inside the sheet page.
- Why: (a) **dismissal parity for free** — today outside-clicks land in chrome because the guest is
  hidden; with the sheet they land in the sheet page, which dismisses and swallows them — identical
  user-observable behavior, no cross-webContents blur heuristics; (b) **no sizing protocol** — menu
  size is plain CSS (DD10); (c) **coordinate identity for guest-relative coords** — sheet-page CSS
  coords ≡ guest-region DIP coords, deleting the context-menu offset translation
  (`src/renderer/renderer.js:positionPageContextMenu` — "offsets by els.webviews.getBoundingClientRect()").
  *Nuance (design-review)*: identity holds for the context menu's guest-relative `params.x/y` only;
  toolbar-anchored menus (kebab/container/site-info) compute anchors from **chrome** client rects and
  must be translated chrome→sheet (subtract the guest-region origin; y clamps to 0 per DD12).
- **Gate**: Leg 1 opens with a WSLg pixel probe — guest-sized transparent sheet added above a live
  guest; `captureWindow` (OS-grab path) must show the guest rendering through it. F7 proved
  transparency at find-bar scale on the same compositing path (child view of `contentView`); F3's
  "transparent renders black" was a different mechanism (transparent window overlay). If the probe
  fails: **operator options-review with sized-to-menu as the recorded fallback** (per-menu static
  bounds, cross-webContents dismissal wiring) — divert, don't improvise.
- Consequences accepted by the operator (2026-07-02): guest input fully blocked while a menu is open
  (parity — guest is hidden today); one transient extra compositing layer while open (removed from the
  view tree on dismiss); menus cannot overlap the toolbar (DD12); sheet invisible in `captureWindow`'s
  WSLg-fallback grabs (same caveat the find-overlay specs codify).

**DD3 — All five surfaces migrate in this one flight**
- Kebab (⋮), container (▾), page context menu, toolbar-unpin mode (same menu node), site-info (🔒).
  The freeze apparatus can only be deleted when its **last** consumer migrates; carving any surface out
  leaves the whole mechanism alive and forfeits the payoff. All five share `menuController` and the
  freeze calls, so the migration is one pattern applied five times, not five designs.
- Trade-off: a bigger flight; mitigated by staging (legs 2–4) behind a dev gate with per-leg
  verifiability (the F7 `GOLDFINCH_FIND_OVERLAY_DEV` staging technique, debrief-endorsed).

**DD4 — Menu-model-over-IPC split: chrome owns state and actions; the sheet is presentation-only**
- Chrome keeps: trigger buttons (`aria-haspopup`/`aria-expanded`), open stimuli (click/keyboard on
  triggers, the `page-context-menu` IPC subscription, Shift+F10), **menu-model building** (it owns the
  `containers` array, tab state, and guest context params), and **action execution** (Settings/
  Downloads/Print/Exit, container-tab creation, copy-link/spelling/Inspect — all already call
  `window.goldfinch` APIs from chrome).
- The sheet page receives a serialized menu model `{menuType, items[], anchor, startIndex}`, renders
  it, runs the APG keyboard contract (roving tabindex, Arrow/Home/End, Escape), and reports
  `{item-activated: id}` or `{dismissed: reason}` back. It holds no business logic and no privileged
  APIs beyond its own IPC bridge.
- **Information-flow completeness check (F7 debrief lesson) — the full channel set, enumerated at
  design time:**
  1. chrome → main: `menu-overlay:open` `{menuType, model, anchor, startIndex}` (main shows sheet,
     forwards model)
  2. chrome → main: `menu-overlay:close` (programmatic close — e.g. mutual exclusion, trigger re-click)
  3. main → sheet: `menu-overlay:init` `{menuType, model, anchor, startIndex}` (pending-init queue for
     the first-load race, F7 pattern)
  4. sheet → main: `menu-overlay:activated` `{id}` → main hides sheet, forwards to chrome
  5. sheet → main: `menu-overlay:dismissed` `{reason: escape|outside-click|blur}` → main hides sheet,
     forwards to chrome
  6. main → chrome: `menu-overlay-activated` `{menuType, id}` (chrome executes the action)
  7. main → chrome: `menu-overlay-closed` `{menuType, reason}` (chrome resets `aria-expanded`, returns
     focus to the trigger / `returnFocus` target)
  - **The main-initiated close family (design-review HIGH — completes the audit).** Main also hides
    the sheet *outside* channels 1/2/4/5: (a) **BaseWindow blur** (app switch — note `main.js`
    currently has **no** window blur listener, only closed/resize/maximize handlers at
    `main.js:636-667`; one must be added); (b) **tab lifecycle while a menu is open** —
    `tab-close`, `tab-hide`, `tab-set-active` (including MCP-driven activation that never blurs the
    sheet); (c) **DD9 teardown** (`render-process-gone`, window-closed). Every one of these routes
    through a single **`closeMenuOverlay(reason)`** helper that (1) hides the sheet, (2) emits
    channel 7 to chrome (so `aria-expanded`/focus state never orphans), and (3) runs the DD5
    find-overlay-restore hook (so an app-switch dismiss can't leave the find bar hidden forever).
    One mutation point, all callers declared.
  - *Feedback-path audit*: chrome's `aria-expanded` + focus (mutated by 6/7), the sheet's rendered
    menu (mutated by 3), main's sheet visibility (mutated by 1/2/4/5 **+ the main-initiated close
    family above**) — each has a declared path. No orphaned state.
- **Reason-resolved refocus (channel 7).** Chrome branches focus-return on `reason` (the F7
  sender-resolved-refocus lesson, generalized): `escape`/`activated` → focus the trigger (or the
  context menu's `returnFocus` target); `blur` (app switch) → **no** refocus (don't steal focus from
  the other app on return); `tab-switch`/`superseded`/`teardown` → no refocus (the incoming guest
  keeps focus). `aria-expanded` resets on **every** reason.
- **Trigger re-click-to-close race (design-review HIGH — named now, mechanism locked at Leg-2
  design).** Today the kebab click toggles (`renderer.js:184-187`) and the pointerdown dismisser
  ignores trigger clicks (`menu-controller.js:118`). Sheet-era, mousedown on the trigger blurs the
  *sheet* → `dismissed{blur}` → channel 7 resets chrome's open-state — all **before** chrome's
  `click` fires, which then sees "closed" and re-opens: re-click-to-close becomes a blink that never
  closes. Default mechanism (confirm at Leg 2): chrome records the arrival time + menuType of
  `menu-overlay-closed{blur}` and suppresses a trigger-click *re-open of the same menu* within the
  same pointer gesture (~300ms window); other menus' triggers are unaffected (suppression is
  same-menuType-only, so it composes with mutual exclusion). **Also locked at Leg-2 design (round-2
  review)**: (a) a monotonic **open-token** carried in the model and echoed in channels 4/5/7, with
  stale-token closes dropped — closes the same-menuType race the suppress window (clicks only)
  doesn't cover (keyboard re-open inside the window receiving the *old* instance's `closed`); (b)
  `closeMenuOverlay(reason)` is **idempotent** — a no-op when the sheet is already hidden (on
  app-switch, BaseWindow blur and the sheet's own blur both fire; chrome must see one channel-7
  close and the DD5 restore hook must run once), unit-tested.
- **Mutual exclusion (open B while A is open).** Single sheet: chrome sends channel 1 for B; main
  treats open-while-visible as **model-replace** (no hide/re-show flicker) and emits channel 7 for A
  with `reason: superseded` so A's trigger state resets. Chrome keys all channel-7 handling on
  `menuType`.
- **Integration hazard, named now**: `menu-controller.js` dismisses on window `blur`
  (`src/renderer/menu-controller.js:114-123`) — but opening the sheet *moves focus off chrome*, which
  would fire that blur and instantly self-dismiss. The chrome-side global blur/pointerdown
  outside-dismiss listeners are retired; dismissal authority moves wholly into the sheet (its own
  click/Escape/blur) + main (`closeMenuOverlay` family).
- **`menu-controller.js` fate**: the APG engine (roving tabindex, `focusItem`, Arrow/Home/End/Escape
  contract) **moves to the sheet page** — it is DOM-pure and dual-export, so it's a move, not a
  reimplementation; the chrome-global pointerdown/blur listeners do not move (retired per above).
  Chrome keeps only trigger-side keydown (ArrowDown/Enter/Space → channel 1 with `startIndex`).
  `test/unit/menu-controller.test.js` follows the module: contract tests survive re-pointed at the
  sheet context; the global-listener tests are inverted/renamed per the leg-skill test-audit rule
  (they pin behavior this flight deletes).

**DD5 — Find bar hidden while a menu is open (parity), via explicit wiring**
- Operator decision: preserve current behavior (find bar is not visible under an open menu).
- Today this rides the freeze path (`tab-hide` → `hideFindOverlay`, restore via `tab-set-active`
  re-add — `src/main/main.js:1667-1679`, `1699-1745`). With the freeze gone, main wires it explicitly:
  sheet-show → `hideFindOverlay()`; sheet-hide → re-show iff the find session targets the active tab
  (`isFindOverlayActive`). This *also* fixes F7's known "focus doesn't return to the overlay after
  unfreeze" item, since restore is now an owned, explicit step. The hide/restore pair lives inside
  the DD4 `closeMenuOverlay(reason)` single close path, so **every** dismissal flavor (Escape, click,
  blur, tab lifecycle, teardown) restores correctly — with the tab-switch reason deferring to
  `tab-set-active`'s existing per-tab find-restore logic rather than double-handling.
- `tests/behavior/find-overlay-geometry.md` step 6's assertion (overlay hidden during menu, restored on
  dismiss) **remains valid** — only its "freeze" framing updates at cutover.

**DD6 — a11y auditing preserved: the audit gains a sheet target**
- Menus leave the axe-injectable chrome DOM; unlike F7 (find-bar state removed from the audit), menus
  are a large a11y surface (roving tabindex, APG menu semantics) and coverage must not be lost —
  operator requirement.
- **Apparatus premise verified at planning (both axes):**
  - *Observe*: the MCP `evaluate` op runs `webContents.executeJavaScript` against any live wcId — the
    resolver is injected `webContents.fromId` (`src/main/automation/resolve.js:76-81` — "const wc =
    fromId(wcId)"), and `scripts/a11y-audit.mjs:runAxe(client, wcId, ...)` is already
    wcId-parameterized. F7 proved driving a non-enumerable overlay by probed wcId live.
  - *Act*: menu opens are triggered from chrome (existing `openPageContextMenuForAudit()` hook at
    `src/renderer/renderer.js:676-701`, adapted; plus equivalent open hooks for kebab/container/
    site-info if needed).
- The audit flow per menu state: chrome evaluate opens the menu → axe injected into the **sheet's**
  wcId → violations collected. Sheet wcId discovery: probed id-space walk (the F7 technique) by
  default; a deliberate admin-only discovery hook may be added at leg design if probing proves brittle
  in the audit script.

**DD7 — Internal tabs are IN scope for the sheet (opposite of the find bar's DD7)**
- Kebab/container/site-info must render over internal `goldfinch://` tabs (that is precisely what
  `tests/behavior/internal-tab-menus.md` protects). The sheet stacks above whichever view is active —
  web or internal. The page context menu keeps its existing internal-guest exclusion
  (`src/main/main.js:825-830` — "if (isInternalContents(contents)) return").

**DD8 — Security invariants (F7 pattern carried forward)**
- All `menu-overlay:*` ipcMain handlers are **sender-validated** (accept only the sheet's or chrome's
  webContents by identity, as appropriate per channel — never trust payload-declared identity).
- The sheet is **not** registered in `tabViews`: invisible to `enumerateTabs`/the automation surface
  (a design choice documented at construction), directly addressable by probed wcId for test driving —
  the F7 enumerable-vs-addressable nuance.
- Chrome-class `webPreferences` (contextIsolation on, its own minimal preload); no widening of the
  internal-page gates, CSP, or automation tiers.
- **Text-only model rendering (design-review).** The menu model carries guest-controlled strings into
  a chrome-class document (`selectionText` in "Search for …", `misspelledWord`,
  `dictionarySuggestions`) plus user-supplied container names. The sheet renders item labels via
  `textContent` only — never markup (chrome's existing `escapeHtml`/`textContent` discipline,
  `renderer.js:217, 445`, carried across the boundary).
- **Tier hardening for non-tab wcIds (defense-in-depth — round-2 review corrected the framing).**
  Jar-tier keys **cannot** reach the sheet today: wcId-first ops at the jar tier route through the
  scope façade (`scope.js:120-128`) → `resolveContentsForJar`, which throws `out-of-jar` on session
  object-identity mismatch (`resolve.js:151-157`) — the sheet is chrome-class (defaultSession), so no
  jar's session can match, exactly as burner tabs and the chrome renderer are refused today (pinned
  by `automation-scope.test.js:142-191`). **Not a live vulnerability; Flight 5 should not hunt one.**
  Leg 2 still adds the resolver-level rule (wcIds not in `tabViews` and not chrome resolve only at
  the admin tier) as **defense-in-depth** — robust against a future sheet-gets-a-partition change —
  via an injected `isTabViewWcId` predicate (main.js owns `tabViews` at `main.js:145` and the
  `createEngine` call at `main.js:487`; established injection pattern). Same-pass obligation: this
  adds a second admin-only relaxation, so the docs/tests pinning "`allowInternal` is admin's SOLE
  relaxation" (`resolve.js:69`, `engine.js:25-29`) update together. Unit tests assert the correct
  baseline (today's refusal is `out-of-jar`, not a widening being closed). Test driving of the sheet
  remains admin-tier (the F7 precedent).

**DD9 — Lifecycle parity with the find overlay**
- Lazy singleton (`ensureMenuOverlayView()`); show = `addChildView` **after** the guest (z-order
  invariant, F7 DD2); hide = `removeChildView` (never `setVisible(false)` — F7 DD7); pending-init
  queue for the first-load race; `render-process-gone` teardown-and-rebuild; teardown on
  window-closed. Geometry: bounds follow the active guest's bounds through the existing
  `tab-set-bounds`/`tab-set-active` paths (same hook points the find overlay uses).

**DD10 — Menus sized by CSS inside the sheet**
- Fixed width per menu type (container/jar menu naturally narrower — operator preference), natural
  height from content. No measure round-trip, no bounds protocol, no resize flash. Long dynamic lists
  (many containers) get a CSS `max-height` + internal scroll rather than unbounded growth.

**DD11 — Test/spec inventory pinning freeze-era behavior (design-review enumeration) + F7 bundles**
- **Six artifacts pin observables this flight deletes** — dispositions declared now, executed at
  cutover (Leg 5):
  - `tests/behavior/internal-tab-menus.md` — **re-author**: the `#webviews backgroundImage` freeze
    tell is its *authoritative* observable and ceases to exist. Also carries stale citations
    (`renderer.js:1076,1091` → now ~1018/1033) — repair in the same pass.
  - `tests/behavior/tab-surface-geometry.md` — **re-author** the freeze rows (same freeze-tell
    dependency); geometry rows survive.
  - `tests/behavior/menu-dismissal.md` (active) — **re-author**: pins the chrome window-blur/
    pointerdown dismissal mechanism being retired; the *user-observable* dismissal contract it
    protects transfers to the sheet.
  - `tests/behavior/kebab-menu.md` (active) — **update**: reads menu DOM/AX from the *chrome* wcId
    (will no longer contain an open menu → sheet wcId); also already stale ("exactly two items").
  - `tests/behavior/page-context-menu.md` — **update**: chrome-DOM menu reads → sheet.
  - `tests/behavior/find-overlay-geometry.md` — **reframe** step 6 (freeze wording → menu-overlay;
    assertion unchanged per DD5).
  - Unit: `test/unit/menu-controller.test.js` — disposition per DD4 (contract tests move with the
    module; global-listener tests inverted/renamed).
- F7-debrief bundles (bundling rule — same surfaces already being edited):
  - `find-overlay-geometry.md` update also folds in the four F7 spec errata (probe-direction
    "around"; step-2 pixel-tolerance band; menu DOM-bracketing; DOM-anchored control location) + the
    absence-authoritativeness rule.
- The docs leg already rewrites CLAUDE.md's menu/freeze architecture section → fold in the F7 pattern
  section (Rec 3: `findNext` inversion note, pending-init queue, sender-resolved refocus, Electron-free
  geometry-module pattern, enumerable-vs-addressable rule).
- Items NOT bundled (different surfaces, stay with their owners): PID-scoped-kill crew rule;
  `find-in-page.md` cold-start caveat (Flight 5); option-semantics sweep (Flight 5).

**DD12 — Sheet covers the guest region only; toolbar-anchored menus sit flush at the guest top**
- Covering the full window would swallow toolbar clicks while a menu is open (real behavior change) and
  occlude the trigger buttons. Accepted consequence: kebab/container/site-info menus, today anchored
  ~4px below their buttons at the toolbar/guest boundary, render flush at the sheet's top edge — a
  couple of pixels lower than today. Acceptable variation, not a divert condition.

**DD13 — Chrome accelerators keep working while a menu is open (parity via forwarding)**
- Freeze-era, an open menu leaves focus in chrome, so chrome shortcuts (Ctrl+W/F/J/L/T, F12, …) still
  work. Sheet-era, focus sits in the sheet's webContents, where neither chrome's keydown handlers nor
  the guest `before-input-event` capture (`src/main/main.js:743` pattern) exist — without wiring,
  every shortcut dead-ends until dismissal (design-review catch).
- Decision: wire `before-input-event` on the sheet's webContents forwarding the **union** of the
  guest-captured set (`main.js:744-810` — F12, Ctrl+Shift+I, Ctrl+=/−/0, Ctrl+P, Ctrl+F, Ctrl+J) and
  the chrome `keydownToAction` set (`src/shared/keydown-action.js:43-71` — Ctrl+T/W/L/M/R,
  Ctrl+Shift+P); the guest set alone is a proper subset and would drop exactly the parity targets
  (round-2 catch — Ctrl+W itself dead-ends under guest-set-only forwarding). Exact set locked at
  Leg-2 design. No conflict with the sheet's APG keys: every forwarded accelerator is modifier-gated
  or F12; unmodified arrows/Home/End/Enter/Space/Escape/Tab stay with the sheet (APG contract wins
  inside the menu). Resulting semantics (e.g. Ctrl+W closes the tab → menu closes via the DD4
  tab-lifecycle path) fall out of the close family; the HAT verifies the composite feels right.

### Prerequisites

- [x] Flight 7 completed and merged to `mission/05-webcontentsview-migration` (`d5a8f0f`, debrief
  `ee529b8`) — the overlay pattern, geometry hook points, and probed-wcId apparatus all exist.
- [x] Mission branch clean; `main` untouched (long-running-branch model stands; no GitHub PR).
- [ ] Behavior-test apparatus for the HAT/Witnessed legs: `npm run dev:automation` instance with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` + pinned free `GOLDFINCH_MCP_PORT`;
  apparatus-wiring litmus (F4 carry) passes. *Verified at execution time, per spec preconditions.*
- [ ] `captureWindow`'s **OS-grab path** (not the WSLg chrome+guest fallback) available on the rig at
  execution time — the CP1 probe and every overlay-presence assertion depend on it. F7's Witnessed run
  (2026-07-02) proved it live on this rig; re-confirm at Leg 1 before trusting the probe verdict.
- [x] a11y-injection premise verified (DD6 — `resolve.js:76-81`, `a11y-audit.mjs:runAxe`).

### Pre-Flight Checklist

- [ ] All open questions resolved (two remain: Leg-1 probe gate; Leg-3 dialog audit — both owned by
  legs with recorded dispositions)
- [x] Design decisions documented
- [x] Prerequisites verified (execution-time items noted)
- [x] Validation approach defined (see Verification)
- [x] Legs defined (tentative, per methodology)

---

## In-Flight

### Technical Approach

Stage the sheet exactly as Flight 7 staged the find overlay — primitive first, routing second, cutover
last, each leg independently verifiable behind a disposable dev gate (`GOLDFINCH_MENU_OVERLAY_DEV`):

1. **Scaffold + probe** (Leg 1): `ensureMenuOverlayView()` singleton in an extracted
   `src/main/menu-overlay-manager.js` from day one (design-review: `main.js` is ~2,230 lines and the
   F7 debrief already lists the analogous find-overlay extraction as a maintenance candidate; F7's
   `find-overlay-geometry.js` proves the Electron-free-module pattern for the pure parts); transparent
   sheet page
   (`src/renderer/menu-overlay.{html,css,js}` + `src/preload/menu-overlay-preload.js`); bounds slaved
   to active-guest bounds via the existing `tab-set-bounds`/`tab-set-active` touch points; teardown
   paths. **First acceptance criterion is the DD2 WSLg transparency probe on pixels.**
2. **Protocol + first consumer** (Leg 2): the DD4 channel set end-to-end; sheet-side model renderer +
   APG keyboard contract; kebab menu (static model — simplest) migrated behind the gate; chrome keeps
   its old menus fully functional (parallel-run).
3. **Dynamic models** (Leg 3): container menu (built from `containers`, max-height scroll), site-info
   popup (content model from tab state); the `#new-container-dialog` audit + disposition.
4. **Context menu + unpin** (Leg 4): guest params model, 1:1 coordinates (delete the offset
   translation), keyboard invocation (Shift+F10, clamped into the sheet), toolbar-unpin mode,
   spelling/Inspect/clipboard actions routed via DD4 channel 6.
5. **Cutover** (Leg 5): flip all five surfaces to the sheet; delete `freezeGuest`/`unfreezeGuest`
   (`src/renderer/renderer.js:998-1042` — freezeGuest at 1008, unfreezeGuest at 1030), the
   `guestFrozen` guard (`renderer.js:979` in `sendActiveBounds`, comment at 989; plus the
   `onTriggerSendBounds` no-op at `renderer.js:2697-2698`), `capture-active-guest`
   (`src/main/main.js:1837-1862`), chrome menu DOM (`index.html`) + CSS (`styles.css:1247-1346`
   region) + the chrome-side outside-dismiss/blur listeners in `menu-controller.js` (DD4). **Do NOT
   delete the overlay touches in `tab-hide`/`tab-set-active`** — they are dual-purpose
   (design-review: `tab-hide`'s `hideFindOverlay()` also serves the pending-activation hide;
   `tab-set-active`'s re-add serves ordinary tab activation): re-comment them, deleting only the
   freeze *framing*. Rewire find-overlay hide/restore per DD5; extend `scripts/a11y-audit.mjs` per
   DD6; execute the DD11 spec/unit-test dispositions + CLAUDE.md/docs bundles; delete the dev gate.
6. **HAT + Witnessed** (Leg 6): guided HAT across all five surfaces (mouse + keyboard + focus-return +
   internal tabs + find-bar interplay); run `/behavior-test menu-overlay` (new spec, drafted) and
   re-run `internal-tab-menus` + `page-context-menu` where apparatus permits.

`menuController`'s registration/roving logic is chrome-side today; Leg-2 design decides how much moves
into the sheet page verbatim vs. is reimplemented — the keyboard contract itself (APG menu semantics)
must be preserved bit-for-bit either way, since `page-context-menu.md` asserts it.

### Checkpoints

- [ ] **CP1 (gate)**: WSLg transparency probe passes on pixels — guest visibly live under a guest-sized
  transparent sheet (Leg 1). Fail → divert per DD2.
- [ ] **CP2**: kebab menu opens/dismisses over a live guest at parity (pixels + keyboard contract),
  old menus still intact (Leg 2).
- [ ] **CP3**: all five surfaces render from the sheet behind the gate; dynamic models correct (Legs
  3–4).
- [ ] **CP4**: cutover complete — freeze apparatus deleted, no `freezeGuest`/`capture-active-guest`/
  `guestFrozen` references remain; unit/typecheck/lint green; a11y audit green **including the new
  sheet-target menu states** (Leg 5).
- [ ] **CP5**: HAT pass + `menu-overlay` Witnessed run pass; updated specs promoted (Leg 6).

### Adaptation Criteria

**Divert if**:
- CP1 probe fails (transparent sheet composites black/opaque on WSLg) → operator options-review;
  recorded fallback: sized-to-menu views (DD2).
- The `#new-container-dialog` audit reveals a freeze dependency that can't migrate or re-anchor
  cleanly within Leg 3's scope → escalate before the cutover leg.
- Live-guest-under-sheet produces WSLg compositing artifacts materially worse than the blip being
  retired → operator review (this would undermine the flight's purpose).

**Acceptable variations**:
- The ~4px anchor shift for toolbar-anchored menus (DD12); per-menu CSS width tuning; probe-vs-hook
  for the audit's sheet-wcId discovery (DD6); splitting Leg 5 into 5 (code cutover) + 5b (spec/docs
  dispositions) if the DD11 inventory balloons — pre-authorized, no divert needed.

### Legs

> **Note:** Tentative; designed one at a time as the flight progresses.

- [x] `01-scaffold-sheet` — singleton + transparency probe (CP1 gate) + geometry-follow + teardown +
  dev gate
- [x] `02-menu-protocol-and-kebab` — DD4 channel set + sheet renderer + APG keyboard + kebab migrated
- [x] `03-container-and-site-info` — dynamic models + max-height scroll + new-container-dialog audit
- [x] `04-page-context-and-unpin` — params model + 1:1 coords + Shift+F10 + toolbar-unpin + actions
- [x] `05-cutover-retire-freeze` — flip + delete freeze apparatus + a11y extension + gate
  deletion *(split per the pre-authorized acceptable variation, 2026-07-02: code cutover here;
  DD5 rewiring landed early in Leg 2)*
- [x] `05b-specs-and-docs` — DD11 spec/unit-test dispositions + CLAUDE.md/docs bundles
  *(second half of the pre-authorized Leg-5 split)*
- [ ] `06-hat-and-alignment` — guided HAT + `/behavior-test menu-overlay` + spec re-runs

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Merged to `mission/05-webcontentsview-migration` (local; `main` untouched)
- [ ] Tests passing (unit + typecheck + lint + a11y with sheet target)
- [ ] Documentation updated (CLAUDE.md menu architecture + F7 pattern bundle; docs/mcp-automation.md if
  the audit hook changes the automation story)

### Verification

- **Guided HAT (Leg 6)**: all five surfaces — mouse open/dismiss, full keyboard contract
  (trigger ArrowDown/Enter/Space, roving, Escape, Tab), focus return to triggers, menus over internal
  tabs, find-bar hidden-under-menu + restore with focus, video-keeps-playing-under-menu, outside-click
  swallow parity.
- **Witnessed behavior test**: `tests/behavior/menu-overlay.md` (drafted this flight — sheet-specific
  rendered properties: live-guest liveness under an open menu, dismissal-without-forwarding, find-bar
  interplay, sheet absence after dismiss; true OS-pointer click-interception is HAT-only — see the
  spec's apparatus note). Plus re-runs of the DD11-updated specs (`internal-tab-menus`,
  `page-context-menu`, `kebab-menu`, `menu-dismissal`) post-update, apparatus permitting.
- **Gates**: `npm test`, `npm run typecheck`, `npm run lint`, `npm run a11y` (menu states now auditing
  the sheet's DOM per DD6).
- **Source absence**: no `freezeGuest`/`unfreezeGuest`/`capture-active-guest`/`guestFrozen` references
  remain (grep-verified at cutover).
