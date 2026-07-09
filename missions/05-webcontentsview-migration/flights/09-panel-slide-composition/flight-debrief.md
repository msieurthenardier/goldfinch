# Flight Debrief: Side-Panel Slide Composition (#27 / SC10)

**Date**: 2026-07-07
**Flight**: [Side-Panel Slide Composition](flight.md)
**Status**: landed
**Duration**: 2026-07-06 (planning) → 2026-07-07 (landed)
**Legs Completed**: 3 of 3 (01-slide-probe, 02-hat-and-certify, 03-fix-slide)

## Outcome Assessment

### Objectives Achieved

**SC7 / #27 / SC10 CERTIFIED and closed** — the mission's longest-standing "DOM-correct ≠
render-correct" item, which defeated three CSS mechanisms under `<webview>` in Mission 04. The
media/privacy panels composite correctly over the live guest: **at rest** (flush, no gap/overlap —
Leg-1 Witnessed `panel-slide` run 6/6) AND **on open/close** (instant, no mid-slide mis-render). The
resolution was to **retire the un-animatable slide** (panels open instantly) rather than make it
smooth — because the slide is structurally un-animatable (see Key Learnings). One source change: the
panel width CSS transition removed. Zero UX loss (operator-confirmed at the HAT); zero new tests
(appropriate — a proven CSS deletion with no new logic); gates green (1050/1050, typecheck, lint).

### Mission Criteria Advanced

- **SC7 (bonus, free-only)** — certified. The F1 spike's "SC7 looks free" prediction was *earned*,
  though not in the way anticipated: the settled compositing is free (always worked), but the slide
  animation had to be retired to close #27.

### Checkpoints

- **CP1 (Leg-1 probe)** — PASS on settled compositing (6/6 Witnessed), objective net complete + clean.
- **CP2 (Leg-2 HAT)** — initially FAILED (glitch reproduced) → triggered Leg 3 → PASS after the fix.

## What Went Well

- **DD1 caught at planning (operator correction).** The operator reframed my initial overlay-migration
  proposal into "panels compress side-by-side, not overlay" *before any leg ran* — grounded in a hard
  constraint (chrome is opaque and stacked below the guests, so an overlay panel would paint over the
  guest). This kept the flight tiny (2 legs + 1 conditional) instead of a panel re-architecture, and
  correctly scoped #27 as the slide *animation*, not overlay-vs-inset. Highest-leverage decision in
  the flight.
- **The probe/HAT split earned its keep by disagreeing.** DD4 drew the apparatus boundary precisely:
  settled compositing is objectively Witnessed-provable (`captureWindow` + geometry); inter-frame
  smoothness is HAT-only (discrete grabs are settled frames). That split is *why* the Leg-1 run could
  pass 6/6 on settled state yet the Leg-2 HAT still caught the glitch — two genuinely different
  properties, never conflated. The strongest design decision in the flight.
- **Pre-authorized conditional Leg 3 absorbed a wrong mechanism guess cleanly.** DD6 budgeted the fix
  as "make the slide smooth via per-frame geometry sync," which turned out impossible — but because
  Leg 3 was pre-authorized (authorize the *outcome*, budget a *plausible mechanism*), the glitch at
  the HAT fired straight into diagnosis with no re-charter round-trip, and the mid-execution-scope-
  change discipline let the actual mechanism (retire the slide) diverge from the budgeted one, deviation
  recorded in three places. Textbook adaptive planning.
- **Live diagnosis was rigorous.** Slowed the transition 2s→10s, instrumented via `evaluate` (proved
  the DOM layout perfect — toolbar stable, no overflow, guest snaps at t=0), and the **operator's
  mid-slide screenshots** proved the composited output wrong. The conclusion (retire the slide) was
  *earned* by that evidence chain, not asserted.

## What Could Be Improved

### Process / Diagnosis
- **The WSLg attribution was wrong — a real error, corrected only at debrief by the operator.** The
  in-flight diagnosis (and both crew debrief agents) concluded the glitch "mis-composites on WSLg."
  The operator's debrief input corrected it: **the identical glitch occurs on the native Windows
  build.** So it is platform-independent (reproduces across `<webview>`→`WebContentsView` AND
  WSLg→native Windows). **Root cause of the error:** I over-pattern-matched — the two prior mission
  render defects (F7 find cold-start, F8 click-swallow) genuinely *were* WSLg, so a third render
  defect got the same label without a native-platform control. The crew agents (running on the WSLg
  repo) could not perform that control; only the operator could. **Lesson (now in CLAUDE.md + mission
  Known Issues):** never attribute a render defect to the rig without a cross-platform control; "the
  last two were WSLg" is not evidence the next one is. All artifacts corrected post-debrief.
- **Leg-1 CP1 over-graded a mis-timed capture as "CLEAN."** The probe captures landed on settled
  frames and reported "stable" for a defect that is real but only visible mid-slide. Technically
  correct (it *was* clean at the sampled frames), but the "COMPLETE + CLEAN" grade created momentary
  false confidence that only the DD6 "must be earned at CP2, not rubber-stamped" discipline caught.
  Lesson: a probe should report *"no defect at sampled settled frames,"* never *"clean"* unqualified,
  for anything whose defect is inter-frame — and a green probe must never soften a HAT gate.
