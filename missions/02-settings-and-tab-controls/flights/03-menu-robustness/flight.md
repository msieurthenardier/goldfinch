# Flight: Menu Dismissal & Shared APG Helper

**Status**: in-flight
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- [ ] **SC8** — keyboard-operable, no new WCAG A/AA violations. This flight **lifts the container
  (`▾`) menu to the same APG level as the kebab** (`role="menu"`/`menuitem`, roving tabindex,
  arrow/Home/End/Escape/Tab nav) via a shared menu controller, and must keep the kebab menu and the
  tab-strip contract passing. (*behavior-test-backed / a11y gate*)

> **Flight-local scope (no mission SC — correctness/robustness).** The core driver of this flight is
> a **dismissal correctness bug**: an open menu (kebab or container) does **not** reliably close when
> the user clicks outside it — specifically clicks landing in the page `<webview>` (a separate
> web-contents the chrome's `document` can't see) and clicks on the *other* menu's trigger. This is a
> robustness fix, not a mission SC, but it's the reason the flight exists. The shared-helper extraction
> (debrief Rec 4) and removal of Flight-2's hand-wired mutual-exclusion ride along on the same surface.

---

## Pre-Flight

### Objective

Make Goldfinch's two dropdown menus (the kebab `⋮` overflow menu and the container `▾` menu) dismiss
reliably on **any** outside interaction — in-chrome clicks (already work), **page/webview clicks**, and
**clicks on the other menu's trigger** — by routing both menus through a single **shared APG menu
controller**. The controller owns open/close, outside-dismiss (`document` + `window` blur),
mutual-exclusion (inherent: opening one closes the others), and the full APG keyboard contract
(`role="menu"`/`menuitem`, roving tabindex, Arrow/Home/End/Escape/Tab). Adopting it **lifts the
container menu to the kebab's a11y level** and lets us **delete the hand-wired mutual-exclusion** added
in Flight 2's HAT. No tab-strip, frameless, scheme, or settings work is in scope.

### Open Questions
- [x] How do menus dismiss on page/webview clicks (which the chrome `document` never sees)? →
  **`window` blur listener** (focus leaving the chrome into the webview or another app) + the existing
  in-chrome `document` handler + helper-`open()` for cross-trigger. See DD1. **Premise to verify
  (spike, leg 1):** does clicking/focusing a `<webview>` actually fire `window` blur on the dev
  compositor (WSLg)? Divert to the preload-forward fallback if not.
- [x] How deep does the shared helper go? → **Full shared APG controller**; both menus register;
  the container menu is uplifted to full APG. See DD2/DD3.
- [x] Apparatus for the behavior tests, both axes (act + observe)? → see DD5.
- [x] Should the helper live in `renderer.js` or a new file? → **In-file controller object** (the
  renderer is `sourceType:"script"`; a new file means a `<script>` include + global exposure, matching
  the `src/shared` dual-export dance for no benefit at this size — the kebab/container code already
  lives in `renderer.js`). Final shape confirmable at leg design, but the lean is in-file.
- [x] a11y-test coverage for the container's new APG nav? → **`menu-dismissal` Step 7 already
  witnesses the core** (role/menuitem/roving/Arrow/Home/End). The only open part is whether to add
  coverage *beyond* Step 7 (e.g. exhaustive multi-item nav) — decide at leg design; do NOT re-derive
  what Step 7 covers.

### Design Decisions

**DD1 — Robust outside-dismiss = `window` blur + in-chrome `document` handler + helper-`open()`
mutual-exclusion; premise-spiked before lock**:
- *Page/webview click* — clicks inside a `<webview>` guest (`renderer.js:249`, separate web-contents)
  never reach the chrome renderer's `document`, so today an open menu survives a page click. Fix: a
  single `window.addEventListener('blur', closeAllMenus)` — clicking/focusing the webview shifts focus
  out of the chrome window and fires `blur`. Bonus: menus also close when the whole app loses focus.
