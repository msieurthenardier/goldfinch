# Flight Debrief: Menu Overlay Sheet

**Date**: 2026-07-06
**Flight**: [Menu Overlay Sheet](flight.md)
**Status**: landed
**Duration**: 2026-07-02 (planning) → 2026-07-06 (landed)
**Legs Completed**: 7 of 7 (01-scaffold-sheet, 02-menu-protocol-and-kebab,
03-container-and-site-info, 04-page-context-and-unpin, 05-cutover-retire-freeze,
05b-specs-and-docs, 06-hat-and-alignment)

## Outcome Assessment

### Objectives Achieved

The freeze-frame chrome-DOM menu mechanism (capture guest → paint still → hide live view → chrome
DOM menu) is **fully retired** and replaced by a single transparent full-guest overlay-sheet
`WebContentsView` hosting all five menu surfaces (kebab ⋮, container ▾, page context, toolbar-unpin,
site-info 🔒) **plus** the new-container dialog, all rendered over the **live** guest. At cutover
the entire freeze apparatus (`freezeGuest`/`unfreezeGuest`/`guestFrozen`/`capture-active-guest`)
and the chrome menu DOM/CSS were deleted — grep-verified zero references in `src/`+`scripts/`.

Bonus outcomes beyond the objective:
- **The pre-existing `#new-container-dialog` occlusion defect was fixed** (rendered as a sheet
  surface; operator-ratified at the HAT) — the flight's operator-call open question resolved.
- **A WSLg click-to-activate swallow was root-caused** during the HAT (three failed inline fix
  attempts → an OS-level repro harness) to a WSLg RAIL/XWayland behavior — **not an F8 regression**
  (freeze-era build reproduces identically) — and solved with a Wayland-aware dev launcher
  (`scripts/dev-launch.mjs` + `src/main/ozone-platform.js`); `grabWindow` hardened for the Wayland
  composite path along the way.

### Mission Criteria Advanced

Flight 8 was **not a mission-landing gate** (SC3/SC4-adjacent — menus at parity on a better
mechanism, same class as Flight 7). It advanced:
- **SC3/SC4-adjacent** — all five menu surfaces keep their behavior on the new mechanism (HAT
  15/15 + Witnessed `menu-overlay` PASS 6/6).
- **Known-issue retirement** — the WSLg internal-tab menu-open blip (F3 carry), freeze
  capture-latency risk, frozen-page staleness, and F7's "focus doesn't return after unfreeze" item
  are all structurally retired by deleting the freeze.
- **Flight-9 enabler** — the media/privacy panel flight now inherits a freeze-free story (no
  DD5-class hide/restore interplay to design against) and a second proven overlay consumer.

### Checkpoints

All five passed in order: **CP1** (WSLg transparency pixel probe — the flight's one genuine unknown,
passed on the OS-grab path, no divert to the sized-to-menu fallback), **CP2** (kebab parity over a
live guest), **CP3** (all five surfaces on the sheet behind the gate), **CP4** (cutover — 27/27
source-absence sweep, a11y green including five new sheet states), **CP5** (HAT 15/15 + Witnessed
6/6).

## What Went Well

- **Per-leg design review earned its keep — repeatedly and measurably.** Each leg ran 1–2 review
  cycles (max-2 rule). The reviews caught issues that would otherwise have surfaced as *build/test
  failures*, not style nits: a surviving `menuController.closeAll()` that would `ReferenceError`
  after the script tag was removed (Leg 5); an AC assuming a runtime `jars-add` broadcast that
  doesn't exist in the product (Leg 3); an **unreachable AC** (guest right-click while a sheet menu
  is open is swallowed by the sheet — no `context-menu` event can fire, Leg 4). The flight-level
  code review then found **zero blocking issues** across the six-leg diff.
- **The Electron-free injected-dependency extraction (`menu-overlay-manager.js`)** kept the full
  menu state machine (open/close/token/idempotency/model-replace) `node --test`-able offline (29
  tests) while every Electron handle stayed at the `main.js` boundary. `main.js` net *shrank*
  despite the added wiring, because the manager absorbed the state machine — the god-file did not
  grow.
- **The chrome-owns-state / sheet-is-presentation split is sound and reusable.** The sheet holds no
  business logic and no privileged APIs, renders every label via `textContent` only (guest-controlled
  strings never hit a markup path), and dispatches spelling by index so guest strings never
  round-trip as commands. Flight 9's panel inherits this split directly.
- **CP1 probe-gating was textbook.** The one compositing unknown (WSLg full-guest transparency) was
  isolated as Leg 1's *first* acceptance criterion, with a recorded divert and a "divert, don't
  improvise" instruction — validating DD1's whole bet cheaply before any protocol work.
- **The staged, gate-parallel-run decomposition** (scaffold → protocol → dynamic → context → cutover
  → docs → HAT) meant the freeze was deleted only once its last consumer migrated — no half-migrated
  intermediate state — and each leg was independently verifiable behind the disposable
  `GOLDFINCH_MENU_OVERLAY_DEV` gate.
