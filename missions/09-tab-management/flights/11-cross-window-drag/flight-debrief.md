# Flight Debrief: Cross-Window Tab Drag

**Date**: 2026-07-17
**Flight**: [Cross-Window Tab Drag](flight.md)
**Status at debrief**: landed → completed
**Commits**: `568c834` (legs 1–3), `54b2e48` (leg 4 + flight landed). PR #93 (stacked, covers F10+F11).

## Outcome

**Criterion 8 is satisfied.** The tab-drag layer was replaced wholesale with native HTML5 DnD — one
Chrome-parity gesture for in-window reorder, tear-off, and cross-window move — and the operator
witnessed the full cross-window gesture live on X11 (tab moved A→B across bare desktop to a
non-overlapping window; same `wcId`, jar intact, live history). The `tab-adopt-by-drop` IPC reuses the
`moveTabIntoWindow` core behind a drag-provenance gate (DD2). The behavior-spec net was re-authored to
match the shipped reality (`cross-window-drag.md`, HAT-apparatus; `tab-tearoff` re-scoped to its
surviving keyboard rows). Suite 1973 / 0 / 0; lint + typecheck clean; DD11 budgets honored
(main.js +36/≤60, renderer.js +10/≤40, preload +9/≤10).

**The flight's defining event was not the feature — it was the diagnosis.** The drag "boundary death"
(any native drag canceled at the window edge) consumed three wrong code-shaped hypotheses, a full
rip-out-and-rebuild of the uncommitted Leg 2, and a four-probe fidelity ladder before the identical
minimal probe, relaunched with `--ozone-platform=wayland`, reproduced it exactly. **The code was never
the defect; the environment was** — and the disproof had been in the repo since M05 F8 (which chose
Wayland for the first-click fix precisely because the ozone backend changes input behavior).

## What Went Well

- **DD2 as "owed, not inherited" prevented a silent authority weakening.** The first payload-names-the-
  source IPC shipped WITH a provenance gate consistent with the DD8 doctrine: declare-at-dragstart with
  sender-owns-wcId verification, consume-at-adopt, 1500ms cross-pipe grace, consume-on-success,
  WeakMap-per-record timers. The forged-MIME vector is closed. (Architect: "the flight's best decision.")
