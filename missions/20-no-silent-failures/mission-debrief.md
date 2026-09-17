# Mission Debrief: No Silent Failures

**Date**: 2026-09-17
**Mission**: [No Silent Failures](mission.md)
**Status**: completed
**Duration**: 2026-09-15 – 2026-09-17
**Flights Completed**: 3 of 3 flown (Flight 4 "Alignment" was optional and
retired unflown — each flight closed with its own HAT, so a mission-closing
look-and-feel session had nothing left to align)

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1. A failed navigation never renders an empty document | met | F1: `did-fail-load` → `loadFailure` on the entry, the guest hidden, the panel shown with code and address |
| 2. Failure is visible from the tab strip | met | `deriveStripLoadState` (one writer): failed / cert-blocked / crashed / hung, glyph + aria suffix |
| 3. Untrusted certificates get an interstitial, not a blank | met | F2: `certificate-error` answered at once; the interstitial specialises the F1 panel; human-only proceed on the sheet |
| 4. Insecure connections are labelled | met | F2: one `SECURITY_STATES` derivation behind the chip, the site-info row, and the census |
| 5. A site's certificate is inspectable | met | F2: read-only `cert-viewer` card fed by the verify-proc observer; strings only, no PEM |
| 6. A crashed tab recovers in place | met | F3: reason-aware panel + Reload that respawns the renderer with history intact |
| 7. A crashed chrome view recovers without losing the window | met | F3: reload-and-reconcile through the boot barrier, internal tabs included, cap 3/60 s |
| 8. A hung tab offers wait-or-kill | met | F3: non-blocking bar, Wait, Kill-and-reload with immediate feedback, self-clearing on `responsive` |
| 9. Every crash leaves a local record | met | F3: closed eight-field record, host-only origin, local dumps pruned to 20, no egress observed |
| 10. New surfaces are safe and accessible | **partial** | Text-only rendering, a11y audit green on every new state, census enum complete (`ok / failed / cert-blocked / crashed / hung`). The keyboard-operable half is blocked by Known Issue #216, left open by operator ruling |

### Overall Outcome

The mission achieved its stated outcome. A navigation that cannot complete, a
connection the browser refuses to trust, a renderer that has died or frozen,
and a chrome view that has crashed each now get a surface that names what
happened and offers the right next step. Nine of ten criteria are met; the
tenth is partial on one open focus defect.

The mission's own founding anecdote is closed: the corporate-VPN TLS
interception that made the browser "appear entirely broken at launch" now
produces an interstitial naming the certificate problem, with an informed
override and a way to inspect the certificate.