- *In-chrome click* — keep one shared `document` (pointerdown/click) handler that closes the open menu
  unless the click target is inside a menu or on a registered trigger (target-aware, so we can drop the
  brittle per-trigger `e.stopPropagation()` reliance).
- *Cross-trigger* — clicking the other menu's trigger closes the open menu because the controller's
  `open()` closes all other registered menus first (mutual-exclusion is inherent, not hand-wired).
- **Premise status — verify-at-leg-1, not known-true**: that clicking/focusing a `<webview>` fires
  `window` blur on the dev compositor (WSLg) is an empirical premise. **Leg 1 opens with a spike that
  tests the PRIMITIVE first** — attach a throwaway `window` blur listener (or eval), `focus()` the
  active tab's webview, and confirm the blur event fires — **before** building `closeAllMenus` on top
  of it, so the divert decision precedes the dependent code (Flight-2 debrief lesson: a divert spike
  must run before the build it gates). If blur does NOT fire reliably → **divert** to the
  preload-forward fallback: add a `pointerdown` → `sendToHost('page-pointerdown')` in
  `webview-preload.js` and a new branch in the renderer's per-webview `ipc-message` handler
  (`renderer.js:429`, which today only switches on `media-list`/`privacy-*`) that calls
  `closeAllMenus`. **That fallback channel wiring is in-scope for leg 1's divert path** (a second
  surface — name it in the leg if the divert fires), not a silent follow-on.
- **Witness ≠ real click (Architect)**: the spike + the `menu-dismissal` test drive the handler via
  `webview.focus()`, which fires embedder blur. A *real trusted pointer click* into the guest could
  diverge (e.g. leave `document.activeElement` on the `<webview>` without firing blur). So the
  witnessed path proves the **handler**; the **real pointer page-click is covered ONLY by the manual /
  HAT check** — keep that manual check mandatory, not optional, since a green witnessed test can't by
  itself prove the real-click path.
- **No legit keep-open-across-blur flow (Architect-confirmed)**: blanket close-on-blur is safe — no
  normal path keeps a menu open while focus leaves the chrome (new-tab webview auto-focus happens
  after the item-click already closed the menu; the "New container…" `window.prompt` closes the menu
  anyway). Re-confirm at leg 1 that no background-webview focus-grab could close a just-opened menu.
- Trade-off: `window` blur also fires on app-switch (desirable here) and on devtools focus (harmless —
  the menu just closes). The target-aware `document` handler is slightly more logic than two blind
  close-listeners, but it's the seam that kills the stopPropagation fragility.

**DD2 — One shared in-file menu controller both menus register with**: a small controller (object/
factory in `renderer.js`) exposing `register(trigger, menu, { buildItems?, anchor })` and managing
open/close/toggle, focus-into-on-open + focus-restore-on-close, roving tabindex, the APG keydown
contract (Arrow/Home/End/Escape/Tab), outside-dismiss (DD1), and mutual-exclusion. The kebab and
container triggers both go through it.
- Rationale: the Flight-2 debrief flagged the parallel-but-separate menus (two open/close pairs, two
  global `document` listeners, bidirectional hand-wired mutual-exclusion — O(n²)) as debt and
  recommended a shared helper *lifting the container menu up to the kebab's level*. This flight is the
  natural home (it's already touching dismissal across both menus).
- Trade-off: a real refactor of two currently-passing surfaces; mitigated by migrating the **kebab
  first** (already APG → behavior-preserving adoption) before the container (which gains behavior).
- **Migrate kebab first (lower risk), then container**: the kebab already has roles + roving + arrow
  nav (`renderer.js:162-240`), so moving it onto the controller should be behavior-preserving and
  proves the controller against a known-good surface before the container uplift adds new behavior.
- **Reconcile BOTH mutual-exclusion call sites in leg 1 (Architect, medium)**: the cross-calls are
  bidirectional — `openContainerMenu()` calls `closeKebabMenu()` (`renderer.js:101`) and
  `openKebabMenu()` calls `closeContainerMenu()` (`:180`). If leg 1 migrates/renames the kebab's
  `closeKebabMenu` without fixing `:101`, the still-old container code throws `ReferenceError` on open
  in the gap between leg 1 and leg 2. Leg 1 MUST keep both call sites consistent — either route `:101`
  through the controller's close-others in the same leg, or keep a `closeKebabMenu` shim until the
  container migrates. (The agentic-workflow batches both legs before the single verify, but a mid-flight
  smoke check would trip on it.)

**DD3 — Container menu uplifted to full APG, preserving its dynamic items + flows**: the container menu
rebuilds its items on each open (jars + Burner + "＋ New container…", `renderer.js:100-134`) with an
inline `left` anchor and Escape-only keyboard. Under the controller it gains `role="menu"` on
`#container-menu`, `role="menuitem"` + roving tabindex on each item, and Arrow/Home/End/Tab nav —
while **preserving**: the dynamic rebuild, the jar **dot** + colors, the Burner and "New container…"
(which opens a `window.prompt`) item behaviors, the createTab-on-select actions, the existing Escape +
focus-restore-to-`▾`, and the inline left-anchor positioning.
- Rationale: SC8 parity + removes the a11y divergence DD5-of-Flight-2 called out.
- Trade-off: the controller must support **dynamic** item sets (container) as well as **static** ones
  (kebab) — `register` takes an optional `buildItems` callback re-run on open; roles/roving are applied
  to the **`.cm-item` buttons only**, NOT all `#container-menu` children. The `window.prompt` in "New
  container…" steals focus — the controller's focus management must not fight it (the prompt closes the
  menu, as today).