- **The HAT's forensic WSLg investigation.** Three reverted fix attempts, each reasonable on the
  information available, then an OS-level PowerShell repro harness that root-caused and *exonerated*
  the app (freeze-era + F8 + zero-view-op-fix all reproduce identically; the original "freeze-era
  works" control had compared against the operator's *native Windows* build, which never had WSLg in
  its path). The flight log's record of the diagnosis is exemplary.

## What Could Be Improved

### Process
- The `menu-overlay` **Witnessed run was the only behavior test executed this flight**; the four
  Leg-5b re-authored regression specs (`internal-tab-menus`, `page-context-menu`, `kebab-menu`,
  `menu-dismissal`) had their first runs deferred (two remain `draft`). Re-authoring specs and
  *running* them ideally shouldn't split across flights — the regression net lagged the mechanism it
  protects. **Disposition: fold into Flight 9's verification** (apparatus already wired) — operator
  decision.
- Apparatus friction consumed real time: the operator's installed Windows Goldfinch squatting the
  session MCP port (49152) forced every leg onto a free-port SDK-client workaround, and every dev
  relaunch re-minted keys. Both are now solved as *standing* apparatus (semi-permanent hash-persisted
  dev key + dual prod/dev project-scope MCP config) — but that setup happened mid-flight, ad hoc.

### Technical
- **`find-input focus is not restored after a menu-Escape** over an active find session** — flagged by
  both crew agents and the Witnessed run log. **Human-interview reframe (operator):** the find term
  used in the spec was `tick`, which matches the fixture's `ticks:` label — and that counter
  re-renders every second, which could itself disrupt the find highlight/selection. So the observed
  "lost focus outline" may be a **test-fixture confound, not a product behavior at all**.
  Disposition: operator to re-test with a static (non-ticking) match term to disambiguate *before*
  deciding accept-vs-fix. Do not act on it as a product bug until re-tested.
- **`main.js` continues to grow** (~2488 lines). The menu logic was correctly extracted, but the
  F7-flagged `find-overlay-manager.js` extraction remains undone (~43 find-overlay refs still inline)
  — and the overlay-view lifecycle (lazy singleton + pending-init queue + `render-process-gone`
  teardown + probed-wcId addressability) now exists in **two parallel implementations** (find inline,
  menu extracted). See Recommendations #2.
- **Three pre-existing keyboard-reachability gaps** surfaced at the HAT (Tab can't leave the guest;
  Ctrl+L dead from guest focus; chrome Tab order doesn't cycle). All **pre-F8, not regressions** —
  shared root cause: guest and chrome are separate `webContents` with no cross-view focus/traversal
  handoff. Ironic asymmetry the sheet exposed: DD13's union set forwards Ctrl+L from the *sheet*, but
  the *guest* never did. **Disposition: own maintenance flight** (operator decision).

### Documentation
- The `webview-preload.js:2-5` comment still references `<webview>` and `ipcRenderer.sendToHost`
  (both stale post-migration; the code uses `ipcRenderer.send('guest-media-list', …)`). Mission-wide
  drift, not F8-introduced — a natural pickup for the end-of-mission maintenance sweep. (The README's
  analogous `<webview>` architecture staleness *was* fixed this session, commit `84833d2`.)

## Test Metrics

`npm test` (node --test): **1050/1050 pass, 0 fail, 0 skipped, 0 todo, no flakes**, 12 suites /
45 files, **~5.06s** wall-clock. `npm run typecheck`: clean. `npm run lint`: clean.
`npm run a11y`: green, including five new `sheet:*` states (3 curated `region`/`#sheet-menu` ACCEPTED
additions; `sheet:site-info` and `sheet:new-container` fired zero findings).

**Trajectory** (prior-debrief comparison — F7 landed at 953): F8 base 969 → 1006 (Leg 2) → 1031
(Leg 3) → 1042 (Leg 4, held through 5/5b) → **1050** (landed; 3 HAT attempt-suites removed, 8
`ozone-platform` tests added). Net **+81 over the flight**, attributed entirely to new suites:
`menu-overlay-manager` (29), `sheet-accelerator` (18), `page-context-model` (11), `site-info` (9),
`ozone-platform` (8), `safe-color` (7), `container-menu` (5), `menu-overlay-value` (4), plus DD8
additions to `automation-resolve` and the re-pointed `menu-controller` suite, net of retired
freeze/attempt tests. Slowest suites unchanged in character: ~2.5s (`automation-find` deliberate
timers), ~1.56s (`automation-mcp-server` port binding); everything else sub-500ms. No slowdown, no
new skips, no flakes vs prior flights.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg-3 dialog: activated-close-then-fresh-open (not model-replace) | main closes `activated` *before* channel 6, so re-open is necessarily fresh; blink accepted rather than unfreezing agreed Leg-2 machinery | Yes — "don't revise frozen machinery to save a rare blink" is a sound discipline |
| DD5 restore-skip set grew 1 → 3 reasons (`tab-switch`+`tab-hide`+`tab-close`) | Ctrl+T-with-find-live would paint the find bar over a hidden guest | Yes — trace every close reason against the find lifecycle |
| Namespaced menu-model ids (`jar:*`/`action:*`) | `jars.slug("New Container")` collides with the `new-container` sentinel | Yes — namespace any model-over-IPC id space that mixes user and system values |
| Generalized `overlayMenus` entry shape (`ariaTarget`+reason-refocus policy) | naive `returnFocus`-as-trigger collided with generic channel-1/7 machinery four ways | Yes — Leg 5 inherited it cleanly; reusable for Flight 9 |
| Pre-authorized Leg-5 split (5 code / 5b docs) | DD11 inventory ballooned across Legs 3–4 as anticipated | Already standardized as a flight "acceptable variation" — worked as intended |
| Free-port SDK-client apparatus + Wayland dev launcher | operator's prod instance squatting the MCP port; WSLg XWayland click-swallow | Apparatus, not product — now standing config |