Volume, for calibration: 148 files, +27,674 / −1,012 lines, 15 new source
modules, three behavior specs, twelve squawks in the mission's range (seven
completed, one deferred, four open), across three days.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1. The failure surface and navigation errors (#163) | completed (PR #215) | Decided the mission's one hard-to-reverse choice — a chrome-DOM panel in the guest slot, guest hidden not occluded — and the two-axis visibility invariant every later surface inherited. Found #216 at its HAT |
| 2. TLS trust: interstitial, override, indicator, viewer (#143) | completed (PR #217) | Answer-at-once `certificate-error`, session-only per-origin override memory, one security derivation behind chip/popup/census, read-only certificate viewer. Established the four-guard decision channel and the per-tab push-channel rule the hard way |
| 3. Crash and hang resilience (#133 + hung renderers) | completed (PR #219) | Crash panel with Reload, hang bar with wait-or-kill, chrome reload-and-reconcile with a storm cap, crash records with a closed field set. Applied F2's lessons from the start with no equivalent defect |
| 4. Alignment | retired unflown | Optional; each flight's own HAT did the work |

## What Went Well

- **One mechanism, three specialisations — and it held.** `src/shared/load-failure.js`
  is one pure module every flight added to rather than forking;
  `load-failure-controller.js`'s `render(tab)` is one function branching
  crash → cert → failure; the visibility invariant grew a third term
  (`guestTakenOver`) instead of a second invariant. A decision made once in
  Flight 1 was inherited, not re-derived.
- **The per-tab state model became coherent.** Four states on the registry
  entry, each on its own owner-routed channel, with `pushTabStateFor` as the
  single re-push definition shared by cross-window move and chrome recovery.
- **The debrief-to-next-flight pipeline works for process lessons.** Flight 2
  learned the push-channel rule from live defects, named it in CLAUDE.md
  (squawk 0081), and Flight 3 applied it to two new states with no equivalent
  defect. Same for settle-before-read and the dedicated acceptance-gate leg.
- **Security controls enforced as data-flow shapes, not review checklists.**
  The override memory (no persistence import, grep-AC'd) and the crash record
  (destructure-not-spread, eight-key literal, source-scan pinned) are the same
  idea applied twice with equal rigor — the mission's most exportable pattern.
- **A dedicated acceptance-gate leg earned its keep twice.** Flight 2 found
  five defects in its run; Flight 3 found two the whole unit suite missed
  (a paused window still reporting itself booted, and a dump prune that never
  reached the real directory) plus a pre-existing contrast violation.
- **Spike-first prevented a wrong build.** Flight 3's leg 1 found that the
  forced-crash call reports `crashed`, not `killed`, before any feature code
  existed; the design amendment cost nothing.
- **Test suite grew without slowing.** 4565 → 4783 → 4996 tests across the
  three flights at a steady 5.0–5.5 s, no skips, no flakes; the new modules are
  filesystem- and Electron-free.
- **Key hygiene held under pressure.** Env-only admin keys, scripts that never
  print them, every scratch log shredded. One transient exposure through the
  harness's own file-change surfacing was contained by rotation.

## What Could Be Improved

- **The composition root's headroom was never fixed, only re-bought.**
  `renderer.js` ended Flight 1 at 1858/1858, was re-pinned five times inside
  Flight 2, got a real extraction in Flight 3 (1806 → 1532) and still sits at
  1576/1577 today. Three consecutive debriefs recommended the *next*
  extraction; none happened. Pinning the budget to the measured minimum is the
  proximate cause.
- **#216 was diagnosed twice and fixed neither time.** Flight 1 found it at its
  HAT; Flight 2 shipped a `chromeNavPending` fix that is unit-pinned but
  confirmed not to fix the live symptom. It affects every hidden-guest surface
  the mission built, including a security-decision card, and it is exactly the
  class of defect the mission exists to eliminate — a surface that explains
  itself but that a keyboard-only operator cannot reliably reach.
- **Squawk 0075 was routed around in all three flights** rather than fixed:
  `captureWindow` composites a hidden guest over chrome-DOM panels under the
  Wayland fallback. Every flight substituted `captureScreenshot(chromeWcId)`.
  It is a real rendering defect, not only a test inconvenience.
- **Two patterns are used consistently but documented inconsistently.** The
  four-guard decision channel and the closed-field-set control each live inside
  a mission-specific CLAUDE.md section; whoever plans the next security channel
  will not find them.
- **A same-flight DD composition gap.** Flight 3's crash reporter changed the
  process signal behaviour its own apparatus depended on, and no spike caught
  it because the two decisions were verified in different legs against
  different binaries.
- **Look and feel was the operator's only real intervention point** across all
  three HATs (the interstitial restyle, then a glyph, a button family and a font
  weight). Operator ruling: the HAT is the right place for it — the cost is low
  and the judgement is inherently by-eye.

## Lessons Learned

1. **Decide the surface mechanism once, early, and make later states
   specialise it.** The mission's hardest-to-reverse decision was Flight 1's
   first, and every later surface was cheaper because of it.
2. **Per-tab state gets its own push channel.** Riding an existing channel
   couples unrelated resets; this cost Flight 2 two live defects and cost
   Flight 3 nothing.
3. **Enforce "must never leak X" as a shape, not a rule.** Destructure rather
   than spread; refuse the persistence import; pin it with a source scan.
4. **A live acceptance gate finds a class of defect no unit suite can.** Both
   flights that ran one found real bugs in the interaction between finished
   features, not within them.
5. **A unit-pinned fix for a live symptom is not a fix.** #216's Flight 2
   attempt passed its tests and changed nothing the operator could see. Any
   retry needs a live by-eye gate as a hard acceptance criterion.
6. **When a decision installs a global hook, re-run the earlier spike premises
   it could invalidate** — inside the same flight, not only across flights.
7. **A stopped renderer produces no compositor frame.** Visibility under
   `SIGSTOP` is permanently a by-eye observable; mark such clauses at authoring.
8. **The frameless window's only exit lives in the chrome DOM.** Any state that
   kills the chrome needs a main-owned affordance or an honest close.

## Methodology Feedback

- **The mission → flight → leg hierarchy fit this work well.** Three flights,
  each one coherent decision cluster; the optional fourth was correctly
  retired rather than flown for completeness.
- **Deferred commit until after the last autonomous leg worked.** One review
  over the whole diff caught what per-leg reviews would have fragmented, and
  the operator's oversight did not suffer.
- **The two-cycle design-review cap is the right rule**, with the Flight
  Director folding verified, decision-free fixes at the cap and escalating only
  design questions. Operator confirmed this as standing practice.
- **Fix-and-continue during a live run is the right cadence** (operator
  confirmed twice): fix, relaunch, re-run the failed row, and keep the
  fail/pass pair in the run log as the fix-verification record.
- **Behavior specs stay on-demand, re-run when a flight touches their
  surfaces** (operator ruling) rather than becoming a pre-release gate.
- **Gap in the methodology worth fixing**: a leg's own live smoke should
  exercise every *existing* apparatus primitive against the leg's new state,
  not only the primitive the leg added. Flight 3's leg 3 reached the paused
  state but never read the tab census against it, deferring a real defect to
  the acceptance leg at higher cost.
- **Harness hygiene note for future live-rig legs**: redirect the dev app's
  stdout to a path outside any watched scratchpad directory, or scrub the mint
  line before it can surface, since the harness's own file-change reporting can
  quote a log into a transcript.

## Action Items

- [ ] Extract the panel-family projection glue (welcome / load-failure / crash /
      hang) out of `activateTab` into a shared controller and re-pin
      `RENDERER_LINE_BUDGET` with ≥ 60 lines of real slack — before any new
      mission adds a chrome surface. Third consecutive debrief to ask.
- [ ] Fix or definitively re-scope #216, with a live by-eye gate as a hard
      acceptance criterion. Untried leading hypothesis is on file (move the
      disarm to the error document's own `did-finish-load`).
- [ ] Un-defer squawk 0075 (`captureWindow` over a hidden guest under the
      Wayland fallback) or re-classify it as permanent apparatus guidance.
- [ ] Write the four-guard decision-channel shape and the
      closed-field-set-as-security-control shape into CLAUDE.md as standalone,
      mission-agnostic patterns.
- [ ] Complete the four open squawks: 0082 (crew apparatus notes), 0083
      (`closeTab` on a background failed tab), 0084 (dedupe branch pin), 0085
      (docs incl. the SEGV/Crashpad finding and the two new planning rules).
- [ ] Investigate the SEGV/Crashpad interaction as a scoped follow-up: a real
      page segfault may present as a hang rather than a crash, a
      misclassification inside the very distinction this mission built.
- [ ] Consider standing repo-wide grep tests (the `seam-contract.test.js`
      idiom) for the `guestTakenOver` invariant and the one-channel-per-state
      rule, so a future violation fails without a flight-specific test being
      written first.