- **Non-item child must not break `role="menu"` (Architect, medium)**: the container rebuild includes a
  non-item header `<div class="cm-title">Open new tab in…</div>` (`renderer.js:103`). With
  `role="menu"` on `#container-menu`, a child with no role trips axe `aria-required-children` /
  `aria-required-parent` — which would be a NEW violation, exactly what the verify gate guards. The
  controller must apply `role="menuitem"` + roving **only to `.cm-item`**, and give the title
  `role="presentation"` (or `role="none"`, or convert it to a proper group label). Verify with
  `npm run a11y` that the uplift adds zero violations.
- **Regression contract**: `unified-tab-controls` (▾ opens, container item opens a tab with the right
  jar dot, Escape/focus behavior) and `tab-keyboard-operability` (the tablist roving contract — the
  pill/▾ sit outside the tablist) **must still pass** after the uplift.

**DD4 — Delete Flight-2's hand-wired mutual-exclusion and per-trigger `stopPropagation` reliance**:
remove the `closeKebabMenu()`/`closeContainerMenu()` cross-calls in the open functions
(`renderer.js:101`, `:180`) and the two separate `document` close listeners (`:240`, `:509`); the
controller subsumes both (mutual-exclusion via `open()`, dismissal via one target-aware handler).
- Rationale: the debrief named the bidirectional cross-calls + dual listeners as the debt this flight
  clears; leaving them would be redundant with the controller and re-introduce the O(n²) smell.
- Trade-off: must confirm the kebab-menu spec's **mutual-exclusion (step 11)** and **Tab-closes
  (step 12)** checkpoints still pass through the controller (they should — same behavior, new owner).

