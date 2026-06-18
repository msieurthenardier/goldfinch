# Flight Debrief: External-consumer enablement + README reframe

**Date**: 2026-06-17
**Flight**: [External-consumer enablement + README reframe](flight.md)
**Status**: landed
**Duration**: 2026-06-17 (planned + executed same day; F9 merged → planning → 5-leg execution → land)
**Legs Completed**: 5 of 5

> **Brief debrief** — small docs/closeout flight (4 files, no engine changes). Crew interviews skipped:
> the Flight Director had full ground truth from orchestration, and the test suite was already run green
> during execution. Metrics captured from that run.

## Outcome Assessment

### Objectives Achieved
Yes. The flight turned the already-built, already-demonstrated MCP automation surface into a finalized,
documented external-consumer contract and reframed the project front door:
- README reframed from media-panel-only → control / privacy / **automatability**.
- `docs/mcp-automation.md` gained a stated **Consumer Contract** index + reach boundary + a consolidated
  production getting-started.
- `scripts/mcp-example-client.mjs` fixed to **authenticate** (it sent no auth and would have 401'd).
- `CLAUDE.md` carried the `runSerialized` dev-pattern (F9 Rec 3).

### Mission Criteria Advanced
- **SC6** (external MCP client drives end-to-end) — **closed.** Demonstrated by the-one (native external
  install); finalized here as documentation + a verified-by-review getting-started. Last open
  external-facing criterion of the mission.

### Checkpoints
All four met (README, Consumer Contract + getting-started, example-client auth fix, CLAUDE.md pattern).

## What Went Well
- **Architect flight-review caught the load-bearing defect pre-implementation.** The example client
  sent no auth (would 401 against the F4+ gate) — found at design review, fixed as its own leg (DD6),
  not discovered mid-run.
- **Parallel fan-out fit the shape.** 4 independent files → 4 parallel design reviews + 4 parallel
  implementers, no conflicts; single review + commit at the end. Efficient for a docs flight.
- **Scope discipline.** Operator trimmed the original Flight-10 line hard (the-one live drive, reach/shim,
  createJar all removed/deferred) — kept it a true closeout instead of letting it sprawl.

## What Could Be Improved

### Process
- **Per-leg design reviews were near-redundant after the Architect flight review.** Four Sonnet reviews
  all returned approve-with-changes with mostly line-number/precision nits. For a docs flight already
  Architect-reviewed, a single consolidated design review (or skipping straight to implement on the
  trivial legs) would have saved ~4 agent round-trips with little lost signal. Consider a "docs/closeout
  flight" lighter cadence.

### Technical
- **Stale-comment drift was the root cause of the one real bug.** The example client carried a Flight-3
  "connects without auth" / "17 tools" comment that masked a genuine auth gap. Echoes F9's
  "behavior-spec count sweep was reactive" lesson — prose claims in scripts/specs drift silently.

### Documentation
- This flight *was* the documentation; README/CLAUDE.md/docs are now current with the shipped surface.

### Test Metrics
- `npm test`: **773 pass / 0 fail / 0 skipped**, ~**0.89s** wall-clock (`node --test test/unit/*.test.js`).
  `typecheck` clean; `lint` clean; `node --check` on the edited script OK.
- vs prior (F9 debrief context): unit count up modestly with no new failures/skips/flakes; suite stays
  sub-second. No engine source changed this flight, so the delta is the example-client edit only.

## Deviations and Lessons Learned
- **Live SC6 confirmation operator-waived.** Planned as the leg-5 close; the operator judged it low
  marginal value (SC6 already demonstrated by the-one; the auth fix is character-for-character identical
  to the proven `scripts/lib/mcp-client.mjs`). Recorded as an accepted disposition, not a gap.
- **Lesson:** a copy-pasteable "example client" is a contract artifact — when the gate changes (F4 added
  auth), the example must change with it. It silently lagged two flights.

## Key Learnings
- Adversarial design review pays off even on a "just docs" flight — the one non-doc defect was the
  highest-value find and would otherwise have shipped a broken getting-started.
- Comment/prose claims in shipped scripts need the same drift-check rigor as code (recurring theme F9→F10).

## Recommendations
1. **Add a prose-claim drift check** (tool counts, "no auth"/"N tools" assertions in scripts/specs) to
   `/preflight-check` or flight recon — recurring across F9 and F10.
2. **Lighter review cadence for docs/closeout flights** — one consolidated design review after the
   Architect pass, not per-leg, when legs are trivial and independent.
3. **(Optional) the deferred `createJar`** — when scoped, pair it with the two-container farbling primary
   path (F9 Rec 5) and a real jar-lifecycle for external consumers.

## Action Items
- [ ] Carry `createJar` (jar-lifecycle MCP tool) into a future flight when prioritized. (Rec 3)
- [ ] (Optional) Live example-client getting-started run on the operator's session for full empirical
      closure — non-blocking; a doc bug would be a one-line follow-up. (Deviation)
- [ ] (Process, mission-control) Consider a prose-claim drift check + a docs-flight review cadence. (Recs 1-2)
