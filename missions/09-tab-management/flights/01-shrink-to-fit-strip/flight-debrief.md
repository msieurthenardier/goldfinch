# Flight Debrief: Shrink-to-Fit Tab Strip

**Date**: 2026-07-14
**Flight**: [Shrink-to-Fit Tab Strip](flight.md)
**Status**: landed
**Duration**: 2026-07-14 (single day: design → two legs → fix cycle → land)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The flight delivered its full objective: Chrome-style progressive tab shrink
(title-hide ≤72px → inactive close-hide ≤56px → padding-compress ≤40px, via
CSS container queries with zero JS), a structurally impossible scrollbar
(`overflow: hidden`, no global width floor), a rendered-and-hit-testable
active-tab close at every count (64px active-only floor + paired
favicon-hide — the DD2 amendment), and middle-click close riding the exact
✕ deferred-reflow path. The `responsive-tab-strip` spec was evolved to a
numeric-read-primary apparatus and passed 10/10 on the landing tree
(runs `2026-07-14-14-44-17` fail → fix → `2026-07-14-15-47-10` pass).
PR #84. BACKLOG's shrink-to-fit entry retired — the first BACKLOG entry to
reach a "landed" disposition.

### Mission Criteria Advanced

- SC1 (no scrollbar at any count, staged disclosure, active keeps close) —
  **fully advanced**, behavior-test-backed.
- SC6's middle-click clause — **pulled forward and done**; the context-menu
  flight inherits it.

## What Went Well

- **The Witnessed pattern earned its cost on its first M09 outing.** Run 1's
  Step 5 caught a real production defect — the active tab's close button
  read `display:block` in the DOM while its 16px box sat ~19px outside its
  own 14.33px tab, clipped invisible — that the implementer's own live
  spot-check had passed, because the spot-check trusted a computed-`display`
  read. The spec's DD4 rule (numeric reads primary, screenshot authoritative
  on divergence) is precisely what fired. The independent Validator then
  re-derived the fix's correctness in run 2 from raw rect arithmetic plus
  its own magnified-pixel inspection rather than trusting the Executor.
- **DD1 (container queries) held as a mechanism** — no misrender, DOM and
  pixels agreed at every threshold; the fallback (ResizeObserver) was never
  needed. The one failure was selector scoping (see below), cleanly
  distinguished in the log from a mechanism-premise failure.
- **DD3/DD4 landed exactly as designed** — the pre-verified apparatus fact
  (MCP `click` forwards `button:'middle'`) meant trusted middle-click was
  drivable with zero surprises, and the numeric-first spec removed the old
  Step-6 reflow-cause ambiguity entirely (byte-identical width sets,
  `elementFromPoint` identity checks at the unmoved coordinate).
- **The amendment path worked as process**: DD2's absolute ("no floor") was
  narrowed post-run-1 via a flight-log Decision (active-tab-only floor),
  preserving the original rationale as history instead of rewriting
  flight.md — fast to execute, fully auditable.
- **Apparatus resilience**: the run-1 pre-flight block (env-pinned port 49707
  held outside the WSL netns; a stale instance confusing discovery) was
  diagnosed and resolved by relaunching on free-fallback, and the learning
  was immediately folded into the spec's preconditions (pin-if-free rule).

## What Could Be Improved

### Process

- **Design review should arithmetic-check fixed-size content against
  floorless shrink.** The flight's central defect was catchable at design
  time: DD1 promised the active tab keeps its close button; DD2 removed all
  width floors; a 16px button cannot render inside a <16px tab. Both the
  flight design and its Architect review reasoned about sliver-width
  trade-offs generally but never ran that five-minute check against the
  active tab's fixed-size child. Recommendation 1 below.
