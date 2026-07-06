# Flight: Side-Panel Slide Composition (#27 / SC10)

**Status**: ready
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria

- [ ] **SC7 — Side-panel compositing (#27 / SC10) — bonus, free-only.** The media/privacy panel
  open/close **slide** composites correctly over the live guest surface on the native
  `WebContentsView` architecture — the guest compresses/expands in sync with the panel edge, no
  tear, lag, jump, or residual gap/overlap — closing the mission's longest-standing
  "DOM-correct ≠ render-correct" item. Explicitly droppable if it proves NOT free (mission SC7
  clause).

## Pre-Flight

### Objective

Verify, on the native surface, that the media and privacy **side-panel open/close slide** renders
correctly and certify SC7/#27/SC10 — panels stay **side-by-side, compressing the main content**
(no overlay, no layout-model change). #27 is the *animation smoothness*, not overlay-vs-inset: the
panel width-slide (0→360px) kept tearing under `<webview>` because the out-of-process guest surface
couldn't track it (three CSS mechanisms failed identically, reverted at the Mission-04 Flight-6
HAT). The F1 spike predicted "#27 does not reproduce under native views; SC7 looks free." This
flight is **verify-first**: look at the current plain-CSS-width slide on the native surface; if it's
smooth for both panels, certify SC7 closed with evidence; if it still glitches, fix it (now feasible
because main-process geometry can drive the guest bounds in lockstep — the whole reason this mission
exists).

### Open Questions

- [ ] **Is the current slide smooth on the native surface?** — the load-bearing unknown, resolved by
  the Leg-1 probe + Leg-2 HAT. A gate with a recorded fallback (drop SC7, or fix), not a blocker.
- [ ] **Does the privacy-panel content-population-during-slide asymmetry persist?** (M04: Media slid
  smoothly, Shields glitched because its stats populate *during* the open frame, causing reflow.)
  Resolved by exercising the privacy panel WITH live content in Leg 1/2.

### Design Decisions

**DD1 — Panels stay chrome-DOM insetting siblings (side-by-side / compress); NOT overlays.**
- The overlay-`WebContentsView` pattern (F7 find bar, F8 menu sheet) was **considered and rejected
  by operator decision (2026-07-06)**: those float *over* the guest; the panel must **compress** the
  content, not cover it. The current model — `#media-panel`/`#privacy-panel` as `flex: none` siblings
  of `#webviews` inside `#main` (`display:flex`), opening from `.collapsed {width:0}` to
  `width: var(--panel-w)` (360px), with the guest re-bounded to the narrowed slot — is the intended
  behavior and does not change. `#27`/SC10 is orthogonal to this: it is purely whether the *slide
  transition* composites cleanly.
- Consequence: this flight touches CSS/animation and the guest-bounds-sync path only. No overlay
  view, no shared-overlay-base extraction (that F8-debrief item is unrelated to this flight and
  stays a separate maintenance concern).

**DD2 — Verify-first, probe-gated (the F1/CP1 discipline).**
- Leg 1 is a native-surface **probe** producing objective evidence (sampled start/mid/end frames per
  panel + resting-state guest-vs-panel geometry via the drafted `panel-slide` Witnessed spec). Leg 2
  is the **HAT** where the operator makes the smoothness call on continuous live motion (the property
  no discrete capture can prove — see DD4). Certify → SC7 closed; glitch → Leg-3 fix (pre-authorized,
  conditional).
- Rationale: the F8 lesson — *pixel probes gate compositing/geometry; smooth motion is HAT-only.* The
  probe establishes resting compositing correctness + mid-slide geometry tracking objectively; the
  human eye on continuous motion certifies no-tear/no-lag.

**DD3 — Both panels, and the privacy panel exercised on a REAL tracker-heavy page.**
- The M04 #27 asymmetry (Media smooth, Shields glitchy) rooted in privacy-stats arriving **async**
  and reflowing the body *during* the open frame. Design-review correction: `renderPrivacy()`
  (`renderer.js:2109-2188`) unconditionally appends its ~8 sections the instant the panel opens, so a
  `#privacy-body` child-count check passes even with zero activity — the static local fixture proves
  nothing. Verification MUST open privacy on a **real page with tracker/third-party activity**
  (a non-zero Trackers/Third-party stat), and the async-reflow-during-open property is **HAT-observed
  on that real page** (it is inter-frame, not a settled grab). Both open AND close slides, both
  panels, and the cross-panel switch (media↔privacy, which routes through `closePrivacyPanel`/
  `togglePanel`).

