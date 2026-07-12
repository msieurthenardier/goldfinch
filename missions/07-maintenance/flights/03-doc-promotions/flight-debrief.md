# Flight Debrief: Doc Promotions

**Date**: 2026-07-11
**Flight**: [Doc Promotions](flight.md)
**Status**: landed
**Duration**: 2026-07-11 (single execution session; design + both legs + batched review)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The flight landed exactly what it specified, with the design predicting the
diff: four CLAUDE.md pattern promotions (uniform focus rule, `action:rowId`
confirm-transition key, the DD1 shared-module story rewrite, MockTimers
recipe), the CP1 full-file consistency sweep (clean — every hit judged
exempt as sanctioned historical framing), the two boot-free invariant pins
(`preload-graph-esm-free.test.js`, `seam-contract.test.js`) with CP2
fail-on-violation demonstrated on scratch copies, and one sanctioned
comment-only `src/` change (the `openContainerOverlay` consumer tag). The
doc-debt window F2's debrief opened ("CLAUDE.md actively misdescribes
`src/shared/` until Flight 3 lands") is closed, and F2's Recommendations
1–3 plus F1's MockTimers action item are all discharged. No diverts; the
adaptation criterion (seam-test fallback) was never needed.

### Mission Criteria Advanced

- **Criterion 4** (CLAUDE.md carries the focus rule, `action:rowId` key,
  and a post-ESM DD10(b) checklist) — fully met; the rewrite went wider
  than the criterion per DD1.
- **Criterion 5** (gates stay green) — held throughout: 1293/1293
  (1284 + 9 new), typecheck clean, lint clean at landing.
- **Criterion 1's documentation tail** — the ESM conversion's story is now
  documented as current rather than pointer-deferred.

## What Went Well

- **Probe-based design reviews caught two real defects before any code
  existed**: the naive ESM-export detector's `export async function` false
  negative (a live pattern at `scripts/lib/mcp-client.mjs:58`) and the
  wrong seam trailing-comment count (5 → 6). Both reviews were empirical —
  reviewers reproduced extractions and cache mechanics in scratch dirs
  rather than opining. This continues F2's "empirical beats analytical"
  finding and is now 3-for-3 across maintenance flights.
- **Citation-audit discipline was load-bearing, not decoration**: 21
  citations verified across the two legs at design time; the one drift
  found (a11y-audit `SHEET_STATES` shifted ~1 line) was neutralized by
  symbol-citing. Implementing agents reported zero improvisation.
- **Evidence-demanding acceptance criteria**: AC6/CP1 specified the exact
  grep to run with hit-by-hit judgments recorded; CP2 required pasting
  actual failing `AssertionError` output into the flight log. Criteria that
  demand pasted evidence are harder to satisfy vacuously than checkboxes —
  the batched Reviewer then independently re-ran all of it and confirmed.
- **Batched flight-level review (agentic-workflow shape)**: one Reviewer
  pass over both legs' uncommitted changes found zero issues on the first
  cycle. For a two-leg docs+tests flight, deferring review to the end cost
  nothing and saved a full review/fix cycle.
- **DD3's two-tier extraction ruling paid off exactly as designed**: a
  call-site-only regex would have silently covered 6/11 of the real audit
  surface; the shipped test unions direct `evaluate()` literals with the
  `SHEET_STATES` `open:` literals and pins all 11 against the 18-entry
  seam.

## What Could Be Improved

### Process

- **Single-run timing figures are not trend signals.** The debrief's
  required single suite run measured 1174.9ms — above both F1/F2's
  multi-run means (~1036–1043ms) and this flight's own landing-time ~971ms
  record. F1's own data shows a >150ms run-to-run spread on unchanged
  code, and the two new test files measured sub-ms individually, so this
  is almost certainly variance, not regression — but a single-run debrief
  instruction invites exactly this ambiguity. Debrief metrics capture
  should use 3–5 runs (as F1/F2 did) before any faster/slower narrative.