**Top lesson (methodological):** *pixel probes gate compositing, not OS input/focus semantics.* CP1
correctly gated transparency/compositing but was structurally blind to the WSLg click-swallow, which
is invisible to `captureWindow` and to any DOM/pixel observable — it only manifests under real OS
pointer input against real foreground-activation truth, and surfaced only at the live HAT. Future
guest-region flights: a real-pointer harness or a live HAT is required to gate input/focus behavior;
a pixel probe cannot.

## Key Learnings

1. **Disciplined feedback-path enumeration up front > iterating in the field.** DD4's robustness came
   from enumerating the full channel set + close family + token/suppress at design time (the F7-debrief
   lesson applied); the reviews then caught *incorporation* drift, not direction errors.
2. **The overlay-view lifecycle is now a proven, twice-instantiated pattern** — ripe for a shared base
   before a third copy lands (Flight 9's panel).
3. **Multi-`WebContentsView` keyboard/focus bridging is an architectural obligation**, not an
   incidental gap — DD13 solved it for the sheet; the guest and chrome views have the analogous
   unsolved gaps.
4. **The F7 "hide = removeChildView, never setVisible(false)-only" invariant is load-bearing** — the
   two fix attempts that violated it were both reverted once the real diagnosis landed; keep it
   unqualified.

## Recommendations

1. **Flight 9 (media/privacy panel) — decide the panel's view identity early and resolve the
   find-focus UX in-scope.** It inherits the freeze-free story + the chrome-owns-state/sheet-presents
   split as a template, but it is stateful/long-lived (unlike a transient menu) and likely wants its
   *own* overlay view — which makes the shared-base extraction (below) timely *before* the panel lands
   as a third divergent copy. Any panel opening over an active find session or open menu must route
   through the same `closeMenuOverlay` reason-resolved close family. Fold the four deferred regression
   specs into Flight 9's verification (apparatus already wired) and promote `internal-tab-menus` /
   `page-context-menu` out of `draft` (operator decision).
2. **Extract a shared overlay-view base before Flight 9 (or as its first step).** The lifecycle —
   lazy singleton + pending-init queue + `render-process-gone` teardown + probed-wcId (non-`tabViews`,
   admin-addressable) — now lives inline in `main.js` (find overlay, ~43 refs) *and* extracted in
   `menu-overlay-manager.js`. Retrofit the find overlay onto a shared `createOverlayView(...)` base so
   the panel is the base's first *new* consumer, not a fourth hand-rolled copy. This also shrinks
   `main.js` and gives the find overlay the offline-testable seam the menu sheet already has.
3. **Scope a dedicated keyboard-nav maintenance flight** (operator decision) for the three pre-existing
   gaps: extend the guest `before-input-event` capture set to the DD13 chrome-class union (Ctrl+L
   etc.) + a guest→chrome focus handoff + chrome Tab-cycle. Makes the multi-view keyboard story
   uniform across guest/chrome/sheet.
4. **Operator action — rotate the prod admin automation key** (it transited chat once during HAT
   apparatus setup) and re-test the find-focus item with a static match term to disambiguate the
   fixture confound before filing it as a bug either way.

## Action Items

- [ ] **Operator**: rotate the prod admin automation key (transited chat during HAT setup).
- [ ] **Operator**: re-test find-input-focus-after-menu-Escape with a static (non-ticking) match term;
  file as product bug only if it reproduces off the ticking fixture.
- [ ] **Flight 9**: run the four deferred regression specs as verification; promote `internal-tab-menus`
  + `page-context-menu` from `draft`; run the two deferred `menu-overlay` variants.
- [ ] **Flight 9 / pre-Flight-9**: extract a shared overlay-view base; retrofit the find overlay onto it.
- [ ] **Maintenance flight** (own flight, operator-approved): guest keyboard-reachability gaps
  (Ctrl+L / cross-view focus handoff / chrome Tab-cycle).
- [ ] **End-of-mission maintenance sweep**: scrub the `webview-preload.js` `<webview>`/`sendToHost`
  stale comment (+ any remaining mission-wide `<webview>` references).