**DD4 — Apparatus (verified on both axes at planning).**
- *Act*: `npm run dev:automation` (the standing dev instance on `127.0.0.1:49252`, semi-permanent
  admin key, project-scope `goldfinch-development` MCP) drives panel open/close via `evaluate` on the
  chrome wcId (`document.getElementById('toggle-media').click()` / `toggle-privacy`) and captures via
  `captureWindow` (OS-grab path). Both proven this mission (F7/F8 Witnessed runs).
- *Observe*: resting-state compositing (guest bounds flush to the open/closed panel, no gap/overlap)
  and mid-slide geometry (guest left/right edge vs panel edge at a sampled frame) are readable from
  `captureWindow` pixels + the guest bounds the renderer sends (`measureWebviewsSlotDIP` →
  `tabSetBounds`). **Apparatus limit (recorded):** *inter-frame smoothness* — the absence of
  tear/lag/stutter *between* frames — is NOT provable from discrete `captureWindow` grabs (each grab
  is a settled frame); it is **HAT-authoritative**, exactly as OS-pointer interception was in F8.
  The `panel-slide` behavior test therefore asserts resting + sampled-frame geometry (the
  regression net); the HAT certifies smoothness.
- Motion guest required: the slide's tearing is only visible with the guest showing motion behind it
  — reuse the ticking `tests/behavior/fixtures/menu-overlay/` fixture (or a video page) so a lagging
  guest edge is perceptible.