- **Count-based ACs need a count-verification pass at design time.** Both
  design-review catches this flight were wrong-count/wrong-pattern
  errors in the leg draft (trailing-comment count, detector alternation).
  The reviews caught them, but a designer self-check ("re-derive every
  literal count in the AC from the tree before review") would make the
  review a confirmation rather than the discovery mechanism.

### Technical

- **`SEAM_COUNT = 18` is now a second source of truth for seam size**,
  alongside CLAUDE.md's prose. The test header instructs updating both
  together, but nothing cross-enforces consistency between the constant
  and the doc (an inconsistent bump — 19 in one place, 20 in the other —
  is not caught). Accepted as DD2's trade-off; named here so the next
  seam-touching flight budgets the dual update.
- **The require-cache pin is a standing but as-yet-unexercised test**:
  `automation-dev.js` / `internal-page.js` have zero own `require()` calls
  today, so only its truth-table sub-tests exercise real logic. Its value
  is entirely prospective (the F2 leg-1 blocker class); that's by design,
  but worth stating plainly.

### Documentation

- **CLAUDE.md doesn't cross-reference its own enforcement.** Leg 1 wrote
  the seam closed-set rule and the PRELOAD-REACHABLE constraint one leg
  before leg 2 created the tests that pin them — so the rewritten prose
  never mentions `seam-contract.test.js` / `preload-graph-esm-free.test.js`
  (grep-verified). A one-line pointer at each rule ("pinned by
  `test/unit/…`") would tell a future editor that changing the seam or the
  quartet has a co-located test obligation. Small, rides any next
  CLAUDE.md touch.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| *(none — both legs implemented to spec; both design-review corrections were adopted pre-implementation, and no adaptation criterion fired)* | — | — |

## Key Learnings

- **Two-tier extraction generalizes**: when a consumer drives named
  identifiers both directly (call-site literals) and indirectly (through a
  data table), a single-pattern static extraction silently covers a
  fraction of the real surface. Probe the recovered-identifier count
  against a hand count before trusting any static contract test.
- **"Docs first, then pin what the docs claim" is a sound leg split**: leg
  2's tests took their targets (the closed-set rule, the
  PRELOAD-REACHABLE constraint) directly from leg 1's rewritten prose,
  which made the pins' intent audit-traceable. The residue (docs not
  naming their pins) is the sequencing's one cost — see Documentation.
- **The vanilla-Node require(esm) probe was correctly ruled a
  non-reopener**: a reviewer's scratch probe showed vanilla Node 22
  `require()` loads ESM transparently; the F2 constraint is
  Electron-42-empirical and the pin is source-text based, valid under
  either runtime behavior. Lesson: platform-empirical findings (Electron)
  outrank same-name probes on adjacent platforms (vanilla Node) — don't
  soften docs on the weaker evidence.
- **Test metrics** (single run this debrief): 1293/1293, 0 skip, 0 flakes
  observed, runner-reported 1174.9ms (wall 1.367s). Count reconciles
  exactly (+9 new). Slowest test unchanged from F1's observation
  (`downloads-store.test.js` monotonic-id test, ~438ms — was 410ms; same
  file F1 flagged, no new outliers). Both new files are sub-ms per test as
  designed. Duration sits above the F1/F2 multi-run means but within
  plausible variance — see Process improvement above; next debrief should
  multi-run before reading a trend.

## Recommendations

1. **Adopt multi-run suite timing (3–5 runs) as the debrief-metrics
   standard** — methodology-level; carry to the mission debrief for the
   mission-control side (the debrief skill currently instructs a single
   run).
2. **Add the enforcement cross-references to CLAUDE.md** on its next
   touch: one line at the seam closed-set rule and one at the
   PRELOAD-REACHABLE/quartet paragraph naming their pinning tests
   (includes the `SEAM_COUNT` dual-update obligation).
3. **Standardize the recon → probe-based design review → citation-audit
   pipeline for maintenance/doc flights** — it caught every defect this
   flight had, all pre-implementation; carry to the mission debrief as a
   methodology observation (3-for-3 across M07).
4. **Designer self-check for count-based ACs**: re-derive every literal
   count/pattern in an AC from the tree before requesting design review.

## Action Items

- [ ] Next CLAUDE.md touch: add "pinned by `test/unit/seam-contract.test.js`"
      to the seam closed-set rule and "pinned by
      `test/unit/preload-graph-esm-free.test.js`" to the
      PRELOAD-REACHABLE quartet paragraph (Rec 2)
- [ ] Mission debrief: carry Rec 1 (multi-run timing) and Rec 3 (empirical
      design-review pipeline, 3-for-3) as methodology feedback
- [ ] Next seam or quartet change: update `SEAM_COUNT` /
      the require-cache module list in lockstep with CLAUDE.md (standing
      obligation, documented in both test headers)
