# Flight: Shrink-to-Fit Tab Strip

**Status**: completed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [x] The tab strip never shows a scrollbar at any tab count: tabs shrink
      progressively (title truncates, then inactive tabs lose their close
      affordance, down to a compact floor) while the active tab keeps its
      close affordance. *(behavior-test-backed — `responsive-tab-strip`)*
- [x] (partial) Tab context menu criterion's middle-click clause: middle-click
      on a tab closes it. *(pulled forward into this flight — it is tab-strip
      pointer behavior, same surface as the deferred-reflow close path; the
      context-menu flight inherits it done)*

---

## Pre-Flight

### Objective

Replace the tab strip's shrink-to-88px-then-scroll behavior with Chrome-style
progressive shrink: tabs share the available width down through staged content
disclosure (full → title-ellipsized → close-hidden on inactive tabs → compact
sliver), the strip never grows a scrollbar at any tab count, and the active tab
keeps a usable close affordance at every stage. Middle-click closes a tab
through the same deferred-reflow pointer path as the ✕ button. The
`responsive-tab-strip` behavior spec evolves to pin the new contract and
absorbs the three spec upgrades deferred from the M05 Flight-2 HAT.

### Open Questions

- [x] Can the strip both "never scroll" and hold a hard px floor? → No —
      contradictory at extreme counts. Resolved: no hard floor (DD2).
- [x] How is progressive disclosure driven — JS measurement or CSS? →
      CSS container queries, zero JS (DD1).
- [x] Do numeric geometry reads exist over the automation surface now? →
      Yes — admin-tier `evaluate` against the chrome `wcId` landed with the
      M03+ eval ops (the a11y audit already drives the chrome this way);
      the spec's "no in-page numeric read" apparatus rule is stale (DD4).
- [ ] Exact disclosure thresholds (px at which title/close hide) — tuned
      during leg implementation against real rendering; HAT flight revisits.

### Design Decisions

**DD1 — Progressive disclosure via CSS container queries, no JS**: each `.tab`
becomes an inline-size query container (`container-type: inline-size`);
`@container` rules stage the disclosure as the tab narrows — title hides below
one threshold, inactive-tab close button below another, padding compresses at
the sliver stage. The active tab is exempt from close-hiding via a
`.tab.active` carve-out.
- Rationale: the browser's layout engine already knows each tab's width —
  querying it in CSS avoids ResizeObserver plumbing, rAF batching, and any
  JS state that could drift from rendered truth. Chromium in Electron 42
  fully supports container queries. Works identically during
  `freezeTabWidths()` inline-width pinning (a container query keys off the
  resolved inline size regardless of how it was set).
- Trade-off: thresholds live in CSS, so unit tests can't assert them —
  the evolved behavior spec (numeric `evaluate` reads) is the regression net.
- Premise to verify at leg start (cheap): a `@container`-driven `display`
  flip renders correctly inside the chrome `WebContentsView` (plain chrome
  DOM — the guest-surface invariant is not in play; this is belt-and-braces
  per the "DOM correct ≠ render correct" history).

**DD2 — No hard width floor; the scrollbar becomes structurally impossible**:
`#tabs` switches `overflow-x: auto` → `overflow: hidden`; `.tab` drops its
`min-width: 88px` floor entirely (flex-shrink may compress tabs to slivers at
extreme counts, Chrome-like).
- Rationale: issue #82 pins "no scrollbar at any tab count." A hard floor plus
  no-scroll would clip trailing tabs invisibly at extreme counts — strictly
  worse than slivers, which stay visible, clickable, and keyboard-reachable
  (roving tabindex is unaffected by width).
- Trade-off: at absurd counts (50+ tabs in a narrow window) individual tabs
  are hard to hit by pointer; keyboard nav and the (future) tab context menu
  remain fully usable. (Chrome proper holds a ~36px floor and falls back to
  overflow handling for the pathological tail; Goldfinch trades that floor
  for the absolute no-scrollbar guarantee. HAT revisits if slivers offend.)