**DD5 — SC7 stays droppable.** This flight *pursues* SC7 because the F1 spike suggested it's now
free. If Leg 1/2 find it glitchy AND the fix proves non-trivial, the operator may **drop SC7** (the
mission's explicit free-only clause) rather than commit to a fix — recorded as an adaptation path,
not a divert.

**DD6 — The ~1-frame guest-bounds lag is structural; "free" is plausible, not guaranteed
(design-review).** Even on native views the panel width animates in the **chrome renderer's
compositor** while the guest re-bound travels renderer → async IPC (`tabSetBounds`) → main
`setBounds`, coalesced to one rAF (`rafGeometryPending` guard, `renderer.js:938-940`) — so the guest
bounds structurally trail the CSS layout by ~1 frame. The F1 "SC7 looks free" prediction is plausible
but must be *earned* at CP1/CP2, not rubber-stamped. This is exactly why Leg 3 (per-frame
main-driven geometry / transform-composited slide) is pre-authorized: it is the correct fix for this
lag if the eye catches it. **Keyboard-toggle asymmetry (LOW, design-review):** the Ctrl+M /
Ctrl+Shift+P shortcut cases (`renderer.js:2354-2360`) call `togglePanel()`/`togglePrivacy()` but
NOT the explicit `sendActiveBounds()` the click handlers do — they rely solely on the `#webviews`
ResizeObserver. The Leg-2 HAT must exercise the keyboard toggles too (operators use them), so the
observer-only re-bound path is certified, not just the click path.

### Prerequisites

- [x] Native `WebContentsView` guest surface shipped (F2/F3) — panels already inset the native guest.
- [x] Standing dev automation apparatus: `goldfinch-development` project-scope MCP → dev instance on
  `127.0.0.1:49252`, semi-permanent admin key; `captureWindow` OS-grab path proven on this rig
  (F7/F8 Witnessed runs). *Re-confirm the OS-grab path (not the WSLg fallback) at Leg-1 via the
  find-bar capture canary before trusting any frame.*
- [x] Wayland dev backend (F8): `npm run dev:automation` routes through `scripts/dev-launch.mjs`
  (selects `--ozone-platform=wayland` under WSLg). Frame capture assumes the Wayland composite path.
- [ ] Operator available for the Leg-2 HAT (smoothness is HAT-authoritative). *Verified at execution.*

### Pre-Flight Checklist

- [x] Open questions owned by legs with recorded gates (Leg-1 probe, Leg-2 HAT)
- [x] Design decisions documented
- [x] Prerequisites verified (execution-time HAT availability noted)
- [x] Validation approach defined (see Verification)
- [x] Legs defined (tentative)

## In-Flight

### Technical Approach

Verify the existing plain-CSS-width slide on the native surface before changing anything:

1. **Probe** (Leg 1): drive both panels open/close over a live motion guest via the dev MCP; sample
   start/mid/end `captureWindow` frames per panel; author + run the `panel-slide` Witnessed spec for
   the objective net (resting compositing flush-to-panel + mid-slide guest-edge geometry, both
   panels, privacy WITH content, cross-panel switch). Flag any tear/gap/overlap visible in frames.
   **Gate**: frames clean + geometry tracks → the slide is a certify candidate; anomaly → carry to
   the HAT and pre-arm Leg 3.
2. **HAT + certify** (Leg 2): operator watches both slides live on the motion guest (open, close,
   cross-panel switch, resize-while-open), makes the smoothness call, and either **certifies SC7/#27/
   SC10 closed** (promote the `panel-slide` spec to active; check SC7; land the flight) or triggers
   Leg 3.
3. **Fix** (Leg 3, conditional — pre-authorized): only if a glitch is confirmed. Drive the guest
   bounds in lockstep with the animation (per-frame main-process geometry sync) or a
   transform-composited slide, now feasible on native views; re-verify + re-HAT. If unused, the
   flight lands at Leg 2.

### Checkpoints

- [ ] **CP1 (gate)**: Leg-1 probe — resting compositing correct (guest flush to open/closed panel,
  no gap/overlap, both panels incl. populated privacy) and mid-slide geometry tracks; frames show no
  gross tear. Clean → certify candidate; anomaly → HAT + Leg 3.
- [ ] **CP2**: Leg-2 HAT — operator certifies both slides smooth (no tear/lag/jump) on continuous
  live motion, including the privacy-content-population case and the cross-panel switch. Pass → SC7
  certified.

### Adaptation Criteria

**Divert if**: the slide glitches AND a fix proves non-trivial → operator options-review (fix vs
**drop SC7** per DD5; the mission permits dropping it).

**Acceptable variations**: a purely cosmetic tuning of the slide (duration/easing) folded into Leg 3
if the operator wants polish while a fix is open; sampling more/fewer frames in the probe.

### Legs

> **Note:** Tentative; designed one at a time as the flight progresses.

- [ ] `01-slide-probe` — native-surface frame + geometry probe (both panels, populated privacy,
  cross-panel switch); author + run the `panel-slide` Witnessed spec; CP1 gate
- [ ] `02-hat-and-certify` — guided HAT (operator smoothness call on live motion); certify SC7 or
  trigger the fix; promote the spec; land
- [ ] `03-fix-slide` *(conditional, pre-authorized)* — only if a glitch is confirmed: per-frame
  guest-bounds sync / transform-composited slide + re-verify

## Post-Flight

### Completion Checklist

- [ ] SC7 certified (closed) OR consciously dropped (DD5) — recorded either way
- [ ] `panel-slide` Witnessed spec promoted to `active` (or parked with reason)
- [ ] Merged to `mission/05-webcontentsview-migration` (local; `main` untouched)
- [ ] Tests passing (unit + typecheck + lint; a11y only if Leg 3 touches panel DOM)

### Verification

- **Leg-1 probe**: `panel-slide` Witnessed run (resting flush-to-panel geometry both panels +
  populated privacy + cross-panel switch + mid-slide guest-edge sampling); frame evidence for the
  HAT.
- **Leg-2 HAT (authoritative for smoothness)**: operator observes open/close/switch/resize-while-open
  for both panels on a live motion guest; no tear/lag/jump/gap. Must include: **both the click AND
  keyboard (Ctrl+M / Ctrl+Shift+P) toggle paths** (DD6 — the keyboard path skips the explicit bounds
  send); and the **privacy panel on a real tracker-heavy page** (DD3 — the async-populate-during-open
  asymmetry is only visible there, live).
- **Gates**: `npm test`, `npm run typecheck`, `npm run lint` (a11y iff Leg 3 changes panel DOM).
- **Source-absence**: n/a (no deletions expected unless Leg 3 replaces the animation mechanism).