- **The increment-gated rebuild converged where hypothesis-driven fixes had not.** Rip to a
  probe-proven minimal core, re-add one feature per increment, operator live-gate per increment ("the
  increments ARE the bisection"). It also produced *better* code than the original — Leg 2 landed as a
  net-negative rewrite that deleted the pointer machine, `shouldArm`/threshold (retiring the F9 debt),
  the click-suppression flag, and the ghost pill outright.
- **Risk-tiering paid.** The Leg 3 design review (HIGH → review) caught six real issues pre-
  implementation, including the reverse-ordering false "Move canceled" and two of three test-pin arity
  bumps; the Leg 4 review caught the missing observation surface in the new spec's preconditions, the
  miscounted dead-row set, and the live synthetic-`DragEvent` green-wash trap.
- **Honest-record discipline held under pressure.** The overturned "tear-off is solid" verdict, the
  falsified DD5 overlap concession, and the twice-extended DD5 are all dated corrections appended over
  preserved provenance — never edited away.
- **The pure-module seam proved out again**: `classifyDragPoint` survived the entire rewrite unchanged
  and gained a second consumer (dragend release-point classification).

## What Could Be Improved

- **The spike measured the wrong environment — the flight's defining miss.** Leg 1 (and F10 Station C
  before it) ran probes bare-`electron` = X11 while the app runs Wayland. Q1–Q3 were answered correctly;
  the unasked Q0 — *does any of this hold under the app's real launch flags?* — invalidated the GO's
  boundary behavior and cost a rewrite-of-the-rewrite plus two debug rounds. Three catchable points:
  the in-repo M05 F8 ozone knowledge was never cross-referenced at planning; the inherited GO was never
  fixture-fidelity-audited; probes printed no environment fingerprint (the `text-input-v3` Wayland
  fingerprint sat in the operator's log unnoticed).
- **Leg 2's original acceptance evidence couldn't distinguish "released on desktop" from "canceled at
  edge"** — boundary-exit dragend coordinates (`-10`) were misread as desktop releases and "VERIFIED
  WORKING" was recorded, then overturned. Acceptance evidence for gesture work must discriminate the
  outcomes, not just observe an effect.
- **Geometry was the wrong instrument for cross-window disambiguation** (the `releaseInsideViewport`
  design error): release-point geometry cannot disambiguate outcomes that live in another window;
  ownership questions resolve main-side. Now recorded in the leg spec.
- **Three code-shaped hypotheses against one persistent symptom should have triggered the environment
  question sooner.** The fidelity-probe ladder was the discriminating instrument; it was the fourth
  move and should have been the second.
- **The source-scan invariant idiom is showing strain**: one new `moveTabIntoWindow` caller forced pin
  bumps in three suites (one unsanctioned by review, caught by the implementer); the `maskComments`
  apostrophe blind spot corrupted three pins in a first draft; an indentation-substring collision forced
  a two-line mutation anchor; and the move/drag scan cluster now costs ~1.0s of attributed test time
  re-masking the same god files.

## Test Metrics

Single full run: **1973 pass / 0 fail / 0 skipped**, 93 files, ~1.36s wall. No flakes observed.
Reconciles exactly: F10's 1965 −5 retired `shouldArm` +3 `isOutsideStrip` (→1963) +1 DD4 pill-free pin
(→1964) +9 `tab-adopt-by-drop` pins (→1973). Wall ~1.22s (F9) → ~1.32s: ~8% for +25 tests, unremarkable.
Timing tail unchanged in shape: `automation-mcp-server` ~1.0s (real HTTP), the fs-heavy
history/downloads cluster ~2.5s combined, then the move/drag source-scan cluster (~1.0s across six
suites — see improvement note). `session-restore-wiring` 156→239ms — part growth, part parallel-
contention inflation; cross-debrief per-suite numbers are not measured identically, quote deltas
cautiously.

## Technical Debt & Accepted Boundaries

1. **DD5 (environment):** cross-window drag is X11-only on this rig (Wayland cancels at the source
   surface — corrected twice, final shape in flight.md); Escape-cancel unavailable under Wayland;
   packaged-native full-parity is an X11-proxied *expectation*, unverifiable here. Every future
   regression check of the flagship gesture is an X11-relaunch protocol.
2. **Accepted race (documented):** tear-off-first cross-pipe arrival → misplaced window C +
   `not-dragging` refusal; vanishing, recoverable, non-self-healing *because of* the gate — trade ruled.
3. **The keyed gauntlet debt compounds:** F10's a11y/behavior carry + `cross-window-drag.md` first run
   + the re-scoped `tab-tearoff` re-run (rows 8/8a/9 + HIGH-1). Criterion 8 has a witness but no
   *executed* repeatable net until the gauntlet runs.
4. **`tearoff-overlay-manager.js` is consumer-less on the drag path** (kept deliberately; its teardown
   test still spends ~56ms) — keep-or-retire is a maintenance question.
5. Deliberate Leg 3 cuts: adopted tabs append-only (no insertion-index placement); no drop-position
   indicator in the target strip.

## Recommendations (ranked)

1. **[Critical] Discharge the operator gauntlet** — first run of `cross-window-drag.md` + the re-scoped
   `tab-tearoff` re-run, stacked with the F10 carry. Consider making the gauntlet a mission-close gate
   rather than a rolling carry — it is compounding toward one large unverified block at mission debrief.
2. **[Critical, methodology] Promote the spike-fidelity rule to mission-control**: a transport/
   environment spike must replicate the app's real launch flags and loading path; probes log an
   environment fingerprint at startup; any inherited GO gets a fixture-fidelity audit before becoming a
   new flight's premise. Belongs in the `/flight` prerequisite interview for flights touching native OS
   behavior.
3. **[Important] Maintenance-flight candidate: source-scan suite economics** — per-call-site pin counts
   spread across suites, the mask blind spot, ~1.0s repeated god-file masking. Options: shared call-site
   registry, or executable pure seams over text pins. Bundle with the `tearoff-overlay` keep-or-retire
   decision (shared surface).
4. **[Important] Write the provenance-gate pattern down** next to the DD8 authority doctrine (declare/
   verify/consume/grace/consume-on-success) — directly reusable for any payload-named-object surface.
5. **[Minor] Promote the HAT-apparatus spec convention** (`OPERATOR:` rows, Executor observe-only,
   synthetic-event prohibition in-spec) to the behavior-test AUTHORING guide **after** it survives its
   first run.
6. **[Minor] Document the native-DnD wiring facts** (document-level `dragover` + no-drag `#tabs` drop
   target; `dropEffect='move'` mandatory; target-driven move — source `dragend.dropEffect` reads `none`
   even on success) as a CLAUDE.md invariant note; today they live only in code comments and the log.
7. **[Minor] Packaged-build smoke check of criterion 8** when a release flight next runs — the
   full-parity claim currently rests on the X11 proxy.

## Skill Effectiveness Notes (for mission-control)

- The scope-change protocol absorbed a mid-leg rip-out-and-rebuild without artifact rewrites — the
  pivot-as-commentary rule worked as designed under real pressure.
- The HAT fix-vs-feature gate and per-increment operator gates were the strongest acceptance instrument
  this flight; the weakest was the session-1 log-reading acceptance ("VERIFIED WORKING") that a
  discriminating gesture check overturned.
- Debugging heuristic worth adding to leg-execution guidance: timing-dependence (fast-works/slow-fails/
  logging-changes-it) reads as a race signature, but N consecutive code-shaped hypothesis failures
  against one persistent symptom should trigger an environment-fidelity probe as the next move.