- **Spec consequence (design-review ruling): the old spec's Step 4 is
  REPLACED, not re-tuned.** Its premise — a scroll-onset threshold exists —
  has no code path under this DD. The evolved spec asserts the positive
  claim instead: at a pathological count (e.g. 60+ tabs) **no scroll
  affordance appears and no tab is clipped out of the strip** — every tab
  still occupies nonzero width. The old "Out of Scope: scroll-onset count"
  line is dropped with it.
- Incidental cleanup owned by this DD: the stale scroll-based comments on
  `#tabs` ("can shrink below content so its own scroll engages") and
  `#tabstrip-drag` ("…overflow-x:auto… yields and scrolls…") are rewritten
  (the yield mechanism survives — automatic min-size resolves to 0 under any
  non-`visible` overflow, so `#tabs` still cedes the 56px drag reservation —
  but the *scroll* wording is wrong once `hidden` lands), and the now-dead
  `scrollbar-width: thin` declaration is removed.

**DD3 — Middle-click close rides the existing pointer-close path**: an
`auxclick` (button 1) handler on the tab element routes into the same
`releaseTabWidths`-aware close flow as the ✕ button (`freezeTabWidths()` +
`closeTab(id)`), so deferred reflow-on-pointer-close applies identically.
- Rationale: middle-click is a pointer close; diverging from the ✕ path would
  fork the deferred-reflow contract the behavior spec pins.
- Trade-off: none identified; `auxclick` also fires for button 3/4 — the
  handler filters `e.button === 1` explicitly, and calls `preventDefault()`
  (design review: documents intent even though middle-click autoscroll is
  already foreclosed by the chrome's `overflow: hidden` document). No
  existing `auxclick`/`mousedown` handler exists on `.tab` — clean landing.

**DD4 — Spec evolution adopts numeric reads; screenshots demote to fallback**:
`responsive-tab-strip.md` is updated in the same flight (BACKLOG rider): the
apparatus gains admin-tier `evaluate(chromeWcId, …)` numeric geometry reads
(`getBoundingClientRect`/`scrollWidth` over `#tabs`/`.tab`) as the
**first-class observable** — width-invariance, slide-left, and re-expand
checks become numeric comparisons; `captureWindow()` remains for
visual/rendered-truth checks and as the WSLg-distortion fallback. The spec
also gains the fixture-distinctness probe (duplicate page titles made a prior
run ambiguous). Act path: `click`/`pressKey` (unchanged, cited in the spec);
read path: `evaluate` + `captureWindow` + `readAxTree` — both axes exist on
the current surface today (chrome `wcId` via `getChromeTarget`, admin key).
- Rationale: the Flight-2 HAT explicitly deferred these three upgrades to the
  next touch of this spec; numeric reads remove the Step-6 "cannot cleanly
  separate reflow causes" ambiguity the old spec had to flag.
- Trade-off: the spec becomes admin-eval-dependent; acceptable — it already
  requires the admin key for `getChromeTarget`.

**DD5 — The keyboard-operability contract is untouched at comfortable widths**:
close buttons remain real, named `button`s in the DOM at all times; the
close-hidden stage is `display`-driven and applies only under width pressure
to **inactive** tabs. `tab-keyboard-operability` runs at low tab counts where
every close button is visible; Delete/Backspace close (which needs no button)
works at every width. The evolved `responsive-tab-strip` spec notes the
interaction explicitly.
- Rationale: extend, don't erode, the pinned a11y contract (mission
  constraint).
- Trade-off: an AT user at extreme tab counts loses the pointer-equivalent
  close *button* on narrow inactive tabs (Delete/Backspace and — later this
  mission — the tab context menu cover the capability).

### Prerequisites