- **"Acceptable variations" phrasing invited a false binary.** The flight
  barred "a hard min-width floor" absolutely, without asking whether a
  *scoped* floor was actually barred by the stated rationale (it wasn't —
  one floored tab can't violate no-clip under the 900px window minimum).
  Adaptation-criteria authors should ask "is there a scoped version of the
  barred change the rationale doesn't actually bar?" before writing an
  absolute divert trigger.
- **Verify-legs should be sized/named for a fix loop.** Leg 2's ACs
  correctly anticipated "failed step is investigated and fixed before the
  leg lands," and that clause absorbed a root-cause + DD amendment + CSS
  fix + full re-run cycle. The process held, but future build/verify flights
  should expect the verify leg to sometimes be the heavier one.

### Technical

- **Leg guidance contradicted its own caution.** Leg 1's Implementation
  Guidance flagged "`@container` rules match *descendants*" one line above
  a suggested snippet that targeted the container itself — a structurally
  impossible rule that CSS silently no-ops (no error; `getComputedStyle`
  simply never reflects it). It cost one implementation cycle and produced a
  real (caught) clipping bug. Mechanical check for future legs: does the
  suggested `@container` block's inner selector equal the container's own
  selector? Also: a leg premise-check should cover the *specific selector
  shape* being suggested, not just "does the feature render at all."
- **Residual verification gap**: maximize/restore geometry is verified only
  on WSLg (run 2 passed on outer-metrics evidence; the renderer
  inner-viewport lag/desync is an environment artifact) — the
  native-compositor manual check remains open, routed to the HAT flight.

### Documentation

- CLAUDE.md should gain the **container-query self-restyle pitfall** (a
  recurring-failure-mode note in the same spirit as the native-surface
  section — the next container-query stage anywhere in the app will hit it)
  and a short **tab-strip DOM/CSS structure** paragraph (`.tab` as pure
  sizing/query container; `.tab-row` carries layout/padding; the three
  disclosure stages + active-tab floor). Deferred to the next doc pass /
  flight-completion doc step of a later M09 flight rather than a standalone
  commit now.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Padding-compress stage moved to a new `.tab-row` inner wrapper instead of `.tab` itself | CSS container queries cannot restyle their own query container (silent no-op; probed live) | Yes — the wrapper split (container box vs layout box) is the template for any future container-query disclosure stage |
| DD2 amended post-run-1: active-tab-only 64px floor + favicon-hide | Run-1 Step 5 proved the active close clipped at sliver widths; a scoped floor doesn't violate the no-clip rationale | Yes — as a *process* pattern: narrow an absolute via a flight-log Decision, preserving the original DD as history |
| App launched without the env port pin (free-fallback) | `GOLDFINCH_MCP_PORT=49707` held outside the WSL netns (invisible to `ss`); pin-exactly failed loudly as designed | Yes — spec precondition updated to pin-if-free / else free-fallback + read the bound port |
| Middle-click clause of the context-menu criterion pulled into this flight | Same surface as the deferred-reflow close path | No further action — one-time sequencing call |

## Key Learnings

1. **"DOM correct ≠ render correct" applies to plain chrome DOM too.** The
   project's native-surface warning is written about `WebContentsView`
   compositor surfaces; this flight demonstrated the same trap one layer up
   — overflow-clipping inside ordinary chrome DOM, invisible to
   computed-style reads. The rect-containment + rendered-glyph assertion is
   the general antidote.
2. **A verification tier is only as strong as its weakest observable.** The
   implementer spot-check and the Witnessed run drove the same app to the
   same state; only the rule about *which observable is authoritative*
   separated a false pass from a true fail.
3. **Test metrics**: 1527/1527 unit assertions, 13 suites, ~1.18s wall-clock,
   no flakes across two timed runs. +25 tests vs mission 08's close
   (1502/1502) — all attributable to the inter-mission security-audit
   commits (`9d7f650`, `5f10cb1`), zero from this flight (CSS-only; the
   electron-free suite can't reach it — the expected flat delta). Wall-clock
   remains in the sub-1.2s post-M07-mock-timers band; no slowdown.
4. **Apparatus learnings for future specs**: `pressKey` wants `ShiftTab`
   (not `Shift+Tab`); the backward focus walk to the tablist passes focus
   through the window controls (a stray Enter would hit Close);
   `#window-controls` sits inside `#tabstrip` so window-control clicks never
   end the width freeze; fixture HTTP caching preserves stale titles after
   on-disk fixture edits.

## Recommendations

1. **Add a "fixed-size-content vs floorless-shrink" cross-check to flight
   design review** (flight-design crew prompt or checklist): whenever a DD
   removes a size floor while any DD/AC promises a fixed-size affordance
   stays visible, run the box arithmetic at review time.
2. **Promote rect-containment + rendered-glyph to a named authoring pattern**
   (behavior-test AUTHORING.md): any "affordance X remains visible/usable at
   state Y" criterion defaults to rect-containment + a rendered-pixel check;
   DOM `display` reads are a fast precondition filter, never the sole pass
   criterion. (Methodology-side change — carry to the mission debrief.)
3. **CLAUDE.md doc pass rider on a future M09 flight**: container-query
   self-restyle pitfall + tab-strip structure paragraph (see Documentation
   above).
4. **Flight 2 (reorder) design inputs**: sliver tabs (~13px) are the drag
   target floor — decide explicitly how pointer drag behaves at pathological
   counts and lean on the keyboard-reorder equivalent; reuse this flight's
   advisories (Tab-order gap, pill-snap) as known context, not
   rediscoveries.
5. **HAT flight budget**: schedule the native-compositor maximize/restore
   recheck early in the HAT session (it has now consumed time in two runs);
   also carry the three small advisories (forward-Tab order, pill-snap UX,
   fixture charset) as HAT triage items.

## Action Items

- [ ] Flight 2 design: fold in sliver-drag constraint + advisories
      (owner: flight-design phase of the next flight).
- [ ] Mission debrief carry-forward: AUTHORING.md rect-containment pattern;
      flight-design arithmetic cross-check (methodology-side).
- [ ] CLAUDE.md rider on a future M09 flight: container-query pitfall +
      tab-strip structure note.
- [ ] HAT flight: native maximize/restore recheck (early), advisory triage.