- **Leg 3 under-budgeted diagnostic depth.** The charter framed Leg 3 as "apply the pre-authorized
  fix" (a mechanism), when the premise — a render defect invisible to DOM that had defeated three
  prior attempts — should have signaled "diagnose-then-fix" with the slow-motion + operator-screenshot
  apparatus pre-staged rather than improvised live. Minor; self-corrected inside Leg 3.

### Technical
- **Stale `prefers-reduced-motion` comment** (`styles.css:~1334`) still lists "panel widths" as a
  neutralized transition; panels no longer transition. Harmless (the `*`-selector block still works),
  cosmetic. Fold into the next flight that touches `styles.css`.

## Test Metrics

`npm test`: **1050 / 1050 pass, 0 fail, 0 skip, 0 flake**, ~5.1s. `npm run typecheck`: clean.
`npm run lint`: clean. `npm run a11y`: N/A (CSS-transition-only change; no panel DOM/ARIA touched).

**Trajectory:** F7 landed 953 → F8 landed 1050 (+81, new suites) → **F9: 1050 (+0)**. F9 is the
**first flight in the mission to add zero tests** — and that is correct here, not a coverage gap: the
change is a CSS transition *deletion* with no new logic to unit-test. The regression net is the
`panel-slide` Witnessed spec (settled compositing, now `active`) plus the rationale comment on both
panels. In-flight gate runs (Leg 1, Leg 3) both reported 1050/1050 — no drift to the landed tip.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg-3 fix INVERTED the budgeted mechanism (retire the slide, not make it smooth) | Live diagnosis proved the slide structurally un-animatable (guest steps) | Yes — pre-authorize the *outcome*, let diagnosis override the *mechanism* |
| WSLg root-cause attribution corrected to platform-independent at debrief | Operator reproduced the glitch on native Windows | Yes — require a cross-platform control before blaming the rig for a render defect |
| Zero new tests | Proven CSS deletion, no new logic | Yes — a verify/fix flight adding zero tests is healthy; only a *build* flight adding zero is a red flag |

## Key Learnings

1. **Guest-view geometry is un-animatable — the guest steps (the load-bearing finding).** A
   `WebContentsView`/`<webview>` guest re-bounds in ONE discrete `setBounds` step; it cannot animate
   in lockstep. Any chrome-side layout that *animates geometry around the guest slot* (a sliding
   panel, a split-view drag) creates a chrome-ramps-while-guest-steps mismatch that mis-renders the
   composited frame **on every platform**. This single mechanism explains all four #27 failures
   (M04's three + F9). **Invariant (now in CLAUDE.md):** never animate chrome layout that
   resizes/repositions the guest slot — animate only things that float *over* the guest (F7 find bar,
   F8 menu sheet) or make the layout change instant.
2. **Compositing-layer render defects are invisible to DOM + automated captures — and not always
   WSLg.** Three times this mission (F7, F8, F9) a real render defect was invisible to DOM reads,
   a11y, `evaluate`, AND discrete `captureWindow` grabs (which settle) — visible only to a human eye /
   operator screenshots in motion. But F9 also proved the corollary: **don't assume the rig.** F7/F8
   were genuinely WSLg; F9 was cross-platform. DOM+capture are necessary-but-insufficient; a HAT/
   operator-screenshot pass is authoritative for guest-region changes — and a native-platform control
   is required before attributing to WSLg.
3. **Retiring a mechanism can be the correct fix, not a workaround.** When a mechanism is structurally
   un-achievable (the slide), removing it (and aligning the chrome with the reality the guest already
   enforced — instant) is *more* correct than any amount of fighting the compositor. M04 burned three
   attempts trying to make the slide smooth; F9 closed #27 by deleting it.

## Recommendations

1. **Correct the stale Flight-6 charter (done in this debrief).** Mission.md line 209 described F6 as
   "media/privacy panel as a native **overlay**" — refuted by DD1 (panels compress, not overlay) and
   the panel work is now done (SC7 certified). F6 reduces to **parity-sweep + macOS build-readiness +
   merge-to-main**. Corrected in mission.md; do not let the stale language mislead F6 planning.
2. **The guest-steps invariant is now documented (CLAUDE.md + mission Known Issues).** Any future
   panel/overlay/split-view work must respect it. This would have saved M04's three reverts and framed
   F9's Leg 3 correctly from the start.
3. **F6 macOS pass: one-line HAT confirm only.** Instant-open cannot mis-render on any platform (no
   mid-slide frames), so no per-OS re-validation of the slide is owed — but a one-line HAT that instant
   panel open/close reads clean on macOS closes the "we only looked on the WSLg + Windows builds" gap.
   Do NOT reopen a macOS-only slide (resurrects cross-platform divergence).
4. **Cosmetic:** scrub "panel widths" from the `prefers-reduced-motion` comment next time `styles.css`
   is touched.

## Action Items

- [x] **Correct the WSLg misattribution** across flight artifacts + CLAUDE.md + mission Known Issues
  (operator debrief input) — done in this debrief.
- [x] **Correct the stale Flight-6 charter** in mission.md (strike "native overlay panel" + done SC7).
- [x] **Document the guest-steps invariant** in CLAUDE.md + mission Known Issues.
- [ ] **Flight 6**: parity sweep + macOS build-readiness + merge-to-main; include a one-line HAT confirm
  of instant panel open/close on macOS.
- [ ] **Cosmetic** (next `styles.css` touch): scrub "panel widths" from the reduced-motion comment.