- [x] Mission 09 active; no other flight in progress.
- [x] Working tree clean on `main` (v0.9.1, `fa6fb1a`).
- [x] BACKLOG anchors verified against current code: `#tabs { overflow-x:
      auto; … }` and `.tab { … min-width: 88px; … }` live in
      `src/renderer/styles.css` (Architect probe, mission design).
- [x] Behavior apparatus available: `npm run dev:automation` +
      `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` mints
      admin key; `getChromeTarget` + `evaluate` + `captureWindow` all on the
      current 28-tool surface (act + observe axes audited).
- [ ] Fixture port free at behavior-test run time (`:8000` family — probed by
      the spec's own precondition).

### Pre-Flight Checklist

- [x] All open questions resolved (threshold tuning delegated to leg + HAT)
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

All changes are chrome-renderer-local (`src/renderer/`): CSS restructuring in
`styles.css` (`#tabs` overflow, `.tab` flex basis/floor removal,
container-query stages, active-tab carve-out) plus a small `renderer.js` touch
(`auxclick` handler in the tab-button wiring inside `createTab`; container
registration is pure CSS). No main-process, preload, or IPC changes. The
guest view is never resized or repositioned by any of this — the strip is
chrome DOM above the guest slot (the native-surface invariant is not
engaged). The `responsive-tab-strip` spec rewrite lands in the same flight so
the regression net moves with the behavior, never trailing it.

### Checkpoints

- [x] Progressive shrink renders correctly live (spot-check via dev launch)
      before the spec rewrite locks numeric thresholds.
- [x] Evolved `responsive-tab-strip` behavior test passes end-to-end (run 2: 10/10).
- [x] `npm run a11y` chrome sweep green (strip states unchanged at
      comfortable widths).

### Adaptation Criteria

**Divert if**:
- Container queries misrender inside the chrome `WebContentsView` (premise
  check fails) → fall back to a ResizeObserver + class-toggle implementation;
  same staged contract, new DD.
- Numeric `evaluate` reads against the chrome prove unusable for geometry
  (unexpected surface restriction) → spec keeps screenshot-primary apparatus;
  DD4 narrows to fixture-probe + fallback-note only.

**Acceptable variations**:
- Exact threshold px values, sliver padding, and whether the jar dot also
  hides at the sliver stage — implementer's judgment, recorded in the leg.
- Ordering of title-hide vs close-hide stages if live rendering argues for it
  (Chrome hides the title text before the close control on inactive tabs;
  match Chrome unless it looks wrong in Goldfinch's chrome).
- A *soft* visual minimum at the sliver stage (padding/border keeping slivers
  legible) is implementer's judgment — PROVIDED the invariant holds: nothing
  may reintroduce a scrollbar or clip tabs out of the strip. A hard
  `min-width` floor is NOT an acceptable variation (it breaks the no-clip
  guarantee); if live rendering argues for a real floor, that is a divert.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as the flight progresses. This list will
> evolve based on discoveries during implementation.

- [x] `progressive-shrink-and-middle-click` — CSS container-query staged
      shrink (DD1/DD2), active-tab close carve-out, middle-click close (DD3),
      live render spot-check, `responsive-tab-strip.md` spec evolution (DD4/
      DD5), BACKLOG entry retirement.
- [x] `verify-integration` — run the evolved `/behavior-test
      responsive-tab-strip` against the live app; `npm run a11y` sweep;
      `npm test` / `lint` / `typecheck`; confirm `tab-keyboard-operability`
      spec needs no text change (audit only).

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (PR open — merges after flight review)
- [x] Tests passing
- [x] Documentation updated (BACKLOG entry retired; CLAUDE.md tab-strip note
      if the strip's described behavior changed)

### Verification

- Evolved `tests/behavior/responsive-tab-strip.md` passes (numeric-read
  apparatus): shrink-to-fit staging, no scrollbar at any count, deferred
  pointer-close reflow (✕ **and** middle-click), immediate keyboard-close
  reflow, maximize-state read path.
- `npm run a11y` green across chrome states.
- `npm test`, `npm run lint`, `npm run typecheck` green.