**DD5 — Verification apparatus, premise-audited on BOTH axes**:
- *Act* — behavior tests attach to the running `:9222` renderer via the committed
  `scripts/cdp-driver.mjs` (trusted input; never the `chrome-devtools` MCP). Drivable: open menus
  (click/keys), in-chrome outside-click (address bar), cross-trigger click, arrow/Home/End/Escape/Tab.
  **Page/webview-click dismissal**: a *real* guest click may not be cleanly CDP-drivable across
  web-contents → the witnessed path drives it by **focusing the active tab's `<webview>`** (eval
  `document.getElementById('webview-…').focus()`), which fires the same `window` blur the real click
  does; the **real pointer page-click** stays a **manual/HAT** check. App-switch dismissal is manual
  (can't steal OS focus from CDP).
- *Observe* — all assertions read existing surfaces: `aria-expanded` on each trigger, `.hidden`/
  computed `display` on each popup, `document.activeElement`, and (post-uplift) `role="menu"`/
  `role="menuitem"` on the container menu. **No new read path needs building.** A precondition for the
  page-click witnessed path: at least one tab with a loaded webview exists (the default tab loads the
  homepage — satisfied).
- Rationale: the act-axis page-click limitation is the real subtlety (cross-web-contents input); the
  webview-`focus()` seam exercises the actual `window`-blur handler without a fragile guest click.
- Trade-off: real pointer page-click + app-switch are manual; everything else is witnessed.

### Prerequisites
- [ ] App runs via `npm run dev:debug` (CDP `:9222`), renderer target present, **and at least one tab
  with a loaded `<webview>`** (default homepage tab satisfies this — needed for the page-click /
  webview-focus dismissal path). *(Behavior-test execution prerequisite — apparatus-audited.)*
- [ ] `scripts/cdp-driver.mjs` reaches `:9222` (KEYS already include Arrow/Home/End/Tab/Escape from
  Flight 2). The `chrome-devtools` MCP does NOT qualify.
- [ ] `npm run a11y` operational against the running app.
- [ ] GUI/desktop runtime (page-click + app-switch dismissal are platform-visible; macOS deferred).

### Pre-Flight Checklist
- [ ] All open questions resolved (or deferred with rationale)
- [ ] Design decisions documented
- [ ] Prerequisites verified (esp. `:9222` renderer + a loaded webview)
- [ ] Validation approach defined (behavior tests authored + the window-blur premise spiked)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

Three build/verify legs plus an optional HAT. Renderer-only (`renderer.js` + small `styles.css`/
`index.html` role attributes; possibly `webview-preload.js` only if the spike diverts to the
preload-forward fallback).

- **Leg 1 `menu-controller`** — open with the **window-blur premise spike** (divert trigger). Build the
  shared controller (open/close/toggle, focus-into + restore, roving tabindex, APG keydown,
  outside-dismiss = target-aware `document` handler + `window` blur, mutual-exclusion). **Migrate the
  kebab menu onto it** (behavior-preserving — kebab is already APG). Remove the kebab's bespoke
  handlers + its `document` listener + the `closeContainerMenu()` cross-call. (SC8)
- **Leg 2 `migrate-container-menu`** — **APG keyboard uplift only** (role=menu/menuitem, roving
  tabindex, arrow/Home/End/Tab; `.cm-title` → `role="presentation"`) while preserving dynamic items,
  jar dots, Burner/New-container flows, Escape/focus-restore, and the inline left-anchor. *(Per design
  review, leg 1 already registered the container for dismissal + mutual-exclusion and removed the
  cross-calls + dual `document` listeners, so leg 2 does NOT re-remove them.)* Note the shared
  controller in CLAUDE.md. (SC8)
- **Leg 3 `verify-integration`** — run the new `menu-dismissal` behavior test; re-run `kebab-menu`
  (incl. steps 11/12 now served by the controller), `unified-tab-controls`, `tab-keyboard-operability`;
  extend container a11y coverage (per DD5 open question); `npm run a11y` (no new violations);
  manual real-page-click + app-switch dismissal checks.
- **Leg 4 `hat-and-alignment`** *(optional)* — tune dismissal + container-menu feel live.

### Checkpoints
- [ ] Window-blur premise confirmed (or diverted to preload-forward) — menu closes when the webview
  takes focus.
- [ ] Open kebab → click the page/webview → menu closes. Open container → click the page → closes.
- [ ] Open one menu → click the other's trigger → first closes, second opens (cross-trigger).
- [ ] In-chrome outside click (address bar) still closes; Escape + focus-restore still work for both.
- [ ] Container menu is now full APG (role=menu/menuitem, roving tabindex, Arrow/Home/End/Tab) and
  still opens tabs with correct jar dots; Burner + New-container still work.
- [ ] Hand-wired mutual-exclusion + dual `document` listeners removed; behavior unchanged.
- [ ] `menu-dismissal` passes; `kebab-menu` + `unified-tab-controls` + `tab-keyboard-operability`
  still pass; `npm run a11y` clean.

### Adaptation Criteria

**Divert if** (concrete): the **leg-1 window-blur spike** shows `window` blur does NOT fire reliably
when a `<webview>` takes focus on the dev compositor → switch DD1's page-click path to the
**preload-forward fallback** (webview-preload posts a `pointerdown` host message → `closeAllMenus`),
and log the switch. Everything else (controller, container uplift, cross-trigger, in-chrome dismiss)
is unaffected.

**Acceptable variations**:
- Controller in-file vs new file (open question) — leg design.
- Container a11y test: extend `unified-tab-controls` vs new spec (open question) — leg design.
- Exact dismissal event (`pointerdown` vs `click`) for the in-chrome handler — leg design.

### Legs

> **Note:** Tentative; legs are created one at a time as the flight progresses.

- [x] `menu-controller` - window-blur premise spike (CONFIRMED — no divert); built the shared menu
  controller (open/close/dismiss[document+window-blur]/mutual-exclusion); migrated the kebab onto it;
  removed the hand-wired cross-calls + dual `document` listeners. (SC8) *(reviewed; gates green)*
- [x] `migrate-container-menu` - **APG uplift only** (roles/roving/arrow-nav + `.cm-title`
  `role=presentation`) for the `▾` menu, preserving dynamic items + jar/Burner/New-container flows +
  anchor; CLAUDE.md note. *(DD4's removals — cross-calls, dual `document` listeners — and registering
  the container for dismissal/mutual-exclusion are front-loaded into leg 1 per design review, so leg 2
  does NOT re-remove them.)* (SC8)
- [ ] `verify-integration` - `menu-dismissal` behavior test; regressions (`kebab-menu`,
  `unified-tab-controls`, `tab-keyboard-operability`); container a11y coverage; `npm run a11y`;
  manual page-click + app-switch dismissal.
- [ ] `hat-and-alignment` *(optional)* - tune dismissal + container-menu feel live with the operator.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing — `menu-dismissal` + `kebab-menu` + `unified-tab-controls` +
  `tab-keyboard-operability` + `npm run a11y` clean + offline gates (`npm test`/typecheck/lint).
  Any new `els.*` need JSDoc casts (typecheck-gated).
- [ ] Documentation — CLAUDE.md notes the shared menu controller; README only if menu UX docs warrant.

### Verification

How to confirm the flight achieved its objective:

- **Behavior test `menu-dismissal`** — for BOTH menus: open → page/webview click (via webview focus)
  closes; open → cross-trigger click closes-first-opens-second; open → in-chrome outside click closes;
  Escape + focus-restore intact. (window-blur path; real pointer page-click + app-switch manual.)
- **Regression `kebab-menu`** — all 12 checkpoints still pass through the controller (esp. 11
  mutual-exclusion, 12 Tab-closes).
- **Regression `unified-tab-controls` + `tab-keyboard-operability`** — container menu opens tabs with
  correct jar dots; tablist roving contract intact; the container uplift introduced no regression.
  **Confirm Burner + "New container…" flows are witnessed** (they live in the container rebuild the
  uplift touches, `renderer.js:114-127`/`addContainer:147`); if `unified-tab-controls` doesn't cover
  them, add coverage or flag them manual — `menu-dismissal` Step 8 only exercises a *named* container.
- **a11y baseline caveat** — Flight-2 debrief Rec 2 (pin the a11y baseline) is still open (assigned to
  Flight 4), so leg 3's "no new violations" is judged against a manual node-target diff, not a pinned
  baseline. The container uplift should *reduce* violations (it adds `role=menu`/`menuitem`); if axe
  count rises, the `.cm-title` role fix (DD3) is the first suspect.
- **Container APG coverage** — the container menu's new arrow/Home/End/roving nav is witnessed (spec
  per DD5 open question).
- **`npm run a11y`** — no new WCAG A/AA violations (container menu should now *improve*, not regress).
- **Manual** — real pointer click on the page dismisses an open menu; switching apps dismisses it.
